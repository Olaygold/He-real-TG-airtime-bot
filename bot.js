require('dotenv').config();
const express = require('express');
const { Telegraf, session, Markup } = require('telegraf');
const { database } = require('./fire');

const app = express();
const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

app.use(express.json());
app.use(bot.webhookCallback('/webhook'));
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

// Group check
async function hasJoinedGroup(ctx) {
  try {
    const member = await ctx.telegram.getChatMember(GROUP_USERNAME, ctx.from.id);
    return ['member', 'administrator', 'creator'].includes(member.status);
  } catch {
    return false;
  }
}

// Start
bot.start(async (ctx) => {
  const userId = ctx.from.id.toString();
  const username = ctx.from.first_name;
  const refCode = ctx.message.text.split(' ')[1];
  const existing = await getUser(userId);

  if (existing) {
    const link = `https://t.me/${ctx.me}?start=${userId}`;
    return ctx.reply(`✅ You're already registered.\n\n🔗 Your referral link: ${link}`, 
      Markup.inlineKeyboard([
        Markup.button.url("🔗 Copy Link", link),
        Markup.button.callback("📊 View Balance", "check_balance")
      ])
    );
  }

  const joinedGroup = await hasJoinedGroup(ctx);
  if (!joinedGroup) {
    return ctx.reply(
      `❌ Please join our Telegram group first:\n👉 https://t.me/${GROUP_USERNAME.replace('@', '')}`,
      Markup.inlineKeyboard([
        Markup.button.url("✅ Join Group", `https://t.me/${GROUP_USERNAME.replace('@', '')}`),
        Markup.button.callback("🔄 I’ve Joined", "check_join")
      ])
    );
  }

  await ctx.reply(`📱 Also join our WhatsApp group before continuing:\n${WHATSAPP_LINK}\n\nOnce done, tap below to continue.`,
    Markup.inlineKeyboard([
      Markup.button.url("📲 Join WhatsApp", WHATSAPP_LINK),
      Markup.button.callback("✅ I’ve Joined WhatsApp", "confirm_whatsapp")
    ])
  );

  ctx.session.awaitingWhatsapp = true;
  ctx.session.refCode = refCode || '';
});

// Callback for confirming WhatsApp join
bot.action("confirm_whatsapp", async (ctx) => {
  const userId = ctx.from.id.toString();
  const username = ctx.from.first_name;
  const refCode = ctx.session.refCode || '';
  const existing = await getUser(userId);
  if (existing) return ctx.reply('✅ You are already registered.');

  await saveUser(userId, {
    id: userId,
    username,
    balance: SIGNUP_BONUS,
    referrals: [],
    withdrawals: [],
    ref_by: refCode
  });

  if (refCode && refCode !== userId) {
    const refUser = await getUser(refCode);
    if (refUser && !refUser.referrals.includes(userId)) {
      refUser.balance += REFERRAL_BONUS;
      refUser.referrals.push(userId);
      await saveUser(refCode, refUser);
      await ctx.telegram.sendMessage(refCode, `🎉 You referred ${username} and earned ₦${REFERRAL_BONUS}`);
    }
  }

  const link = `https://t.me/${ctx.me}?start=${userId}`;
  await ctx.reply(`🎉 Welcome ${username}! You’ve received ₦${SIGNUP_BONUS} signup bonus.\n\n🔗 Your referral link: ${link}`,
    Markup.inlineKeyboard([
      Markup.button.url("🔗 Copy Link", link),
      Markup.button.callback("📊 View Balance", "check_balance")
    ])
  );
  ctx.session.awaitingWhatsapp = false;
});

// Callback: check_join
bot.action("check_join", async (ctx) => {
  const joined = await hasJoinedGroup(ctx);
  if (!joined) return ctx.reply("❌ You haven't joined the group yet.");
  
  await ctx.reply(`📱 Also join our WhatsApp group before continuing:\n${WHATSAPP_LINK}`,
    Markup.inlineKeyboard([
      Markup.button.url("📲 Join WhatsApp", WHATSAPP_LINK),
      Markup.button.callback("✅ I’ve Joined WhatsApp", "confirm_whatsapp")
    ])
  );
  ctx.session.awaitingWhatsapp = true;
});

// Balance command & button
bot.command("balance", async (ctx) => {
  const user = await getUser(ctx.from.id);
  const bal = user?.balance || 0;
  ctx.reply(`💰 Your current balance is ₦${bal}`);
});
bot.action("check_balance", async (ctx) => {
  const user = await getUser(ctx.from.id);
  const bal = user?.balance || 0;
  ctx.reply(`💰 Your current balance is ₦${bal}`);
});

// Referral link
bot.command("refer", async (ctx) => {
  const link = `https://t.me/${ctx.me}?start=${ctx.from.id}`;
  ctx.reply(`🔗 Your referral link:\n${link}`,
    Markup.inlineKeyboard([
      Markup.button.url("🔗 Copy Referral Link", link)
    ])
  );
});

// History
bot.command("history", async (ctx) => {
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

// Withdraw
bot.command("withdraw", async (ctx) => {
  const user = await getUser(ctx.from.id);
  if (user.balance < MIN_WITHDRAW) {
    return ctx.reply(`❌ You need at least ₦${MIN_WITHDRAW} to withdraw.`);
  }

  ctx.session.withdraw = { step: 'phone' };
  ctx.reply("📱 Enter your phone number or tap Cancel", 
    Markup.keyboard([["❌ Cancel"]]).oneTime().resize()
  );
});

// Text listener
bot.on('text', async (ctx) => {
  const userId = ctx.from.id.toString();
  ctx.session = ctx.session || {};
  const step = ctx.session.withdraw?.step;

  if (ctx.message.text === "❌ Cancel") {
    ctx.session.withdraw = null;
    return ctx.reply("❌ Withdrawal cancelled", Markup.removeKeyboard());
  }

  if (step === 'phone') {
    ctx.session.withdraw.phone = ctx.message.text;
    ctx.session.withdraw.step = 'network';
    return ctx.reply("📶 Enter your network (MTN, Airtel, Glo, 9mobile):");
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
    return ctx.reply(`✅ Withdrawal request of ₦${amount} submitted!\n📱 To: ${phone} (${network})`, Markup.removeKeyboard());
  }
});

// Home route
app.get('/', (req, res) => res.send('✅ Airtime bot is running.'));

// Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Bot is live on port ${PORT}`));
