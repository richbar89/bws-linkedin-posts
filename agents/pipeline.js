// agents/pipeline.js
// Daily pipeline orchestrator — runs automatically at 6pm Mon-Fri via cron
//
// Mon-Thu: fetch → score → generate → schedule for NEXT DAY 7:30am-5:30pm
// Friday:  fetch → score → generate → schedule Sat 8-10am + Mon afternoon 10:30am+
//          + generate Mon morning round-ups (7:30/8:30/9:30am) from week's pool
//          + clear pool + pick next week's third industry

const { Client } = require("pg");
const { fetchLast24Hours } = require("../fetch-last-24-hours");
const { fetchAndScoreTenders } = require("./fetcher");
const { writePostsForShortlist } = require("./writer");
const { scheduleToChannels } = require("./buffer");
const { generateRoundupPost } = require("./roundup");

// Categories available as the rotating third industry (not Security or Construction)
const THIRD_INDUSTRY_OPTIONS = [
  "Fire Safety",
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
];

// Per-channel daily post limits
const MAX_GENERAL_POSTS = 8; // BWS main page
const MAX_CONSTRUCTION_POSTS = 6; // Construction page
// Security: no cap — schedule all qualifying tenders

// ============================================================================
// TIME HELPERS
// ============================================================================

function buildTimeSlots(
  date,
  startHour,
  startMin,
  endHour,
  endMin,
  intervalMins = 60,
) {
  const slots = [];
  const d = new Date(date);
  d.setHours(startHour, startMin, 0, 0);
  const end = new Date(date);
  end.setHours(endHour, endMin, 0, 0);
  while (d <= end) {
    slots.push(new Date(d));
    d.setMinutes(d.getMinutes() + intervalMins);
  }
  return slots;
}

function getNextWeekday(dayOfWeek, hour, min) {
  const d = new Date();
  const current = d.getDay();
  let daysUntil = (dayOfWeek - current + 7) % 7;
  if (daysUntil === 0) daysUntil = 7;
  d.setDate(d.getDate() + daysUntil);
  d.setHours(hour, min, 0, 0);
  return d;
}

function getTomorrowAt(hour, min) {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(hour, min, 0, 0);
  return d;
}

function getWeekStartDate() {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().split("T")[0];
}

// ============================================================================
// DB HELPERS
// ============================================================================

function getDbClient() {
  return new Client({
    connectionString:
      process.env.DATABASE_URL || "postgresql://localhost:5432/tenders",
  });
}

async function getConfig(client, key) {
  const res = await client.query(
    "SELECT value FROM weekly_config WHERE key = $1",
    [key],
  );
  return res.rows[0]?.value || null;
}

async function setConfig(client, key, value) {
  await client.query(
    `INSERT INTO weekly_config (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [key, value],
  );
}

async function getCurrentThirdIndustry(client) {
  let current = await getConfig(client, "current_third_industry");
  if (!current) {
    current =
      THIRD_INDUSTRY_OPTIONS[
        Math.floor(Math.random() * THIRD_INDUSTRY_OPTIONS.length)
      ];
    await setConfig(client, "current_third_industry", current);
    console.log(`🎲 Initialised third industry: ${current}`);
  }
  return current;
}

async function rotateThirdIndustry(client) {
  const current = await getConfig(client, "current_third_industry");
  const last = await getConfig(client, "last_third_industry");
  const available = THIRD_INDUSTRY_OPTIONS.filter((c) => c !== last);
  const next = available[Math.floor(Math.random() * available.length)];
  await setConfig(client, "last_third_industry", current || next);
  await setConfig(client, "current_third_industry", next);
  console.log(`🎲 Next week's third industry: ${next}`);
  return next;
}

async function addToRoundupPool(client, tenders, weekStart, thirdIndustry) {
  const roundupCategories = ["Security", "Construction", thirdIndustry];
  const eligible = tenders.filter((t) =>
    roundupCategories.some(
      (cat) => (t.ai_category || "").toLowerCase() === cat.toLowerCase(),
    ),
  );
  let added = 0;
  for (const t of eligible) {
    try {
      await client.query(
        `INSERT INTO roundup_pool
           (tender_id, title, buyer_name, value_amount, value_currency,
            deadline_date, location, description, ai_category, score, week_start)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (tender_id, week_start) DO NOTHING`,
        [
          t.id,
          t.title,
          t.buyer_name,
          t.value_amount,
          t.value_currency || "GBP",
          t.deadline_date,
          t.location,
          t.description,
          t.ai_category,
          t.score,
          weekStart,
        ],
      );
      added++;
    } catch (e) {
      console.log(`  ⚠️  Pool insert error for ${t.id}: ${e.message}`);
    }
  }
  console.log(
    `  📥 Added ${added} tenders to roundup pool (categories: ${roundupCategories.join(", ")})`,
  );
  return added;
}

// ============================================================================
// LOGGING HELPERS
// ============================================================================

async function createLog(client, triggeredBy, dayType) {
  try {
    const res = await client.query(
      `INSERT INTO pipeline_logs (triggered_by, status, day_type)
       VALUES ($1, 'running', $2) RETURNING id`,
      [triggeredBy, dayType],
    );
    return res.rows[0].id;
  } catch (e) {
    console.log("⚠️  Could not create pipeline log:", e.message);
    return null;
  }
}

async function updateLog(client, logId, fields) {
  if (!logId) return;
  try {
    const keys = Object.keys(fields);
    const values = Object.values(fields);
    const setClauses = keys.map((k, i) =>
      k === "scheduled_posts" ? `${k} = $${i + 1}::jsonb` : `${k} = $${i + 1}`,
    );
    await client.query(
      `UPDATE pipeline_logs SET ${setClauses.join(", ")} WHERE id = $${keys.length + 1}`,
      [...values, logId],
    );
  } catch (e) {
    console.log("⚠️  Could not update pipeline log:", e.message);
  }
}

// ============================================================================
// SCHEDULING HELPERS
// ============================================================================

async function stagePosts(client, posts, shortlist, slots) {
  const staged = [];
  let slotIndex = 0;
  for (let i = 0; i < posts.length; i++) {
    const post = posts[i];
    if (!post.post_text || slotIndex >= slots.length) continue;

    const tender = shortlist.find((t) => t.id === post.id) || post;
    const pages = tender.targetPages || ["main"];
    const proposedSlot = slots[slotIndex++];

    try {
      const result = await client.query(
        `INSERT INTO post_staging (tender_id, title, url, ai_category, industry_key, pages, post_text, proposed_slot, value_amount, value_currency)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (tender_id) DO UPDATE SET
           post_text = EXCLUDED.post_text,
           proposed_slot = EXCLUDED.proposed_slot,
           pages = EXCLUDED.pages,
           value_amount = EXCLUDED.value_amount,
           value_currency = EXCLUDED.value_currency,
           status = 'pending',
           created_at = NOW()
         RETURNING id`,
        [
          String(post.id),
          post.title || "",
          tender.tender_url || "",
          tender.ai_category || "",
          tender.industryKey || "general",
          pages.join(","),
          post.post_text,
          proposedSlot.toISOString(),
          tender.value_amount || null,
          tender.value_currency || "GBP",
        ],
      );
      if (result.rowCount > 0) {
        staged.push({
          title: (post.title || post.id || "").substring(0, 80),
          category: tender.ai_category || "General",
          pages,
          proposed_slot: proposedSlot.toISOString(),
        });
        console.log(
          `  📋 ${(post.title || "").substring(0, 50)} @ ${proposedSlot.toLocaleTimeString("en-GB")} → [${pages.join(", ")}]`,
        );
      } else {
        console.log(
          `  ⏭️  Already staged: ${(post.title || "").substring(0, 50)}`,
        );
      }
    } catch (e) {
      console.log(`  ⚠️  Could not stage: ${e.message}`);
    }
  }
  return staged;
}

// ============================================================================
// MAIN PIPELINE
// ============================================================================

async function runDailyPipeline(triggeredBy = "cron") {
  const startTime = new Date();
  console.log("\n" + "=".repeat(70));
  console.log(`🚀 DAILY PIPELINE — ${startTime.toLocaleString("en-GB")}`);
  console.log("=".repeat(70) + "\n");

  const dayOfWeek = startTime.getDay();
  const isFriday = dayOfWeek === 5;
  const weekStart = getWeekStartDate();
  const dayType = isFriday ? "friday" : "weekday";

  const db = getDbClient();
  await db.connect();

  const logId = await createLog(db, triggeredBy, dayType);

  try {
    // ── Step 1: Fetch ──────────────────────────────────────────────────────
    console.log("📡 Step 1: Fetching tenders from API...");
    await fetchLast24Hours();
    const fetchResult = await db.query(
      "SELECT COUNT(*) FROM tenders WHERE publication_date >= NOW() - INTERVAL '24 hours'",
    );
    const tendersSaved = parseInt(fetchResult.rows[0].count);
    await updateLog(db, logId, { tenders_fetched: tendersSaved });
    console.log("✅ Fetch complete\n");

    // ── Step 2: Score & shortlist ──────────────────────────────────────────
    console.log("🎯 Step 2: Scoring and shortlisting...");
    const shortlist = await fetchAndScoreTenders({
      hoursBack: 24,
      maxResults: 100, // fetch enough for all three channels
    });
    await updateLog(db, logId, { tenders_scored: shortlist.length });
    console.log(`✅ ${shortlist.length} tenders shortlisted\n`);

    if (shortlist.length === 0) {
      await updateLog(db, logId, {
        status: "complete",
        duration_seconds: (Date.now() - startTime) / 1000,
        finished_at: new Date().toISOString(),
      });
      console.log("⚠️  No tenders to post today. Pipeline complete.");
      return;
    }

    // Apply per-channel caps before writing posts (saves API calls)
    const getKey = (t) => t.industryKey || "general";
    const securitySelected = shortlist.filter((t) => getKey(t) === "security");
    const constructionSelected = shortlist
      .filter((t) => getKey(t) === "construction")
      .slice(0, MAX_CONSTRUCTION_POSTS);
    const generalSelected = shortlist
      .filter((t) => !["security", "construction"].includes(getKey(t)))
      .slice(0, MAX_GENERAL_POSTS);
    const toPost = [
      ...securitySelected,
      ...constructionSelected,
      ...generalSelected,
    ];
    console.log(
      `  → Security: ${securitySelected.length}, Construction: ${constructionSelected.length}, General: ${generalSelected.length}\n`,
    );

    // ── Step 3: Generate posts ─────────────────────────────────────────────
    console.log("✍️  Step 3: Generating posts...");
    const posts = await writePostsForShortlist(toPost);
    const successful = posts.filter((p) => p.post_text);
    await updateLog(db, logId, { posts_generated: successful.length });
    console.log(`✅ ${successful.length}/${posts.length} posts generated\n`);

    // ── Step 4: Add to roundup pool ────────────────────────────────────────
    console.log("📥 Step 4: Adding to roundup pool...");
    const thirdIndustry = await getCurrentThirdIndustry(db);
    const roundupAdded = await addToRoundupPool(
      db,
      shortlist,
      weekStart,
      thirdIndustry,
    );
    await updateLog(db, logId, {
      roundup_added: roundupAdded,
      third_industry: thirdIndustry,
    });
    console.log(`  Third industry this week: ${thirdIndustry}\n`);

    // Sort by score + value descending
    const ranked = successful.sort((a, b) => {
      const ta = shortlist.find((t) => t.id === a.id) || {};
      const tb = shortlist.find((t) => t.id === b.id) || {};
      const scoreA = (ta.score || 0) + (parseFloat(ta.value_amount) || 0) / 1e6;
      const scoreB = (tb.score || 0) + (parseFloat(tb.value_amount) || 0) / 1e6;
      return scoreB - scoreA;
    });

    // Split into per-channel buckets (already capped at write time, but keep explicit)
    const securityRanked = ranked.filter(
      (p) => shortlist.find((t) => t.id === p.id)?.industryKey === "security",
    );
    const constructionRanked = ranked.filter(
      (p) =>
        shortlist.find((t) => t.id === p.id)?.industryKey === "construction",
    );
    const generalRanked = ranked.filter((p) => {
      const key = shortlist.find((t) => t.id === p.id)?.industryKey;
      return !["security", "construction"].includes(key);
    });

    let allScheduled = [];

    // ── Step 5: Stage for review ───────────────────────────────────────────
    if (!isFriday) {
      console.log("📋 Step 5: Staging posts for review (Mon-Thu)...");
      const tomorrow = getTomorrowAt(7, 30);

      // Staggered start times, 60-min intervals per channel
      // Security:     7:30, 8:30, 9:30 ...
      // Construction: 8:00, 9:00, 10:00 ...
      // General:      8:30, 9:30, 10:30 ...
      const secSlots = buildTimeSlots(tomorrow, 7, 30, 17, 30, 60);
      const conSlots = buildTimeSlots(tomorrow, 8, 0, 17, 0, 60);
      const genSlots = buildTimeSlots(tomorrow, 8, 30, 16, 30, 60);

      console.log(`\n  🔒 Security (${securityRanked.length}):`);
      allScheduled.push(
        ...(await stagePosts(db, securityRanked, shortlist, secSlots)),
      );

      console.log(`\n  🏗️  Construction (${constructionRanked.length}):`);
      allScheduled.push(
        ...(await stagePosts(db, constructionRanked, shortlist, conSlots)),
      );

      console.log(`\n  📋 General (${generalRanked.length}):`);
      allScheduled.push(
        ...(await stagePosts(db, generalRanked, shortlist, genSlots)),
      );
    } else {
      console.log(
        "📋 Step 5: Friday pipeline — staging Sat + Mon posts for review...\n",
      );

      const satSlots = [
        getNextWeekday(6, 8, 0),
        getNextWeekday(6, 9, 0),
        getNextWeekday(6, 10, 0),
      ];
      const monSlots = buildTimeSlots(
        getNextWeekday(1, 10, 30),
        10,
        30,
        17,
        30,
      );

      // Saturday: top 2 from each channel
      console.log("  🗓️  Saturday Security:");
      allScheduled.push(
        ...(await stagePosts(db, securityRanked.slice(0, 2), shortlist, [
          ...satSlots,
        ])),
      );
      console.log("  🗓️  Saturday Construction:");
      allScheduled.push(
        ...(await stagePosts(db, constructionRanked.slice(0, 2), shortlist, [
          ...satSlots,
        ])),
      );
      console.log("  🗓️  Saturday General:");
      allScheduled.push(
        ...(await stagePosts(db, generalRanked.slice(0, 2), shortlist, [
          ...satSlots,
        ])),
      );

      // Monday afternoon: remaining from each channel
      const monSec = securityRanked.slice(2);
      const monCon = constructionRanked.slice(2);
      const monGen = generalRanked.slice(2);
      if (monSec.length > 0) {
        console.log(`\n  🗓️  Monday Security (${monSec.length}):`);
        allScheduled.push(
          ...(await stagePosts(db, monSec, shortlist, [...monSlots])),
        );
      }
      if (monCon.length > 0) {
        console.log(`\n  🗓️  Monday Construction (${monCon.length}):`);
        allScheduled.push(
          ...(await stagePosts(db, monCon, shortlist, [...monSlots])),
        );
      }
      if (monGen.length > 0) {
        console.log(`\n  🗓️  Monday General (${monGen.length}):`);
        allScheduled.push(
          ...(await stagePosts(db, monGen, shortlist, [...monSlots])),
        );
      }

      // Monday morning round-ups
      console.log("\n  🔄 Generating Monday morning round-ups...");
      const poolResult = await db.query(
        "SELECT * FROM roundup_pool WHERE week_start = $1 ORDER BY score DESC",
        [weekStart],
      );
      const pool = poolResult.rows;

      const roundupSchedule = [
        { category: "Security", pages: ["security", "main"], monTime: [7, 30] },
        {
          category: "Construction",
          pages: ["construction", "main"],
          monTime: [8, 30],
        },
        { category: thirdIndustry, pages: ["main"], monTime: [9, 30] },
      ];

      for (const item of roundupSchedule) {
        const categoryTenders = pool.filter(
          (t) =>
            (t.ai_category || "").toLowerCase() === item.category.toLowerCase(),
        );
        if (categoryTenders.length < 3) {
          console.log(
            `  ⚠️  Only ${categoryTenders.length} tenders for ${item.category} round-up (need 3+) — skipping`,
          );
          continue;
        }
        console.log(
          `  ✍️  Generating ${item.category} round-up (${categoryTenders.length} tenders)...`,
        );
        const postText = await generateRoundupPost(
          categoryTenders,
          item.category,
        );
        const scheduledAt = getNextWeekday(1, item.monTime[0], item.monTime[1]);
        const results = await scheduleToChannels(
          item.pages,
          postText,
          scheduledAt,
        );
        const anySuccess = results.some((r) => !r.error);
        if (anySuccess) {
          allScheduled.push({
            title: `${item.category} Weekly Round-Up`,
            category: item.category,
            pages: item.pages,
            scheduled_at: scheduledAt.toISOString(),
            is_roundup: true,
          });
        }
        console.log(
          `  ${anySuccess ? "✅" : "❌"} ${item.category} round-up → Mon ${scheduledAt.toLocaleTimeString("en-GB")} [${item.pages.join(", ")}]`,
        );
      }

      // Clear pool and rotate industry
      await db.query("DELETE FROM roundup_pool WHERE week_start = $1", [
        weekStart,
      ]);
      console.log(`\n  🧹 Roundup pool cleared for week ${weekStart}`);
      await rotateThirdIndustry(db);
    }

    // ── Complete ───────────────────────────────────────────────────────────
    const duration = (Date.now() - startTime) / 1000;
    await updateLog(db, logId, {
      status: "complete",
      posts_scheduled: allScheduled.length,
      scheduled_posts: JSON.stringify(allScheduled),
      duration_seconds: duration,
      finished_at: new Date().toISOString(),
    });

    console.log("\n" + "=".repeat(70));
    console.log(`✅ PIPELINE COMPLETE in ${duration.toFixed(1)}s`);
    console.log("=".repeat(70) + "\n");
  } catch (err) {
    console.error("\n❌ PIPELINE ERROR:", err.message);
    console.error(err.stack);
    await updateLog(db, logId, {
      status: "error",
      error_message: err.message,
      finished_at: new Date().toISOString(),
    });
    throw err;
  } finally {
    await db.end();
  }
}

module.exports = { runDailyPipeline };
