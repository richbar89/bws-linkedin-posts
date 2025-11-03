const { Client } = require("pg");

async function checkCpvCodes() {
  const client = new Client({
    connectionString:
      process.env.DATABASE_URL || "postgresql://localhost:5432/tenders",
  });

  await client.connect();

  const result = await client.query(
    "SELECT id, title, cpv_codes FROM tenders LIMIT 10",
  );

  console.log("\n📋 Sample tenders with CPV codes:\n");

  let withCpv = 0;
  let withoutCpv = 0;

  result.rows.forEach((tender) => {
    let cpvCodes = [];

    if (typeof tender.cpv_codes === "string") {
      try {
        cpvCodes = JSON.parse(tender.cpv_codes);
      } catch (e) {}
    } else if (Array.isArray(tender.cpv_codes)) {
      cpvCodes = tender.cpv_codes;
    } else if (
      typeof tender.cpv_codes === "object" &&
      tender.cpv_codes !== null
    ) {
      cpvCodes = Object.values(tender.cpv_codes);
    }

    if (cpvCodes.length > 0) {
      withCpv++;
      console.log(`✅ ${tender.id}: ${tender.title.substring(0, 50)}...`);
      console.log(`   CPV: ${cpvCodes.join(", ")}\n`);
    } else {
      withoutCpv++;
      console.log(
        `❌ ${tender.id}: ${tender.title.substring(0, 50)}... (NO CPV CODES)\n`,
      );
    }
  });

  const total = await client.query("SELECT COUNT(*) FROM tenders");
  console.log(`\n📊 Summary:`);
  console.log(`   Total tenders: ${total.rows[0].count}`);
  console.log(`   With CPV codes (in sample): ${withCpv}/10`);
  console.log(`   Without CPV codes (in sample): ${withoutCpv}/10\n`);

  await client.end();
}

checkCpvCodes();
