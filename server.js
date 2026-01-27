// COMPLETE SERVER.JS FOR TENDER MATCHER
// This includes: CSV upload, tender matching, and all API routes

const express = require("express");
const multer = require("multer");
const { Client } = require("pg");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static("public"));

// Configure multer for file uploads
const upload = multer({ dest: "/tmp/" });

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getDbClient() {
  return new Client({
    connectionString:
      process.env.DATABASE_URL || "postgresql://localhost:5432/tenders",
  });
}

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

// ============================================================================
// HTML PAGES ROUTES
// ============================================================================

app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Tender Matcher System</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0;
          }
          .container {
            background: white;
            padding: 60px;
            border-radius: 12px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
            text-align: center;
            max-width: 500px;
          }
          h1 { color: #333; margin-bottom: 20px; }
          p { color: #666; margin-bottom: 40px; }
          .button {
            display: inline-block;
            background: #667eea;
            color: white;
            padding: 15px 40px;
            border-radius: 8px;
            text-decoration: none;
            font-weight: 600;
            margin: 10px;
            transition: background 0.3s;
          }
          .button:hover { background: #5568d3; }
          .button.secondary {
            background: #10b981;
          }
          .button.secondary:hover {
            background: #059669;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🎯 Tender Matcher System</h1>
          <p>Construction prospect matching prototype</p>
          <a href="/upload" class="button">📤 Upload Prospects</a>
          <a href="/matcher" class="button secondary">🔍 Match Tenders</a>
        </div>
      </body>
    </html>
  `);
});

app.get("/upload", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "upload-prospects.html"));
});

app.get("/matcher", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "tender-matcher.html"));
});

// ============================================================================
// API ROUTES - CSV UPLOAD
// ============================================================================

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
    const client = getDbClient();
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
      sendLog(`✅ Found CPV columns at indices: ${cpvIndices.join(", ")}`);
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

// ============================================================================
// API ROUTES - TENDER MATCHING
// ============================================================================

// Get construction tenders
app.get("/api/tenders/construction", async (req, res) => {
  const client = getDbClient();

  try {
    await client.connect();

    // Get all tenders with construction-related CPV codes
    const constructionPrefixes = [
      "45", // Construction
      "71", // Architecture/Engineering
      "44", // Construction materials
      "77", // Landscaping
      "90", // Waste/Cleaning
      "70", // Real estate
      "09", // Utilities
      "66", // Insurance
      "79", // Business services
    ];

    const result = await client.query(
      `
      SELECT 
        id, title, description, cpv_codes, 
        publication_date, deadline_date, status,
        buyer_name, tender_url, value_amount, value_currency
      FROM tenders
      WHERE 
        status IN ('active', 'planning', 'planned')
        AND (
          ${constructionPrefixes
            .map(
              (prefix, idx) =>
                `cpv_codes::text LIKE '%"${prefix}%' ${idx < constructionPrefixes.length - 1 ? "OR" : ""}`,
            )
            .join("\n          ")}
        )
      ORDER BY publication_date DESC
      LIMIT 100
    `,
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching construction tenders:", error);
    res.status(500).json({ error: error.message });
  } finally {
    await client.end();
  }
});

// Match prospects to a tender
app.get("/api/match/:tenderId", async (req, res) => {
  const { tenderId } = req.params;
  const client = getDbClient();

  try {
    await client.connect();

    // Get the tender
    const tenderResult = await client.query(
      "SELECT * FROM tenders WHERE id = $1",
      [tenderId],
    );

    if (tenderResult.rows.length === 0) {
      return res.status(404).json({ error: "Tender not found" });
    }

    const tender = tenderResult.rows[0];
    const tenderCpvCodes = JSON.parse(tender.cpv_codes);

    if (tenderCpvCodes.length === 0) {
      return res.json([]);
    }

    // Find prospects with matching CPV codes
    const matchResult = await client.query(
      `
      SELECT 
        p.*,
        (
          SELECT json_agg(cpv)
          FROM jsonb_array_elements_text(p.cpv_codes) AS cpv
          WHERE cpv = ANY($1::text[])
        ) as matched_cpv_codes
      FROM prospects p
      WHERE p.cpv_codes ?| $1::text[]
      ORDER BY 
        (
          SELECT COUNT(*)
          FROM jsonb_array_elements_text(p.cpv_codes) AS cpv
          WHERE cpv = ANY($1::text[])
        ) DESC,
        p.company_name
    `,
      [tenderCpvCodes],
    );

    // Format the results
    const matches = matchResult.rows.map((row) => ({
      ...row,
      cpv_codes: JSON.parse(row.cpv_codes),
      matched_cpv_codes: row.matched_cpv_codes || [],
    }));

    res.json(matches);
  } catch (error) {
    console.error("Error matching prospects:", error);
    res.status(500).json({ error: error.message });
  } finally {
    await client.end();
  }
});

// Get match statistics
app.get("/api/stats/matches", async (req, res) => {
  const client = getDbClient();

  try {
    await client.connect();

    const constructionPrefixes = [
      "45",
      "71",
      "44",
      "77",
      "90",
      "70",
      "09",
      "66",
      "79",
    ];

    const tendersResult = await client.query(
      `
      SELECT COUNT(*) as total
      FROM tenders
      WHERE 
        status IN ('active', 'planning', 'planned')
        AND (
          ${constructionPrefixes
            .map(
              (prefix, idx) =>
                `cpv_codes::text LIKE '%"${prefix}%' ${idx < constructionPrefixes.length - 1 ? "OR" : ""}`,
            )
            .join("\n          ")}
        )
    `,
    );

    const prospectsResult = await client.query(
      "SELECT COUNT(*) as total FROM prospects",
    );

    const cpvStats = await client.query(`
      SELECT 
        jsonb_array_length(cpv_codes) as cpv_count,
        COUNT(*) as prospects
      FROM prospects
      GROUP BY cpv_count
      ORDER BY cpv_count
    `);

    res.json({
      total_construction_tenders: parseInt(tendersResult.rows[0].total),
      total_prospects: parseInt(prospectsResult.rows[0].total),
      cpv_distribution: cpvStats.rows,
    });
  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).json({ error: error.message });
  } finally {
    await client.end();
  }
});

// ============================================================================
// START SERVER
// ============================================================================

app.listen(PORT, () => {
  console.log("\n" + "=".repeat(70));
  console.log("🚀 TENDER MATCHER SERVER");
  console.log("=".repeat(70));
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`📤 Upload prospects: http://localhost:${PORT}/upload`);
  console.log(`🔍 Match tenders: http://localhost:${PORT}/matcher`);
  console.log("=".repeat(70) + "\n");
});
