// UPDATED: Fetch tenders from API - LAST 24 HOURS ONLY
const { Client } = require("pg");
const Anthropic = require("@anthropic-ai/sdk");

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const AI_CATEGORIES = [
  "Security",
  "Fire Safety",
  "Construction",
  "Civil Engineering",
  "M&E",
  "Gas Services",
  "Water Hygiene",
  "Grounds Maintenance",
  "Waste Management",
  "Cleaning",
  "Catering",
  "Facilities Management",
  "Electrical",
  "Transport",
  "Landscaping",
  "Pest Control",
  "Roadworks",
  "Legal/Law",
  "General",
];

const CATEGORY_LIST_STR = AI_CATEGORIES.join(", ");

async function categoriseTender(title, description) {
  const desc = description ? description.substring(0, 1000) : "Not available";
  const prompt =
    `You are classifying UK public sector tenders. Pick the single best category from this list:\n` +
    `${CATEGORY_LIST_STR}\n\n` +
    `RULES:\n` +
    `- Use 'Facilities Management' ONLY for bundled/integrated multi-service FM contracts covering multiple building services under one contract. NOT for individual services.\n` +
    `- If the tender is clearly one specific service (e.g. cleaning, electrical, grounds maintenance, catering, pest control), use that specific category.\n` +
    `- Use 'Civil Engineering' for infrastructure, drainage, earthworks, structures — not general building construction.\n` +
    `- Use 'Roadworks' for highway maintenance, road surfacing, street lighting, traffic management.\n` +
    `- Use 'Landscaping' for parks, planting, hard landscaping. Use 'Grounds Maintenance' for ongoing grass cutting/maintenance contracts.\n` +
    `- Use 'General' only if no other category fits at all.\n` +
    `- Reply with ONLY the category name, nothing else.\n\n` +
    `Title: ${title}\nDescription: ${desc}`;

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 20,
      messages: [{ role: "user", content: prompt }],
    });
    const result = message.content[0].text.trim();
    return AI_CATEGORIES.includes(result) ? result : "General";
  } catch (e) {
    return "General";
  }
}

// Extract the most specific delivery location from an OCDS release
function extractDeliveryLocation(release) {
  const candidates = [];

  // 1. Tender-level delivery locations (NUTS descriptions)
  if (Array.isArray(release.tender?.deliveryLocations)) {
    for (const loc of release.tender.deliveryLocations) {
      if (loc.description && loc.description.trim()) {
        candidates.push(loc.description.trim());
      }
    }
  }

  // 2. Item-level delivery locations
  if (Array.isArray(release.tender?.items)) {
    for (const item of release.tender.items) {
      if (Array.isArray(item.deliveryLocations)) {
        for (const loc of item.deliveryLocations) {
          if (loc.description && loc.description.trim()) {
            candidates.push(loc.description.trim());
          }
        }
      }
    }
  }

  // 3. Buyer address — locality or region
  const addr = release.buyer?.address;
  if (addr) {
    const parts = [addr.locality, addr.region]
      .filter(Boolean)
      .map((s) => s.trim());
    if (parts.length > 0) candidates.push(parts.join(", "));
  }

  // Filter out country-level noise
  const GENERIC = new Set([
    "uk",
    "united kingdom",
    "england",
    "gb",
    "great britain",
    "wales",
    "scotland",
    "northern ireland",
  ]);
  const specific = candidates.filter((c) => !GENERIC.has(c.toLowerCase()));

  return specific.length > 0 ? specific[0] : null;
}

// Helper function to normalize CPV codes
function normalizeCpvCode(cpv) {
  if (!cpv) return null;
  const normalized = String(cpv).replace(/-/g, "").substring(0, 8);
  return normalized.length === 8 ? normalized : null;
}

async function fetchLast24Hours() {
  console.log("\n" + "=".repeat(70));
  console.log("🚀 TENDER FETCH - LAST 24 HOURS ONLY");
  console.log("=".repeat(70) + "\n");

  // Calculate date from 24 hours ago
  const twentyFourHoursAgo = new Date();
  twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);
  const dateFrom = twentyFourHoursAgo.toISOString();

  console.log(
    `📅 Fetching tenders from: ${twentyFourHoursAgo.toLocaleString("en-GB")}`,
  );
  console.log(`📅 Current time: ${new Date().toLocaleString("en-GB")}\n`);

  // Connect to database
  const client = new Client({
    connectionString:
      process.env.DATABASE_URL || "postgresql://localhost:5432/tenders",
  });

  await client.connect();
  console.log("✅ Connected to database\n");

  try {
    let allReleases = [];
    let pageCount = 0;

    let nextUrl = `https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages?updatedFrom=${dateFrom}&limit=100`;

    console.log("⚡ Starting pagination...");
    console.log("⚡ Will stop after 10 pages or when no more results\n");

    // Pagination loop - limit to 10 pages for 24 hour window
    while (nextUrl && pageCount < 10) {
      pageCount++;
      console.log(`📡 Page ${pageCount}...`);

      try {
        const response = await fetch(nextUrl);

        if (!response.ok) {
          console.log(
            `   ❌ HTTP Error: ${response.status} ${response.statusText}`,
          );
          break;
        }

        const data = await response.json();

        if (data.releases && Array.isArray(data.releases)) {
          const newReleases = data.releases.length;
          allReleases = allReleases.concat(data.releases);
          console.log(
            `   ✅ Got ${newReleases} releases (Total: ${allReleases.length})`,
          );
        } else {
          console.log(`   ⚠️  No releases in response`);
        }

        // Check for next page
        if (data.links?.next) {
          nextUrl = data.links.next;
          console.log(`   ➡️  Next page available`);
          await new Promise((resolve) => setTimeout(resolve, 200));
        } else {
          console.log(`   ✋ No more pages`);
          nextUrl = null;
        }
      } catch (fetchError) {
        console.log(`   ❌ Fetch error: ${fetchError.message}`);
        break;
      }
    }

    console.log("\n" + "=".repeat(70));
    console.log(
      `📊 FETCH COMPLETE: ${allReleases.length} releases from ${pageCount} pages`,
    );
    console.log("=".repeat(70) + "\n");

    // Wipe tenders from last 24 hours so we repopulate with correct filters
    const wipeResult = await client.query(
      "DELETE FROM tenders WHERE publication_date >= $1",
      [twentyFourHoursAgo.toISOString()],
    );
    console.log(
      `🗑️  Cleared ${wipeResult.rowCount} tenders from last 24 hours — repopulating...\n`,
    );

    // Now process and filter
    console.log("💾 Processing and saving tenders...\n");

    let processedCount = 0;
    let savedCount = 0;
    let skippedNoTender = 0;
    let skippedInactive = 0;
    let cpvIssues = 0;
    let valuesFound = 0;
    let valuesMissing = 0;
    let allStatusCounts = {};
    let savedStatusCounts = {};

    // Only keep live contract notices — exclude PINs, PMEs, award notices etc.
    // UK2/UK4 = Contract Notice, UK9 = Social/Other Services, UK10 = Concession
    // UK1/UK12 = Prior Info Notice, UK13 = Preliminary Market Engagement
    // UK3/F03 = Contract Award Notice, UK5 = Voluntary Transparency Notice
    const EXCLUDED_NOTICE_TYPES = [
      "UK1",
      "UK3",
      "UK5",
      "UK12",
      "UK13",
      "F01",
      "F03",
      "F21",
    ];

    for (const release of allReleases) {
      if (!release.tender) {
        skippedNoTender++;
        continue;
      }

      processedCount++;
      const tenderStatus = (release.tender.status || "unknown").toLowerCase();

      // Count ALL statuses for reporting
      allStatusCounts[tenderStatus] = (allStatusCounts[tenderStatus] || 0) + 1;

      // Skip anything that isn't an actively open tender
      if (tenderStatus !== "active") {
        skippedInactive++;
        continue;
      }

      // Skip if release tag doesn't include "tender" (catches PMEs, PINs tagged as "planning")
      const releaseTags = Array.isArray(release.tag) ? release.tag : [];
      if (!releaseTags.includes("tender")) {
        skippedInactive++;
        console.log(
          `   ⏭️  Skipped ${release.id} — release tags: [${releaseTags.join(", ")}]`,
        );
        continue;
      }

      // Also skip by notice type as a second check
      const tenderDoc = release.tender.documents?.find(
        (d) => d.documentType === "tenderNotice",
      );
      const noticeType = tenderDoc?.noticeType || "";
      if (
        noticeType &&
        EXCLUDED_NOTICE_TYPES.some((t) => noticeType.startsWith(t))
      ) {
        skippedInactive++;
        console.log(
          `   ⏭️  Skipped ${release.id} — notice type: ${noticeType}`,
        );
        continue;
      }

      // Count saved statuses
      savedStatusCounts[tenderStatus] =
        (savedStatusCounts[tenderStatus] || 0) + 1;

      // Extract CPV codes
      let cpvCodes = [];

      if (release.tender.classification?.id) {
        const normalized = normalizeCpvCode(release.tender.classification.id);
        if (normalized) cpvCodes.push(normalized);
      }

      if (release.tender.items) {
        for (const item of release.tender.items) {
          if (item.classification?.id) {
            const normalized = normalizeCpvCode(item.classification.id);
            if (normalized) cpvCodes.push(normalized);
          }

          if (item.additionalClassifications) {
            for (const ac of item.additionalClassifications) {
              if (ac.scheme === "CPV" && ac.id) {
                const normalized = normalizeCpvCode(ac.id);
                if (normalized) cpvCodes.push(normalized);
              }
            }
          }
        }
      }

      cpvCodes = [...new Set(cpvCodes)];

      if (cpvCodes.length === 0) {
        cpvIssues++;
      }

      // Extract contract value — try main value first, then sum lots
      // API uses either "amount" or "amountGross" depending on notice type
      const tenderValue = release.tender.value;
      let valueAmount = tenderValue?.amount || tenderValue?.amountGross || null;
      const valueCurrency = tenderValue?.currency || "GBP";

      if (!valueAmount && release.tender.lots?.length > 0) {
        const lotTotal = release.tender.lots
          .map((lot) => lot.value?.amount || lot.value?.amountGross || 0)
          .reduce((a, b) => a + b, 0);
        if (lotTotal > 0) valueAmount = lotTotal;
      }

      if (valueAmount) {
        valuesFound++;
      } else {
        valuesMissing++;
      }

      const deadline = release.tender.tenderPeriod?.endDate || null;
      const buyerName = release.buyer?.name || "Unknown";
      const tenderUrl = `https://www.find-tender.service.gov.uk/Notice/${release.id}`;
      const deliveryLocation = extractDeliveryLocation(release);

      // Save to database with value and location fields (INSERT or UPDATE)
      try {
        await client.query(
          `INSERT INTO tenders (
            id, title, description, cpv_codes,
            publication_date, deadline_date, status,
            buyer_name, tender_url, value_amount, value_currency,
            delivery_location
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          ON CONFLICT (id) DO UPDATE SET
            title = EXCLUDED.title,
            description = EXCLUDED.description,
            cpv_codes = EXCLUDED.cpv_codes,
            deadline_date = EXCLUDED.deadline_date,
            status = EXCLUDED.status,
            value_amount = EXCLUDED.value_amount,
            value_currency = EXCLUDED.value_currency,
            delivery_location = EXCLUDED.delivery_location`,
          [
            release.id,
            release.tender.title || "No title",
            release.tender.description || "",
            JSON.stringify(cpvCodes),
            release.date,
            deadline,
            tenderStatus,
            buyerName,
            tenderUrl,
            valueAmount,
            valueCurrency,
            deliveryLocation,
          ],
        );

        savedCount++;

        if (savedCount % 20 === 0) {
          console.log(`   📝 Saved ${savedCount} tenders...`);
        }
      } catch (dbError) {
        console.log(`   ⚠️  DB error for ${release.id}: ${dbError.message}`);
      }
    }

    // AI classification pass — classify all newly saved tenders
    if (savedCount > 0 && process.env.ANTHROPIC_API_KEY) {
      console.log(
        `\n🤖 AI CLASSIFICATION: Classifying ${savedCount} tenders with Claude Haiku...\n`,
      );

      // Fetch tenders that don't yet have an ai_category
      const unclassified = await client.query(
        `SELECT id, title, description FROM tenders
         WHERE publication_date >= $1 AND (ai_category IS NULL OR ai_category = '')`,
        [twentyFourHoursAgo.toISOString()],
      );

      let classified = 0;
      for (const row of unclassified.rows) {
        const category = await categoriseTender(row.title, row.description);
        await client.query(
          "UPDATE tenders SET ai_category = $1 WHERE id = $2",
          [category, row.id],
        );
        classified++;
        if (classified % 10 === 0) {
          console.log(
            `   🏷️  Classified ${classified}/${unclassified.rows.length}...`,
          );
        }
        // Small delay to avoid hammering the API
        await new Promise((r) => setTimeout(r, 150));
      }

      console.log(
        `\n✅ AI classification complete: ${classified} tenders categorised\n`,
      );
    } else if (!process.env.ANTHROPIC_API_KEY) {
      console.log(
        "\n⚠️  ANTHROPIC_API_KEY not set — skipping AI classification\n",
      );
    }

    // Clean up old tenders (older than 24 hours)
    const deleteResult = await client.query(
      "DELETE FROM tenders WHERE publication_date < $1",
      [twentyFourHoursAgo.toISOString()],
    );
    console.log(
      `\n🧹 Cleaned up ${deleteResult.rowCount} tenders older than 24 hours`,
    );

    // Results summary
    console.log("\n" + "=".repeat(70));
    console.log("📊 PROCESSING SUMMARY");
    console.log("=".repeat(70) + "\n");
    console.log(`   Total releases fetched: ${allReleases.length}`);
    console.log(`   Pages fetched: ${pageCount}`);
    console.log(`   Releases with tender data: ${processedCount}`);
    console.log(`   Releases without tender data: ${skippedNoTender}`);
    console.log(
      `   Skipped (non-active status or notice type): ${skippedInactive}`,
    );
    console.log(`   ✅ SAVED active tenders: ${savedCount}`);
    console.log(`   Tenders missing CPV codes: ${cpvIssues}`);
    console.log(`   💰 Tenders WITH contract value: ${valuesFound}`);
    console.log(`   ⚠️  Tenders WITHOUT contract value: ${valuesMissing}`);

    console.log("\n📊 All statuses found in API:");
    Object.entries(allStatusCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([status, count]) => {
        const kept = status === "active" ? "✅ KEPT" : "❌ FILTERED";
        console.log(`   ${status}: ${count} ${kept}`);
      });

    console.log("\n📊 Statuses saved to database:");
    Object.entries(savedStatusCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([status, count]) => {
        console.log(`   ${status}: ${count}`);
      });

    // Verify database
    const dbCount = await client.query("SELECT COUNT(*) FROM tenders");
    const dbStatusBreakdown = await client.query(`
      SELECT status, COUNT(*) as count
      FROM tenders
      GROUP BY status
      ORDER BY count DESC
    `);

    console.log(`\n✅ Database now contains: ${dbCount.rows[0].count} tenders`);
    console.log("\n📊 Database status verification:");
    dbStatusBreakdown.rows.forEach((row) => {
      console.log(`   ${row.status}: ${row.count}`);
    });

    // Recent tenders check
    const recentCheck = await client.query(`
      SELECT COUNT(*) as count
      FROM tenders
      WHERE publication_date >= NOW() - INTERVAL '24 hours'
    `);
    console.log(
      `\n📅 Tenders from last 24 hours: ${recentCheck.rows[0].count}`,
    );

    console.log("\n" + "=".repeat(70));
    console.log("✅ SUCCESS: 24-hour tender refresh complete!");
    console.log(`   ${savedCount} tenders processed from last 24 hours`);
    console.log(`   ${valuesFound} have contract values`);
    console.log("\n" + "=".repeat(70) + "\n");
  } catch (error) {
    console.log("\n" + "=".repeat(70));
    console.log("❌ FATAL ERROR");
    console.log("=".repeat(70));
    console.log(`\nError: ${error.message}`);
    console.log(`\nStack: ${error.stack}`);
    console.log("\n" + "=".repeat(70) + "\n");
    throw error;
  } finally {
    await client.end();
  }
}

// Run if called directly
if (require.main === module) {
  fetchLast24Hours().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}

module.exports = { fetchLast24Hours };
