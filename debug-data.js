const { Client } = require("pg");

async function debugData() {
  const client = new Client({
    connectionString:
      process.env.DATABASE_URL || "postgresql://localhost:5432/tenders",
  });

  await client.connect();

  // Check companies
  console.log("\n🏢 Companies in database:\n");
  const companies = await client.query("SELECT * FROM companies");
  companies.rows.forEach((company) => {
    console.log(`ID: ${company.id}`);
    console.log(`Name: ${company.name}`);
    console.log(`CPV Codes (raw): ${company.cpv_codes}`);
    console.log(`CPV Codes type: ${typeof company.cpv_codes}\n`);
  });

  // Check tenders
  console.log("\n📋 Sample tender CPV data:\n");
  const tenders = await client.query(
    "SELECT id, cpv_codes FROM tenders LIMIT 3",
  );
  tenders.rows.forEach((tender) => {
    console.log(`Tender ID: ${tender.id}`);
    console.log(`CPV Codes (raw): ${tender.cpv_codes}`);
    console.log(`CPV Codes type: ${typeof tender.cpv_codes}\n`);
  });

  await client.end();
}

debugData();
