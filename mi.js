const { admin, database } = require("./fire"); // still using your RTDB connection
const firestore = admin.firestore();

async function migrate() {
  try {
    console.log("🚀 Starting migration to Firestore (flattened)");

    // 1️⃣ Disabled Plans → disabledPlans collection
    const disabledPlansSnap = await database.ref("vtu/disabledPlans").once("value");
    if (disabledPlansSnap.exists()) {
      const disabledPlansData = disabledPlansSnap.val();
      for (const network in disabledPlansData) {
        for (const planType in disabledPlansData[network]) {
          await firestore.collection("disabledPlans").add({
            network,
            planType,
            status: disabledPlansData[network][planType]
          });
        }
      }
      console.log("✅ Migrated disabledPlans");
    }

    // 2️⃣ Users → users collection
    const usersSnap = await database.ref("vtu/users").once("value");
    if (usersSnap.exists()) {
      const usersData = usersSnap.val();

      for (const uid in usersData) {
        const { withdrawals, transactions, accountDetails, ...userData } = usersData[uid];

        // Save user base info
        await firestore.collection("users").doc(uid).set({
          ...userData,
          accountDetails: accountDetails || {}
        });

        // 3️⃣ Withdrawals → withdrawals collection
        if (withdrawals) {
          for (const withdrawalId in withdrawals) {
            await firestore.collection("withdrawals").doc(withdrawalId).set({
              uid,
              ...withdrawals[withdrawalId]
            });
          }
        }

        // 4️⃣ Transactions → transactions collection
        if (transactions) {
          for (const txId in transactions) {
            await firestore.collection("transactions").doc(txId).set({
              uid,
              ...transactions[txId]
            });
          }
        }
      }

      console.log("✅ Migrated users, withdrawals, transactions");
    }

    console.log("🎉 Migration completed successfully!");
  } catch (err) {
    console.error("❌ Migration failed:", err);
  }
}

migrate();
