// Test API with exact website parameters
async function testWebsiteParams() {
  console.log("\n🔬 TESTING WITH EXACT WEBSITE PARAMETERS\n");
  console.log("━".repeat(60) + "\n");

  // Exact dates from website: 15/12/2025 to 05/01/2026
  const fromDate = "2025-12-15T00:00:00Z";
  const toDate = "2026-01-05T23:59:59Z";

  console.log("Website filters:");
  console.log("  Procurement stage: Tender ✓");
  console.log("  Publication date: 15/12/2025 to 05/01/2026");
  console.log("  Result: 656 notices\n");

  // Test 1: publishedFrom and publishedTo
  console.log("TEST 1: Using publishedFrom and publishedTo");
  console.log("━".repeat(60));

  const url1 = `https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?publishedFrom=${fromDate}&publishedTo=${toDate}&limit=100&stages=tender`;
  console.log(`URL: ${url1}\n`);

  try {
    const response1 = await fetch(url1);
    const data1 = await response1.json();

    console.log(`Result: ${data1.releases?.length || 0} releases`);
    console.log(`Has next page: ${data1.links?.next ? "YES" : "NO"}`);

    if (data1.releases && data1.releases.length > 0) {
      console.log("\nSample dates:");
      data1.releases.slice(0, 3).forEach((r, i) => {
        console.log(
          `  ${i + 1}. ${new Date(r.date).toLocaleDateString("en-GB")}`,
        );
      });
    }
  } catch (error) {
    console.log(`Error: ${error.message}`);
  }

  // Test 2: Just remove the date filter and count all
  console.log("\n\nTEST 2: No date filter, stages=tender, count all pages");
  console.log("━".repeat(60));

  const url2 = `https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?limit=100&stages=tender`;
  console.log(`URL: ${url2}\n`);

  try {
    let totalCount = 0;
    let pageCount = 0;
    let nextUrl = url2;
    let inDateRange = 0;

    const fromDateObj = new Date("2025-12-15");
    const toDateObj = new Date("2026-01-06"); // Include 05/01

    while (nextUrl && pageCount < 10) {
      pageCount++;
      const response = await fetch(nextUrl);
      const data = await response.json();

      totalCount += data.releases?.length || 0;

      // Count how many are in date range
      if (data.releases) {
        const inRange = data.releases.filter((r) => {
          const pubDate = new Date(r.date);
          return pubDate >= fromDateObj && pubDate < toDateObj;
        }).length;
        inDateRange += inRange;

        console.log(
          `Page ${pageCount}: ${data.releases.length} releases (${inRange} in date range)`,
        );
      }

      nextUrl = data.links?.next || null;

      if (!nextUrl) {
        console.log("No more pages");
        break;
      }

      // Small delay
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    console.log(`\nTotal across ${pageCount} pages: ${totalCount} releases`);
    console.log(`In date range 15/12-05/01: ${inDateRange} releases`);
    console.log(
      `\n${inDateRange === 656 ? "✅ MATCHES website count!" : "⚠️  Does not match website (656)"}`,
    );
  } catch (error) {
    console.log(`Error: ${error.message}`);
  }

  console.log("\n" + "━".repeat(60) + "\n");
}

testWebsiteParams();
