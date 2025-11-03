const { Client } = require("pg");

async function checkDatabase() {
  const client = new Client({
    connectionString:
      process.env.DATABASE_URL || "postgresql://localhost:5432/tenders",
  });

  await client.connect();

  // Count tenders
  const result = await client.query("SELECT COUNT(*) FROM tenders");
  console.log(`\n📊 Total tenders in database: ${result.rows[0].count}\n`);

  // Show first 3 examples
  const tenders = await client.query(
    "SELECT id, title, status, buyer_name FROM tenders LIMIT 3",
  );

  console.log("📋 Sample tenders:\n");
  tenders.rows.forEach((tender, i) => {
    console.log(`${i + 1}. ${tender.title}`);
    console.log(`   ID: ${tender.id}`);
    console.log(`   Status: ${tender.status}`);
    console.log(`   Buyer: ${tender.buyer_name}\n`);
  });

  await client.end();
}

checkDatabase();
