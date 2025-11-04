// Match tenders to a company based on CPV codes
// UPDATED: Changed to 5-digit matching for better accuracy
const { Client } = require("pg");

async function matchTendersForCompany(companyId) {
  const client = new Client({
    connectionString:
      process.env.DATABASE_URL || "postgresql://localhost:5432/tenders",
  });

  await client.connect();

  try {
    // Get company details
    const companyResult = await client.query(
      "SELECT * FROM companies WHERE id = $1",
      [companyId],
    );

    if (companyResult.rows.length === 0) {
      console.log(`\n⚠️  Company ID ${companyId} not found\n`);
      await client.end();
      return;
    }

    const company = companyResult.rows[0];

    // Handle both JSON string and PostgreSQL array format
    let companyCpvCodes = [];
    if (typeof company.cpv_codes === "string") {
      companyCpvCodes = JSON.parse(company.cpv_codes);
    } else if (Array.isArray(company.cpv_codes)) {
      companyCpvCodes = company.cpv_codes;
    } else if (typeof company.cpv_codes === "object") {
      // PostgreSQL might return it as an object, try converting to array
      companyCpvCodes = Object.values(company.cpv_codes);
    }

    console.log(`\n🏢 Finding tenders for: ${company.name}`);
    console.log(`📋 Company CPV Codes: ${companyCpvCodes.join(", ")}\n`);

    // Find matching tenders
    const matchingTenders = [];

    const allTenders = await client.query(
      "SELECT * FROM tenders ORDER BY publication_date DESC",
    );

    for (const tender of allTenders.rows) {
      // Safely parse CPV codes - handle multiple formats
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

      // Check if any tender CPV matches any company CPV
      for (const companyCpv of companyCpvCodes) {
        for (const tenderCpv of tenderCpvCodes) {
          if (!tenderCpv) continue;

          const companyCpvStr = String(companyCpv);
          const tenderCpvStr = String(tenderCpv);

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

          // UPDATED: Category match (5 digits instead of 4)
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

    // Display results
    console.log(`✅ Found ${matchingTenders.length} matching tenders\n`);
    console.log("━".repeat(80) + "\n");

    if (matchingTenders.length === 0) {
      console.log("No matching tenders found for this company.\n");
    } else {
      matchingTenders.forEach((tender, index) => {
        console.log(`${index + 1}. ${tender.title}`);
        console.log(`   ID: ${tender.id}`);
        console.log(`   Buyer: ${tender.buyer_name}`);
        console.log(`   Status: ${tender.status}`);
        console.log(
          `   Published: ${new Date(tender.publication_date).toLocaleDateString()}`,
        );

        if (tender.deadline_date) {
          console.log(
            `   Deadline: ${new Date(tender.deadline_date).toLocaleDateString()}`,
          );
        }

        let tenderCpvs = [];
        if (typeof tender.cpv_codes === "string") {
          try {
            tenderCpvs = JSON.parse(tender.cpv_codes);
          } catch (e) {}
        } else if (Array.isArray(tender.cpv_codes)) {
          tenderCpvs = tender.cpv_codes;
        } else if (
          typeof tender.cpv_codes === "object" &&
          tender.cpv_codes !== null
        ) {
          tenderCpvs = Object.values(tender.cpv_codes);
        }

        console.log(`   CPV Codes: ${tenderCpvs.join(", ")}`);
        console.log(`   URL: ${tender.tender_url}`);
        console.log("");
      });
    }

    console.log("━".repeat(80) + "\n");
  } catch (error) {
    console.log("❌ Error:", error.message);
    console.log("Stack:", error.stack);
  } finally {
    await client.end();
  }
}

// Command line interface
const companyId = parseInt(process.argv[2]);

if (!companyId) {
  console.log("\n📋 Usage: node match-tenders.js COMPANY_ID\n");
  console.log("Example: node match-tenders.js 3\n");
  console.log('Run "node manage-companies.js list" to see all company IDs\n');
} else {
  matchTendersForCompany(companyId);
}
