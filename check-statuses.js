// Check what tender statuses are actually in the database
const { Client } = require("pg");

async function checkStatuses() {
  const client = new Client({
    connectionString:
      process.env.DATABASE_URL || "postgresql://localhost:5432/tenders",
  });

  await client.connect();

  try {
    console.log("\n🔍 Analyzing tender statuses in database...\n");

    // Get count of tenders by status
    const statusCounts = await client.query(`
      SELECT status, COUNT(*) as count
      FROM tenders
      GROUP BY status
      ORDER BY count DESC
    `);

    console.log("📊 Tenders by Status:");
    console.log("━".repeat(60));
    statusCounts.rows.forEach((row) => {
      console.log(`   ${row.status}: ${row.count} tenders`);
    });
    console.log("━".repeat(60));

    // Get total count
    const total = await client.query("SELECT COUNT(*) FROM tenders");
    console.log(`\n📈 Total tenders in database: ${total.rows[0].count}`);

    // Check how many would be shown with current filter
    const filtered = await client.query(
      "SELECT COUNT(*) FROM tenders WHERE status IN ('planned', 'active')",
    );
    console.log(
      `🔽 Currently filtered TO show: ${filtered.rows[0].count} tenders`,
    );
    console.log(
      `❌ Currently filtered OUT: ${parseInt(total.rows[0].count) - parseInt(filtered.rows[0].count)} tenders`,
    );

    // Sample some tenders with their CPV codes
    console.log("\n📋 Sample tenders:");
    const samples = await client.query(
      "SELECT title, status, cpv_codes FROM tenders LIMIT 5",
    );
    samples.rows.forEach((tender, i) => {
      console.log(`\n${i + 1}. ${tender.title}`);
      console.log(`   Status: ${tender.status}`);
      let cpvs = [];
      try {
        if (typeof tender.cpv_codes === "string") {
          cpvs = JSON.parse(tender.cpv_codes);
        } else if (Array.isArray(tender.cpv_codes)) {
          cpvs = tender.cpv_codes;
        }
      } catch (e) {}
      console.log(`   CPV Codes: ${cpvs.join(", ") || "None"}`);
    });

    console.log("\n");
  } catch (error) {
    console.error("❌ Error:", error.message);
  } finally {
    await client.end();
  }
}

checkStatuses();
