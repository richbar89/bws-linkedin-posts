// Advanced diagnostic - test different API approaches
async function testDifferentApproaches() {
  console.log("🔬 ADVANCED API PAGINATION TEST\n");
  console.log("=".repeat(70) + "\n");

  const tenDaysAgo = new Date();
  tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
  const dateFrom = tenDaysAgo.toISOString();

  console.log(
    `📅 Date range: Last 10 days from ${tenDaysAgo.toLocaleDateString()}\n`,
  );

  // TEST 1: With stages filter (current approach)
  console.log("TEST 1: With stages=planning,tender filter");
  console.log("-".repeat(70));
  await testFetch(
    `https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?stages=planning,tender&updatedFrom=${dateFrom}&limit=100`,
    "Test 1",
  );

  console.log("\n");

  // TEST 2: Without stages filter
  console.log("TEST 2: WITHOUT stages filter (all tenders)");
  console.log("-".repeat(70));
  await testFetch(
    `https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?updatedFrom=${dateFrom}&limit=100`,
    "Test 2",
  );

  console.log("\n");

  // TEST 3: Check if 'publishedFrom' works better than 'updatedFrom'
  console.log("TEST 3: Using publishedFrom instead of updatedFrom");
  console.log("-".repeat(70));
  await testFetch(
    `https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?stages=planning,tender&publishedFrom=${dateFrom}&limit=100`,
    "Test 3",
  );

  console.log("\n");

  // TEST 4: Try smaller limit to see if that helps pagination
  console.log("TEST 4: Smaller limit (50 instead of 100)");
  console.log("-".repeat(70));
  await testFetch(
    `https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?stages=planning,tender&updatedFrom=${dateFrom}&limit=50`,
    "Test 4",
  );
}

async function testFetch(url, testName) {
  try {
    console.log(`🌐 Fetching: ${url.substring(0, 100)}...`);

    const response = await fetch(url);

    if (!response.ok) {
      console.log(`   ❌ Error: ${response.status}\n`);
      return;
    }

    const data = await response.json();

    console.log(`   ✅ Success!`);
    console.log(`   📦 Releases in this page: ${data.releases?.length || 0}`);

    // Check pagination info
    if (data.links) {
      console.log(`   🔗 Links object present: YES`);
      console.log(`   🔗 Has 'next' link: ${data.links.next ? "YES" : "NO"}`);

      if (data.links.next) {
        console.log(`   🔗 Next URL: ${data.links.next}`);

        // Try to extract cursor
        try {
          const nextUrl = new URL(data.links.next);
          const cursor = nextUrl.searchParams.get("cursor");
          console.log(`   🎯 Cursor value: ${cursor?.substring(0, 30)}...`);
        } catch (e) {
          console.log(`   ⚠️  Could not parse next URL`);
        }
      }
    } else {
      console.log(`   🔗 Links object: NOT PRESENT`);
    }

    // Check for other pagination hints
    if (data.meta) {
      console.log(`   📊 Meta object: PRESENT`);
      console.log(`   📊 Meta content:`, JSON.stringify(data.meta, null, 2));
    }

    // Show sample of first release
    if (data.releases && data.releases.length > 0) {
      const first = data.releases[0];
      console.log(
        `   📄 Sample tender: ${first.tender?.title?.substring(0, 50) || "No title"}...`,
      );
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
  }
}

testDifferentApproaches();
