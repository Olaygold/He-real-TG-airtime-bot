const { admin, database } = require("./fire"); // RTDB connection
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: "postgresql://postgres:xnkFLFwceOoYidzkKmaYJodaSYFPbMnB@gondola.proxy.rlwy.net:59649/railway",
  ssl: { rejectUnauthorized: false }
});

// === Mappings ===
const statusMap = { success: 1, failed: 2, pending: 3, refunded: 4, processing: 5 };
const typeMap = {
  airtime: 1, data: 2, tv: 3, epins: 4, deposit: 5,
  betting: 6, electricity: 7, withdrawal: 8, datacard: 9
};

// === Deep Clean ===
async function deepCleanTables() {
  console.log("🧹 Clearing old data...");
  await pool.query("TRUNCATE TABLE transactions RESTART IDENTITY CASCADE");
  await pool.query("TRUNCATE TABLE withdrawals RESTART IDENTITY CASCADE");
  await pool.query("TRUNCATE TABLE user_accounts RESTART IDENTITY CASCADE");
  await pool.query("TRUNCATE TABLE users RESTART IDENTITY CASCADE");
  await pool.query("TRUNCATE TABLE disabled_plans RESTART IDENTITY CASCADE");
  console.log("✅ All tables cleared!");
}

// === Migration ===
async function migrate() {
  try {
    console.log("🚀 Starting migration from RTDB → PostgreSQL");

    // Step 0: Clear existing data
    await deepCleanTables();

    // 1️⃣ Disabled Plans
    const disabledPlansSnap = await database.ref("vtu/disabledPlans").once("value");
    if (disabledPlansSnap.exists()) {
      const disabledPlansData = disabledPlansSnap.val();
      for (const network in disabledPlansData) {
        for (const planType in disabledPlansData[network]) {
          await pool.query(
            `INSERT INTO disabled_plans (network, plan_type, status)
             VALUES ($1, $2, $3)
             ON CONFLICT (network, plan_type) DO NOTHING`,
            [network, planType, disabledPlansData[network][planType]]
          );
        }
      }
      console.log("✅ Migrated disabled_plans");
    }

    // 2️⃣ Users + Accounts + Withdrawals + Transactions
    const usersSnap = await database.ref("vtu/users").once("value");
    if (usersSnap.exists()) {
      const usersData = usersSnap.val();

      for (const uid in usersData) {
        const { withdrawals, transactions, accountDetails, ...userData } = usersData[uid];

        // Insert user
        await pool.query(
          `INSERT INTO users (uid, full_name, email, phone, balance, is_admin)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            uid,
            userData.fullName || null,
            userData.email || null,
            userData.phone || null,
            userData.balance || 0,
            userData.isAdmin || false
          ]
        );

        // Insert account details
        if (accountDetails?.bankName && accountDetails?.accountNumber && accountDetails?.accountName) {
          await pool.query(
            `INSERT INTO user_accounts (uid, bank_name, account_number, account_name, provider)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              uid,
              accountDetails.bankName,
              accountDetails.accountNumber,
              accountDetails.accountName,
              accountDetails.provider || null
            ]
          );
        }

        // Withdrawals
        if (withdrawals) {
          for (const withdrawalId in withdrawals) {
            await pool.query(
              `INSERT INTO withdrawals (id, uid, amount, status, created_at)
               VALUES ($1, $2, $3, $4, to_timestamp($5 / 1000))`,
              [
                withdrawalId,
                uid,
                withdrawals[withdrawalId].amount || 0,
                statusMap[withdrawals[withdrawalId].status] || 3,
                withdrawals[withdrawalId].createdAt || Date.now()
              ]
            );
          }
        }

        // Transactions
        if (transactions) {
          for (const txId in transactions) {
            const tx = transactions[txId];
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
                txId,
                uid,
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
          }
        }
      }

      console.log("✅ Migrated users, user_accounts, withdrawals, transactions");
    }

    console.log("🎉 Migration completed successfully!");
  } catch (err) {
    console.error("❌ Migration failed:", err);
  } finally {
    await pool.end();
  }
}

migrate();
