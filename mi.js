const { admin, database } = require("./fire"); // Firebase RTDB connection
const { Pool } = require("pg");
require("dotenv").config();

// PostgreSQL connection (with your actual database URL)
const pool = new Pool({
  connectionString: "postgresql://postgres:xnkFLFwceOoYidzkKmaYJodaSYFPbMnB@gondola.proxy.rlwy.net:59649/railway",
  ssl: { 
    rejectUnauthorized: false 
  }
});

async function migrateAccountDetails() {
  console.log("🚀 Starting account details migration...");
  const startTime = Date.now();

  try {
    // 1. Fetch all users from Firebase
    const usersSnap = await database.ref("vtu/users").once("value");
    if (!usersSnap.exists()) {
      console.log("ℹ️ No users found in Firebase");
      return { success: false, message: "No users found" };
    }

    const users = usersSnap.val();
    let migratedCount = 0;
    let errorCount = 0;

    // 2. Process each user's account details
    for (const [uid, userData] of Object.entries(users)) {
      try {
        // Extract account details from root level (your Firebase structure)
        const { accountName, accountNumber, bank } = userData;

        // Skip if no account number exists
        if (!accountNumber) continue;

        // 3. Insert into PostgreSQL
        await pool.query(
          `INSERT INTO user_accounts (
            uid, 
            bank_name, 
            account_number, 
            account_name
          ) VALUES ($1, $2, $3, $4)
          ON CONFLICT (account_number) DO NOTHING`,
          [uid, bank || null, accountNumber, accountName || null]
        );
        migratedCount++;
      } catch (err) {
        errorCount++;
        console.error(`❌ Error migrating account for ${uid}:`, err.message);
      }
    }

    // 4. Report results
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`
    🎉 Migration Complete!
    ⏱️  Duration: ${duration}s
    ✅ Successfully migrated: ${migratedCount} accounts
    ❌ Errors encountered: ${errorCount}
    `);

    return {
      success: true,
      duration: `${duration}s`,
      migratedCount,
      errorCount
    };

  } catch (err) {
    console.error("🔥 Critical migration error:", err);
    return { success: false, error: err.message };
  } finally {
    await pool.end();
  }
}

// Execute the migration (with error handling)
migrateAccountDetails()
  .then(result => {
    if (!result.success) {
      process.exit(1); // Exit with error code if failed
    }
  })
  .catch(err => {
    console.error("Unhandled migration error:", err);
    process.exit(1);
  });
