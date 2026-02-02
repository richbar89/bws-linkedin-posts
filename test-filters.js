// Test different API filter combinations
console.log("🔍 Testing Find-a-Tender API with different filters...\n");

async function testFilters() {
  const threeWeeksAgo = new Date();
  threeWeeksAgo.setDate(threeWeeksAgo.getDate() - 21);
  const dateFrom = threeWeeksAgo.toISOString();

  const tests = [
    {
      name: "With stages=tender filter",
      url: `https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?updatedFrom=${dateFrom}&limit=100&stages=tender`,
    },
    {
      name: "WITHOUT stages filter",
      url: `https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?updatedFrom=${dateFrom}&limit=100`,
    },
    {
      name: "With releaseTag=tender",
      url: `https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?updatedFrom=${dateFrom}&limit=100&releaseTag=tender`,
    },
  ];

  for (const test of tests) {
    console.log("=".repeat(70));
    console.log(`TEST: ${test.name}`);
    console.log("=".repeat(70));

    try {
      const response = await fetch(test.url);
      console.log(`Status: ${response.status} ${response.statusText}`);

      if (response.ok) {
        const data = await response.json();
        console.log(`✅ Releases: ${data.releases?.length || 0}`);
        console.log(`   Has next link: ${!!data.links?.next ? "YES" : "NO"}`);

        if (data.links?.next) {
          console.log(`   Next URL: ${data.links.next.substring(0, 80)}...`);
        }

        // Check tender statuses in first page
        if (data.releases && data.releases.length > 0) {
          const statuses = {};
          data.releases.forEach((r) => {
            if (r.tender?.status) {
              statuses[r.tender.status] = (statuses[r.tender.status] || 0) + 1;
            }
          });
          console.log(`   Statuses found:`, statuses);
        }
      } else {
        console.log(`❌ Error: ${response.status}`);
      }
    } catch (error) {
      console.log(`❌ Error: ${error.message}`);
    }

    console.log();

    // Small delay between tests
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.log("=".repeat(70));
  console.log("RECOMMENDATION:");
  console.log("=".repeat(70));
  console.log("If one version gives more results with pagination,");
  console.log("we should use that in fetch-and-save-tenders.js");
  console.log();
}

testFilters();
