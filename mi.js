// updateSchema.js
const { Pool } = require("pg");

// === Railway PostgreSQL Connection ===
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://postgres:xnkFLFwceOoYidzkKmaYJodaSYFPbMnB@postgres.railway.internal:5432/railway",
  ssl: { rejectUnauthorized: false }
});

async function updateSchema() {
  try {
    console.log("🔄 Updating schema...");

    await pool.query(`
      ALTER TABLE transactions ALTER COLUMN request_id TYPE VARCHAR(100);
      ALTER TABLE transactions ALTER COLUMN reference TYPE VARCHAR(100);
      ALTER TABLE transactions ALTER COLUMN order_id TYPE VARCHAR(100);
      ALTER TABLE transactions ALTER COLUMN customer_id TYPE VARCHAR(100);
      ALTER TABLE transactions ALTER COLUMN transaction_ref TYPE VARCHAR(150);
      ALTER TABLE transactions ALTER COLUMN phone TYPE VARCHAR(30);
      ALTER TABLE transactions ALTER COLUMN product TYPE VARCHAR(50);
      ALTER TABLE transactions ALTER COLUMN service_id TYPE VARCHAR(50);
    `);

    console.log("✅ Schema updated successfully!");
  } catch (err) {
    console.error("❌ Error updating schema:", err);
  } finally {
    await pool.end();
  }
}

updateSchema();
