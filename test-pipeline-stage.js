// Quick test - compare 2 stages vs 3 stages
async function compareStages() {
  const tenDaysAgo = new Date();
  tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
  const dateFrom = tenDaysAgo.toISOString();

  console.log("🔍 COMPARING STAGE FILTERS\n");
  console.log("=".repeat(70) + "\n");

  // Test 1: Current (2 stages)
  console.log("TEST 1: planning,tender (current)");
  console.log("-".repeat(70));
  const url1 = `https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?stages=planning,tender&updatedFrom=${dateFrom}&limit=50`;
  const response1 = await fetch(url1);
  const data1 = await response1.json();
  console.log(`✅ Got ${data1.releases?.length || 0} releases`);
  console.log(`🔗 Has more pages: ${data1.links?.next ? "YES" : "NO"}\n`);

  // Test 2: With pipeline added (3 stages)
  console.log("TEST 2: pipeline,planning,tender (with pipeline added)");
  console.log("-".repeat(70));
  const url2 = `https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?stages=pipeline,planning,tender&updatedFrom=${dateFrom}&limit=50`;
  const response2 = await fetch(url2);
  const data2 = await response2.json();
  console.log(`✅ Got ${data2.releases?.length || 0} releases`);
  console.log(`🔗 Has more pages: ${data2.links?.next ? "YES" : "NO"}\n`);

  console.log("=".repeat(70));
  console.log("📊 VERDICT:");
  if (data2.releases?.length > data1.releases?.length) {
    console.log(`✅ Adding 'pipeline' gives MORE results!`);
    console.log(
      `   Increase: ${data2.releases.length - data1.releases.length} more tenders just on page 1`,
    );
  } else {
    console.log(`❌ Adding 'pipeline' doesn't increase results`);
  }
}

compareStages();
