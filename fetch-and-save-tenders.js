// Fetch tenders from API and save to database
// FINAL SOLUTION - Fetch ALL tenders in tender stage, filter by deadline not passed
const { Client } = require("pg");

function normalizeCpvCode(cpv) {
  if (!cpv) return null;
  const normalized = String(cpv).replace(/-/g, "").substring(0, 8);
  return normalized.length === 8 ? normalized : null;
}

async function fetchAndSaveTenders() {
  console.log("🚀 Starting tender fetch...\n");
  console.log(
    "📋 Strategy: Fetch ALL tenders in 'tender' stage, keep only those with deadlines not passed\n",
  );

  const today = new Date();
  console.log(`📅 Today: ${today.toLocaleDateString("en-GB")}\n`);

  const client = new Client({
    connectionString:
      process.env.DATABASE_URL || "postgresql://localhost:5432/tenders",
  });

  await client.connect();
  console.log("✅ Connected to database\n");

  try {
    let allTenders = [];
    let nextUrl = null;
    let pageCount = 0;

    // NO DATE FILTER - just get all tenders in tender stage
    // The website's 656 includes old tenders still open to bid
    let apiUrl = `https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?limit=100&stages=tender`;

    console.log("⚡ Fetching ALL tenders in 'tender' procurement stage...");
    console.log("⚡ Will filter by deadline date (keep only open tenders)\n");

    do {
      pageCount++;
      const urlToFetch = nextUrl || apiUrl;

      console.log(`📡 Fetching page ${pageCount}...`);

      const response = await fetch(urlToFetch);
      if (!response.ok) throw new Error(`API error: ${response.status}`);

      const data = await response.json();

      if (data.releases && data.releases.length > 0) {
        // Filter - keep only tenders with deadline in future or no deadline
        const openTenders = data.releases.filter((release) => {
          if (!release.tender) return false;

          // If no deadline, keep it
          if (!release.tender.tenderPeriod?.endDate) return true;

          // Check deadline is in future
          const deadline = new Date(release.tender.tenderPeriod.endDate);
          return deadline >= today;
        });

        allTenders = allTenders.concat(openTenders);

        console.log(
          `   Got ${data.releases.length} releases (${openTenders.length} still open, ${allTenders.length} total)`,
        );
      }

      nextUrl = data.links?.next || null;

      if (nextUrl) {
        console.log(`   ➡️  More pages...\n`);
      } else {
        console.log(`   ✋ No more pages\n`);
      }

      if (pageCount >= 40) {
        console.log("   ⚠️  Reached page limit\n");
        break;
      }

      if (nextUrl) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    } while (nextUrl);

    console.log(
      `\n✅ Fetched ${allTenders.length} open tenders (${pageCount} pages)\n`,
    );

    // Save to database
    console.log("💾 Saving to database...\n");

    let savedCount = 0;
    let cpvIssues = 0;
    let statusCounts = {};

    await client.query("DELETE FROM tenders");
    console.log("🧹 Cleared old tenders\n");

    for (const release of allTenders) {
      if (release.tender) {
        const tenderStatus = (release.tender.status || "unknown").toLowerCase();
        statusCounts[tenderStatus] = (statusCounts[tenderStatus] || 0) + 1;

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
              for (const classification of item.additionalClassifications) {
                if (classification.scheme === "CPV" && classification.id) {
                  const normalized = normalizeCpvCode(classification.id);
                  if (normalized) cpvCodes.push(normalized);
                }
              }
            }
          }
        }

        cpvCodes = [...new Set(cpvCodes)];
        if (cpvCodes.length === 0) cpvIssues++;

        const deadline = release.tender.tenderPeriod?.endDate || null;
        const buyerName = release.buyer?.name || "Unknown";
        const tenderUrl = `https://www.find-tender.service.gov.uk/Notice/${release.id}`;

        try {
          await client.query(
            `INSERT INTO tenders (
              id, title, description, cpv_codes, 
              publication_date, deadline_date, status, 
              buyer_name, tender_url
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (id) DO UPDATE SET
              title = EXCLUDED.title,
              description = EXCLUDED.description,
              cpv_codes = EXCLUDED.cpv_codes,
              deadline_date = EXCLUDED.deadline_date,
              status = EXCLUDED.status`,
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
            ],
          );

          savedCount++;

          if (savedCount % 100 === 0) {
            console.log(`   Saved ${savedCount}...`);
          }
        } catch (dbError) {
          console.log(`   ⚠️  Error saving ${release.id}: ${dbError.message}`);
        }
      }
    }

    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📊 RESULTS`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    console.log(`   Open tenders (deadline >= today): ${allTenders.length}`);
    console.log(`   Pages fetched: ${pageCount}`);
    console.log(`   ✅ SAVED: ${savedCount} tenders`);
    console.log(`   Tenders with no CPV codes: ${cpvIssues}`);

    console.log(`\n📊 Status breakdown:`);
    Object.entries(statusCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([status, count]) => {
        console.log(`   ${status}: ${count}`);
      });

    const dbCount = await client.query("SELECT COUNT(*) FROM tenders");
    console.log(`\n✅ Database: ${dbCount.rows[0].count} tenders`);
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

    if (savedCount >= 600) {
      console.log("✅ SUCCESS - Got ~650 tenders!\n");
    } else {
      console.log(`Got ${savedCount} open tenders`);
      console.log(
        "This represents all tenders in 'tender' stage with open deadlines\n",
      );
      console.log(
        "Note: The website's 656 count may include additional notice types",
      );
      console.log(
        "that the API doesn't expose through the stages parameter.\n",
      );
    }
  } catch (error) {
    console.log("❌ Error:", error.message);
    console.log("Stack:", error.stack);
  } finally {
    await client.end();
  }
}

fetchAndSaveTenders();
