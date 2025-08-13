const { admin } = require("./fire");
const firestore = admin.firestore();
const { Pool } = require("pg");

// === PostgreSQL connection ===
const pool = new Pool({
  connectionString: "postgresql://postgres:xnkFLFwceOoYidzkKmaYJodaSYFPbMnB@gondola.proxy.rlwy.net:59649/railway",
  ssl: { rejectUnauthorized: false }
});

// === Mappings ===
const statusMap = {
  success: 1,
  failed: 2,
  pending: 3,
  refunded: 4,
  processing: 5
};

const typeMap = {
  airtime: 1,
  data: 2,
  tv: 3,
  epins: 4,
  deposit: 5,
  betting: 6,
  electricity: 7,
  withdrawal: 8,
  datacard: 9
};

let nextRequestId = 1;

// === Utility: check if record exists ===
async function recordExists(table, column, value) {
  if (!value) return false;
  const res = await pool.query(`SELECT 1 FROM ${table} WHERE ${column} = $1 LIMIT 1`, [value]);
  return res.rowCount > 0;
}

// === Utility: expand schema to avoid varchar errors ===
async function ensureSchemaReady() {
  console.log("🔄 Ensuring schema can handle large values...");
  await pool.query(`
    ALTER TABLE transactions ALTER COLUMN request_id TYPE VARCHAR(150);
    ALTER TABLE transactions ALTER COLUMN reference TYPE VARCHAR(150);
    ALTER TABLE transactions ALTER COLUMN order_id TYPE VARCHAR(150);
    ALTER TABLE transactions ALTER COLUMN customer_id TYPE VARCHAR(150);
    ALTER TABLE transactions ALTER COLUMN transaction_ref TYPE VARCHAR(200);
    ALTER TABLE transactions ALTER COLUMN phone TYPE VARCHAR(50);
    ALTER TABLE transactions ALTER COLUMN product TYPE VARCHAR(100);
    ALTER TABLE transactions ALTER COLUMN service_id TYPE VARCHAR(100);

    ALTER TABLE user_accounts ALTER COLUMN bank_name TYPE VARCHAR(150);
    ALTER TABLE user_accounts ALTER COLUMN account_number TYPE VARCHAR(50);
    ALTER TABLE user_accounts ALTER COLUMN account_name TYPE VARCHAR(150);
    ALTER TABLE user_accounts ALTER COLUMN provider TYPE VARCHAR(100);
  `);
  console.log("✅ Schema adjusted");
}

// === Deep search for accountDetails in a user doc ===
function findAccountDetails(userObj) {
  if (!userObj || typeof userObj !== "object") return null;

  if (
    userObj.bankName &&
    userObj.accountNumber &&
    userObj.accountName
  ) {
    return {
      bankName: userObj.bankName,
      accountNumber: userObj.accountNumber,
      accountName: userObj.accountName,
      provider: userObj.provider || null
    };
  }

  for (const key in userObj) {
    if (typeof userObj[key] === "object") {
      const found = findAccountDetails(userObj[key]);
      if (found) return found;
    }
  }
  return null;
}

// === Migrate Users ===
async function migrateUsers() {
  console.log("Migrating users...");
  const snapshot = await firestore.collection("users").get();
  let migratedCount = 0, skippedCount = 0, accountsCount = 0;

  for (const doc of snapshot.docs) {
    const user = doc.data();

    // Migrate user profile
    if (!(await recordExists("users", "uid", doc.id))) {
      await pool.query(
        `INSERT INTO users (uid, full_name, email, phone, balance, is_admin)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          doc.id,
          user.fullName || null,
          user.email || null,
          user.phone || null,
          user.balance || 0,
          user.isAdmin || false
        ]
      );
      migratedCount++;
    } else {
      skippedCount++;
    }

    // Migrate account details (search deeply)
    const acc = findAccountDetails(user);
    if (acc && !(await recordExists("user_accounts", "account_number", acc.accountNumber))) {
      await pool.query(
        `INSERT INTO user_accounts (uid, bank_name, account_number, account_name, provider)
         VALUES ($1, $2, $3, $4, $5)`,
        [doc.id, acc.bankName, acc.accountNumber, acc.accountName, acc.provider]
      );
      accountsCount++;
    }
  }

  console.log(`✅ Users migrated: ${migratedCount} | Skipped: ${skippedCount}`);
  console.log(`✅ Accounts migrated: ${accountsCount}`);
}

// === Migrate Transactions ===
async function migrateTransactions() {
  console.log("Migrating transactions...");
  const snapshot = await firestore.collection("transactions").get();
  let migratedCount = 0, skippedCount = 0;

  for (const doc of snapshot.docs) {
    const tx = doc.data();
    let requestId = tx.requestId || `req_${nextRequestId++}`;

    if (await recordExists("transactions", "request_id", requestId)) {
      skippedCount++;
      continue;
    }

    await pool.query(
      `INSERT INTO transactions (
        request_id, uid, type_id, status_id, amount, amount_charged, discount,
        balance_before, balance_after, phone, product, service_id, customer_id,
        reference, order_id, message, gross_amount, fee, net_amount, transaction_ref, extra
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12, $13,
        $14, $15, $16, $17, $18, $19, $20, $21
      )`,
      [
        requestId,
        tx.uid || null,
        typeMap[tx.type] || null,
        statusMap[tx.status] || 3,
        tx.amount || null,
        tx.amountCharged || null,
        tx.discount || 0,
        tx.balanceBefore || null,
        tx.balanceAfter || null,
        tx.phone || null,
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
      ]
    );
    migratedCount++;
  }

  console.log(`✅ Transactions migrated: ${migratedCount} | Skipped: ${skippedCount}`);
}

// === Run ===
(async () => {
  try {
    await ensureSchemaReady();
    await migrateUsers();
    await migrateTransactions();
    console.log("🎉 Migration complete!");
  } catch (err) {
    console.error("❌ Migration error:", err);
  } finally {
    await pool.end();
    process.exit();
  }
})();
