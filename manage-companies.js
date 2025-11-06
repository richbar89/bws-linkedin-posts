// Company management script (with firstName, lastName, email)
const { Client } = require("pg");

function getClient() {
  return new Client({
    connectionString:
      process.env.DATABASE_URL || "postgresql://localhost:5432/tenders",
  });
}

async function addCompany(name, cpvCodes, firstName, lastName, email) {
  const client = getClient();
  await client.connect();
  try {
    const result = await client.query(
      "INSERT INTO companies (name, cpv_codes, first_name, last_name, email) VALUES ($1, $2::jsonb, $3, $4, $5) RETURNING *",
      [
        name,
        JSON.stringify(cpvCodes),
        firstName || null,
        lastName || null,
        email || null,
      ],
    );
    console.log("\n✅ Company added successfully!");
    console.log(`   ID: ${result.rows[0].id}`);
    console.log(`   Name: ${result.rows[0].name}`);
    console.log(
      `   Contact: ${result.rows[0].first_name || "—"} ${result.rows[0].last_name || "—"}`,
    );
    console.log(`   Email: ${result.rows[0].email || "—"}`);
    console.log(`   CPV Codes: ${cpvCodes.join(", ")}\n`);
  } catch (error) {
    console.log("❌ Error adding company:", error.message);
  } finally {
    await client.end();
  }
}

async function listCompanies() {
  const client = getClient();
  await client.connect();
  try {
    const result = await client.query("SELECT * FROM companies ORDER BY name");
    if (result.rows.length === 0) {
      console.log("\n📭 No companies found. Add some companies first!\n");
      return;
    }
    console.log("\n🏢 Companies:\n");
    result.rows.forEach((company) => {
      let cpvCodes = [];
      if (typeof company.cpv_codes === "string")
        cpvCodes = JSON.parse(company.cpv_codes);
      else if (Array.isArray(company.cpv_codes)) cpvCodes = company.cpv_codes;
      else if (
        typeof company.cpv_codes === "object" &&
        company.cpv_codes !== null
      )
        cpvCodes = Object.values(company.cpv_codes);

      console.log(`[${company.id}] ${company.name}`);
      console.log(
        `    Contact: ${company.first_name || "—"} ${company.last_name || "—"}`,
      );
      console.log(`    Email: ${company.email || "—"}`);
      console.log(`    CPV Codes: ${cpvCodes.join(", ")}\n`);
    });
  } catch (error) {
    console.log("❌ Error listing companies:", error.message);
  } finally {
    await client.end();
  }
}

async function deleteCompany(companyId) {
  const client = getClient();
  await client.connect();
  try {
    const result = await client.query(
      "DELETE FROM companies WHERE id = $1 RETURNING name",
      [companyId],
    );
    if (result.rows.length > 0)
      console.log(`\n✅ Deleted company: ${result.rows[0].name}\n`);
    else console.log(`\n⚠️  Company ID ${companyId} not found\n`);
  } catch (error) {
    console.log("❌ Error deleting company:", error.message);
  } finally {
    await client.end();
  }
}

async function updateContact(companyId, firstName, lastName, email) {
  const client = getClient();
  await client.connect();
  try {
    const result = await client.query(
      "UPDATE companies SET first_name=$1, last_name=$2, email=$3 WHERE id=$4 RETURNING name, first_name, last_name, email",
      [firstName, lastName, email, companyId],
    );
    if (result.rows.length === 0)
      console.log(`\n⚠️  Company ID ${companyId} not found\n`);
    else {
      const c = result.rows[0];
      console.log(`\n✅ Updated ${c.name} contact details:`);
      console.log(`   Name: ${c.first_name} ${c.last_name}`);
      console.log(`   Email: ${c.email}\n`);
    }
  } catch (error) {
    console.log("❌ Error updating contact:", error.message);
  } finally {
    await client.end();
  }
}

// CLI
const command = process.argv[2];

if (command === "add") {
  const name = process.argv[3];
  const args = process.argv.slice(4);
  if (!name || args.length === 0) {
    console.log(
      '\nUsage: node manage-companies.js add "Company Name" CPV1 CPV2 ... [--first FirstName] [--last LastName] [--email someone@example.com]\n',
    );
  } else {
    // Parse optional flags
    const firstIndex = args.findIndex((v) => v === "--first");
    const lastIndex = args.findIndex((v) => v === "--last");
    const emailIndex = args.findIndex((v) => v === "--email");

    const firstName = firstIndex !== -1 ? args[firstIndex + 1] : null;
    const lastName = lastIndex !== -1 ? args[lastIndex + 1] : null;
    const email = emailIndex !== -1 ? args[emailIndex + 1] : null;

    // Get CPV codes (everything before the first flag)
    let cpvEndIndex = args.length;
    for (const flagIndex of [firstIndex, lastIndex, emailIndex]) {
      if (flagIndex !== -1 && flagIndex < cpvEndIndex) {
        cpvEndIndex = flagIndex;
      }
    }
    const cpvs = args.slice(0, cpvEndIndex);

    addCompany(name, cpvs, firstName, lastName, email);
  }
} else if (command === "list") {
  listCompanies();
} else if (command === "delete") {
  const companyId = parseInt(process.argv[3], 10);
  if (!companyId) {
    console.log("\nUsage: node manage-companies.js delete COMPANY_ID\n");
  } else {
    deleteCompany(companyId);
  }
} else if (command === "update-contact") {
  const companyId = parseInt(process.argv[3], 10);
  const firstName = process.argv[4];
  const lastName = process.argv[5];
  const email = process.argv[6];
  if (!companyId || !firstName || !lastName || !email) {
    console.log(
      "\nUsage: node manage-companies.js update-contact COMPANY_ID FirstName LastName email@example.com\n",
    );
  } else {
    updateContact(companyId, firstName, lastName, email);
  }
} else {
  console.log("\n📋 Company Management Commands:\n");
  console.log(
    '  node manage-companies.js add "Company Name" CPV1 CPV2 ... [--first FirstName] [--last LastName] [--email someone@example.com]',
  );
  console.log("  node manage-companies.js list");
  console.log("  node manage-companies.js delete COMPANY_ID");
  console.log(
    "  node manage-companies.js update-contact COMPANY_ID FirstName LastName email@example.com\n",
  );
}
