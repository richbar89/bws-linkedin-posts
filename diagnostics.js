// Comprehensive diagnostic for tender scanner
const { Client } = require("pg");

async function runDiagnostics() {
  console.log("\n" + "=".repeat(70));
  console.log("🔍 TENDER SCANNER DIAGNOSTICS");
  console.log("=".repeat(70) + "\n");

  const client = new Client({
    connectionString:
      process.env.DATABASE_URL || "postgresql://localhost:5432/tenders",
  });

  try {
    await client.connect();
    console.log("✅ Database connection: OK\n");

    // 1. Check total tender count
    console.log("📊 TENDER COUNT CHECK");
    console.log("-".repeat(70));
    const totalCount = await client.query("SELECT COUNT(*) FROM tenders");
    console.log(`   Total tenders in database: ${totalCount.rows[0].count}`);

    if (parseInt(totalCount.rows[0].count) < 500) {
      console.log("   ⚠️  WARNING: Expected ~650+ tenders from 21-day window");
      console.log(
        "   ⚠️  This suggests the fetch script may not be running properly\n",
      );
    } else {
      console.log("   ✅ Tender count looks healthy\n");
    }

    // 2. Check when database was last updated
    console.log("⏰ LAST UPDATE CHECK");
    console.log("-".repeat(70));
    const lastUpdate = await client.query(
      "SELECT MAX(created_at) as last_update FROM tenders",
    );

    if (lastUpdate.rows[0].last_update) {
      const lastUpdateDate = new Date(lastUpdate.rows[0].last_update);
      const now = new Date();
      const hoursSince = Math.round((now - lastUpdateDate) / (1000 * 60 * 60));

      console.log(
        `   Last database update: ${lastUpdateDate.toLocaleString("en-GB")}`,
      );
      console.log(`   Hours since last update: ${hoursSince}`);

      if (hoursSince > 25) {
        console.log(
          "   ⚠️  WARNING: Database hasn't been updated in over 24 hours!",
        );
        console.log("   ⚠️  The 5am daily job may not be running\n");
      } else {
        console.log("   ✅ Database was updated recently\n");
      }
    } else {
      console.log("   ❌ ERROR: No tenders found in database\n");
    }

    // 3. Check recent tenders by publication date
    console.log("📅 RECENT TENDERS (by publication date)");
    console.log("-".repeat(70));
    const recentTenders = await client.query(`
      SELECT 
        DATE(publication_date) as day,
        COUNT(*) as count
      FROM tenders
      WHERE publication_date >= NOW() - INTERVAL '7 days'
      GROUP BY DATE(publication_date)
      ORDER BY day DESC
      LIMIT 7
    `);

    if (recentTenders.rows.length === 0) {
      console.log("   ⚠️  No tenders published in the last 7 days");
      console.log("   ⚠️  This could indicate a fetching problem\n");
    } else {
      recentTenders.rows.forEach((row) => {
        const date = new Date(row.day);
        console.log(
          `   ${date.toLocaleDateString("en-GB", {
            weekday: "short",
            day: "2-digit",
            month: "short",
          })}: ${row.count} tenders`,
        );
      });
      console.log();
    }

    // 4. Check status distribution
    console.log("📊 STATUS DISTRIBUTION");
    console.log("-".repeat(70));
    const statusDist = await client.query(`
      SELECT status, COUNT(*) as count
      FROM tenders
      GROUP BY status
      ORDER BY count DESC
    `);

    statusDist.rows.forEach((row) => {
      console.log(`   ${row.status}: ${row.count}`);
    });
    console.log();

    // 5. Check sample of most recent tenders
    console.log("📰 MOST RECENT TENDERS (top 5)");
    console.log("-".repeat(70));
    const sampleTenders = await client.query(`
      SELECT title, publication_date, status, created_at
      FROM tenders
      ORDER BY publication_date DESC
      LIMIT 5
    `);

    sampleTenders.rows.forEach((tender, i) => {
      console.log(`   ${i + 1}. ${tender.title.substring(0, 50)}...`);
      console.log(
        `      Published: ${new Date(tender.publication_date).toLocaleDateString("en-GB")}`,
      );
      console.log(
        `      Added to DB: ${new Date(tender.created_at).toLocaleString("en-GB")}`,
      );
      console.log(`      Status: ${tender.status}`);
      console.log();
    });

    // 6. Check CPV code coverage
    console.log("🏷️  CPV CODE COVERAGE");
    console.log("-".repeat(70));
    const noCpv = await client.query(`
      SELECT COUNT(*) as count
      FROM tenders
      WHERE cpv_codes = '[]'::jsonb OR cpv_codes IS NULL
    `);

    const withCpv =
      parseInt(totalCount.rows[0].count) - parseInt(noCpv.rows[0].count);
    console.log(`   Tenders with CPV codes: ${withCpv}`);
    console.log(`   Tenders without CPV codes: ${noCpv.rows[0].count}`);

    if (parseInt(noCpv.rows[0].count) > 50) {
      console.log(
        "   ⚠️  Many tenders missing CPV codes - this may affect matching\n",
      );
    } else {
      console.log("   ✅ CPV coverage looks good\n");
    }

    // 7. Check companies
    console.log("🏢 COMPANIES");
    console.log("-".repeat(70));
    const companyCount = await client.query("SELECT COUNT(*) FROM companies");
    console.log(`   Total companies tracked: ${companyCount.rows[0].count}`);

    if (parseInt(companyCount.rows[0].count) === 0) {
      console.log(
        "   ⚠️  No companies added yet - add some to see matching tenders\n",
      );
    } else {
      const companies = await client.query(
        "SELECT name, cpv_codes FROM companies LIMIT 5",
      );
      companies.rows.forEach((company) => {
        const cpvCodes =
          typeof company.cpv_codes === "string"
            ? JSON.parse(company.cpv_codes)
            : company.cpv_codes;
        console.log(`   - ${company.name} (${cpvCodes.length} CPV codes)`);
      });
      console.log();
    }

    // Final summary
    console.log("=".repeat(70));
    console.log("📋 SUMMARY");
    console.log("=".repeat(70));

    const issues = [];

    if (parseInt(totalCount.rows[0].count) < 500) {
      issues.push("Low tender count - may need to run fetch script");
    }

    if (lastUpdate.rows[0].last_update) {
      const hoursSince = Math.round(
        (new Date() - new Date(lastUpdate.rows[0].last_update)) /
          (1000 * 60 * 60),
      );
      if (hoursSince > 25) {
        issues.push(
          "Database not updated in 24+ hours - scheduler may not be running",
        );
      }
    }

    if (recentTenders.rows.length < 3) {
      issues.push("Few recent tenders - API fetch may be incomplete");
    }

    if (issues.length === 0) {
      console.log("\n✅ All checks passed! System appears healthy.\n");
    } else {
      console.log("\n⚠️  Issues detected:\n");
      issues.forEach((issue, i) => {
        console.log(`   ${i + 1}. ${issue}`);
      });
      console.log();
    }

    console.log("💡 RECOMMENDATIONS:");
    console.log("   1. Make sure scheduler.js is being imported in server.js");
    console.log("   2. Check Replit logs for scheduled job execution at 5am");
    console.log(
      "   3. Run 'node fetch-and-save-tenders.js' manually to update now",
    );
    console.log(
      "   4. Consider using Replit's 'Always On' feature to prevent sleeping",
    );
    console.log();
  } catch (error) {
    console.error("\n❌ Error running diagnostics:", error.message);
    console.error("\nStack trace:", error.stack);
  } finally {
    await client.end();
    console.log("=".repeat(70) + "\n");
  }
}

runDiagnostics();
