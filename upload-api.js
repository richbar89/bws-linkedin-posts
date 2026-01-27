// API ENDPOINT FOR CSV UPLOAD AND IMPORT
// Add this to your server.js

const multer = require("multer");
const { Client } = require("pg");
const fs = require("fs");

// Configure multer for file upload
const upload = multer({ dest: "/tmp/" });

// Route for CSV upload and import
app.post("/api/import-prospects", upload.single("csv"), async (req, res) => {
  // Set up streaming response
  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Transfer-Encoding", "chunked");

  const sendMessage = (data) => {
    res.write(JSON.stringify(data) + "\n");
  };

  const sendLog = (message, level = "info") => {
    sendMessage({ type: "log", message, level });
  };

  try {
    if (!req.file) {
      sendMessage({ type: "error", message: "No file uploaded" });
      return res.end();
    }

    sendLog("📁 File uploaded: " + req.file.originalname);
    sendMessage({ type: "progress", progress: 10, message: "Reading CSV..." });

    // Read the uploaded file
    const content = fs.readFileSync(req.file.path, "utf8");
    sendLog(`📄 File size: ${content.length} bytes`);

    // Parse CSV
    sendLog("🔍 Parsing CSV...");
    const records = parseCSVWithQuotes(content);
    sendLog(`✅ Found ${records.length} records`);

    if (records.length < 2) {
      sendMessage({ type: "error", message: "CSV has no data rows" });
      return res.end();
    }

    sendMessage({
      type: "progress",
      progress: 20,
      message: "Connecting to database...",
    });

    // Connect to database
    const client = new Client({
      connectionString:
        process.env.DATABASE_URL || "postgresql://localhost:5432/tenders",
    });

    await client.connect();
    sendLog("✅ Connected to database");

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

    sendLog("✅ Table ready");

    // Parse header
    const header = splitCSVLine(records[0]);
    sendLog(`📋 Found ${header.length} columns`);

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

    // Find CPV columns
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

    if (cpvIndices.length === 0) {
      sendLog("⚠️  No CPV columns found, will look at last 5 columns");
    } else {
      sendLog(`✅ Found CPV columns: ${cpvIndices.join(", ")}`);
    }

    sendMessage({
      type: "progress",
      progress: 30,
      message: "Clearing old data...",
    });

    await client.query("DELETE FROM prospects");
    sendLog("🧹 Cleared old prospects");

    sendMessage({
      type: "progress",
      progress: 40,
      message: "Importing prospects...",
    });

    let imported = 0;
    let skipped = 0;

    // Import records
    for (let i = 1; i < records.length; i++) {
      const fields = splitCSVLine(records[i]);

      // Progress updates
      if (i % 500 === 0) {
        const progress = 40 + (i / records.length) * 50;
        sendMessage({
          type: "progress",
          progress,
          message: `Processing: ${i}/${records.length}`,
        });
      }

      // Get email
      const email = fields[emailIdx]?.trim();
      if (!email || !email.includes("@")) {
        skipped++;
        continue;
      }

      // Get CPV codes
      const cpvCodes = [];

      if (cpvIndices.length > 0) {
        // Use found CPV columns
        for (const idx of cpvIndices) {
          const cpv = fields[idx]?.trim();
          if (cpv && /^\d{8}$/.test(cpv)) {
            cpvCodes.push(cpv);
          }
        }
      } else {
        // Fallback: look at last 5 columns
        for (let j = 0; j < 5; j++) {
          const cpvIdx = fields.length - 5 + j;
          if (cpvIdx >= 0) {
            const cpv = fields[cpvIdx]?.trim();
            if (cpv && /^\d{8}$/.test(cpv)) {
              cpvCodes.push(cpv);
            }
          }
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
          sendLog(`✅ Imported ${imported} prospects...`);
        }
      } catch (err) {
        // Skip on error
      }
    }

    sendMessage({
      type: "progress",
      progress: 95,
      message: "Finalizing...",
    });

    // Get final stats
    const totalResult = await client.query("SELECT COUNT(*) FROM prospects");
    const total = parseInt(totalResult.rows[0].count);

    sendLog(`\n✅ Import complete!`);
    sendLog(`   Imported: ${imported}`);
    sendLog(`   Skipped: ${skipped}`);
    sendLog(`   Total in database: ${total}`);

    sendMessage({
      type: "stats",
      stats: { imported, skipped, total },
    });

    sendMessage({
      type: "complete",
      stats: { imported, skipped, total },
    });

    await client.end();

    // Clean up uploaded file
    fs.unlinkSync(req.file.path);

    res.end();
  } catch (error) {
    sendMessage({
      type: "error",
      message: error.message,
    });
    sendLog(`❌ Error: ${error.message}`, "error");
    res.end();
  }
});

// Helper: Parse CSV handling multi-line records
function parseCSVWithQuotes(content) {
  const allLines = content.split(/\r?\n/);
  const records = [];
  let currentRecord = "";
  let quoteCount = 0;

  for (const line of allLines) {
    currentRecord += line;
    quoteCount += (line.match(/"/g) || []).length;

    if (quoteCount % 2 === 0) {
      if (currentRecord.trim()) {
        records.push(currentRecord);
      }
      currentRecord = "";
      quoteCount = 0;
    } else {
      currentRecord += "\n";
    }
  }

  return records;
}

// Helper: Split CSV line handling quoted fields
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

console.log("✅ CSV upload endpoint loaded at POST /api/import-prospects");
