// Simple Express server for tender scanner
// UPDATED: Changed CPV matching to 3 digits for broader, more accurate results
const express = require("express");
const { Client } = require("pg");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static("public"));

// Database connection helper
async function getDbClient() {
  const client = new Client({
    connectionString:
      process.env.DATABASE_URL || "postgresql://localhost:5432/tenders",
  });
  await client.connect();
  return client;
}

// API Routes

// Get statistics
app.get("/api/stats", async (req, res) => {
  const client = await getDbClient();

  try {
    // Only count tenders with status 'planned' or 'active'
    const tenderCount = await client.query(
      "SELECT COUNT(*) FROM tenders WHERE status IN ('planned', 'active')",
    );
    const companyCount = await client.query("SELECT COUNT(*) FROM companies");

    // Get last tender publication date (from filtered tenders only)
    const lastTender = await client.query(
      "SELECT MAX(publication_date) as last_update FROM tenders WHERE status IN ('planned', 'active')",
    );

    res.json({
      total_tenders: parseInt(tenderCount.rows[0].count),
      total_companies: parseInt(companyCount.rows[0].count),
      last_updated: lastTender.rows[0].last_update,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    await client.end();
  }
});

// Get all companies
app.get("/api/companies", async (req, res) => {
  const client = await getDbClient();

  try {
    const result = await client.query("SELECT * FROM companies ORDER BY name");

    // Parse CPV codes for each company
    const companies = result.rows.map((company) => {
      let cpvCodes = [];
      if (typeof company.cpv_codes === "string") {
        cpvCodes = JSON.parse(company.cpv_codes);
      } else if (Array.isArray(company.cpv_codes)) {
        cpvCodes = company.cpv_codes;
      } else if (
        typeof company.cpv_codes === "object" &&
        company.cpv_codes !== null
      ) {
        cpvCodes = Object.values(company.cpv_codes);
      }

      return {
        id: company.id,
        name: company.name,
        cpv_codes: cpvCodes,
        created_at: company.created_at,
      };
    });

    res.json(companies);
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    await client.end();
  }
});

// Get matching tenders for a company
app.get("/api/companies/:id/tenders", async (req, res) => {
  const companyId = parseInt(req.params.id);
  const client = await getDbClient();

  try {
    // Get company
    const companyResult = await client.query(
      "SELECT * FROM companies WHERE id = $1",
      [companyId],
    );

    if (companyResult.rows.length === 0) {
      res.status(404).json({ error: "Company not found" });
      return;
    }

    const company = companyResult.rows[0];

    // Parse company CPV codes
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

    // Only get tenders with status 'planned' or 'active'
    const tendersResult = await client.query(
      "SELECT * FROM tenders WHERE status IN ('planned', 'active') ORDER BY publication_date DESC",
    );

    // Match tenders
    const matchingTenders = [];

    for (const tender of tendersResult.rows) {
      // Parse tender CPV codes
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

      // Check for matches - UPDATED: Using 3-digit matching as the broadest level
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

          // UPDATED: Broader match (3 digits instead of 4)
          // This matches the Find-a-Tender website behavior more closely
          if (tenderCpvStr.length >= 3 && companyCpvStr.length >= 3) {
            if (
              tenderCpvStr.substring(0, 3) === companyCpvStr.substring(0, 3)
            ) {
              hasMatch = true;
              break;
            }
          }
        }
        if (hasMatch) break;
      }

      if (hasMatch) {
        matchingTenders.push({
          id: tender.id,
          title: tender.title,
          description: tender.description,
          buyer_name: tender.buyer_name,
          status: tender.status,
          publication_date: tender.publication_date,
          deadline_date: tender.deadline_date,
          cpv_codes: tenderCpvCodes,
          tender_url: tender.tender_url,
        });
      }
    }

    res.json({
      company: {
        id: company.id,
        name: company.name,
        cpv_codes: companyCpvCodes,
      },
      tenders: matchingTenders,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    await client.end();
  }
});

// Add a new company
app.post("/api/companies", async (req, res) => {
  const { name, cpv_codes } = req.body;

  if (!name || !cpv_codes || !Array.isArray(cpv_codes)) {
    res.status(400).json({ error: "Name and CPV codes (array) required" });
    return;
  }

  const client = await getDbClient();

  try {
    const result = await client.query(
      "INSERT INTO companies (name, cpv_codes) VALUES ($1, $2::jsonb) RETURNING *",
      [name, JSON.stringify(cpv_codes)],
    );

    res.json({ success: true, company: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    await client.end();
  }
});

// Delete a company
app.delete("/api/companies/:id", async (req, res) => {
  const companyId = parseInt(req.params.id);

  if (!companyId || isNaN(companyId)) {
    res.status(400).json({ error: "Valid company ID required" });
    return;
  }

  const client = await getDbClient();

  try {
    const result = await client.query(
      "DELETE FROM companies WHERE id = $1 RETURNING name",
      [companyId],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: "Company not found" });
      return;
    }

    res.json({
      success: true,
      message: `Company "${result.rows[0].name}" deleted successfully`,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    await client.end();
  }
});

// Start server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n🚀 Tender Scanner running on http://localhost:${PORT}`);
  console.log(`📊 Open your browser and visit: http://localhost:${PORT}\n`);
  console.log(`✅ Filtering to show only 'planned' and 'active' tenders\n`);
  console.log(`🔍 Using 3-digit CPV matching for broader results\n`);
});
