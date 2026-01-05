// Test different API parameters to find why we only get 85 tenders
const { Client } = require("pg");

async function testAPI() {
  console.log("\n🔬 API INVESTIGATION\n");
  console.log("━".repeat(60) + "\n");

  // Test 1: Try with publishedFrom instead of updatedFrom
  console.log("TEST 1: Using publishedFrom (instead of updatedFrom)");
  console.log("━".repeat(60));

  const threeWeeksAgo = new Date();
  threeWeeksAgo.setDate(threeWeeksAgo.getDate() - 21);
  const dateFrom = threeWeeksAgo.toISOString();

  const url1 = `https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?publishedFrom=${dateFrom}&limit=100&stages=tender`;
  console.log(`URL: ${url1}\n`);

  try {
    const response1 = await fetch(url1);
    const data1 = await response1.json();

    console.log(`✅ Got ${data1.releases?.length || 0} releases`);
    console.log(`   Has next page: ${data1.links?.next ? "YES" : "NO"}`);
    if (data1.links?.next) {
      console.log(`   Next URL: ${data1.links.next}`);
    }
  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
  }

  // Test 2: Try without any date filter
  console.log("\n\nTEST 2: No date filter at all");
  console.log("━".repeat(60));

  const url2 = `https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?limit=100&stages=tender`;
  console.log(`URL: ${url2}\n`);

  try {
    const response2 = await fetch(url2);
    const data2 = await response2.json();

    console.log(`✅ Got ${data2.releases?.length || 0} releases`);
    console.log(`   Has next page: ${data2.links?.next ? "YES" : "NO"}`);
    if (data2.links?.next) {
      console.log(`   Next URL: ${data2.links.next}`);
    }
  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
  }

  // Test 3: Try with updatedFrom (current approach)
  console.log("\n\nTEST 3: Using updatedFrom (current approach)");
  console.log("━".repeat(60));

  const url3 = `https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?updatedFrom=${dateFrom}&limit=100&stages=tender`;
  console.log(`URL: ${url3}\n`);

  try {
    const response3 = await fetch(url3);
    const data3 = await response3.json();

    console.log(`✅ Got ${data3.releases?.length || 0} releases`);
    console.log(`   Has next page: ${data3.links?.next ? "YES" : "NO"}`);
    if (data3.links?.next) {
      console.log(`   Next URL: ${data3.links.next}`);
    }

    // Check the actual dates in the results
    if (data3.releases && data3.releases.length > 0) {
      console.log("\n   Sample publication dates:");
      data3.releases.slice(0, 5).forEach((r, i) => {
        console.log(
          `      ${i + 1}. ${new Date(r.date).toLocaleDateString("en-GB")} - ${r.tender?.title?.substring(0, 40)}...`,
        );
      });
    }
  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
  }

  // Test 4: Try a shorter date range
  console.log("\n\nTEST 4: Using last 7 days only");
  console.log("━".repeat(60));

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const dateFrom7 = sevenDaysAgo.toISOString();

  const url4 = `https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?updatedFrom=${dateFrom7}&limit=100&stages=tender`;
  console.log(`URL: ${url4}\n`);

  try {
    const response4 = await fetch(url4);
    const data4 = await response4.json();

    console.log(`✅ Got ${data4.releases?.length || 0} releases`);
    console.log(`   Has next page: ${data4.links?.next ? "YES" : "NO"}`);
  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
  }

  console.log("\n" + "━".repeat(60));
  console.log("\n💡 ANALYSIS:\n");
  console.log(
    "Compare the results above to see which parameter gives us more tenders.\n",
  );
}

testAPI();
