// UPDATED: Fetch tenders from API - NOW INCLUDES CONTRACT VALUE!
const { Client } = require("pg");

// Helper function to normalize CPV codes
function normalizeCpvCode(cpv) {
  if (!cpv) return null;
  const normalized = String(cpv).replace(/-/g, "").substring(0, 8);
  return normalized.length === 8 ? normalized : null;
}

async function fetchAndSaveTenders() {
  console.log("\n" + "=".repeat(70));
  console.log("🚀 TENDER FETCH STARTING - WITH VALUE EXTRACTION");
  console.log("=".repeat(70) + "\n");

  // Calculate date from 21 days ago
  const threeWeeksAgo = new Date();
  threeWeeksAgo.setDate(threeWeeksAgo.getDate() - 21);
  const dateFrom = threeWeeksAgo.toISOString();

  console.log(`📅 Fetching tenders from: ${dateFrom}`);
  console.log(
    `📅 That's ${Math.round((Date.now() - threeWeeksAgo) / (1000 * 60 * 60 * 24))} days ago\n`,
  );

  // Connect to database
  const client = new Client({
    connectionString:
      process.env.DATABASE_URL || "postgresql://localhost:5432/tenders",
  });

  await client.connect();
  console.log("✅ Connected to database\n");

  try {
    let allReleases = [];
    let pageCount = 0;

    let nextUrl = `https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?updatedFrom=${dateFrom}&limit=100`;

    console.log("⚡ Starting pagination...");
    console.log(
      "⚡ NOTE: Fetching ALL statuses, will filter for active ones after\n",
    );

    // Pagination loop
    while (nextUrl && pageCount < 30) {
      pageCount++;
      console.log(`📡 Page ${pageCount}...`);

      try {
        const response = await fetch(nextUrl);

        if (!response.ok) {
          console.log(
            `   ❌ HTTP Error: ${response.status} ${response.statusText}`,
          );
          break;
        }

        const data = await response.json();

        if (data.releases && Array.isArray(data.releases)) {
          const newReleases = data.releases.length;
          allReleases = allReleases.concat(data.releases);
          console.log(
            `   ✅ Got ${newReleases} releases (Total: ${allReleases.length})`,
          );
        } else {
          console.log(`   ⚠️  No releases in response`);
        }

        // Check for next page
        if (data.links?.next) {
          nextUrl = data.links.next;
          console.log(`   ➡️  Next page available`);
          await new Promise((resolve) => setTimeout(resolve, 200));
        } else {
          console.log(`   ✋ No more pages`);
          nextUrl = null;
        }
      } catch (fetchError) {
        console.log(`   ❌ Fetch error: ${fetchError.message}`);
        break;
      }
    }

    if (pageCount >= 30) {
      console.log("\n⚠️  Reached 30-page safety limit");
    }

    console.log("\n" + "=".repeat(70));
    console.log(
      `📊 FETCH COMPLETE: ${allReleases.length} releases from ${pageCount} pages`,
    );
    console.log("=".repeat(70) + "\n");

    // Now process and filter
    console.log("💾 Processing and filtering tenders...\n");

    let processedCount = 0;
    let savedCount = 0;
    let skippedNoTender = 0;
    let skippedInactive = 0;
    let cpvIssues = 0;
    let valuesFound = 0;
    let valuesMissing = 0;
    let allStatusCounts = {};
    let savedStatusCounts = {};

    // Clear old tenders
    await client.query("DELETE FROM tenders");
    console.log("🧹 Cleared existing tenders\n");

    // Define which statuses we want to keep
    const ACTIVE_STATUSES = ["active", "planning", "planned"];

    for (const release of allReleases) {
      if (!release.tender) {
        skippedNoTender++;
        continue;
      }

      processedCount++;
      const tenderStatus = (release.tender.status || "unknown").toLowerCase();

      // Count ALL statuses for reporting
      allStatusCounts[tenderStatus] = (allStatusCounts[tenderStatus] || 0) + 1;

      // Skip if not an active status
      if (!ACTIVE_STATUSES.includes(tenderStatus)) {
        skippedInactive++;
        continue;
      }

      // Count saved statuses
      savedStatusCounts[tenderStatus] =
        (savedStatusCounts[tenderStatus] || 0) + 1;

      // Extract CPV codes
      let cpvCodes = [];

      if (release.tender.classification?.id) {
        const normalized = normalizeCpvCode(release.tender.classification.id);
        if (normalized) cpvCodes.push(normalized);
      }

      if (release.tender.items) {
        for (const item of release.tender.items) {
          if (item.classification?.id) {
            const normalized = normalizeCpvCode(item.classification.id);
            if (normalized) cpvCodes.push(normalized);
          }

          if (item.additionalClassifications) {
            for (const ac of item.additionalClassifications) {
              if (ac.scheme === "CPV" && ac.id) {
                const normalized = normalizeCpvCode(ac.id);
                if (normalized) cpvCodes.push(normalized);
              }
            }
          }
        }
      }

      cpvCodes = [...new Set(cpvCodes)];

      if (cpvCodes.length === 0) {
        cpvIssues++;
      }

      // **NEW: Extract contract value**
      const valueAmount = release.tender.value?.amount || null;
      const valueCurrency = release.tender.value?.currency || "GBP";

      if (valueAmount) {
        valuesFound++;
      } else {
        valuesMissing++;
      }

      const deadline = release.tender.tenderPeriod?.endDate || null;
      const buyerName = release.buyer?.name || "Unknown";
      const tenderUrl = `https://www.find-tender.service.gov.uk/Notice/${release.id}`;

      // Save to database with value fields
      try {
        await client.query(
          `INSERT INTO tenders (
            id, title, description, cpv_codes, 
            publication_date, deadline_date, status, 
            buyer_name, tender_url, value_amount, value_currency
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          ON CONFLICT (id) DO UPDATE SET
            title = EXCLUDED.title,
            description = EXCLUDED.description,
            cpv_codes = EXCLUDED.cpv_codes,
            deadline_date = EXCLUDED.deadline_date,
            status = EXCLUDED.status,
            value_amount = EXCLUDED.value_amount,
            value_currency = EXCLUDED.value_currency`,
          [
            release.id,
            release.tender.title || "No title",
            release.tender.description || "",
            JSON.stringify(cpvCodes),
            release.date,
            deadline,
            tenderStatus,
            buyerName,
            tenderUrl,
            valueAmount,
            valueCurrency,
          ],
        );

        savedCount++;

        if (savedCount % 100 === 0) {
          console.log(`   📝 Saved ${savedCount} tenders...`);
        }
      } catch (dbError) {
        console.log(`   ⚠️  DB error for ${release.id}: ${dbError.message}`);
      }
    }

    // Results summary
    console.log("\n" + "=".repeat(70));
    console.log("📊 PROCESSING SUMMARY");
    console.log("=".repeat(70) + "\n");
    console.log(`   Total releases fetched: ${allReleases.length}`);
    console.log(`   Pages fetched: ${pageCount}`);
    console.log(`   Releases with tender data: ${processedCount}`);
    console.log(`   Releases without tender data: ${skippedNoTender}`);
    console.log(`   Tenders with inactive status: ${skippedInactive}`);
    console.log(`   ✅ SAVED active tenders: ${savedCount}`);
    console.log(`   Tenders missing CPV codes: ${cpvIssues}`);
    console.log(`   💰 Tenders WITH contract value: ${valuesFound}`);
    console.log(`   ⚠️  Tenders WITHOUT contract value: ${valuesMissing}`);

    console.log("\n📊 All statuses found in API:");
    Object.entries(allStatusCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([status, count]) => {
        const kept = ACTIVE_STATUSES.includes(status)
          ? "✅ KEPT"
          : "❌ FILTERED";
        console.log(`   ${status}: ${count} ${kept}`);
      });

    console.log("\n📊 Statuses saved to database:");
    Object.entries(savedStatusCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([status, count]) => {
        console.log(`   ${status}: ${count}`);
      });

    // Verify database
    const dbCount = await client.query("SELECT COUNT(*) FROM tenders");
    const dbStatusBreakdown = await client.query(`
      SELECT status, COUNT(*) as count
      FROM tenders
      GROUP BY status
      ORDER BY count DESC
    `);

    console.log(`\n✅ Database now contains: ${dbCount.rows[0].count} tenders`);
    console.log("\n📊 Database status verification:");
    dbStatusBreakdown.rows.forEach((row) => {
      console.log(`   ${row.status}: ${row.count}`);
    });

    // Value summary
    const valueStats = await client.query(`
      SELECT 
        COUNT(*) FILTER (WHERE value_amount IS NOT NULL) as with_value,
        COUNT(*) FILTER (WHERE value_amount IS NULL) as without_value,
        MIN(value_amount) as min_value,
        MAX(value_amount) as max_value,
        AVG(value_amount) as avg_value
      FROM tenders
    `);

    console.log("\n💰 Contract Value Statistics:");
    console.log(`   Tenders with value: ${valueStats.rows[0].with_value}`);
    console.log(
      `   Tenders without value: ${valueStats.rows[0].without_value}`,
    );
    if (valueStats.rows[0].min_value) {
      console.log(
        `   Min value: £${parseFloat(valueStats.rows[0].min_value).toLocaleString()}`,
      );
      console.log(
        `   Max value: £${parseFloat(valueStats.rows[0].max_value).toLocaleString()}`,
      );
      console.log(
        `   Avg value: £${parseFloat(valueStats.rows[0].avg_value).toLocaleString()}`,
      );
    }

    console.log("\n" + "=".repeat(70));

    // Health check
    if (savedCount < 500) {
      console.log("\n⚠️  WARNING: Lower than expected tender count");
      console.log(`   Expected: ~650+ active tenders in 21-day window`);
      console.log(`   Got: ${savedCount} tenders`);
    } else {
      console.log("\n✅ SUCCESS: Healthy tender count!");
      console.log(`   ${savedCount} active tenders saved`);
      console.log(`   ${valuesFound} have contract values`);
    }

    console.log("\n" + "=".repeat(70) + "\n");
  } catch (error) {
    console.log("\n" + "=".repeat(70));
    console.log("❌ FATAL ERROR");
    console.log("=".repeat(70));
    console.log(`\nError: ${error.message}`);
    console.log(`\nStack: ${error.stack}`);
    console.log("\n" + "=".repeat(70) + "\n");
  } finally {
    await client.end();
  }
}

// Run if called directly
if (require.main === module) {
  fetchAndSaveTenders().catch(console.error);
}

module.exports = { fetchAndSaveTenders };
