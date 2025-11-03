// Test each stage individually
async function testEachStage() {
  const tenDaysAgo = new Date();
  tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
  const dateFrom = tenDaysAgo.toISOString();

  console.log("🔍 TESTING EACH STAGE INDIVIDUALLY\n");
  console.log("=".repeat(70) + "\n");

  const stagesToTest = [
    "pipeline",
    "planning",
    "tender",
    "planning,tender",
    "pipeline,planning",
    "pipeline,tender",
    "pipeline,planning,tender",
  ];

  for (const stages of stagesToTest) {
    console.log(`Testing: ${stages}`);
    console.log("-".repeat(70));

    const url = `https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?stages=${stages}&updatedFrom=${dateFrom}&limit=100`;

    try {
      const response = await fetch(url);

      if (!response.ok) {
        console.log(
          `   ❌ Error: ${response.status} - ${response.statusText}\n`,
        );
        continue;
      }

      const data = await response.json();
      const count = data.releases?.length || 0;
      const hasMore = data.links?.next ? "YES" : "NO";

      console.log(`   ✅ Results: ${count} releases`);
      console.log(`   🔗 More pages: ${hasMore}`);

      if (count > 0) {
        const first = data.releases[0];
        console.log(
          `   📄 Sample: ${first.tender?.title?.substring(0, 50) || "No title"}...`,
        );
        console.log(`   📅 Stage: ${first.tender?.status || "unknown"}`);
      }

      console.log("");
    } catch (error) {
      console.log(`   ❌ Error: ${error.message}\n`);
    }
  }

  console.log("=".repeat(70));
  console.log("\n💡 ALSO TESTING: No stages filter at all");
  console.log("-".repeat(70));

  const urlNoStages = `https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?updatedFrom=${dateFrom}&limit=100`;
  const responseNoStages = await fetch(urlNoStages);
  const dataNoStages = await responseNoStages.json();

  console.log(`   ✅ Results: ${dataNoStages.releases?.length || 0} releases`);
  console.log(`   🔗 More pages: ${dataNoStages.links?.next ? "YES" : "NO"}`);

  console.log("\n" + "=".repeat(70));
  console.log("📊 RECOMMENDATION:");
  console.log("The combination with the MOST results is the one to use!");
}

testEachStage();
