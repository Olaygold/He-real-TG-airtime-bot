const { admin } = require("./fire"); // Firebase setup
const firestore = admin.firestore();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://postgres:xnkFLFwceOoYidzkKmaYJodaSYFPbMnB@gondola.proxy.rlwy.net:59649/railway",
  ssl: { rejectUnauthorized: false }
});

// === Status & Type mappings ===
const statusMap = {
  "success": 1,
  "failed": 2,
  "pending": 3,
  "refunded": 4,
  "processing": 5
};

const typeMap = {
  "airtime": 1,
  "data": 2,
  "tv": 3,
  "epins": 4,
  "deposit": 5,
  "betting": 6,
  "electricity": 7,
  "withdrawal": 8,
  "datacard": 9
};

let nextRequestId = 1;

// === Helper to check existence ===
async function recordExists(table, column, value) {
  const result = await pool.query(`SELECT 1 FROM ${table} WHERE ${column} = $1 LIMIT 1`, [value]);
  return result.rowCount > 0;
}

// === Migrate Users ===
async function migrateUsers() {
  console.log("Migrating users...");
  const snapshot = await firestore.collection("users").get();

  for (const doc of snapshot.docs) {
    const user = doc.data();

    // Skip if already migrated
    if (await recordExists("users", "uid", doc.id)) continue;

    await pool.query(`
      INSERT INTO users (uid, full_name, email, phone, balance, is_admin)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [
      doc.id,
      user.fullName || null,
      user.email || null,
      user.phone || null,
      user.balance || 0,
      user.isAdmin || false
    ]);

    if (user.bankName && user.accountNumber && user.accountName) {
      await pool.query(`
        INSERT INTO user_accounts (uid, bank_name, account_number, account_name, provider)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT DO NOTHING
      `, [
        doc.id,
        user.bankName,
        user.accountNumber,
        user.accountName,
        user.provider || null
      ]);
    }
  }
  console.log("✅ Users migrated");
}

// === Migrate Transactions ===
async function migrateTransactions() {
  console.log("Migrating transactions...");
  const snapshot = await firestore.collection("transactions").get();

  for (const doc of snapshot.docs) {
    const tx = doc.data();

    // Ensure request_id exists
    let requestId = tx.requestId;
    if (!requestId) {
      requestId = `req_${nextRequestId}`;
      nextRequestId++;
    }

    // Skip if already migrated
    if (await recordExists("transactions", "request_id", requestId)) continue;

    await pool.query(`
      INSERT INTO transactions (
        request_id, uid, type_id, status_id, amount, amount_charged, discount,
        balance_before, balance_after, phone, network, product, service_id, customer_id,
        reference, order_id, message, gross_amount, fee, net_amount, transaction_ref,
        extra
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12, $13, $14,
        $15, $16, $17, $18, $19, $20, $21,
        $22
      )
    `, [
      requestId,
      tx.uid,
      typeMap[tx.type] || null,
      statusMap[tx.status] || null,
      tx.amount || null,
      tx.amountCharged || null,
      tx.discount || 0,
      tx.balanceBefore || null,
      tx.balanceAfter || null,
      tx.phone || null,
      tx.network || null,
      tx.product || null,
      tx.serviceID || null,
      tx.customerID || null,
      tx.reference || null,
      tx.orderId || null,
      tx.message || null,
      tx.grossAmount || null,
      tx.fee || null,
      tx.netAmount || null,
      tx.transactionRef || null,
      JSON.stringify({
        plan: tx.plan,
        variation_id: tx.variation_id,
        value: tx.value,
        quantity: tx.quantity,
        epins: tx.epins,
        token: tx.token,
        customerName: tx.customerName,
        customerAddress: tx.customerAddress,
        disco: tx.disco,
        serviceFee: tx.serviceFee,
        totalCharged: tx.totalCharged
      })
    ]);
  }
  console.log("✅ Transactions migrated");
}

// === Run Migration ===
async function migrate() {
  try {
    await migrateUsers();
    await migrateTransactions();
    console.log("🎉 Migration complete!");
  } catch (err) {
    console.error("❌ Migration error:", err);
  } finally {
    await pool.end();
    process.exit();
  }
}

migrate();
