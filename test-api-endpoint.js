// Test the actual API endpoint that the frontend calls
const { Client } = require("pg");

async function testApiEndpoint() {
  const client = new Client({
    connectionString:
      process.env.DATABASE_URL || "postgresql://localhost:5432/tenders",
  });

  await client.connect();
  console.log("✅ Connected to database\n");

  try {
    // Get all companies
    const companies = await client.query(
      "SELECT * FROM companies ORDER BY name",
    );

    console.log("🏢 COMPANIES IN DATABASE:\n");
    companies.rows.forEach((company) => {
      let cpvCodes = [];
      if (typeof company.cpv_codes === "string") {
        cpvCodes = JSON.parse(company.cpv_codes);
      } else if (Array.isArray(company.cpv_codes)) {
        cpvCodes = company.cpv_codes;
      } else if (
        typeof company.cpv_codes === "object" &&
        company.cpv_codes !== null
      ) {
        cpvCodes = Object.values(company.cpv_codes);
      }

      console.log(`   [ID: ${company.id}] ${company.name}`);
      console.log(`   CPV Codes: ${cpvCodes.join(", ")}`);
      console.log("");
    });

    // Pick first security company to test
    const securityCompany = companies.rows.find((c) => {
      let cpvCodes = [];
      if (typeof c.cpv_codes === "string") {
        cpvCodes = JSON.parse(c.cpv_codes);
      } else if (Array.isArray(c.cpv_codes)) {
        cpvCodes = c.cpv_codes;
      }
      return cpvCodes.includes("79710000");
    });

    if (!securityCompany) {
      console.log("❌ No security company found!");
      return;
    }

    console.log("=".repeat(70));
    console.log(
      `\n🔍 TESTING API FOR: ${securityCompany.name} (ID: ${securityCompany.id})\n`,
    );

    // Parse company CPV codes
    let companyCpvCodes = [];
    if (typeof securityCompany.cpv_codes === "string") {
      companyCpvCodes = JSON.parse(securityCompany.cpv_codes);
    } else if (Array.isArray(securityCompany.cpv_codes)) {
      companyCpvCodes = securityCompany.cpv_codes;
    } else if (
      typeof securityCompany.cpv_codes === "object" &&
      securityCompany.cpv_codes !== null
    ) {
      companyCpvCodes = Object.values(securityCompany.cpv_codes);
    }

    console.log(`📋 Company CPV Codes: ${companyCpvCodes.join(", ")}\n`);

    // Simulate the server's matching logic
    const tendersResult = await client.query(
      "SELECT * FROM tenders ORDER BY publication_date DESC",
    );

    console.log(`📊 Total tenders to check: ${tendersResult.rows.length}\n`);

    const matchingTenders = [];

    // Helper function (same as server.js)
    function normalizeCpvCode(cpv) {
      if (!cpv) return "";
      const cpvStr = String(cpv).replace(/-/g, "");
      return cpvStr.substring(0, 8);
    }

    function cpvCodesMatch(cpv1, cpv2) {
      const cpv1Normalized = normalizeCpvCode(cpv1);
      const cpv2Normalized = normalizeCpvCode(cpv2);

      if (!cpv1Normalized || !cpv2Normalized) return false;

      // Exact match (8 digits)
      if (cpv1Normalized === cpv2Normalized) return true;

      // Partial match (6 digits)
      if (cpv1Normalized.length >= 6 && cpv2Normalized.length >= 6) {
        if (cpv1Normalized.substring(0, 6) === cpv2Normalized.substring(0, 6))
          return true;
      }

      // Category match (5 digits)
      if (cpv1Normalized.length >= 5 && cpv2Normalized.length >= 5) {
        if (cpv1Normalized.substring(0, 5) === cpv2Normalized.substring(0, 5))
          return true;
      }

      return false;
    }

    for (const tender of tendersResult.rows) {
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

      for (const companyCpv of companyCpvCodes) {
        for (const tenderCpv of tenderCpvCodes) {
          if (!tenderCpv) continue;
          if (cpvCodesMatch(companyCpv, tenderCpv)) {
            hasMatch = true;
            break;
          }
        }
        if (hasMatch) break;
      }

      if (hasMatch) {
        matchingTenders.push({
          id: tender.id,
          title: tender.title,
          buyer_name: tender.buyer_name,
          status: tender.status,
          publication_date: tender.publication_date,
          deadline_date: tender.deadline_date,
          cpv_codes: tenderCpvCodes,
          tender_url: tender.tender_url,
        });
      }
    }

    console.log("=".repeat(70));
    console.log(
      `\n✅ API SIMULATION RESULT: ${matchingTenders.length} MATCHING TENDERS\n`,
    );
    console.log("=".repeat(70));

    if (matchingTenders.length > 0) {
      console.log("\n📋 MATCHING TENDERS:\n");
      matchingTenders.forEach((tender, index) => {
        console.log(`${index + 1}. ${tender.title}`);
        console.log(`   ID: ${tender.id}`);
        console.log(`   Buyer: ${tender.buyer_name}`);
        console.log(`   Status: ${tender.status}`);
        console.log(`   CPV Codes: ${tender.cpv_codes.join(", ")}`);
        console.log("");
      });

      console.log(
        "\n✅ These tenders SHOULD appear when you select this company on the frontend!",
      );
      console.log("\n💡 If they DON'T appear, the problem is:");
      console.log("   1. The server needs to be restarted");
      console.log("   2. There's a frontend JavaScript error");
      console.log("   3. The API route isn't being called correctly\n");
    } else {
      console.log("\n❌ NO MATCHES FOUND!");
      console.log("This is the same result the API would return.\n");
    }
  } catch (error) {
    console.error("❌ Error:", error.message);
    console.error(error.stack);
  } finally {
    await client.end();
  }
}

testApiEndpoint();
