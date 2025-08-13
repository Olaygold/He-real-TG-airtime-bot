const { database } = require("./fire");
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: "postgresql://postgres:xnkFLFwceOoYidzkKmaYJodaSYFPbMnB@gondola.proxy.rlwy.net:59649/railway",
  ssl: { rejectUnauthorized: false }
});

async function ensureColumnsExist() {
  try {
    // Check if account_reference column exists
    const checkQuery = `
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'user_accounts' 
      AND column_name = 'account_reference'
    `;
    
    const result = await pool.query(checkQuery);
    
    if (result.rows.length === 0) {
      console.log("🛠 Adding missing account_reference column");
      await pool.query(`
        ALTER TABLE user_accounts 
        ADD COLUMN account_reference VARCHAR(255)
      `);
    }
  } catch (err) {
    console.error("❌ Failed to ensure columns exist:", err);
    throw err;
  }
}

async function migrateAccounts() {
  console.log("🔍 Starting migration with duplicate protection");

  try {
    // 1. Ensure all columns exist
    await ensureColumnsExist();

    // 2. Fetch users from Firebase
    const usersRef = database.ref("vtu/users");
    const snapshot = await usersRef.once("value");

    if (!snapshot.exists()) {
      console.log("❌ No data at vtu/users");
      return;
    }

    const users = snapshot.val();
    console.log(`📊 Found ${Object.keys(users).length} users`);

    // 3. Process each user
    for (const [uid, user] of Object.entries(users)) {
      console.log(`\n👤 Processing user ${uid}`);

      if (!user.accountDetails) {
        console.log("⏩ Skipped - No accountDetails");
        continue;
      }

      const { 
        accountName, 
        accountNumber, 
        bank,
        accountReference 
      } = user.accountDetails;

      if (!accountNumber) {
        console.log("⏩ Skipped - No accountNumber");
        continue;
      }

      // 4. Check if account already exists
      const existsResult = await pool.query(
        `SELECT 1 FROM user_accounts WHERE account_number = $1`,
        [accountNumber]
      );

      if (existsResult.rows.length > 0) {
        console.log("⏩ Skipped - Account already exists");
        continue;
      }

      console.log("💳 Migrating account:", {
        accountNumber,
        accountName,
        bank,
        accountReference
      });

      // 5. Insert with all fields
      await pool.query(`
        INSERT INTO user_accounts (
          uid,
          bank_name,
          account_number,
          account_name,
          account_reference
        ) VALUES ($1, $2, $3, $4, $5)
      `, [
        uid,
        bank || null,
        accountNumber,
        accountName || null,
        accountReference || null
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
