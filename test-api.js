// Simple test to fetch tenders from Find-a-Tender API

async function testFetchTenders() {
  console.log("🔍 Testing Find-a-Tender API...\n");

  // Calculate date from 7 days ago
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const dateFrom = sevenDaysAgo.toISOString();

  console.log(`📅 Fetching tenders from: ${dateFrom}`);

  // Build the API URL
  const apiUrl = `https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?updatedFrom=${dateFrom}&limit=5`;

  try {
    console.log("🌐 Making request...\n");

    const response = await fetch(apiUrl);

    if (!response.ok) {
      throw new Error(`API returned error: ${response.status}`);
    }

    const data = await response.json();

    console.log("✅ Success! Got data from API\n");
    console.log(
      `📊 Total releases found: ${data.releases ? data.releases.length : 0}\n`,
    );

    // Show first tender details
    if (data.releases && data.releases.length > 0) {
      const firstTender = data.releases[0];
      console.log("📋 First tender example:");
      console.log("-----------------------------------");
      console.log("ID:", firstTender.id);
      console.log("Date:", firstTender.date);

      if (firstTender.tender) {
        console.log("Title:", firstTender.tender.title);
        console.log("Status:", firstTender.tender.status);
      }

      console.log("\n✨ API is working! We can fetch tender data.");
    } else {
      console.log("⚠️ No tenders found in the response");
    }
  } catch (error) {
    console.log("❌ Error:", error.message);
  }
}

// Run the test
testFetchTenders();
