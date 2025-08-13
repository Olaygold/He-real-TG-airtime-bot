// create-tables.js
import pg from "pg";
const { Pool } = pg;

// Your Railway connection URL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://postgres:xnkFLFwceOoYidzkKmaYJodaSYFPbMnB@gondola.proxy.rlwy.net:59649/railway",
  ssl: { rejectUnauthorized: false }
});

const schemaSQL = `
-- Lookup tables
CREATE TABLE IF NOT EXISTS statuses (
    id SMALLINT PRIMARY KEY,
    name VARCHAR(20) NOT NULL UNIQUE
);

INSERT INTO statuses (id, name)
VALUES (1, 'success'), (2, 'failed'), (3, 'pending'), (4, 'refunded'), (5, 'processing')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS transaction_types (
    id SMALLINT PRIMARY KEY,
    name VARCHAR(20) NOT NULL UNIQUE
);

INSERT INTO transaction_types (id, name)
VALUES
(1, 'airtime'), (2, 'data'), (3, 'tv'), (4, 'epins'),
(5, 'deposit'), (6, 'betting'), (7, 'electricity'),
(8, 'withdrawal'), (9, 'datacard')
ON CONFLICT (id) DO NOTHING;

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    uid VARCHAR(64) UNIQUE NOT NULL,
    full_name VARCHAR(150),
    email VARCHAR(255),
    phone VARCHAR(20),
    balance NUMERIC(14,2) DEFAULT 0 NOT NULL,
    is_admin BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_uid ON users(uid);

-- Sequence for request numbers
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'request_seq') THEN
        CREATE SEQUENCE request_seq START 1;
    END IF;
END$$;

-- Transactions table
CREATE TABLE IF NOT EXISTS transactions (
    id BIGSERIAL PRIMARY KEY,
    request_no BIGINT NOT NULL DEFAULT nextval('request_seq'),
    request_id VARCHAR(30) NOT NULL UNIQUE,
    uid VARCHAR(64) NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
    type_id SMALLINT NOT NULL REFERENCES transaction_types(id),
    date TIMESTAMPTZ NOT NULL DEFAULT now(),
    status_id SMALLINT NOT NULL REFERENCES statuses(id),
    amount NUMERIC(12,2),
    amount_charged NUMERIC(12,2),
    discount NUMERIC(12,2) DEFAULT 0,
    balance_before NUMERIC(14,2),
    balance_after NUMERIC(14,2),
    phone VARCHAR(20),
    network VARCHAR(50),
    product VARCHAR(50),
    service_id VARCHAR(80),
    customer_id VARCHAR(80),
    reference VARCHAR(120),
    order_id VARCHAR(120),
    message VARCHAR(255),
    gross_amount NUMERIC(12,2),
    fee NUMERIC(12,2),
    net_amount NUMERIC(12,2),
    transaction_ref VARCHAR(120),
    extra JSONB,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tx_uid_date ON transactions(uid, date DESC);
CREATE INDEX IF NOT EXISTS idx_tx_request_id ON transactions(request_id);
CREATE INDEX IF NOT EXISTS idx_tx_reference ON transactions(reference);
CREATE INDEX IF NOT EXISTS idx_tx_type_status ON transactions(type_id, status_id);

-- Transaction API Raw table
CREATE TABLE IF NOT EXISTS transaction_api_raw (
    id BIGSERIAL PRIMARY KEY,
    transaction_id BIGINT REFERENCES transactions(id) ON DELETE CASCADE,
    api_raw JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_raw_tx_id ON transaction_api_raw(transaction_id);

-- Withdrawals table
CREATE TABLE IF NOT EXISTS withdrawals (
    id BIGSERIAL PRIMARY KEY,
    uid VARCHAR(64) NOT NULL REFERENCES users(uid) ON DELETE CASCADE,
    amount NUMERIC(12,2) NOT NULL,
    fee NUMERIC(12,2) DEFAULT 0,
    net_amount NUMERIC(12,2),
    account_number VARCHAR(20),
    bank_code VARCHAR(20),
    bank_name VARCHAR(100),
    account_name VARCHAR(150),
    status_id SMALLINT NOT NULL REFERENCES statuses(id),
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_withdrawals_uid ON withdrawals(uid);
`;

async function createTables() {
  const client = await pool.connect();
  try {
    console.log("Creating tables...");
    await client.query(schemaSQL);
    console.log("✅ All tables created successfully!");
  } catch (err) {
    console.error("❌ Error creating tables:", err);
  } finally {
    client.release();
    await pool.end();
  }
}

createTables();
