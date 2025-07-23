require('dotenv').config();
const express = require('express');
const { Telegraf, session, Markup } = require('telegraf');
const { database } = require('./fire');

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

// Webhook setup
app.use(express.json());
app.use(bot.webhookCallback('/webhook'));
bot.telegram.setWebhook(`${process.env.WEBHOOK_URL}/webhook`);

// Constants
const SIGNUP_BONUS = 50;
const REFERRAL_BONUS = 50;
const MIN_WITHDRAW = 350;
const GROUP_USERNAME = process.env.GROUP_USERNAME.replace('@', '');
const WHATSAPP_LINK = process.env.WHATSAPP_LINK;

// Firebase helpers
const userRef = (id) => database.ref(`users/${id}`);
const getUser = async (id) => (await userRef(id).once('value')).val();
const saveUser = async (id, data) => userRef(id).update(data);

// Helpers
const homeButtons = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('💰 My Balance', 'balance')],
    [Markup.button.callback('👥 My Referrals', 'referrals')],
    [Markup.button.callback('📤 Withdraw', 'withdraw')],
    [Markup.button.callback('🔗 Copy My Referral Link', 'myref')],
  ]);

// Delete previous reply if exists
const deletePrevious = async (ctx) => {
  if (ctx.session?.lastMsgId) {
    try {
      await ctx.deleteMessage(ctx.session.lastMsgId);
    } catch (e) {}
  }
};

// Start command
bot.start(async (ctx) => {
  const userId = ctx.from.id.toString();
  const username = ctx.from.first_name;
  const refCode = ctx.message.text.split(' ')[1];
  const existing = await getUser(userId);

  if (existing) {
    return ctx.reply('✅ You are already registered.', homeButtons());
  }

  ctx.session = { refCode, awaitingJoin: true };

  const msg = await ctx.reply(
    `👋 Welcome ${username}!\n\nPlease complete the following steps to continue:`,
    Markup.inlineKeyboard([
      [Markup.button.url('✅ Join Telegram Group', `https://t.me/${GROUP_USERNAME}`)],
      [Markup.button.url('✅ Join WhatsApp Group', WHATSAPP_LINK)],
      [Markup.button.callback('🚀 I\'ve Joined Both', 'verify_join')],
      [Markup.button.callback('❌ Cancel', 'cancel')],
    ])
  );

  ctx.session.lastMsgId = msg.message_id;
});

// Verify group join
bot.action('verify_join', async (ctx) => {
  await ctx.answerCbQuery();
  await deletePrevious(ctx);

  const userId = ctx.from.id.toString();
  const username = ctx.from.first_name;
  const refCode = ctx.session?.refCode;
  const existing = await getUser(userId);

  if (existing) {
    return ctx.reply('✅ You are already registered.', homeButtons());
  }

  // Check Telegram group
  try {
    const member = await ctx.telegram.getChatMember(`@${GROUP_USERNAME}`, userId);
    if (!['member', 'administrator', 'creator'].includes(member.status)) {
      return ctx.reply('❗ You must join the Telegram group to continue.');
    }
  } catch {
    return ctx.reply('❗ Could not verify Telegram group join. Try again.');
  }

  // Save new user
  const newUser = {
    id: userId,
    imuid: `IM${userId}`,
    username,
    balance: SIGNUP_BONUS,
    referrals: [],
    withdrawals: [],
    ref_by: refCode || '',
    joined: new Date().toISOString(),
  };
  await saveUser(userId, newUser);

  // Handle referral
  if (refCode && refCode !== userId) {
    const refUser = await getUser(refCode);
    if (refUser && Array.isArray(refUser.referrals) && !refUser.referrals.includes(userId)) {
      refUser.balance += REFERRAL_BONUS;
      refUser.referrals.push(userId);
      await saveUser(refCode, refUser);
    }
  }

  ctx.session = null;
  const botUsername = (await ctx.telegram.getMe()).username;
  const referralLink = `https://t.me/${botUsername}?start=${userId}`;

  return ctx.reply(
    `🎉 Welcome ${username}!\n\nYou've received ₦${SIGNUP_BONUS} signup bonus.\n\n🔗 Your referral link:\n${referralLink}`,
    homeButtons()
  );
});

// Cancel
bot.action('cancel', async (ctx) => {
  await ctx.answerCbQuery();
  await deletePrevious(ctx);
  ctx.session = null;
  return ctx.reply('❌ Registration cancelled.', homeButtons());
});

// Balance
bot.action('balance', async (ctx) => {
  await ctx.answerCbQuery();
  await deletePrevious(ctx);
  const user = await getUser(ctx.from.id);
  const msg = await ctx.reply(`💰 Your current balance is ₦${user?.balance || 0}`, homeButtons());
  ctx.session = { lastMsgId: msg.message_id };
});

// Referral link
bot.action('myref', async (ctx) => {
  await ctx.answerCbQuery();
  await deletePrevious(ctx);
  const botUsername = (await ctx.telegram.getMe()).username;
  const link = `https://t.me/${botUsername}?start=${ctx.from.id}`;
  const msg = await ctx.reply(`🔗 Your referral link:\n${link}`, homeButtons());
  ctx.session = { lastMsgId: msg.message_id };
});

// Referrals
bot.action('referrals', async (ctx) => {
  await ctx.answerCbQuery();
  await deletePrevious(ctx);

  const user = await getUser(ctx.from.id);
  const referrals = user?.referrals || [];

  if (referrals.length === 0) {
    const msg = await ctx.reply('👥 No referrals yet.', homeButtons());
    ctx.session = { lastMsgId: msg.message_id };
    return;
  }

  let text = `👥 You’ve invited ${referrals.length} user(s):\n`;
  for (const r of referrals) {
    const refUser = await getUser(r);
    text += `- @${refUser?.username || 'Unknown'}\n`;
  }

  const msg = await ctx.reply(text, homeButtons());
  ctx.session = { lastMsgId: msg.message_id };
});

// Withdraw
bot.action('withdraw', async (ctx) => {
  await ctx.answerCbQuery();
  await deletePrevious(ctx);
  const user = await getUser(ctx.from.id);

  if (user.balance < MIN_WITHDRAW) {
    const msg = await ctx.reply(`❌ You need at least ₦${MIN_WITHDRAW} to withdraw.`, homeButtons());
    ctx.session = { lastMsgId: msg.message_id };
    return;
  }

  ctx.session.withdraw = { step: 'phone' };
  const msg = await ctx.reply('📱 Enter your phone number for airtime:');
  ctx.session.lastMsgId = msg.message_id;
});

// Handle user text input
bot.on('text', async (ctx) => {
  const step = ctx.session?.withdraw?.step;
  const userId = ctx.from.id.toString();
  if (!step) return;

  await deletePrevious(ctx);

  if (step === 'phone') {
    ctx.session.withdraw.phone = ctx.message.text;
    ctx.session.withdraw.step = 'network';
    const msg = await ctx.reply('📶 Enter your network (MTN, Airtel, Glo, 9mobile):');
    ctx.session.lastMsgId = msg.message_id;
    return;
  }

  if (step === 'network') {
    const { phone } = ctx.session.withdraw;
    const network = ctx.message.text;
    const amount = MIN_WITHDRAW;
    const user = await getUser(userId);

    const withdrawals = user.withdrawals || [];
    withdrawals.push({
      amount,
      phone,
      network,
      status: 'pending',
      date: new Date().toISOString(),
    });

    await saveUser(userId, {
      balance: user.balance - amount,
      withdrawals,
    });

    ctx.session.withdraw = null;

    const msg = await ctx.reply(
      `✅ Withdrawal request of ₦${amount} submitted!\n📱 Airtime will be sent to ${phone} (${network})`,
      homeButtons()
    );
    ctx.session = { lastMsgId: msg.message_id };
  }
});

// Health check
app.get('/', (req, res) => res.send('✅ Airtime bot is running.'));

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Bot is live on port ${PORT}`);
});
