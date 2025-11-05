// Check when the database was last updated
const { Client } = require("pg");

async function checkLastUpdate() {
  const client = new Client({
    connectionString:
      process.env.DATABASE_URL || "postgresql://localhost:5432/tenders",
  });

  await client.connect();

  try {
    console.log("\n🔍 Checking database update status...\n");

    // Get the most recent tender by publication date
    const mostRecent = await client.query(
      "SELECT title, publication_date, created_at FROM tenders ORDER BY publication_date DESC LIMIT 1",
    );

    if (mostRecent.rows.length > 0) {
      const tender = mostRecent.rows[0];
      console.log("📅 Most Recently PUBLISHED Tender:");
      console.log(`   Title: ${tender.title}`);
      console.log(
        `   Published: ${new Date(tender.publication_date).toLocaleString("en-GB")}`,
      );
      console.log(
        `   Added to DB: ${new Date(tender.created_at).toLocaleString("en-GB")}`,
      );
    }

    // Get when tenders were last added to the database
    const lastAdded = await client.query(
      "SELECT created_at FROM tenders ORDER BY created_at DESC LIMIT 1",
    );

    if (lastAdded.rows.length > 0) {
      const lastUpdate = new Date(lastAdded.rows[0].created_at);
      const now = new Date();
      const hoursSince = Math.round((now - lastUpdate) / (1000 * 60 * 60));

      console.log(`\n⏰ Database Last Updated:`);
      console.log(`   ${lastUpdate.toLocaleString("en-GB")}`);
      console.log(`   (${hoursSince} hours ago)`);
    }

    // Count tenders by publication date (last 3 days)
    console.log("\n📊 Tenders by Publication Date (last 3 days):");
    const recentDays = await client.query(`
      SELECT 
        DATE(publication_date) as day,
        COUNT(*) as count
      FROM tenders
      WHERE publication_date >= NOW() - INTERVAL '3 days'
      GROUP BY DATE(publication_date)
      ORDER BY day DESC
    `);

    recentDays.rows.forEach((row) => {
      console.log(
        `   ${new Date(row.day).toLocaleDateString("en-GB")}: ${row.count} tenders`,
      );
    });

    // Total count
    const total = await client.query("SELECT COUNT(*) FROM tenders");
    console.log(`\n📈 Total tenders in database: ${total.rows[0].count}`);

    console.log("\n");
  } catch (error) {
    console.error("❌ Error:", error.message);
  } finally {
    await client.end();
  }
}

checkLastUpdate();
