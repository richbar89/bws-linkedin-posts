/**
 * fetch-and-save-tenders.js
 *
 * GOAL (what you described):
 * - Rolling last 3 weeks of "live" tenders
 * - No planning, no awarded, no contract notices
 * - Only what can be bid on now
 *
 * IMPORTANT DETAIL:
 * The Find a Tender OCDS API filters by UPDATED date (updatedFrom/updatedTo),
 * not strictly by PUBLISHED date.
 *
 * So we:
 * 1) Fetch a wider UPDATED window (default 60 days) from tender stage
 * 2) Filter locally to keep only:
 *    - published within KEEP_DAYS (default 21 days)
 *    - deadline not passed
 * 3) Upsert into Postgres in batches with retries, so it doesn't crash mid-run.
 */

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

// -------------------------
// Config (env overrides)
// -------------------------

// Fetch wider than 21 days because API uses UPDATED, not PUBLISHED
const FETCH_DAYS = parseInt(process.env.FETCH_DAYS || "60", 10);

// Keep exactly what you want for the front-end (rolling 3 weeks)
const KEEP_DAYS = parseInt(process.env.KEEP_DAYS || "21", 10);

const PAGE_LIMIT = Math.min(
  Math.max(parseInt(process.env.PAGE_LIMIT || "100", 10), 1),
  100,
);
const STAGES = process.env.STAGES || "tender"; // tender only

// API base
const FTS_BASE_URL =
  process.env.FTS_BASE_URL || "https://www.find-tender.service.gov.uk";
const FTS_OCDS_ENDPOINT = `${FTS_BASE_URL}/api/1.0/ocdsReleasePackages`;

// DB
const connectionString =
  process.env.DATABASE_URL ||
  process.env.LOCAL_DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:5432/tenders";

// Resume state
const STATE_FILE = path.join(process.cwd(), ".tender_fetch_state.json");

// Batch size for DB upserts
const DB_BATCH_SIZE = Math.min(
  Math.max(parseInt(process.env.DB_BATCH_SIZE || "50", 10), 10),
  200,
);

// Safety cap
const MAX_PAGES = parseInt(process.env.MAX_PAGES || "9999", 10);

// -------------------------
// Helpers
// -------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function gbDateTime(x) {
  try {
    return new Date(x).toLocaleString("en-GB");
  } catch {
    return String(x);
  }
}

function isoNoTz(date) {
  // API wants YYYY-MM-DDTHH:MM:SS with no timezone
  const pad = (n) => String(n).padStart(2, "0");
  return (
    date.getFullYear() +
    "-" +
    pad(date.getMonth() + 1) +
    "-" +
    pad(date.getDate()) +
    "T" +
    pad(date.getHours()) +
    ":" +
    pad(date.getMinutes()) +
    ":" +
    pad(date.getSeconds())
  );
}

function daysAgoNoTz(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return isoNoTz(d);
}

function normalizeCpvCode(cpv) {
  const s = String(cpv || "")
    .trim()
    .replace(/-/g, "");
  if (!s) return "";
  return s.length >= 8 ? s.slice(0, 8) : s;
}

function extractCpvCodesFromRelease(release) {
  const codes = new Set();

  const main = release?.tender?.classification?.id;
  if (main) codes.add(normalizeCpvCode(main));

  const items = Array.isArray(release?.tender?.items)
    ? release.tender.items
    : [];
  for (const item of items) {
    const addl = Array.isArray(item?.additionalClassifications)
      ? item.additionalClassifications
      : [];
    for (const c of addl) {
      if (c?.id) codes.add(normalizeCpvCode(c.id));
    }
  }

  const lots = Array.isArray(release?.tender?.lots) ? release.tender.lots : [];
  for (const lot of lots) {
    const lotClass = lot?.classification?.id;
    if (lotClass) codes.add(normalizeCpvCode(lotClass));
  }

  return Array.from(codes).filter(Boolean);
}

function extractBuyerName(release) {
  if (release?.buyer?.name) return release.buyer.name;
  const parties = Array.isArray(release?.parties) ? release.parties : [];
  const buyerParty = parties.find(
    (p) => Array.isArray(p?.roles) && p.roles.includes("buyer"),
  );
  return buyerParty?.name || null;
}

function buildTenderUrlFromId(noticeId) {
  if (!noticeId) return null;
  return `${FTS_BASE_URL}/Notice/${noticeId}`;
}

function isDeadlineStillOpen(release) {
  const end = release?.tender?.tenderPeriod?.endDate;
  if (!end) return true; // keep if missing deadline (you can tighten later)
  const endDate = new Date(end);
  if (Number.isNaN(endDate.getTime())) return true;
  return endDate.getTime() >= Date.now();
}

function isPublishedWithinKeepWindow(release) {
  // release.date is the release timestamp (often aligns with publish time)
  const published = release?.date;
  if (!published) return true; // if missing, don't drop (rare)
  const d = new Date(published);
  if (Number.isNaN(d.getTime())) return true;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - KEEP_DAYS);
  return d.getTime() >= cutoff.getTime();
}

function mapReleaseToDbTender(release) {
  const id = release?.id; // notice ID like 000109-2026
  const title = release?.tender?.title || null;
  const description =
    release?.tender?.description || release?.description || null;

  const publication_date = release?.date || null;
  const deadline_date = release?.tender?.tenderPeriod?.endDate || null;

  const buyer_name = extractBuyerName(release);
  const cpv_codes = extractCpvCodesFromRelease(release);

  // Your app uses "active" for items shown as live
  const status = "active";

  const tender_url = buildTenderUrlFromId(id);

  return {
    id,
    title,
    description,
    cpv_codes,
    publication_date,
    deadline_date,
    status,
    buyer_name,
    tender_url,
  };
}

function readState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return null;
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return null;
  }
}

function writeState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
  } catch (e) {
    console.warn("⚠️  Could not write state file:", e.message);
  }
}

// API fetch with retries (429/503)
async function fetchJsonWithRetry(url, { maxRetries = 8 } = {}) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "BWS-Tender-Scanner/1.0",
        },
      });

      if (res.status === 429 || res.status === 503) {
        const retryAfter = res.headers.get("retry-after");
        const waitSeconds = retryAfter ? parseInt(retryAfter, 10) : null;
        const waitMs = Number.isFinite(waitSeconds)
          ? waitSeconds * 1000
          : Math.min(30000, 1000 * attempt * 2);

        console.log(
          `   ⏳ API throttled (${res.status}). Waiting ${Math.round(waitMs / 1000)}s...`,
        );
        await sleep(waitMs);
        continue;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`API ${res.status}: ${text.slice(0, 200)}`);
      }

      return await res.json();
    } catch (err) {
      if (attempt === maxRetries) throw err;
      const backoff = Math.min(20000, 500 * attempt * attempt);
      console.log(
        `   ⚠️  API error: ${err.message}. Retrying in ${Math.round(backoff / 1000)}s...`,
      );
      await sleep(backoff);
    }
  }
}

// DB retry wrapper for terminated connections
async function dbWithRetry(fn, { maxRetries = 6 } = {}) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const code = err?.code;
      const msg = String(err?.message || "").toLowerCase();

      const transient =
        code === "57P01" || // terminating connection due to administrator command
        code === "ECONNRESET" ||
        code === "ETIMEDOUT" ||
        code === "EPIPE" ||
        msg.includes("terminating connection") ||
        msg.includes("connection terminated") ||
        msg.includes("server closed the connection") ||
        msg.includes("timeout");

      if (!transient || attempt === maxRetries) throw err;

      const backoff = Math.min(15000, 500 * attempt * attempt);
      console.log(
        `   ⚠️  DB issue (${code || "unknown"}). Retrying in ${Math.round(backoff / 1000)}s...`,
      );
      await sleep(backoff);
    }
  }
}

function buildUpsertQuery(tenders) {
  const cols = [
    "id",
    "title",
    "description",
    "cpv_codes",
    "publication_date",
    "deadline_date",
    "status",
    "buyer_name",
    "tender_url",
  ];

  const values = [];
  const rowsSql = tenders
    .map((t, rowIdx) => {
      const base = rowIdx * cols.length;

      values.push(
        t.id,
        t.title,
        t.description,
        JSON.stringify(t.cpv_codes || []), // store as JSONB
        t.publication_date ? new Date(t.publication_date) : null,
        t.deadline_date ? new Date(t.deadline_date) : null,
        t.status,
        t.buyer_name,
        t.tender_url,
      );

      const ph = cols.map((_, colIdx) => `$${base + colIdx + 1}`);
      return `(${ph.join(", ")})`;
    })
    .join(",\n");

  const sql = `
    INSERT INTO tenders (${cols.join(", ")})
    VALUES
    ${rowsSql}
    ON CONFLICT (id) DO UPDATE SET
      title = EXCLUDED.title,
      description = EXCLUDED.description,
      cpv_codes = EXCLUDED.cpv_codes::jsonb,
      publication_date = EXCLUDED.publication_date,
      deadline_date = EXCLUDED.deadline_date,
      status = EXCLUDED.status,
      buyer_name = EXCLUDED.buyer_name,
      tender_url = EXCLUDED.tender_url
  `;

  return { sql, values };
}

// -------------------------
// Main
// -------------------------

async function main() {
  console.log("🚀 Starting tender fetch...\n");
  console.log("📋 Strategy:");
  console.log(
    "   1) Fetch tender-stage releases using UPDATED window (wider than 3 weeks)",
  );
  console.log(
    "   2) Keep only those PUBLISHED in last 3 weeks AND still open\n",
  );
  console.log(`📅 Today: ${new Date().toLocaleDateString("en-GB")}\n`);
  console.log(`🧲 FETCH_DAYS (updated window): ${FETCH_DAYS} days`);
  console.log(`🎯 KEEP_DAYS (published window): ${KEEP_DAYS} days\n`);

  const pool = new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
    keepAlive: true,
  });

  await dbWithRetry(async () => {
    const c = await pool.connect();
    try {
      await c.query("SELECT 1");
    } finally {
      c.release();
    }
  });

  console.log("✅ Connected to database\n");

  const saved = readState();
  const resumeCursor = process.env.RESUME_CURSOR || saved?.cursor || null;

  const updatedFrom = process.env.UPDATED_FROM || daysAgoNoTz(FETCH_DAYS);
  const updatedTo = process.env.UPDATED_TO || isoNoTz(new Date());

  console.log("⚡ Fetching ALL tenders in 'tender' procurement stage...");
  console.log("⚡ Will filter locally by:");
  console.log("   - deadline not passed");
  console.log(`   - published within last ${KEEP_DAYS} days`);
  console.log(
    `🕒 API UPDATED window: updatedFrom=${updatedFrom} -> updatedTo=${updatedTo}`,
  );
  if (resumeCursor) console.log(`🔁 Resuming from cursor: ${resumeCursor}`);
  console.log("");

  let cursor = resumeCursor;
  let page = 0;

  let totalFetched = 0;
  let totalOpen = 0;
  let totalKept = 0;
  let totalSaved = 0;

  try {
    while (page < MAX_PAGES) {
      page++;

      const url =
        `${FTS_OCDS_ENDPOINT}?limit=${PAGE_LIMIT}` +
        `&stages=${encodeURIComponent(STAGES)}` +
        `&updatedFrom=${encodeURIComponent(updatedFrom)}` +
        `&updatedTo=${encodeURIComponent(updatedTo)}` +
        (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");

      console.log(`📡 Fetching page ${page}...`);

      const data = await fetchJsonWithRetry(url);
      const releases = Array.isArray(data?.releases) ? data.releases : [];
      const nextCursor = data?.cursor || null;

      totalFetched += releases.length;

      // Filter: deadline open
      const open = releases.filter(isDeadlineStillOpen);
      totalOpen += open.length;

      // Filter: published within KEEP_DAYS
      const kept = open.filter(isPublishedWithinKeepWindow);
      totalKept += kept.length;

      // Map to DB rows
      const tenders = kept
        .map(mapReleaseToDbTender)
        .filter((t) => t.id && t.title);

      // Save in DB batches
      let savedThisPage = 0;
      for (let i = 0; i < tenders.length; i += DB_BATCH_SIZE) {
        const batch = tenders.slice(i, i + DB_BATCH_SIZE);

        await dbWithRetry(async () => {
          const client = await pool.connect();
          try {
            const { sql, values } = buildUpsertQuery(batch);
            await client.query(sql, values);
          } finally {
            client.release();
          }
        });

        savedThisPage += batch.length;
        totalSaved += batch.length;
      }

      console.log(
        `   Got ${releases.length} releases (${open.length} still open, ${kept.length} kept, ${totalKept} kept total)`,
      );
      console.log(
        `   💾 Saved/updated ${savedThisPage} tenders this page (${totalSaved} total)\n`,
      );

      writeState({
        cursor: nextCursor,
        page,
        totals: { totalFetched, totalOpen, totalKept, totalSaved },
        lastRun: {
          at: new Date().toISOString(),
          updatedFrom,
          updatedTo,
          stages: STAGES,
          limit: PAGE_LIMIT,
          fetchDays: FETCH_DAYS,
          keepDays: KEEP_DAYS,
        },
      });

      if (!nextCursor || releases.length === 0) {
        console.log("✅ No more pages. Finished.\n");
        break;
      }

      cursor = nextCursor;

      // Small pause to be kind to API + DB
      await sleep(200);
    }

    console.log("📈 FINAL SUMMARY");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`   Total releases fetched: ${totalFetched}`);
    console.log(`   Total open releases: ${totalOpen}`);
    console.log(
      `   Total kept (open + published within ${KEEP_DAYS}d): ${totalKept}`,
    );
    console.log(`   Total saved/updated: ${totalSaved}`);
    console.log(`   Finished at: ${gbDateTime(new Date())}`);
    console.log(
      "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n",
    );
  } catch (err) {
    console.error("❌ Fetch run failed:", err.message);

    const st = readState();
    if (st?.cursor) {
      console.error(
        `\n🔁 Resume with:\nRESUME_CURSOR=${st.cursor} node fetch-and-save-tenders.js\n`,
      );
    }
    process.exitCode = 1;
  } finally {
    try {
      await pool.end();
    } catch {}
  }
}

main();
