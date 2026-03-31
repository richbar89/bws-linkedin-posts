// reclassify.js
// Re-classifies tenders currently labelled 'General' or NULL
// Run once: node reclassify.js

const { Client } = require("pg");
const Anthropic = require("@anthropic-ai/sdk");

const CATS = [
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

async function run() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("❌ ANTHROPIC_API_KEY not set");
    process.exit(1);
  }

  const anthropic = new Anthropic({ apiKey });
  const db = new Client({
    connectionString:
      process.env.DATABASE_URL || "postgresql://localhost:5432/tenders",
  });

  await db.connect();
  console.log("✅ DB connected\n");

  const { rows } = await db.query(
    `SELECT id, title, description FROM tenders
     WHERE ai_category = 'General' OR ai_category IS NULL OR ai_category = 'Facilities Management'
     ORDER BY publication_date DESC
     LIMIT 500`,
  );

  console.log(`🔍 Re-classifying ${rows.length} tenders...\n`);
  let updated = 0;

  for (const t of rows) {
    const desc = t.description ? t.description.substring(0, 1000) : "";
    const prompt =
      `You are classifying UK public sector tenders. Pick the single best category from this list:\n` +
      `${CATS.join(", ")}\n\n` +
      `RULES:\n` +
      `- Use 'Facilities Management' ONLY for bundled multi-service FM contracts, NOT individual services.\n` +
      `- Use 'Civil Engineering' for infrastructure/drainage/structures, NOT general building work.\n` +
      `- Use 'Roadworks' for highway maintenance, road surfacing, street lighting.\n` +
      `- Use 'Landscaping' for parks/planting. Use 'Grounds Maintenance' for ongoing grass cutting contracts.\n` +
      `- Use 'General' only if no other category fits.\n` +
      `- Reply with ONLY the category name, nothing else.\n\n` +
      `Title: ${t.title}\nDescription: ${desc}`;

    try {
      const msg = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 20,
        messages: [{ role: "user", content: prompt }],
      });
      const result = msg.content[0].text.trim();
      const cat = CATS.includes(result) ? result : "General";

      await db.query("UPDATE tenders SET ai_category = $1 WHERE id = $2", [
        cat,
        t.id,
      ]);
      if (cat !== "General") {
        process.stdout.write(
          `  ✅ ${cat.padEnd(25)} ${t.title.substring(0, 50)}\n`,
        );
      } else {
        process.stdout.write(".");
      }
      updated++;
    } catch (e) {
      process.stdout.write(`  ❌ Failed: ${e.message}\n`);
    }

    // Small delay to avoid rate limits
    await new Promise((r) => setTimeout(r, 150));
  }

  console.log(`\n\n✅ Done — ${updated}/${rows.length} tenders processed`);
  await db.end();
}

run().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
