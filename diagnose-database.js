// Quick diagnostic - check what's currently in the database
const { Client } = require("pg");

async function diagnose() {
  const client = new Client({
    connectionString:
      process.env.DATABASE_URL || "postgresql://localhost:5432/tenders",
  });

  await client.connect();
  console.log("\n🔍 DATABASE DIAGNOSTIC\n");
  console.log("━".repeat(60) + "\n");

  try {
    // Total count
    const total = await client.query("SELECT COUNT(*) FROM tenders");
    console.log(`📊 Total tenders in database: ${total.rows[0].count}`);

    if (parseInt(total.rows[0].count) < 500) {
      console.log(
        "⚠️  WARNING: This is MUCH lower than expected (should be ~650)!\n",
      );
    } else {
      console.log("✅ This looks reasonable!\n");
    }

    // Status breakdown
    console.log("📊 Status breakdown:");
    const statuses = await client.query(`
      SELECT status, COUNT(*) as count
      FROM tenders
      GROUP BY status
      ORDER BY count DESC
    `);

    statuses.rows.forEach((row) => {
      console.log(`   ${row.status}: ${row.count}`);
    });

    // Date range
    console.log("\n📅 Date range:");
    const dateRange = await client.query(`
      SELECT 
        MIN(publication_date) as oldest,
        MAX(publication_date) as newest
      FROM tenders
    `);

    if (dateRange.rows[0].oldest) {
      console.log(
        `   Oldest: ${new Date(dateRange.rows[0].oldest).toLocaleDateString("en-GB")}`,
      );
      console.log(
        `   Newest: ${new Date(dateRange.rows[0].newest).toLocaleDateString("en-GB")}`,
      );

      const daysCovered = Math.round(
        (new Date(dateRange.rows[0].newest) -
          new Date(dateRange.rows[0].oldest)) /
          (1000 * 60 * 60 * 24),
      );
      console.log(`   Covering: ${daysCovered} days`);
    }

    // Sample tenders
    console.log("\n📋 Sample tenders (first 3):");
    const samples = await client.query(`
      SELECT id, title, status, publication_date
      FROM tenders
      ORDER BY publication_date DESC
      LIMIT 3
    `);

    samples.rows.forEach((tender, i) => {
      console.log(`\n   ${i + 1}. ${tender.title.substring(0, 60)}...`);
      console.log(`      ID: ${tender.id}`);
      console.log(`      Status: ${tender.status}`);
      console.log(
        `      Published: ${new Date(tender.publication_date).toLocaleDateString("en-GB")}`,
      );
    });

    console.log("\n" + "━".repeat(60));
    console.log("\n💡 RECOMMENDATION:\n");

    if (parseInt(total.rows[0].count) < 500) {
      console.log("   Run: node fetch-and-save-tenders-CORRECT.js");
      console.log("   This should increase your tender count to ~650");
    } else {
      console.log("   Your database looks healthy!");
    }

    console.log("\n");
  } catch (error) {
    console.error("❌ Error:", error.message);
  } finally {
    await client.end();
  }
}

diagnose();
