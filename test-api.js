// Test what the API endpoint actually returns for a company
const { Client } = require("pg");

async function testCompanyEndpoint(companyName) {
  const client = new Client({
    connectionString:
      process.env.DATABASE_URL || "postgresql://localhost:5432/tenders",
  });

  await client.connect();

  try {
    // Find the company
    const companyResult = await client.query(
      "SELECT * FROM companies WHERE name ILIKE $1",
      [`%${companyName}%`],
    );

    if (companyResult.rows.length === 0) {
      console.log(`❌ Company "${companyName}" not found\n`);
      await client.end();
      return;
    }

    const company = companyResult.rows[0];

    // Parse company CPV codes
    let companyCpvCodes = [];
    if (typeof company.cpv_codes === "string") {
      companyCpvCodes = JSON.parse(company.cpv_codes);
    } else if (Array.isArray(company.cpv_codes)) {
      companyCpvCodes = company.cpv_codes;
    } else if (
      typeof company.cpv_codes === "object" &&
      company.cpv_codes !== null
    ) {
      companyCpvCodes = Object.values(company.cpv_codes);
    }

    console.log(`\n🏢 Testing Company: ${company.name}`);
    console.log(`   Company ID: ${company.id}`);
    console.log(`   Company CPV Codes: ${companyCpvCodes.join(", ")}\n`);

    // Get ALL tenders from database (what the fixed server should do)
    const allTendersResult = await client.query(
      "SELECT * FROM tenders ORDER BY publication_date DESC",
    );

    console.log(
      `📊 Total tenders in database: ${allTendersResult.rows.length}\n`,
    );

    // Now manually do the matching like the server does
    const matchingTenders = [];

    for (const tender of allTendersResult.rows) {
      // Parse tender CPV codes
      let tenderCpvCodes = [];
      if (typeof tender.cpv_codes === "string") {
        try {
          tenderCpvCodes = JSON.parse(tender.cpv_codes);
        } catch (e) {
          continue;
        }
      } else if (Array.isArray(tender.cpv_codes)) {
        tenderCpvCodes = tender.cpv_codes;
      } else if (
        typeof tender.cpv_codes === "object" &&
        tender.cpv_codes !== null
      ) {
        tenderCpvCodes = Object.values(tender.cpv_codes);
      }

      if (!Array.isArray(tenderCpvCodes) || tenderCpvCodes.length === 0)
        continue;

      let hasMatch = false;

      // Check for matches
      for (const companyCpv of companyCpvCodes) {
        for (const tenderCpv of tenderCpvCodes) {
          if (!tenderCpv) continue;

          // Normalize both
          const companyCpvStr = String(companyCpv)
            .replace(/-/g, "")
            .substring(0, 8);
          const tenderCpvStr = String(tenderCpv)
            .replace(/-/g, "")
            .substring(0, 8);

          // Exact match (8 digits)
          if (tenderCpvStr === companyCpvStr) {
            hasMatch = true;
            break;
          }

          // Partial match (6 digits)
          if (tenderCpvStr.length >= 6 && companyCpvStr.length >= 6) {
            if (
              tenderCpvStr.substring(0, 6) === companyCpvStr.substring(0, 6)
            ) {
              hasMatch = true;
              break;
            }
          }

          // Category match (5 digits)
          if (tenderCpvStr.length >= 5 && companyCpvStr.length >= 5) {
            if (
              tenderCpvStr.substring(0, 5) === companyCpvStr.substring(0, 5)
            ) {
              hasMatch = true;
              break;
            }
          }
        }
        if (hasMatch) break;
      }

      if (hasMatch) {
        matchingTenders.push(tender);
      }
    }

    console.log(`✅ Matching tenders found: ${matchingTenders.length}\n`);

    // Look specifically for the security tender
    const securityTender = matchingTenders.find((t) => t.id === "070999-2025");

    if (securityTender) {
      console.log(
        "🎉 SUCCESS! The Tripos Court tender IS in the matched results!\n",
      );
      console.log("━".repeat(70));
      console.log(`📋 Title: ${securityTender.title}`);
      console.log(`🏢 Buyer: ${securityTender.buyer_name}`);
      console.log(
        `📅 Published: ${new Date(securityTender.publication_date).toLocaleString("en-GB")}`,
      );
      console.log(`📊 Status: ${securityTender.status}`);

      let cpvs = [];
      if (typeof securityTender.cpv_codes === "string") {
        cpvs = JSON.parse(securityTender.cpv_codes);
      } else if (Array.isArray(securityTender.cpv_codes)) {
        cpvs = securityTender.cpv_codes;
      }
      console.log(`🏷️  CPV: ${cpvs.join(", ")}`);
      console.log("━".repeat(70));
      console.log("\n✅ The server SHOULD be returning this tender!");
      console.log("   If it's not showing in your browser, the issue is:");
      console.log("   1. Server hasn't been restarted with the new code");
      console.log("   2. Browser cache needs clearing");
      console.log("   3. Wrong company selected in dropdown\n");
    } else {
      console.log("❌ The Tripos Court tender is NOT in the matched results\n");
      console.log("Showing first 5 matching tenders instead:\n");
      matchingTenders.slice(0, 5).forEach((t, i) => {
        console.log(`${i + 1}. ${t.title}`);
        console.log(
          `   Published: ${new Date(t.publication_date).toLocaleDateString("en-GB")}`,
        );
        console.log(`   Buyer: ${t.buyer_name}\n`);
      });
    }

    // Show what endpoint URL to test
    console.log(`\n🔗 API Endpoint to test in browser:`);
    console.log(
      `   http://localhost:3000/api/companies/${company.id}/tenders\n`,
    );
  } catch (error) {
    console.error("❌ Error:", error.message);
    console.error(error.stack);
  } finally {
    await client.end();
  }
}

// Get company name from command line
const companyName = process.argv.slice(2).join(" ");

if (!companyName) {
  console.log("\n💡 Usage: node test-api.js [company name]");
  console.log("\nExample:");
  console.log('  node test-api.js "KK Security"\n');
} else {
  testCompanyEndpoint(companyName);
}
