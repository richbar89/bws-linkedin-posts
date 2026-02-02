// Fetch tenders from API and save to database
// CORRECT FIX: No stages filter - just fetch everything and keep only status="active"
const { Client } = require("pg");

// Helper function to normalize CPV codes
function normalizeCpvCode(cpv) {
  if (!cpv) return null;
  // Remove dashes and take first 8 digits
  const normalized = String(cpv).replace(/-/g, "").substring(0, 8);
  return normalized.length === 8 ? normalized : null;
}

async function fetchAndSaveTenders() {
  console.log("🚀 Starting tender fetch (ACTIVE STATUS ONLY)...\n");

  // Calculate date from 21 days ago (3 weeks)
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
    // Fetch from API with pagination
    let allTenders = [];
    let nextUrl = null;
    let pageCount = 0;

    // NO STAGES FILTER - fetch everything, we'll filter by status
    let apiUrl = `https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?updatedFrom=${dateFrom}&limit=100`;

    console.log("⚡ Fetching ALL tenders (no stage filter)...\n");

    do {
      pageCount++;

      // Use nextUrl if we have it from previous response, otherwise use initial URL
      const urlToFetch = nextUrl || apiUrl;

      console.log(`📡 Fetching page ${pageCount}...`);

      const response = await fetch(urlToFetch);

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();

      if (data.releases && data.releases.length > 0) {
        allTenders = allTenders.concat(data.releases);
        console.log(
          `   Got ${data.releases.length} releases (Total: ${allTenders.length})`,
        );
      }

      // Check for next page - use the FULL next URL
      nextUrl = data.links?.next || null;

      if (nextUrl) {
        console.log(`   ➡️  More pages available...\n`);
      } else {
        console.log(`   ✋ No more pages\n`);
      }

      // Safety limit - stop after 20 pages (2000 tenders)
      if (pageCount >= 20) {
        console.log("   ⚠️  Reached page limit (20 pages)\n");
        break;
      }
    } while (nextUrl);

    console.log(`\n✅ Fetched ${allTenders.length} total releases\n`);

    // Process and save tenders
    console.log("💾 Processing and saving tenders...\n");

    let savedCount = 0;
    let skippedNoTender = 0;
    let skippedWrongStatus = 0;
    let cpvIssues = 0;
    let statusCounts = {};

    // Clear existing tenders first (rolling 21-day window)
    await client.query("DELETE FROM tenders");
    console.log("🧹 Cleared old tenders\n");

    for (const release of allTenders) {
      // Only process if it has tender data
      if (release.tender) {
        const tenderStatus = (release.tender.status || "unknown").toLowerCase();

        // Track ALL status counts for reporting
        statusCounts[tenderStatus] = (statusCounts[tenderStatus] || 0) + 1;

        // ONLY SAVE if status is "active" (live tender)
        if (tenderStatus !== "active") {
          skippedWrongStatus++;
          continue;
        }

        // Extract CPV codes - Get from ALL sources
        let cpvCodes = [];

        // 1. Get main classification CPV code (tender level)
        if (release.tender.classification && release.tender.classification.id) {
          const normalized = normalizeCpvCode(release.tender.classification.id);
          if (normalized) {
            cpvCodes.push(normalized);
          }
        }

        // 2. Get CPV codes from items
        if (release.tender.items) {
          for (const item of release.tender.items) {
            // Get main item classification
            if (item.classification && item.classification.id) {
              const normalized = normalizeCpvCode(item.classification.id);
              if (normalized) {
                cpvCodes.push(normalized);
              }
            }

            // Get additional classifications
            if (item.additionalClassifications) {
              for (const classification of item.additionalClassifications) {
                if (classification.scheme === "CPV" && classification.id) {
                  const normalized = normalizeCpvCode(classification.id);
                  if (normalized) {
                    cpvCodes.push(normalized);
                  }
                }
              }
            }
          }
        }

        // Remove duplicates
        cpvCodes = [...new Set(cpvCodes)];

        if (cpvCodes.length === 0) {
          cpvIssues++;
        }

        // Extract deadline
        let deadline = null;
        if (release.tender.tenderPeriod?.endDate) {
          deadline = release.tender.tenderPeriod.endDate;
        }

        // Extract buyer name
        let buyerName = "Unknown";
        if (release.buyer && release.buyer.name) {
          buyerName = release.buyer.name;
        }

        // Build tender URL
        const tenderUrl = `https://www.find-tender.service.gov.uk/Notice/${release.id}`;

        // Save to database - ONLY "active" tenders
        try {
          await client.query(
            `
            INSERT INTO tenders (
              id, title, description, cpv_codes, 
              publication_date, deadline_date, status, 
              buyer_name, tender_url
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (id) DO UPDATE SET
              title = EXCLUDED.title,
              description = EXCLUDED.description,
              cpv_codes = EXCLUDED.cpv_codes,
              deadline_date = EXCLUDED.deadline_date,
              status = EXCLUDED.status
          `,
            [
              release.id,
              release.tender.title || "No title",
              release.tender.description || "",
              JSON.stringify(cpvCodes),
              release.date,
              deadline,
              "active",
              buyerName,
              tenderUrl,
            ],
          );

          savedCount++;
        } catch (dbError) {
          console.log(
            `   ⚠️  Error saving tender ${release.id}: ${dbError.message}`,
          );
        }
      } else {
        skippedNoTender++;
      }
    }

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📊 RESULTS SUMMARY`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    console.log(`   Total releases fetched: ${allTenders.length}`);
    console.log(`   Pages fetched: ${pageCount}`);
    console.log(`   Releases with no tender data: ${skippedNoTender}`);
    console.log(
      `   Tenders with wrong status (skipped): ${skippedWrongStatus}`,
    );
    console.log(`   ✅ SAVED to database (active only): ${savedCount}`);
    console.log(`   Tenders with no CPV codes: ${cpvIssues}`);

    console.log(`\n📊 Status breakdown from API (ALL statuses fetched):`);
    Object.entries(statusCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([status, count]) => {
        const indicator = status === "active" ? "✅" : "❌";
        console.log(`   ${indicator} ${status}: ${count}`);
      });

    // Verify database
    const dbCount = await client.query("SELECT COUNT(*) FROM tenders");

    console.log(
      `\n✅ Database now contains: ${dbCount.rows[0].count} active tenders`,
    );
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    if (savedCount < 500) {
      console.log(
        "⚠️  WARNING: Expected around 655 active tenders based on manual check",
      );
      console.log("⚠️  Only saved " + savedCount + " - this seems low!");
      console.log("\n💡 Possible reasons:");
      console.log(
        "   - API might need more pages fetched (increase page limit)",
      );
      console.log("   - Date range might be different than website");
      console.log("   - Website might be counting differently\n");
    } else {
      console.log("✅ Tender count looks reasonable!\n");
    }
  } catch (error) {
    console.log("❌ Error:", error.message);
    console.log("Stack:", error.stack);
  } finally {
    await client.end();
  }
}

fetchAndSaveTenders();
