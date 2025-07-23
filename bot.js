require('dotenv').config();
const express = require('express');
const { Telegraf, session, Markup } = require('telegraf');
const { database } = require('./fire');

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

const SIGNUP_BONUS = 50;
const REFERRAL_BONUS = 50;
const MIN_WITHDRAW = 350;
const GROUP_ID = Number(process.env.GROUP_ID); // must be a number
const WHATSAPP_LINK = process.env.WHATSAPP_LINK;
const GROUP_USERNAME = process.env.GROUP_USERNAME; // username without @

// Get and cache bot username
let botUsername = '';
bot.telegram.getMe().then((botInfo) => {
  botUsername = botInfo.username;
});

// Firebase helpers
const userRef = (userId) => database.ref(`users/${userId}`);
const getUser = async (userId) => {
  const snap = await userRef(userId).once('value');
  return snap.exists() ? snap.val() : null;
};
const saveUser = async (userId, data) => {
  await userRef(userId).update(data);
};

// Group join check
async function hasJoinedGroup(ctx) {
  try {
    const member = await ctx.telegram.getChatMember(GROUP_ID, ctx.from.id);
    return ['member', 'administrator', 'creator'].includes(member.status);
  } catch (err) {
    console.error('Join check error:', err.message);
    return false;
  }
}

// Buttons
function homeButtons() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('💰 My Balance', 'balance')],
    [Markup.button.callback('👥 My Referrals', 'referrals')],
    [Markup.button.callback('📤 Withdraw', 'withdraw')],
    [Markup.button.callback('🔗 Copy My Referral Link', 'myref')]
  ]);
}

// Start command
bot.start(async (ctx) => {
  const userId = ctx.from.id.toString();
  const username = ctx.from.first_name;
  const refCode = ctx.message.text.split(' ')[1];
  const existing = await getUser(userId);

  if (existing) {
    return ctx.reply('✅ You are already registered.', homeButtons());
  }

  ctx.session.refCode = refCode;
  ctx.session.awaitingJoin = true;

  await ctx.reply(
    `👋 Welcome ${username}!\n\nPlease complete the following steps to continue:`,
    Markup.inlineKeyboard([
      [Markup.button.url('✅ Join Telegram Group', `https://t.me/${GROUP_USERNAME}`)],
      [Markup.button.url('✅ Join WhatsApp Group', WHATSAPP_LINK)],
      [Markup.button.callback('🚀 I\'ve Joined Both', 'verify_join')],
      [Markup.button.callback('❌ Cancel', 'cancel')]
    ])
  );
});

// Verify join
bot.action('verify_join', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id.toString();
  const username = ctx.from.first_name;
  const refCode = ctx.session.refCode;

  const alreadyRegistered = await getUser(userId);
  if (alreadyRegistered) {
    return ctx.reply('✅ You are already registered.', homeButtons());
  }

  const joined = await hasJoinedGroup(ctx);
  if (!joined) {
    return ctx.reply(`❌ Please join the Telegram group first:\nhttps://t.me/${GROUP_USERNAME}`);
  }

  const newUser = {
    id: userId,
    imuid: `IM${userId}`,
    username,
    balance: SIGNUP_BONUS,
    referrals: [],
    withdrawals: [],
    ref_by: refCode || ''
  };
  await saveUser(userId, newUser);

  // Referral logic
  if (refCode && refCode !== userId) {
    const refUser = await getUser(refCode);
    if (refUser && !refUser.referrals.includes(userId)) {
      refUser.balance += REFERRAL_BONUS;
      refUser.referrals.push(userId);
      await saveUser(refCode, refUser);
    }
  }

  ctx.session.awaitingJoin = false;

  const referralLink = `https://t.me/${botUsername}?start=${userId}`;
  await ctx.reply(
    `🎉 Welcome ${username}!\n\nYou've received ₦${SIGNUP_BONUS} signup bonus.\n\n🔗 Your referral link:\n${referralLink}`,
    homeButtons()
  );
});

// Cancel
bot.action('cancel', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.session = null;
  ctx.reply('❌ Registration cancelled.');
});

// Balance
bot.action('balance', async (ctx) => {
  const user = await getUser(ctx.from.id);
  ctx.reply(`💰 Your current balance is ₦${user?.balance || 0}`);
});

// Referral link
bot.action('myref', async (ctx) => {
  const link = `https://t.me/${botUsername}?start=${ctx.from.id}`;
  ctx.reply(`🔗 Your referral link:\n${link}`);
});

// Referrals
bot.action('referrals', async (ctx) => {
  const user = await getUser(ctx.from.id);
  const referrals = user?.referrals || [];

  if (referrals.length === 0) {
    return ctx.reply('👥 No referrals yet.');
  }

  let text = `👥 You’ve invited ${referrals.length} user(s):\n`;
  for (let r of referrals) {
    const refUser = await getUser(r);
    text += `- @${refUser?.username || 'Unknown'}\n`;
  }

  ctx.reply(text);
});

// Withdraw
bot.action('withdraw', async (ctx) => {
  const user = await getUser(ctx.from.id);
  if (user.balance < MIN_WITHDRAW) {
    return ctx.reply(`❌ You need at least ₦${MIN_WITHDRAW} to withdraw.`);
  }

  ctx.session.withdraw = { step: 'phone' };
  ctx.reply('📱 Enter your phone number for airtime:');
});

// Handle withdrawal text flow
bot.on('text', async (ctx) => {
  const userId = ctx.from.id.toString();
  const user = await getUser(userId);
  ctx.session = ctx.session || {};

  const step = ctx.session.withdraw?.step;
  if (step === 'phone') {
    ctx.session.withdraw.phone = ctx.message.text;
    ctx.session.withdraw.step = 'network';
    return ctx.reply('📶 Enter your network (MTN, Airtel, Glo, 9mobile):');
  }

  if (step === 'network') {
    const phone = ctx.session.withdraw.phone;
    const network = ctx.message.text;
    const amount = MIN_WITHDRAW;

    const withdrawals = user.withdrawals || [];
    withdrawals.push({ amount, phone, network, status: 'pending' });

    await saveUser(userId, {
      balance: user.balance - amount,
      withdrawals
    });

    ctx.session.withdraw = null;
    return ctx.reply(`✅ Withdrawal request of ₦${amount} submitted!\n📱 Airtime will be sent to ${phone} (${network})`);
  }
});

// Health check
app.get('/', (req, res) => res.send('✅ Airtime bot is running.'));

// Webhook setup
app.use(express.json());
app.use(bot.webhookCallback('/webhook'));
bot.telegram.setWebhook(`${process.env.WEBHOOK_URL}/webhook`);

// OR launch manually for local/dev testing
if (!process.env.WEBHOOK_URL) {
  bot.launch();
  console.log('🚀 Bot launched via polling');
}

// Start Express server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Bot is live on port ${PORT}`);
});
