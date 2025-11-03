async function testApiStructure() {
  const tenDaysAgo = new Date();
  tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
  const dateFrom = tenDaysAgo.toISOString();

  const stages = "planning,tender";
  const apiUrl = `https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?stages=${stages}&updatedFrom=${dateFrom}&limit=2`;

  console.log("Fetching sample tenders...\n");

  const response = await fetch(apiUrl);
  const data = await response.json();

  if (data.releases && data.releases.length > 0) {
    const firstRelease = data.releases[0];

    console.log("Full structure of first tender:\n");
    console.log(JSON.stringify(firstRelease, null, 2));

    console.log("\n\n=== Checking for CPV codes ===\n");

    // Check different possible locations for CPV codes
    console.log("1. tender.items:", firstRelease.tender?.items);
    console.log(
      "\n2. tender.classification:",
      firstRelease.tender?.classification,
    );
    console.log(
      "\n3. tender.additionalClassifications:",
      firstRelease.tender?.additionalClassifications,
    );
  }
}

testApiStructure();
