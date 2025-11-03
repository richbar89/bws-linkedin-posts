// Company management script
const { Client } = require("pg");

async function addCompany(name, cpvCodes) {
  const client = new Client({
    connectionString:
      process.env.DATABASE_URL || "postgresql://localhost:5432/tenders",
  });

  await client.connect();

  try {
    // Ensure cpvCodes is stored as proper JSON array
    const result = await client.query(
      "INSERT INTO companies (name, cpv_codes) VALUES ($1, $2::jsonb) RETURNING *",
      [name, JSON.stringify(cpvCodes)],
    );

    console.log("\n✅ Company added successfully!");
    console.log(`   ID: ${result.rows[0].id}`);
    console.log(`   Name: ${result.rows[0].name}`);
    console.log(`   CPV Codes: ${cpvCodes.join(", ")}\n`);
  } catch (error) {
    console.log("❌ Error adding company:", error.message);
  } finally {
    await client.end();
  }
}

async function listCompanies() {
  const client = new Client({
    connectionString:
      process.env.DATABASE_URL || "postgresql://localhost:5432/tenders",
  });

  await client.connect();

  try {
    const result = await client.query("SELECT * FROM companies ORDER BY name");

    if (result.rows.length === 0) {
      console.log("\n📭 No companies found. Add some companies first!\n");
      return;
    }

    console.log("\n🏢 Companies:\n");
    result.rows.forEach((company) => {
      // Parse CPV codes - handle both JSON and array format
      let cpvCodes = [];
      if (typeof company.cpv_codes === "string") {
        cpvCodes = JSON.parse(company.cpv_codes);
      } else if (Array.isArray(company.cpv_codes)) {
        cpvCodes = company.cpv_codes;
      }

      console.log(`[${company.id}] ${company.name}`);
      console.log(`    CPV Codes: ${cpvCodes.join(", ")}\n`);
    });
  } catch (error) {
    console.log("❌ Error listing companies:", error.message);
  } finally {
    await client.end();
  }
}

async function deleteCompany(companyId) {
  const client = new Client({
    connectionString:
      process.env.DATABASE_URL || "postgresql://localhost:5432/tenders",
  });

  await client.connect();

  try {
    const result = await client.query(
      "DELETE FROM companies WHERE id = $1 RETURNING name",
      [companyId],
    );

    if (result.rows.length > 0) {
      console.log(`\n✅ Deleted company: ${result.rows[0].name}\n`);
    } else {
      console.log(`\n⚠️  Company ID ${companyId} not found\n`);
    }
  } catch (error) {
    console.log("❌ Error deleting company:", error.message);
  } finally {
    await client.end();
  }
}

// Command line interface
const command = process.argv[2];

if (command === "add") {
  const name = process.argv[3];
  const cpvCodes = process.argv.slice(4);

  if (!name || cpvCodes.length === 0) {
    console.log(
      '\nUsage: node manage-companies.js add "Company Name" CPV1 CPV2 CPV3...\n',
    );
    console.log(
      'Example: node manage-companies.js add "Fire Safety Ltd" 45111200 45311000\n',
    );
  } else {
    addCompany(name, cpvCodes);
  }
} else if (command === "list") {
  listCompanies();
} else if (command === "delete") {
  const companyId = parseInt(process.argv[3]);

  if (!companyId) {
    console.log("\nUsage: node manage-companies.js delete COMPANY_ID\n");
    console.log("Example: node manage-companies.js delete 1\n");
  } else {
    deleteCompany(companyId);
  }
} else {
  console.log("\n📋 Company Management Commands:\n");
  console.log('  node manage-companies.js add "Company Name" CPV1 CPV2 ...');
  console.log("  node manage-companies.js list");
  console.log("  node manage-companies.js delete COMPANY_ID\n");
  console.log("Examples:");
  console.log(
    '  node manage-companies.js add "Fire Safety Ltd" 45111200 45311000',
  );
  console.log("  node manage-companies.js list");
  console.log("  node manage-companies.js delete 1\n");
}
