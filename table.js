// create-user-accounts.js
import pg from "pg";
const { Pool } = pg;

// Railway connection string
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://postgres:xnkFLFwceOoYidzkKmaYJodaSYFPbMnB@gondola.proxy.rlwy.net:59649/railway",
  ssl: { rejectUnauthorized: false }
});

const schemaSQL = `
CREATE TABLE IF NOT EXISTS user_accounts (
    id BIGSERIAL PRIMARY KEY,
    uid VARCHAR(64) NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
    bank_name VARCHAR(100),
    account_number VARCHAR(20),
    account_name VARCHAR(150),
    provider VARCHAR(50), -- e.g., "Monnify", "Paystack"
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_accounts_uid ON user_accounts(uid);
`;

async function createTable() {
  const client = await pool.connect();
  try {
    console.log("Creating user_accounts table...");
    await client.query(schemaSQL);
    console.log("✅ user_accounts table created successfully!");
  } catch (err) {
    console.error("❌ Error creating table:", err);
  } finally {
    client.release();
    await pool.end();
  }
}

createTable();
