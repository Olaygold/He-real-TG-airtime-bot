const { database } = require("./fire");
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: "postgresql://postgres:xnkFLFwceOoYidzkKmaYJodaSYFPbMnB@gondola.proxy.rlwy.net:59649/railway",
  ssl: { rejectUnauthorized: false }
});

async function migrateAccounts() {
  console.log("🔍 Starting PRECISE migration for accountDetails");

  try {
    // 1. Access the exact path
    const usersRef = database.ref("vtu/users");
    const snapshot = await usersRef.once("value");

    if (!snapshot.exists()) {
      console.log("❌ No data at vtu/users");
      return;
    }

    const users = snapshot.val();
    console.log(`📊 Found ${Object.keys(users).length} users`);

    // 2. Process each user
    for (const [uid, user] of Object.entries(users)) {
      console.log(`\n👤 User ${uid}`);

      // 3. Check for accountDetails (now nested!)
      if (!user.accountDetails) {
        console.log("⏩ Skipped - No accountDetails");
        continue;
      }

      const { 
        accountName, 
        accountNumber, 
        bank,
        accountReference // Optional field
      } = user.accountDetails;

      if (!accountNumber) {
        console.log("⏩ Skipped - No accountNumber");
        continue;
      }

      console.log("💳 Account Details:", {
        accountName,
        accountNumber,
        bank
      });

      // 4. Insert into PostgreSQL
      await pool.query(`
        INSERT INTO user_accounts (
          uid,
          bank_name,
          account_number,
          account_name,
          provider,
          extra
        ) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (account_number) DO NOTHING
      `, [
        uid,
        bank || null,
        accountNumber,
        accountName || null,
        null, // Provider not in your data
        JSON.stringify({ reference: accountReference }) // Store extra data
      ]);

      console.log("✅ Migrated successfully");
    }

    console.log("\n🎉 Migration completed!");

  } catch (err) {
    console.error("💥 FATAL ERROR:", err);
  } finally {
    await pool.end();
  }
}

migrateAccounts();
