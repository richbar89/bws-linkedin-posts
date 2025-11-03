// Diagnostic script to check tender API fetch
async function diagnoseTenderFetch() {
  console.log("🔍 TENDER FETCH DIAGNOSTICS\n");
  console.log("=".repeat(60) + "\n");

  // Calculate date from 10 days ago
  const tenDaysAgo = new Date();
  tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
  const dateFrom = tenDaysAgo.toISOString();

  console.log(`📅 Fetching tenders from: ${dateFrom}`);
  console.log(`📅 That's from: ${tenDaysAgo.toLocaleDateString()}\n`);

  const stages = "planning,tender";
  console.log(`🎯 Filtering by stages: ${stages}\n`);

  let allReleases = [];
  let cursor = null;
  let pageCount = 0;

  try {
    do {
      pageCount++;

      const apiUrl = cursor
        ? `https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?stages=${stages}&updatedFrom=${dateFrom}&limit=100&cursor=${cursor}`
        : `https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?stages=${stages}&updatedFrom=${dateFrom}&limit=100`;

      console.log(`📡 Fetching page ${pageCount}...`);

      const response = await fetch(apiUrl);

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const data = await response.json();

      if (data.releases && data.releases.length > 0) {
        allReleases = allReleases.concat(data.releases);
        console.log(`   ✅ Got ${data.releases.length} releases`);
        console.log(`   📊 Total so far: ${allReleases.length}`);
      } else {
        console.log(`   ⚠️  No releases on this page`);
      }

      // Check for next page
      if (data.links?.next) {
        cursor = new URL(data.links.next).searchParams.get("cursor");
        console.log(
          `   ➡️  More pages available (cursor: ${cursor?.substring(0, 20)}...)\n`,
        );
      } else {
        cursor = null;
        console.log(`   ✋ No more pages available\n`);
      }

      // Safety limit to prevent infinite loops
      if (pageCount >= 20) {
        console.log(`\n⚠️  Stopping at page 20 for safety\n`);
        break;
      }
    } while (cursor);

    console.log("\n" + "=".repeat(60));
    console.log("📊 FINAL RESULTS:");
    console.log("=".repeat(60));
    console.log(`Total pages fetched: ${pageCount}`);
    console.log(`Total releases: ${allReleases.length}`);

    // Count how many actually have tender data
    let withTenderData = 0;
    let withoutTenderData = 0;

    allReleases.forEach((release) => {
      if (release.tender) {
        withTenderData++;
      } else {
        withoutTenderData++;
      }
    });

    console.log(`Releases with tender data: ${withTenderData}`);
    console.log(`Releases without tender data: ${withoutTenderData}`);

    console.log("\n💡 RECOMMENDATIONS:");

    if (allReleases.length < 100) {
      console.log("❗ Very few tenders found. Consider:");
      console.log(
        "   • Increasing the date range (e.g., 30 days instead of 10)",
      );
      console.log("   • Removing the stages filter to get all tenders");
    }

    if (pageCount === 1) {
      console.log("❗ Only got 1 page of results. This might be normal,");
      console.log("   or the API might not be returning all available data.");
    }

    console.log("\n🔧 TO FIX: Edit fetch-and-save-tenders.js:");
    console.log("   • Line 7: Change 10 to a larger number (e.g., 30 or 90)");
    console.log("   • Line 19: Try removing stages filter");
  } catch (error) {
    console.log("\n❌ ERROR:", error.message);
  }
}

diagnoseTenderFetch();
