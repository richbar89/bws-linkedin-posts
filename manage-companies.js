// Company management script (now supports optional contact email)
const { Client } = require("pg");

function getClient() {
  return new Client({
    connectionString:
      process.env.DATABASE_URL || "postgresql://localhost:5432/tenders",
  });
}

async function addCompany(name, cpvCodes, contactEmail) {
  const client = getClient();
  await client.connect();
  try {
    const result = await client.query(
      "INSERT INTO companies (name, cpv_codes, contact_email) VALUES ($1, $2::jsonb, $3) RETURNING *",
      [name, JSON.stringify(cpvCodes), contactEmail || null],
    );
    console.log("\n✅ Company added successfully!");
    console.log(`   ID: ${result.rows[0].id}`);
    console.log(`   Name: ${result.rows[0].name}`);
    console.log(`   Email: ${result.rows[0].contact_email || "—"}`);
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
      console.log(`    Email: ${company.contact_email || "—"}`);
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

async function setEmail(companyId, email) {
  const client = getClient();
  await client.connect();
  try {
    const result = await client.query(
      "UPDATE companies SET contact_email=$1 WHERE id=$2 RETURNING name, contact_email",
      [email, companyId],
    );
    if (result.rows.length === 0)
      console.log(`\n⚠️  Company ID ${companyId} not found\n`);
    else
      console.log(
        `\n✅ Updated ${result.rows[0].name} email → ${result.rows[0].contact_email}\n`,
      );
  } catch (error) {
    console.log("❌ Error updating email:", error.message);
  } finally {
    await client.end();
  }
}

// CLI
const command = process.argv[2];

if (command === "add") {
  const name = process.argv[3];
  const cpvAndEmail = process.argv.slice(4);
  if (!name || cpvAndEmail.length === 0) {
    console.log(
      '\nUsage: node manage-companies.js add "Company Name" CPV1 CPV2 ... [--email someone@example.com]\n',
    );
  } else {
    // parse optional --email
    const emailFlagIndex = cpvAndEmail.findIndex((v) => v === "--email");
    let email = null;
    let cpvs = cpvAndEmail;
    if (emailFlagIndex !== -1) {
      email = cpvAndEmail[emailFlagIndex + 1] || null;
      cpvs = cpvAndEmail.slice(0, emailFlagIndex);
    }
    addCompany(name, cpvs, email);
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
} else if (command === "set-email") {
  const companyId = parseInt(process.argv[3], 10);
  const email = process.argv[4];
  if (!companyId || !email) {
    console.log(
      "\nUsage: node manage-companies.js set-email COMPANY_ID someone@example.com\n",
    );
  } else {
    setEmail(companyId, email);
  }
} else {
  console.log("\n📋 Company Management Commands:\n");
  console.log(
    '  node manage-companies.js add "Company Name" CPV1 CPV2 ... [--email someone@example.com]',
  );
  console.log("  node manage-companies.js list");
  console.log("  node manage-companies.js delete COMPANY_ID");
  console.log(
    "  node manage-companies.js set-email COMPANY_ID someone@example.com\n",
  );
}
