// Test script to check security tenders in database
const { Client } = require("pg");

async function testSecurityTenders() {
  const client = new Client({
    connectionString:
      process.env.DATABASE_URL || "postgresql://localhost:5432/tenders",
  });

  await client.connect();
  console.log("✅ Connected to database\n");

  try {
    // Security CPV codes from your app
    const securityCpvCodes = ["79710000", "79711000", "79715000", "79714000"];

    console.log("🔒 SECURITY TENDER DIAGNOSTIC\n");
    console.log("=".repeat(70));
    console.log("\n📋 Looking for CPV codes:", securityCpvCodes.join(", "));
    console.log("");

    // 1. Check total tenders in database
    const totalResult = await client.query("SELECT COUNT(*) FROM tenders");
    console.log(`📊 Total tenders in database: ${totalResult.rows[0].count}\n`);

    // 2. Get ALL tenders and check their CPV codes
    const allTenders = await client.query(
      "SELECT id, title, cpv_codes, buyer_name, publication_date FROM tenders ORDER BY publication_date DESC",
    );

    console.log("🔍 Checking each tender for security CPV matches...\n");

    let securityMatches = [];
    let tendersWithNoCpv = 0;

    for (const tender of allTenders.rows) {
      // Parse CPV codes
      let tenderCpvCodes = [];

      if (typeof tender.cpv_codes === "string") {
        try {
          tenderCpvCodes = JSON.parse(tender.cpv_codes);
        } catch (e) {
          tendersWithNoCpv++;
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

      if (tenderCpvCodes.length === 0) {
        tendersWithNoCpv++;
        continue;
      }

      // Check for security matches using 5-digit matching
      let matchedCpvs = [];
      for (const securityCpv of securityCpvCodes) {
        for (const tenderCpv of tenderCpvCodes) {
          const securityNormalized = String(securityCpv).substring(0, 5);
          const tenderNormalized = String(tenderCpv)
            .replace(/-/g, "")
            .substring(0, 5);

          if (tenderNormalized === securityNormalized) {
            matchedCpvs.push(`${tenderCpv} ≈ ${securityCpv}`);
          }
        }
      }

      if (matchedCpvs.length > 0) {
        securityMatches.push({
          id: tender.id,
          title: tender.title,
          buyer: tender.buyer_name,
          pubDate: tender.publication_date,
          cpvCodes: tenderCpvCodes,
          matches: matchedCpvs,
        });
      }
    }

    // 3. Display results
    console.log("=".repeat(70));
    console.log(`\n✅ FOUND ${securityMatches.length} SECURITY TENDERS\n`);
    console.log(`⚠️  ${tendersWithNoCpv} tenders have no CPV codes\n`);
    console.log("=".repeat(70));

    if (securityMatches.length > 0) {
      console.log("\n🔒 SECURITY TENDERS:\n");

      securityMatches.forEach((tender, index) => {
        console.log(`${index + 1}. ${tender.title}`);
        console.log(`   ID: ${tender.id}`);
        console.log(`   Buyer: ${tender.buyer}`);
        console.log(
          `   Published: ${new Date(tender.pubDate).toLocaleDateString("en-GB")}`,
        );
        console.log(`   CPV Codes: ${tender.cpvCodes.join(", ")}`);
        console.log(`   Matches: ${tender.matches.join(", ")}`);
        console.log("");
      });
    } else {
      console.log("\n❌ NO SECURITY TENDERS FOUND!\n");
      console.log("This could mean:");
      console.log("1. No security tenders were published in the last 14 days");
      console.log("2. The API fetch didn't capture CPV codes properly");
      console.log("3. Security tenders use different CPV codes\n");
    }

    // 4. Check if any companies are tracking security
    console.log("=".repeat(70));
    console.log("\n🏢 CHECKING COMPANIES TRACKING SECURITY:\n");

    const companies = await client.query("SELECT * FROM companies");

    let securityCompanies = [];
    for (const company of companies.rows) {
      let companyCpvCodes = [];
      if (typeof company.cpv_codes === "string") {
        companyCpvCodes = JSON.parse(company.cpv_codes);
      } else if (Array.isArray(company.cpv_codes)) {
        companyCpvCodes = company.cpv_codes;
      }

      const hasSecurityCpv = companyCpvCodes.some((cpv) =>
        securityCpvCodes.some(
          (secCpv) =>
            String(cpv).substring(0, 5) === String(secCpv).substring(0, 5),
        ),
      );

      if (hasSecurityCpv) {
        securityCompanies.push({
          name: company.name,
          cpvCodes: companyCpvCodes,
        });
      }
    }

    if (securityCompanies.length > 0) {
      console.log(
        `✅ ${securityCompanies.length} company/companies tracking security:\n`,
      );
      securityCompanies.forEach((company) => {
        console.log(`   • ${company.name}: ${company.cpvCodes.join(", ")}`);
      });
    } else {
      console.log("⚠️  NO COMPANIES are tracking security CPV codes!");
      console.log(
        `   Add a company with one of these CPV codes: ${securityCpvCodes.join(", ")}`,
      );
    }

    console.log("\n" + "=".repeat(70) + "\n");
  } catch (error) {
    console.error("❌ Error:", error.message);
  } finally {
    await client.end();
  }
}

testSecurityTenders();
