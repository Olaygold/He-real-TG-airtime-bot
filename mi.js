// updateSchema.js
const { Pool } = require("pg");

// === Railway PostgreSQL Connection ===
const pool = new Pool({
  connectionString: "postgresql://postgres:xnkFLFwceOoYidzkKmaYJodaSYFPbMnB@gondola.proxy.rlwy.net:59649/railway",
  ssl: { rejectUnauthorized: false }
});

async function updateSchema() {
  try {
    console.log("🔄 Updating schema...");

    // Expand column sizes to avoid "value too long" errors
    await pool.query(`
      ALTER TABLE transactions ALTER COLUMN request_id TYPE VARCHAR(100);
      ALTER TABLE transactions ALTER COLUMN reference TYPE VARCHAR(100);
      ALTER TABLE transactions ALTER COLUMN order_id TYPE VARCHAR(100);
      ALTER TABLE transactions ALTER COLUMN customer_id TYPE VARCHAR(100);
      ALTER TABLE transactions ALTER COLUMN transaction_ref TYPE VARCHAR(150);
      ALTER TABLE transactions ALTER COLUMN phone TYPE VARCHAR(30);
      ALTER TABLE transactions ALTER COLUMN product TYPE VARCHAR(50);
      ALTER TABLE transactions ALTER COLUMN service_id TYPE VARCHAR(50);

      -- Also ensure user_accounts table has enough space
      ALTER TABLE user_accounts ALTER COLUMN bank_name TYPE VARCHAR(100);
      ALTER TABLE user_accounts ALTER COLUMN account_number TYPE VARCHAR(50);
      ALTER TABLE user_accounts ALTER COLUMN account_name TYPE VARCHAR(100);
      ALTER TABLE user_accounts ALTER COLUMN provider TYPE VARCHAR(50);
    `);

    console.log("✅ Schema updated successfully!");
  } catch (err) {
    console.error("❌ Error updating schema:", err);
  } finally {
    await pool.end();
  }
}

updateSchema();
