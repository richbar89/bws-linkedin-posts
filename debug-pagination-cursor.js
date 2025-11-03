// Debug pagination cursor handling
async function debugPagination() {
  console.log("🔍 DEBUGGING PAGINATION CURSOR\n");
  console.log("=".repeat(70) + "\n");

  const tenDaysAgo = new Date();
  tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
  const dateFrom = tenDaysAgo.toISOString();
  const stages = "planning,tender";

  // Page 1
  console.log("📄 PAGE 1 REQUEST:");
  const page1Url = `https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?stages=${stages}&updatedFrom=${dateFrom}&limit=50`;
  console.log(`URL: ${page1Url}\n`);

  const response1 = await fetch(page1Url);
  const data1 = await response1.json();

  console.log(`✅ Page 1 successful: ${data1.releases?.length || 0} releases`);
  console.log(`🔗 Has next link: ${data1.links?.next ? "YES" : "NO"}`);

  if (data1.links?.next) {
    console.log(`🔗 Full next URL: ${data1.links.next}\n`);

    // Method 1: Extract cursor using URL parsing
    try {
      const nextUrl = new URL(data1.links.next);
      const cursor = nextUrl.searchParams.get("cursor");
      console.log("METHOD 1: URL parsing");
      console.log(`   Cursor extracted: ${cursor}\n`);

      // Try building page 2 request the way the code does it
      console.log("📄 PAGE 2 REQUEST (Method 1):");
      const page2Url = `https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?stages=${stages}&updatedFrom=${dateFrom}&limit=50&cursor=${cursor}`;
      console.log(`URL: ${page2Url.substring(0, 150)}...\n`);

      console.log("Attempting page 2 fetch...");
      const response2 = await fetch(page2Url);

      if (response2.ok) {
        const data2 = await response2.json();
        console.log(
          `✅ Page 2 successful: ${data2.releases?.length || 0} releases\n`,
        );
      } else {
        console.log(`❌ Page 2 failed: ${response2.status}`);
        const errorText = await response2.text();
        console.log(`Error response: ${errorText.substring(0, 200)}\n`);
      }
    } catch (e) {
      console.log(`❌ Error with Method 1: ${e.message}\n`);
    }

    // Method 2: Use the full next URL directly
    console.log("METHOD 2: Use full next URL directly");
    console.log(`Attempting page 2 fetch with full URL...\n`);

    const response2Direct = await fetch(data1.links.next);

    if (response2Direct.ok) {
      const data2Direct = await response2Direct.json();
      console.log(
        `✅ Page 2 successful: ${data2Direct.releases?.length || 0} releases`,
      );
      console.log(
        `🔗 Has next link: ${data2Direct.links?.next ? "YES" : "NO"}\n`,
      );
    } else {
      console.log(`❌ Page 2 failed: ${response2Direct.status}`);
      const errorText = await response2Direct.text();
      console.log(`Error response: ${errorText.substring(0, 200)}\n`);
    }
  }

  console.log("\n" + "=".repeat(70));
  console.log("💡 CONCLUSION:");
  console.log("If Method 2 works but Method 1 doesn't, we need to use");
  console.log("the full 'next' URL instead of building it ourselves.");
}

debugPagination();
