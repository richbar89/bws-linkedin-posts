// Fetch tenders from API and save to database
// FIXED: Removed stages filter to get ALL tenders (matches website behavior)
const { Client } = require("pg");

async function fetchAndSaveTenders() {
  console.log("🚀 Starting tender fetch...\n");

  // Calculate date from 10 days ago
  const tenDaysAgo = new Date();
  tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
  const dateFrom = tenDaysAgo.toISOString();

  console.log(`📅 Fetching tenders from: ${dateFrom}\n`);

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

    // Initial URL - NO stages filter to get all tenders
    let apiUrl = `https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?updatedFrom=${dateFrom}&limit=50`;

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
    } while (nextUrl);

    console.log(`\n✅ Fetched ${allTenders.length} total releases\n`);

    // Process and save tenders
    console.log("💾 Saving tenders to database...");

    let savedCount = 0;
    let skippedCount = 0;

    // Clear existing tenders first (rolling 10-day window)
    await client.query("DELETE FROM tenders");
    console.log("🧹 Cleared old tenders\n");

    for (const release of allTenders) {
      // Only process if it has tender data
      if (release.tender) {
        // Extract CPV codes - FIXED to look in the right places!
        let cpvCodes = [];

        // 1. Get main classification CPV code
        if (release.tender.classification && release.tender.classification.id) {
          cpvCodes.push(release.tender.classification.id);
        }

        // 2. Get additional classifications from items
        if (release.tender.items) {
          for (const item of release.tender.items) {
            if (item.additionalClassifications) {
              for (const classification of item.additionalClassifications) {
                if (classification.scheme === "CPV" && classification.id) {
                  cpvCodes.push(classification.id);
                }
              }
            }
          }
        }

        // Remove duplicates
        cpvCodes = [...new Set(cpvCodes)];

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

        // Save to database
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
              release.tender.status || "active",
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
        skippedCount++;
      }
    }

    console.log(`\n📊 Results:`);
    console.log(`   Total releases fetched: ${allTenders.length}`);
    console.log(`   Saved to database: ${savedCount}`);
    console.log(`   Skipped (no tender data): ${skippedCount}`);
    console.log(`   Pages fetched: ${pageCount}`);
    console.log("\n✨ Done! Rolling 10-day window updated.\n");
  } catch (error) {
    console.log("❌ Error:", error.message);
  } finally {
    await client.end();
  }
}

fetchAndSaveTenders();
