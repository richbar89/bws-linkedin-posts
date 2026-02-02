// Quick test of Find-a-Tender API
console.log("🔍 Testing Find-a-Tender API...\n");

async function testApi() {
  // Test with 21 days ago
  const threeWeeksAgo = new Date();
  threeWeeksAgo.setDate(threeWeeksAgo.getDate() - 21);
  const dateFrom = threeWeeksAgo.toISOString();

  const url = `https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?updatedFrom=${dateFrom}&limit=100&stages=tender`;

  console.log("Testing URL:");
  console.log(url);
  console.log();

  try {
    console.log("📡 Fetching first page...");
    const response = await fetch(url);

    console.log(`Status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      console.log("❌ API returned error status");
      return;
    }

    const data = await response.json();

    console.log("\n📊 Response structure:");
    console.log(
      `- Has 'releases' array: ${Array.isArray(data.releases) ? "YES" : "NO"}`,
    );
    console.log(`- Number of releases: ${data.releases?.length || 0}`);
    console.log(`- Has 'links' object: ${!!data.links ? "YES" : "NO"}`);
    console.log(`- Has 'next' link: ${!!data.links?.next ? "YES" : "NO"}`);

    if (data.releases && data.releases.length > 0) {
      const firstRelease = data.releases[0];
      console.log("\n📄 First release sample:");
      console.log(`- ID: ${firstRelease.id}`);
      console.log(`- Has tender: ${!!firstRelease.tender ? "YES" : "NO"}`);
      if (firstRelease.tender) {
        console.log(
          `- Title: ${firstRelease.tender.title?.substring(0, 60)}...`,
        );
        console.log(`- Status: ${firstRelease.tender.status}`);
        console.log(`- Published: ${firstRelease.date}`);
      }
    }

    if (data.links?.next) {
      console.log("\n🔗 Next page URL:");
      console.log(data.links.next.substring(0, 100) + "...");
    }

    console.log("\n✅ API test successful!");
  } catch (error) {
    console.log("\n❌ Error:", error.message);
  }
}

testApi();
