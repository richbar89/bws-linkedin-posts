// Simple Express server for tender scanner
// UPDATED: Added new industry categories
const express = require("express");
const { Client } = require("pg");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Industry to CPV code mappings - UPDATED with new industries
const industries = {
  security: {
    name: "Security",
    cpvCodes: ["79710000", "79711000", "79715000", "79714000"],
    icon: "🔒",
  },
  fire: {
    name: "Fire Safety",
    cpvCodes: ["45331100", "50413200", "45331200", "45331210"],
    icon: "🔥",
  },
  cleaning: {
    name: "Cleaning",
    cpvCodes: [
      "90910000",
      "90919200",
      "90911200",
      "90911000",
      "90900000",
      "90919300",
    ],
    icon: "🧹",
  },
  waste: {
    name: "Waste Management",
    cpvCodes: ["90500000", "90511000", "90512000", "90513100"],
    icon: "♻️",
  },
  construction: {
    name: "Construction",
    cpvCodes: [
      "45000000",
      "45100000",
      "45200000",
      "45300000",
      "45400000",
      "45260000",
    ],
    icon: "🏗️",
  },
  facilities: {
    name: "Facilities Management",
    cpvCodes: ["79993100", "79993000"],
    icon: "🏢",
  },
  engineering: {
    name: "Mechanical & Electrical Engineering",
    cpvCodes: ["71333000", "71314100", "45350000", "45311000", "45315100"],
    icon: "⚡",
  },
};

// Middleware
app.use(express.json());
app.use(express.static("public"));

// Prevent API caching
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  next();
});

// Database connection helper
async function getDbClient() {
  const client = new Client({
    connectionString:
      process.env.DATABASE_URL || "postgresql://localhost:5432/tenders",
  });
  await client.connect();
  return client;
}

// Helper function to normalize CPV code (remove dashes and extra chars)
function normalizeCpvCode(cpv) {
  if (!cpv) return "";
  const cpvStr = String(cpv).replace(/-/g, "");
  return cpvStr.substring(0, 8);
}

// Helper function to check if CPV codes match (using 5-digit logic)
function cpvCodesMatch(cpv1, cpv2) {
  const cpv1Normalized = normalizeCpvCode(cpv1);
  const cpv2Normalized = normalizeCpvCode(cpv2);

  if (!cpv1Normalized || !cpv2Normalized) return false;

  // Exact match (8 digits)
  if (cpv1Normalized === cpv2Normalized) return true;

  // Partial match (6 digits)
  if (cpv1Normalized.length >= 6 && cpv2Normalized.length >= 6) {
    if (cpv1Normalized.substring(0, 6) === cpv2Normalized.substring(0, 6))
      return true;
  }

  // Category match (5 digits)
  if (cpv1Normalized.length >= 5 && cpv2Normalized.length >= 5) {
    if (cpv1Normalized.substring(0, 5) === cpv2Normalized.substring(0, 5))
      return true;
  }

  return false;
}

// Helper function to find matching companies for tender CPV codes
async function findMatchingCompanies(tenderCpvCodes, client) {
  const companiesResult = await client.query("SELECT * FROM companies");
  const matchingCompanies = [];

  for (const company of companiesResult.rows) {
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

    let hasMatch = false;
    for (const companyCpv of companyCpvCodes) {
      for (const tenderCpv of tenderCpvCodes) {
        if (cpvCodesMatch(companyCpv, tenderCpv)) {
          hasMatch = true;
          break;
        }
      }
      if (hasMatch) break;
    }

    if (hasMatch) {
      matchingCompanies.push({
        id: company.id,
        name: company.name,
      });
    }
  }

  return matchingCompanies;
}

// API Routes

// Get statistics
app.get("/api/stats", async (req, res) => {
  const client = await getDbClient();

  try {
    const tenderCount = await client.query(
      "SELECT COUNT(*) FROM tenders WHERE status IN ('active', 'planning', 'planned')",
    );
    const companyCount = await client.query("SELECT COUNT(*) FROM companies");

    const lastTender = await client.query(
      "SELECT MAX(publication_date) as last_update FROM tenders WHERE status IN ('active', 'planning', 'planned')",
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
    const companyResult = await client.query(
      "SELECT * FROM companies WHERE id = $1",
      [companyId],
    );

    if (companyResult.rows.length === 0) {
      res.status(404).json({ error: "Company not found" });
      return;
    }

    const company = companyResult.rows[0];

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

    const tendersResult = await client.query(
      "SELECT * FROM tenders WHERE status IN ('active', 'planning', 'planned') ORDER BY publication_date DESC",
    );

    const matchingTenders = [];

    for (const tender of tendersResult.rows) {
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

      for (const companyCpv of companyCpvCodes) {
        for (const tenderCpv of tenderCpvCodes) {
          if (!tenderCpv) continue;
          if (cpvCodesMatch(companyCpv, tenderCpv)) {
            hasMatch = true;
            break;
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

// Get industry tender counts
app.get("/api/industries/counts", async (req, res) => {
  const client = await getDbClient();

  try {
    const tendersResult = await client.query(
      "SELECT * FROM tenders WHERE status IN ('active', 'planning', 'planned')",
    );

    const counts = {};

    // Initialize counts for all industries
    for (const industryKey of Object.keys(industries)) {
      counts[industryKey] = 0;
    }

    for (const tender of tendersResult.rows) {
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

      for (const [industryKey, industry] of Object.entries(industries)) {
        let hasMatch = false;
        for (const industryCpv of industry.cpvCodes) {
          for (const tenderCpv of tenderCpvCodes) {
            if (cpvCodesMatch(industryCpv, tenderCpv)) {
              hasMatch = true;
              break;
            }
          }
          if (hasMatch) break;
        }
        if (hasMatch) {
          counts[industryKey]++;
        }
      }
    }

    res.json(counts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    await client.end();
  }
});

// Get tenders for an industry
app.get("/api/industries/:industry/tenders", async (req, res) => {
  const industryKey = req.params.industry;
  const client = await getDbClient();

  try {
    if (!industries[industryKey]) {
      res.status(404).json({ error: "Industry not found" });
      return;
    }

    const industry = industries[industryKey];
    const industryCpvCodes = industry.cpvCodes;

    const tendersResult = await client.query(
      "SELECT * FROM tenders WHERE status IN ('active', 'planning', 'planned') ORDER BY publication_date DESC",
    );

    const matchingTenders = [];

    for (const tender of tendersResult.rows) {
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

      for (const industryCpv of industryCpvCodes) {
        for (const tenderCpv of tenderCpvCodes) {
          if (!tenderCpv) continue;
          if (cpvCodesMatch(industryCpv, tenderCpv)) {
            hasMatch = true;
            break;
          }
        }
        if (hasMatch) break;
      }

      if (hasMatch) {
        const matchingCompanies = await findMatchingCompanies(
          tenderCpvCodes,
          client,
        );

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
          matching_companies: matchingCompanies,
        });
      }
    }

    res.json({
      industry: {
        key: industryKey,
        name: industry.name,
        cpv_codes: industryCpvCodes,
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
  console.log(
    `✅ UPDATED: Showing only open tenders (active, planning, planned)\n`,
  );
  console.log(`🔍 Using 5-digit CPV matching with normalization\n`);
});
