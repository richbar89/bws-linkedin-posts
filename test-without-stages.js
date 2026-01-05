// Test WITHOUT stages filter to see if website uses different filtering
async function testWithoutStages() {
  console.log("\n🔬 TESTING WITHOUT STAGES FILTER\n");
  console.log("━".repeat(60) + "\n");

  console.log("Hypothesis: Maybe the website doesn't use stages=tender");
  console.log("or uses a different filtering method\n");

  const fromDateObj = new Date("2025-12-15");
  const toDateObj = new Date("2026-01-06");

  // Test: No stages filter at all
  console.log("TEST: No stages filter, count all in date range");
  console.log("━".repeat(60));

  const url = `https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?limit=100`;
  console.log(`URL: ${url}\n`);

  try {
    let totalCount = 0;
    let pageCount = 0;
    let nextUrl = url;
    let inDateRange = 0;
    let stageBreakdown = {};
    let statusBreakdown = {};

    while (nextUrl && pageCount < 10) {
      pageCount++;
      const response = await fetch(nextUrl);
      const data = await response.json();

      totalCount += data.releases?.length || 0;

      // Count how many are in date range and track stages
      if (data.releases) {
        data.releases.forEach((r) => {
          const pubDate = new Date(r.date);
          const isInRange = pubDate >= fromDateObj && pubDate < toDateObj;

          // Track stage
          const stage = r.tag?.[0] || "unknown";
          stageBreakdown[stage] = (stageBreakdown[stage] || 0) + 1;

          // Track status if in tender stage
          if (stage === "tender" && r.tender?.status) {
            statusBreakdown[r.tender.status] =
              (statusBreakdown[r.tender.status] || 0) + 1;
          }

          if (isInRange) {
            inDateRange++;
          }
        });

        console.log(
          `Page ${pageCount}: ${data.releases.length} releases (${inDateRange} total in date range so far)`,
        );
      }

      nextUrl = data.links?.next || null;

      if (!nextUrl) {
        console.log("No more pages\n");
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    console.log(`\n📊 RESULTS:`);
    console.log(`Total across ${pageCount} pages: ${totalCount} releases`);
    console.log(`In date range 15/12-05/01: ${inDateRange} releases`);
    console.log(`\n📊 Stage breakdown (all ${totalCount} releases):`);
    Object.entries(stageBreakdown)
      .sort((a, b) => b[1] - a[1])
      .forEach(([stage, count]) => {
        console.log(`   ${stage}: ${count}`);
      });

    if (Object.keys(statusBreakdown).length > 0) {
      console.log(`\n📊 Status breakdown (tender stage only):`);
      Object.entries(statusBreakdown)
        .sort((a, b) => b[1] - a[1])
        .forEach(([status, count]) => {
          console.log(`   ${status}: ${count}`);
        });
    }

    console.log(
      `\n${inDateRange === 656 ? "✅ MATCHES website count (656)!" : `⚠️  Still doesn't match website (656 vs ${inDateRange})`}`,
    );
  } catch (error) {
    console.log(`Error: ${error.message}`);
  }

  console.log("\n" + "━".repeat(60));
  console.log("\n💡 NEXT STEP:\n");
  console.log("If this also doesn't give 656, the website might be:");
  console.log("1. Using a different API endpoint");
  console.log("2. Filtering by deadline date instead of publication date");
  console.log("3. Including contract notices that extend beyond publication");
  console.log("4. Using cached/indexed data that's different from API\n");
}

testWithoutStages();
