// Search for a specific tender by ID
const { Client } = require("pg");

async function findTenderById(tenderId) {
  const client = new Client({
    connectionString:
      process.env.DATABASE_URL || "postgresql://localhost:5432/tenders",
  });

  await client.connect();

  try {
    console.log(`\n🔍 Searching for tender ID: ${tenderId}\n`);

    // Search for tender by exact ID
    const result = await client.query("SELECT * FROM tenders WHERE id = $1", [
      tenderId,
    ]);

    if (result.rows.length === 0) {
      console.log("❌ Tender NOT FOUND in database\n");
      console.log("This means:");
      console.log("1. The API hasn't returned this tender yet, OR");
      console.log("2. This tender was published outside the 14-day window, OR");
      console.log("3. There was an issue fetching it\n");

      console.log("💡 Try running: node fetch-and-save-tenders.js\n");
      await client.end();
      return;
    }

    const tender = result.rows[0];

    console.log("✅ TENDER FOUND IN DATABASE!\n");
    console.log("━".repeat(70));
    console.log(`📋 Title: ${tender.title}`);
    console.log(`🏢 Buyer: ${tender.buyer_name}`);
    console.log(
      `📅 Published: ${new Date(tender.publication_date).toLocaleString("en-GB")}`,
    );
    console.log(
      `⏰ Deadline: ${tender.deadline_date ? new Date(tender.deadline_date).toLocaleString("en-GB") : "Not specified"}`,
    );
    console.log(`📊 Status: ${tender.status}`);
    console.log(`🔗 URL: ${tender.tender_url}`);

    // Parse CPV codes
    let cpvCodes = [];
    try {
      if (typeof tender.cpv_codes === "string") {
        cpvCodes = JSON.parse(tender.cpv_codes);
      } else if (Array.isArray(tender.cpv_codes)) {
        cpvCodes = tender.cpv_codes;
      } else if (
        typeof tender.cpv_codes === "object" &&
        tender.cpv_codes !== null
      ) {
        cpvCodes = Object.values(tender.cpv_codes);
      }
    } catch (e) {
      console.log(`⚠️ Error parsing CPV codes: ${e.message}`);
    }

    console.log(`\n🏷️  CPV Codes (${cpvCodes.length}):`);
    if (cpvCodes.length === 0) {
      console.log("   ⚠️ No CPV codes found for this tender");
    } else {
      cpvCodes.forEach((cpv) => {
        console.log(`   • ${cpv}`);
      });
    }

    console.log("\n" + "━".repeat(70));
    console.log("\n🔍 Checking which companies this matches...\n");

    // Get all companies
    const companies = await client.query(
      "SELECT * FROM companies ORDER BY name",
    );

    if (companies.rows.length === 0) {
      console.log("⚠️ No companies in database yet!\n");
      await client.end();
      return;
    }

    const matchingCompanies = [];

    for (const company of companies.rows) {
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

      // Check for matches using 5-digit logic
      const matches = [];
      for (const companyCpv of companyCpvCodes) {
        for (const tenderCpv of cpvCodes) {
          const companyCpvStr = String(companyCpv)
            .replace(/-/g, "")
            .substring(0, 8);
          const tenderCpvStr = String(tenderCpv)
            .replace(/-/g, "")
            .substring(0, 8);

          // Exact match
          if (companyCpvStr === tenderCpvStr) {
            matches.push(`${companyCpv} = ${tenderCpv} (exact match)`);
            break;
          }

          // 6-digit match
          if (companyCpvStr.length >= 6 && tenderCpvStr.length >= 6) {
            if (
              companyCpvStr.substring(0, 6) === tenderCpvStr.substring(0, 6)
            ) {
              matches.push(`${companyCpv} ≈ ${tenderCpv} (6-digit match)`);
              break;
            }
          }

          // 5-digit match
          if (companyCpvStr.length >= 5 && tenderCpvStr.length >= 5) {
            if (
              companyCpvStr.substring(0, 5) === tenderCpvStr.substring(0, 5)
            ) {
              matches.push(`${companyCpv} ≈ ${tenderCpv} (5-digit match)`);
              break;
            }
          }
        }
      }

      if (matches.length > 0) {
        matchingCompanies.push({
          name: company.name,
          matches: matches,
        });
      }
    }

    if (matchingCompanies.length > 0) {
      console.log(
        `✅ This tender MATCHES ${matchingCompanies.length} company/companies:\n`,
      );
      matchingCompanies.forEach((company) => {
        console.log(`   🏢 ${company.name}`);
        company.matches.forEach((match) => {
          console.log(`      ${match}`);
        });
        console.log("");
      });
      console.log(
        "✨ This tender SHOULD appear when you select these companies!\n",
      );
    } else {
      console.log(
        "❌ This tender does NOT match any of your tracked companies\n",
      );
      console.log("📋 Your tracked companies and their CPV codes:\n");

      companies.rows.forEach((company) => {
        let companyCpvCodes = [];
        if (typeof company.cpv_codes === "string") {
          companyCpvCodes = JSON.parse(company.cpv_codes);
        } else if (Array.isArray(company.cpv_codes)) {
          companyCpvCodes = company.cpv_codes;
        }
        console.log(`   ${company.name}: ${companyCpvCodes.join(", ")}`);
      });

      console.log("\n💡 To see this tender, you need to:");
      console.log("   1. Add a new company, OR");
      console.log("   2. Add one of these CPV codes to an existing company:\n");
      cpvCodes.forEach((cpv) => {
        console.log(`      • ${cpv}`);
      });
      console.log("");
    }
  } catch (error) {
    console.error("❌ Error:", error.message);
  } finally {
    await client.end();
  }
}

// Get tender ID from command line
const tenderId = process.argv[2];

if (!tenderId) {
  console.log("\n💡 Usage: node search-tender-by-id.js TENDER_ID");
  console.log("\nExample:");
  console.log("  node search-tender-by-id.js 070999-2025\n");
} else {
  findTenderById(tenderId);
}
