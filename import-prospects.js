// Import construction leads - ULTRA SIMPLE VERSION
const { Client } = require("pg");
const fs = require("fs");

async function importProspects() {
  console.log("\n" + "=".repeat(70));
  console.log("📊 IMPORTING CONSTRUCTION PROSPECTS");
  console.log("=".repeat(70) + "\n");

  const client = new Client({
    connectionString:
      process.env.DATABASE_URL || "postgresql://localhost:5432/tenders",
  });

  await client.connect();
  console.log("✅ Connected to database\n");

  try {
    // Create table
    await client.query(`
      CREATE TABLE IF NOT EXISTS prospects (
        id SERIAL PRIMARY KEY,
        first_name VARCHAR(255),
        last_name VARCHAR(255),
        full_name VARCHAR(255),
        email VARCHAR(255) UNIQUE,
        title VARCHAR(255),
        company_name VARCHAR(255),
        company_website VARCHAR(255),
        linkedin_url VARCHAR(500),
        company_linkedin VARCHAR(500),
        employees_count INTEGER,
        city VARCHAR(255),
        country VARCHAR(255),
        cpv_codes JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_prospects_cpv ON prospects USING GIN (cpv_codes);
      CREATE INDEX IF NOT EXISTS idx_prospects_email ON prospects(email);
    `);
    console.log("✅ Prospects table ready\n");

    // Find CSV
    let csvPath;
    const possiblePaths = [
      "./ConstructionLeads_with_5_CPVs.csv",
      "/home/runner/workspace/ConstructionLeads_with_5_CPVs.csv",
      "/mnt/user-data/uploads/ConstructionLeads_with_5_CPVs.csv",
    ];

    for (const path of possiblePaths) {
      if (fs.existsSync(path)) {
        csvPath = path;
        break;
      }
    }

    if (!csvPath) {
      throw new Error("CSV file not found!");
    }

    console.log(`✅ Found CSV at: ${csvPath}\n`);

    // Read file
    const content = fs.readFileSync(csvPath, "utf8");

    // Split into lines but handle quoted newlines
    const allLines = content.split(/\r?\n/);
    const records = [];
    let currentRecord = "";
    let quoteCount = 0;

    for (const line of allLines) {
      currentRecord += line;
      quoteCount += (line.match(/"/g) || []).length;

      // If even number of quotes, record is complete
      if (quoteCount % 2 === 0) {
        if (currentRecord.trim()) {
          records.push(currentRecord);
        }
        currentRecord = "";
        quoteCount = 0;
      } else {
        // Multi-line field, add newline back
        currentRecord += "\n";
      }
    }

    console.log(`📄 Found ${records.length} records\n`);

    if (records.length < 2) {
      throw new Error("CSV has no data rows");
    }

    // Parse header
    const header = splitCSVLine(records[0]);
    console.log(`📋 Columns: ${header.length}`);

    // Find CPV columns (they should be at the end)
    const cpvIndices = [];
    for (let i = 0; i < header.length; i++) {
      if (
        header[i] === "CPV1" ||
        header[i] === "CPV2" ||
        header[i] === "CPV3" ||
        header[i] === "CPV4" ||
        header[i] === "CPV5"
      ) {
        cpvIndices.push(i);
      }
    }

    console.log(`📋 CPV columns at indices: ${cpvIndices.join(", ")}`);

    const emailIdx = header.indexOf("Email");
    const firstNameIdx = header.indexOf("First Name");
    const lastNameIdx = header.indexOf("Last Name");
    const fullNameIdx = header.indexOf("Full Name");
    const titleIdx = header.indexOf("Title");
    const companyIdx = header.indexOf("Company Name");
    const websiteIdx = header.indexOf("Company Website");
    const linkedinIdx = header.indexOf("LinkedIn");
    const companyLinkedinIdx = header.indexOf("Company Linkedin");
    const employeesIdx = header.indexOf("Employees Count");
    const cityIdx = header.indexOf("City");
    const countryIdx = header.indexOf("Country");

    console.log(`📧 Email column: ${emailIdx}`);
    console.log();

    // Clear old data
    await client.query("DELETE FROM prospects");
    console.log("🧹 Cleared old prospects\n");

    let imported = 0;
    let skipped = 0;

    // Process records
    for (let i = 1; i < records.length; i++) {
      const fields = splitCSVLine(records[i]);

      // Get email
      const email = fields[emailIdx]?.trim();
      if (!email || !email.includes("@")) {
        skipped++;
        continue;
      }

      // Get CPV codes - look at the LAST 5 columns
      const cpvCodes = [];
      for (let j = 0; j < 5; j++) {
        const cpvIdx = fields.length - 5 + j;
        const cpv = fields[cpvIdx]?.trim();
        if (cpv && /^\d{8}$/.test(cpv)) {
          cpvCodes.push(cpv);
        }
      }

      if (cpvCodes.length === 0) {
        skipped++;
        continue;
      }

      try {
        await client.query(
          `INSERT INTO prospects (
            first_name, last_name, full_name, email, title,
            company_name, company_website, linkedin_url, company_linkedin,
            employees_count, city, country, cpv_codes
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          ON CONFLICT (email) DO NOTHING`,
          [
            fields[firstNameIdx] || null,
            fields[lastNameIdx] || null,
            fields[fullNameIdx] || null,
            email,
            fields[titleIdx] || null,
            fields[companyIdx] || null,
            fields[websiteIdx] || null,
            fields[linkedinIdx] || null,
            fields[companyLinkedinIdx] || null,
            parseInt(fields[employeesIdx]) || null,
            fields[cityIdx] || null,
            fields[countryIdx] || null,
            JSON.stringify(cpvCodes),
          ],
        );

        imported++;
        if (imported % 500 === 0) {
          console.log(`   ✅ ${imported} prospects...`);
        }
      } catch (err) {
        // Skip errors
      }
    }

    console.log("\n" + "=".repeat(70));
    console.log("📊 RESULTS");
    console.log("=".repeat(70));
    console.log(`   ✅ Imported: ${imported}`);
    console.log(`   ⚠️  Skipped: ${skipped}`);

    const total = await client.query("SELECT COUNT(*) FROM prospects");
    console.log(`\n✅ Total in database: ${total.rows[0].count}\n`);

    const sample = await client.query(`
      SELECT full_name, company_name, cpv_codes 
      FROM prospects 
      LIMIT 3
    `);

    console.log("📋 Sample:");
    sample.rows.forEach((p) => {
      console.log(`   ${p.full_name} @ ${p.company_name}`);
      console.log(`   CPV: ${JSON.parse(p.cpv_codes).join(", ")}\n`);
    });

    console.log("=".repeat(70) + "\n");
  } catch (error) {
    console.error("❌ ERROR:", error.message);
  } finally {
    await client.end();
  }
}

// Simple CSV line splitter
function splitCSVLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  fields.push(current.trim());
  return fields;
}

if (require.main === module) {
  importProspects().catch(console.error);
}

module.exports = { importProspects };
