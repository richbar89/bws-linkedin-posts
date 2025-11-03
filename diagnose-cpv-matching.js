// Diagnostic: Check why CPV matching is missing tenders
const { Client } = require("pg");

async function diagnoseCpvMatching(companyId) {
  const client = new Client({
    connectionString:
      process.env.DATABASE_URL || "postgresql://localhost:5432/tenders",
  });

  await client.connect();

  try {
    // Get company
    const companyResult = await client.query(
      "SELECT * FROM companies WHERE id = $1",
      [companyId],
    );

    if (companyResult.rows.length === 0) {
      console.log(`\n⚠️  Company ID ${companyId} not found\n`);
      return;
    }

    const company = companyResult.rows[0];
    let companyCpvCodes = [];

    if (typeof company.cpv_codes === "string") {
      companyCpvCodes = JSON.parse(company.cpv_codes);
    } else if (Array.isArray(company.cpv_codes)) {
      companyCpvCodes = company.cpv_codes;
    }

    console.log("\n🔍 CPV MATCHING DIAGNOSTIC\n");
    console.log("=".repeat(70));
    console.log(`\n🏢 Company: ${company.name}`);
    console.log(`📋 Company CPV Codes: ${companyCpvCodes.join(", ")}\n`);
    console.log("=".repeat(70));

    // Get ALL tenders (not just planned/active)
    const allTenders = await client.query(
      "SELECT * FROM tenders ORDER BY publication_date DESC",
    );

    console.log(`\n📊 Total tenders in database: ${allTenders.rows.length}`);

    // Get filtered tenders (planned/active only)
    const filteredTenders = await client.query(
      "SELECT * FROM tenders WHERE status IN ('planned', 'active') ORDER BY publication_date DESC",
    );

    console.log(`📊 Planned/Active tenders: ${filteredTenders.rows.length}\n`);
    console.log("=".repeat(70));

    let matchCount = 0;
    let nearMissCount = 0;
    const nearMisses = [];

    for (const tender of filteredTenders.rows) {
      let tenderCpvCodes = [];

      if (typeof tender.cpv_codes === "string") {
        try {
          tenderCpvCodes = JSON.parse(tender.cpv_codes);
        } catch (e) {
          continue;
        }
      } else if (Array.isArray(tender.cpv_codes)) {
        tenderCpvCodes = tender.cpv_codes;
      }

      if (!Array.isArray(tenderCpvCodes) || tenderCpvCodes.length === 0) {
        continue;
      }

      let hasMatch = false;
      let matchType = null;
      let matchedPair = null;

      // Check for matches
      for (const companyCpv of companyCpvCodes) {
        for (const tenderCpv of tenderCpvCodes) {
          if (!tenderCpv) continue;

          const companyCpvStr = String(companyCpv);
          const tenderCpvStr = String(tenderCpv);

          // Exact match (8 digits)
          if (tenderCpvStr === companyCpvStr) {
            hasMatch = true;
            matchType = "EXACT (8 digits)";
            matchedPair = `${companyCpvStr} = ${tenderCpvStr}`;
            break;
          }

          // 6 digit match
          if (tenderCpvStr.length >= 6 && companyCpvStr.length >= 6) {
            if (
              tenderCpvStr.substring(0, 6) === companyCpvStr.substring(0, 6)
            ) {
              hasMatch = true;
              matchType = "PARTIAL (6 digits)";
              matchedPair = `${companyCpvStr.substring(0, 6)} = ${tenderCpvStr.substring(0, 6)}`;
              break;
            }
          }

          // 4 digit match
          if (tenderCpvStr.length >= 4 && companyCpvStr.length >= 4) {
            if (
              tenderCpvStr.substring(0, 4) === companyCpvStr.substring(0, 4)
            ) {
              hasMatch = true;
              matchType = "BROAD (4 digits)";
              matchedPair = `${companyCpvStr.substring(0, 4)} = ${tenderCpvStr.substring(0, 4)}`;
              break;
            }
          }

          // Check for "near misses" (3 digit match - not currently matched)
          if (tenderCpvStr.length >= 3 && companyCpvStr.length >= 3) {
            if (
              tenderCpvStr.substring(0, 3) === companyCpvStr.substring(0, 3)
            ) {
              nearMisses.push({
                title: tender.title.substring(0, 60) + "...",
                tender_cpvs: tenderCpvCodes.join(", "),
                match_prefix: companyCpvStr.substring(0, 3),
              });
              nearMissCount++;
            }
          }
        }
        if (hasMatch) break;
      }

      if (hasMatch) {
        matchCount++;
        console.log(`\n✅ MATCH #${matchCount}: ${matchType}`);
        console.log(`   Title: ${tender.title.substring(0, 60)}...`);
        console.log(`   Status: ${tender.status}`);
        console.log(`   Matched: ${matchedPair}`);
        console.log(`   Tender CPVs: ${tenderCpvCodes.join(", ")}`);
      }
    }

    console.log("\n" + "=".repeat(70));
    console.log(`\n📊 RESULTS:`);
    console.log(`   Total matches found: ${matchCount}`);
    console.log(`   Near misses (3 digit): ${nearMissCount}`);

    if (nearMissCount > 0) {
      console.log(`\n🔍 NEAR MISSES (matched 3 digits but not 4):`);
      nearMisses.slice(0, 5).forEach((miss, i) => {
        console.log(`\n   ${i + 1}. ${miss.title}`);
        console.log(`      Tender CPVs: ${miss.tender_cpvs}`);
        console.log(`      Matched prefix: ${miss.match_prefix}xxx`);
      });

      if (nearMisses.length > 5) {
        console.log(`\n   ... and ${nearMisses.length - 5} more near misses`);
      }
    }

    console.log("\n" + "=".repeat(70));
    console.log("\n💡 RECOMMENDATIONS:");

    if (matchCount < 5 && nearMissCount > 0) {
      console.log(
        "   ⚠️  You have near misses! The 4-digit matching might be too strict.",
      );
      console.log("   Consider using 3-digit matching for broader results.");
    }

    if (matchCount === 0) {
      console.log("   ❌ No matches found!");
      console.log("   Possible issues:");
      console.log("   1. CPV codes don't match any tenders in database");
      console.log("   2. Matching logic is too strict");
      console.log("   3. Check if the website uses different CPV codes");
    }

    console.log("\n");
  } catch (error) {
    console.log("❌ Error:", error.message);
  } finally {
    await client.end();
  }
}

// Get company ID from command line
const companyId = parseInt(process.argv[2]);

if (!companyId) {
  console.log("\n📋 Usage: node diagnose-cpv-matching.js COMPANY_ID\n");
  console.log("Example: node diagnose-cpv-matching.js 3\n");
  console.log('Run "node manage-companies.js list" to see all company IDs\n');
} else {
  diagnoseCpvMatching(companyId);
}
