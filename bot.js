require('dotenv').config();
const express = require('express');
const { Telegraf, session } = require('telegraf');
const { database } = require('./fire');

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

app.use(express.json()); // Important for webhook
app.use(bot.webhookCallback('/webhook'));

// Set the webhook
bot.telegram.setWebhook(`${process.env.WEBHOOK_URL}/webhook`);

// Constants
const SIGNUP_BONUS = 50;
const REFERRAL_BONUS = 50;
const MIN_WITHDRAW = 350;
const GROUP_USERNAME = process.env.GROUP_USERNAME;
const WHATSAPP_LINK = process.env.WHATSAPP_LINK;

// Firebase helpers
const userRef = (userId) => database.ref(`users/${userId}`);
const getUser = async (userId) => {
  const snap = await userRef(userId).once('value');
  return snap.exists() ? snap.val() : null;
};
const saveUser = async (userId, data) => {
  await userRef(userId).update(data);
};

// Check if user is in the group
async function hasJoinedGroup(ctx) {
  try {
    const member = await ctx.telegram.getChatMember(GROUP_USERNAME, ctx.from.id);
    return ['member', 'administrator', 'creator'].includes(member.status);
  } catch {
    return false;
  }
}

// Start command
bot.start(async (ctx) => {
  const userId = ctx.from.id.toString();
  const username = ctx.from.first_name;
  const refCode = ctx.message.text.split(' ')[1];
  const existing = await getUser(userId);

  if (existing) return ctx.reply('✅ You are already registered.');

  const joinedGroup = await hasJoinedGroup(ctx);
  if (!joinedGroup) {
    return ctx.reply(`❌ Please join our Telegram group first: https://t.me/${GROUP_USERNAME.replace('@', '')}`);
  }

  await ctx.reply(`📱 Also join our WhatsApp group before continuing:\n${WHATSAPP_LINK}\n\nOnce done, type *joined* to continue.`, { parse_mode: 'Markdown' });
  ctx.session.awaitingWhatsapp = true;
});

// After WhatsApp join
bot.hears(/joined/i, async (ctx) => {
  if (!ctx.session.awaitingWhatsapp) return;

  const userId = ctx.from.id.toString();
  const username = ctx.from.first_name;
  const refCode = ctx.message.text.split(' ')[1];

  const existing = await getUser(userId);
  if (existing) return ctx.reply('✅ You are already registered.');

  await saveUser(userId, {
    id: userId,
    username,
    balance: SIGNUP_BONUS,
    referrals: [],
    withdrawals: [],
    ref_by: refCode || ''
  });

  if (refCode && refCode !== userId) {
    const refUser = await getUser(refCode);
    if (refUser && !refUser.referrals.includes(userId)) {
      refUser.balance += REFERRAL_BONUS;
      refUser.referrals.push(userId);
      await saveUser(refCode, refUser);
    }
  }

  ctx.session.awaitingWhatsapp = false;
  await ctx.reply(`🎉 Welcome ${username}! You’ve received ₦${SIGNUP_BONUS} signup bonus.`);
});

// Show balance
bot.command('balance', async (ctx) => {
  const user = await getUser(ctx.from.id);
  const bal = user?.balance || 0;
  ctx.reply(`💰 Your current balance is ₦${bal}`);
});

// Referral link
bot.command('refer', async (ctx) => {
  const link = `https://t.me/${ctx.me}?start=${ctx.from.id}`;
  ctx.reply(`🔗 Your referral link:\n${link}`);
});

// History
bot.command('history', async (ctx) => {
  const user = await getUser(ctx.from.id);
  const referrals = user?.referrals || [];
  const withdrawals = user?.withdrawals || [];
  let text = `👥 Referrals: ${referrals.length}\n📜 Withdrawal History:\n`;

  if (withdrawals.length === 0) {
    text += '❌ No withdrawals yet.';
  } else {
    withdrawals.forEach(w => {
      text += `• ₦${w.amount} to ${w.phone} (${w.network}) - ${w.status}\n`;
    });
  }

  ctx.reply(text);
});

// Withdraw command
bot.command('withdraw', async (ctx) => {
  const user = await getUser(ctx.from.id);
  if (user.balance < MIN_WITHDRAW) {
    return ctx.reply(`❌ You need at least ₦${MIN_WITHDRAW} to withdraw.`);
  }

  ctx.session.withdraw = { step: 'phone' };
  ctx.reply('📱 Please enter your phone number for airtime:');
});

// Handle text input
bot.on('text', async (ctx) => {
  ctx.session = ctx.session || {};
  const step = ctx.session.withdraw?.step;
  const userId = ctx.from.id.toString();

  if (step === 'phone') {
    ctx.session.withdraw.phone = ctx.message.text;
    ctx.session.withdraw.step = 'network';
    return ctx.reply('📶 Enter your network (MTN, Airtel, Glo, 9mobile):');
  }

  if (step === 'network') {
    const phone = ctx.session.withdraw.phone;
    const network = ctx.message.text;
    const amount = MIN_WITHDRAW;

    const user = await getUser(userId);
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

// Home route
app.get('/', (req, res) => res.send('✅ Airtime bot is running.'));

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Bot is live on port ${PORT}`);
});
