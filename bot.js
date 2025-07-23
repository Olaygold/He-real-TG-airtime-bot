require('dotenv').config();
const express = require('express');
const { Telegraf, session, Markup } = require('telegraf');
const { database } = require('./fire');

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

// Webhook
app.use(express.json());
app.use(bot.webhookCallback('/webhook'));
bot.telegram.setWebhook(`${process.env.WEBHOOK_URL}/webhook`);

const SIGNUP_BONUS = 50;
const REFERRAL_BONUS = 50;
const MIN_WITHDRAW = 350;
const GROUP_USERNAME = process.env.GROUP_USERNAME.replace('@', '');
const WHATSAPP_LINK = process.env.WHATSAPP_LINK;

// Firebase Helpers
const userRef = (id) => database.ref(`users/${id}`);
const getUser = async (id) => (await userRef(id).once('value')).val();
const saveUser = async (id, data) => userRef(id).update(data);

// Delete previous bot message
const deletePrevious = async (ctx) => {
  if (ctx.session?.lastMsgId) {
    try { await ctx.deleteMessage(ctx.session.lastMsgId); } catch {}
  }
};

// Home menu
const homeButtons = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback('💰 My Balance', 'balance')],
    [Markup.button.callback('👥 My Referrals', 'referrals')],
    [Markup.button.callback('📤 Withdraw', 'withdraw')],
    [Markup.button.callback('📄 Withdraw History', 'withdraw_history')],
    [Markup.button.callback('🔗 My Referral Link', 'myref')],
    [Markup.button.callback('ℹ️ About This Bot', 'about')],
  ]);

// /start
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

// Verify Join


bot.action('verify_join', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id.toString();
  const username = ctx.from.first_name;
  const refCode = ctx.session.refCode;

  const existing = await getUser(userId);
  if (existing) return ctx.reply('✅ You are already registered.', homeButtons());

  const joinedGroup = await hasJoinedGroup(ctx);
  if (!joinedGroup) {
    return ctx.reply(`❌ Please join our Telegram group first.\n👉 https://t.me/${GROUP_USERNAME.replace('@', '')}`);
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

  // Handle referral
  if (refCode && refCode !== userId) {
    const refUser = await getUser(refCode);
    if (refUser) {
      refUser.referrals = refUser.referrals || [];
      if (!refUser.referrals.includes(userId)) {
        refUser.referrals.push(userId);
        refUser.balance += REFERRAL_BONUS;
        await saveUser(refCode, refUser);
      }
    }
  }

  ctx.session.awaitingJoin = false;

  const botUsername = ctx.me || bot.options.username || 'YourBotUsername';
  const referralLink = `https://t.me/${botUsername}?start=${userId}`;

  await ctx.reply(
    `🎉 Welcome ${username}!\n\nYou've received ₦${SIGNUP_BONUS} signup bonus.\n\n🔗 Your referral link:\n${referralLink}`,
    homeButtons()
  );
});







  ctx.session = null;
  const botUsername = (await ctx.telegram.getMe()).username;
  const link = `https://t.me/${botUsername}?start=${userId}`;
  return ctx.reply(
    `🎉 Welcome ${username}!\nYou've received ₦${SIGNUP_BONUS} signup bonus.\n\n🔗 Your referral link:\n${link}`,
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
  const refs = user?.referrals || [];
  if (refs.length === 0) {
    const msg = await ctx.reply('👥 No referrals yet.', homeButtons());
    ctx.session = { lastMsgId: msg.message_id };
    return;
  }

  let text = `👥 You’ve invited ${refs.length} user(s):\n`;
  for (const r of refs) {
    const refUser = await getUser(r);
    text += `- @${refUser?.username || 'Unknown'}\n`;
  }

  const msg = await ctx.reply(text, homeButtons());
  ctx.session = { lastMsgId: msg.message_id };
});

// About
bot.action('about', async (ctx) => {
  await ctx.answerCbQuery();
  await deletePrevious(ctx);
  const msg = await ctx.reply(
    `🤖 *About This Bot*\n\n✅ Earn ₦50 per referral.\n🎁 ₦50 signup bonus.\n💸 Withdraw only on Sundays (7PM–8PM).`,
    { parse_mode: 'Markdown', ...homeButtons() }
  );
  ctx.session = { lastMsgId: msg.message_id };
});

// Withdraw (Start Flow)
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

// Withdrawal Submission
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
    const now = new Date();
    const isSunday = now.getDay() === 0;
    const hour = now.getHours();

    const { phone } = ctx.session.withdraw;
    const network = ctx.message.text;
    const user = await getUser(userId);
    const amount = MIN_WITHDRAW;

    if (!(isSunday && hour >= 19 && hour < 20)) {
      ctx.session.withdraw = null;
      const msg = await ctx.reply('⏳ You can only *submit* withdrawals on Sundays (7PM–8PM). Try again later.', {
        parse_mode: 'Markdown',
        ...homeButtons(),
      });
      ctx.session = { lastMsgId: msg.message_id };
      return;
    }

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

    ctx.session = null;
    const msg = await ctx.reply(
      `✅ Withdrawal request of ₦${amount} submitted!\n📱 ${phone} (${network})`,
      homeButtons()
    );
    ctx.session = { lastMsgId: msg.message_id };
  }
});

// Withdrawal History
bot.action('withdraw_history', async (ctx) => {
  await ctx.answerCbQuery();
  await deletePrevious(ctx);
  const user = await getUser(ctx.from.id);
  const history = user?.withdrawals || [];

  if (history.length === 0) {
    const msg = await ctx.reply('📄 No withdrawal history found.', homeButtons());
    ctx.session = { lastMsgId: msg.message_id };
    return;
  }

  let text = `📄 Your Withdrawal History:\n`;
  history.slice(-5).reverse().forEach((w, i) => {
    text += `\n#${i + 1}: ₦${w.amount} to ${w.phone} (${w.network}) - *${w.status.toUpperCase()}*`;
  });

  const msg = await ctx.reply(text, { parse_mode: 'Markdown', ...homeButtons() });
  ctx.session = { lastMsgId: msg.message_id };
});

// Monitor referral approvals (optional external admin hook)
const monitorWithdrawalApprovals = () => {
  database.ref('users').on('child_changed', async (snap) => {
    const user = snap.val();
    if (!user?.withdrawals) return;
    const last = user.withdrawals[user.withdrawals.length - 1];
    if (last.status === 'approved' && !last.notified) {
      await bot.telegram.sendMessage(user.id, `✅ Your withdrawal request of ₦${last.amount} has been *APPROVED*!`, {
        parse_mode: 'Markdown',
      });
      last.notified = true;
      await saveUser(user.id, { withdrawals: user.withdrawals });
    }
  });
};
monitorWithdrawalApprovals();

// Health
app.get('/', (req, res) => res.send('✅ Bot running'));

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Bot is live on port ${PORT}`);
});
