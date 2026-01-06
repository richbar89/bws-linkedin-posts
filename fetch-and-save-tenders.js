/**
 * fetch-and-save-tenders.js
 *
 * Correct approach to match what you see in the Find-a-Tender WEBSITE search:
 *
 * 1) You provide the exact SEARCH_URL you use manually (with filters like Stage=Tender, published last 3 weeks, etc).
 * 2) Script crawls all pages of that search and extracts Notice IDs (e.g. 000109-2026).
 * 3) For each Notice ID, it fetches structured JSON via:
 *      https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages/{NOTICE_ID}
 *    (This is officially supported by the API docs.)
 * 4) Filters to “live” (deadline not passed) and rolling KEEP_DAYS (default 21).
 * 5) Batch upserts into Postgres with retries (robust on Replit-hosted DBs).
 *
 * Run:
 *   SEARCH_URL="https://www.find-tender.service.gov.uk/...your search..." node fetch-and-save-tenders.js
 *
 * Optional knobs:
 *   KEEP_DAYS=21
 *   MAX_PAGES=999
 *   PAGE_PAUSE_MS=200
 *   API_PAUSE_MS=120
 *   DB_BATCH_SIZE=50
 *   RESUME_PAGE=1
 */

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

// ---------- Config ----------
const FTS_BASE_URL =
  process.env.FTS_BASE_URL || "https://www.find-tender.service.gov.uk";
const OCDS_BY_NOTICE_ENDPOINT = `${FTS_BASE_URL}/api/1.0/ocdsReleasePackages`;

const SEARCH_URL = process.env.SEARCH_URL; // REQUIRED

const KEEP_DAYS = parseInt(process.env.KEEP_DAYS || "21", 10);
const MAX_PAGES = parseInt(process.env.MAX_PAGES || "2000", 10);
const RESUME_PAGE = parseInt(process.env.RESUME_PAGE || "1", 10);

const PAGE_PAUSE_MS = parseInt(process.env.PAGE_PAUSE_MS || "200", 10);
const API_PAUSE_MS = parseInt(process.env.API_PAUSE_MS || "120", 10);
const DB_BATCH_SIZE = Math.min(
  Math.max(parseInt(process.env.DB_BATCH_SIZE || "50", 10), 10),
  200,
);

const connectionString =
  process.env.DATABASE_URL ||
  process.env.LOCAL_DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:5432/tenders";

const STATE_FILE = path.join(process.cwd(), ".tender_fetch_state.json");

// ---------- Helpers ----------
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function gbDateTime(x) {
  try {
    return new Date(x).toLocaleString("en-GB");
  } catch {
    return String(x);
  }
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
  if (!end) return true; // keep if missing deadline
  const endDate = new Date(end);
  if (Number.isNaN(endDate.getTime())) return true;
  return endDate.getTime() >= Date.now();
}

function isWithinKeepDays(release) {
  const published = release?.date; // OCDS release date (typically aligns to publication/update)
  if (!published) return true;
  const d = new Date(published);
  if (Number.isNaN(d.getTime())) return true;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - KEEP_DAYS);
  return d.getTime() >= cutoff.getTime();
}

function mapReleaseToDbTender(release) {
  const id = release?.id; // notice id like 000109-2026
  const title = release?.tender?.title || null;
  const description =
    release?.tender?.description || release?.description || null;

  const publication_date = release?.date || null;
  const deadline_date = release?.tender?.tenderPeriod?.endDate || null;

  const buyer_name = extractBuyerName(release);
  const cpv_codes = extractCpvCodesFromRelease(release);

  // We only store "live bid-able" results for your front end
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

function ensureSearchUrlHasPage(url, pageNum) {
  const u = new URL(url);

  // Common patterns:
  // - ?p=1
  // - ?page=1
  // We’ll prefer p, but support either.
  if (u.searchParams.has("p")) {
    u.searchParams.set("p", String(pageNum));
    return u.toString();
  }
  if (u.searchParams.has("page")) {
    u.searchParams.set("page", String(pageNum));
    return u.toString();
  }

  // If neither exists, add p=
  u.searchParams.set("p", String(pageNum));
  return u.toString();
}

function extractNoticeIdsFromHtml(html) {
  // Find-a-Tender notice links look like /Notice/000109-2026
  const re = /\/Notice\/(\d{6}-\d{4})/g;
  const ids = new Set();
  let m;
  while ((m = re.exec(html)) !== null) {
    ids.add(m[1]);
  }
  return Array.from(ids);
}

async function fetchTextWithRetry(url, { maxRetries = 8 } = {}) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "BWS-Tender-Scanner/1.0",
          Accept: "text/html,*/*",
        },
      });

      if (res.status === 429 || res.status === 503) {
        const retryAfter = res.headers.get("retry-after");
        const waitSeconds = retryAfter ? parseInt(retryAfter, 10) : null;
        const waitMs = Number.isFinite(waitSeconds)
          ? waitSeconds * 1000
          : Math.min(30000, 1000 * attempt * 2);
        console.log(
          `   ⏳ Throttled (${res.status}). Waiting ${Math.round(waitMs / 1000)}s...`,
        );
        await sleep(waitMs);
        continue;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      }

      return await res.text();
    } catch (err) {
      if (attempt === maxRetries) throw err;
      const backoff = Math.min(20000, 500 * attempt * attempt);
      console.log(
        `   ⚠️  Page fetch error: ${err.message}. Retrying in ${Math.round(backoff / 1000)}s...`,
      );
      await sleep(backoff);
    }
  }
}

async function fetchJsonWithRetry(url, { maxRetries = 8 } = {}) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "BWS-Tender-Scanner/1.0",
          Accept: "application/json",
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

async function dbWithRetry(fn, { maxRetries = 6 } = {}) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const code = err?.code;
      const msg = String(err?.message || "").toLowerCase();

      const transient =
        code === "57P01" ||
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
        JSON.stringify(t.cpv_codes || []),
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

// ---------- Main ----------
async function main() {
  if (!SEARCH_URL) {
    console.error(
      '\n❌ Missing SEARCH_URL.\n\nRun like:\nSEARCH_URL="<your Find-a-Tender search URL>" node fetch-and-save-tenders.js\n',
    );
    process.exit(1);
  }

  console.log("🚀 Starting tender fetch (MATCH WEBSITE SEARCH)...\n");
  console.log(`📅 Today: ${new Date().toLocaleDateString("en-GB")}`);
  console.log(`🔎 SEARCH_URL: ${SEARCH_URL}`);
  console.log(
    `🎯 Keeping only: deadline not passed + published within last ${KEEP_DAYS} days\n`,
  );

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

  const state = readState();
  const startPage = parseInt(
    process.env.RESUME_PAGE || state?.page || RESUME_PAGE,
    10,
  );

  let page = startPage;
  let allNoticeIds = [];
  const seen = new Set();

  console.log(`📚 Crawling search pages starting at page ${startPage}...\n`);

  while (page <= MAX_PAGES) {
    const pageUrl = ensureSearchUrlHasPage(SEARCH_URL, page);

    console.log(`📄 Page ${page}: ${pageUrl}`);

    const html = await fetchTextWithRetry(pageUrl);
    const ids = extractNoticeIdsFromHtml(html);

    // If a page has 0 IDs, we've hit the end (or the HTML layout changed)
    if (ids.length === 0) {
      console.log(
        "🛑 No notice IDs found on this page. Stopping pagination.\n",
      );
      break;
    }

    let newCount = 0;
    for (const id of ids) {
      if (!seen.has(id)) {
        seen.add(id);
        allNoticeIds.push(id);
        newCount++;
      }
    }

    console.log(
      `   ✅ Found ${ids.length} IDs (${newCount} new). Total unique IDs: ${allNoticeIds.length}\n`,
    );

    writeState({
      page,
      totalIds: allNoticeIds.length,
      lastRun: { at: new Date().toISOString(), searchUrl: SEARCH_URL },
    });

    page++;
    await sleep(PAGE_PAUSE_MS);
  }

  console.log("📌 Finished crawling search pages.");
  console.log(`📦 Total unique notice IDs collected: ${allNoticeIds.length}\n`);

  console.log("⚡ Fetching OCDS JSON per notice ID and saving to DB...\n");

  let processed = 0;
  let kept = 0;
  let saved = 0;

  // Process in chunks to avoid hammering API/DB
  const NOTICE_BATCH = 25;

  for (let i = 0; i < allNoticeIds.length; i += NOTICE_BATCH) {
    const chunk = allNoticeIds.slice(i, i + NOTICE_BATCH);

    const tendersToSave = [];

    for (const noticeId of chunk) {
      const url = `${OCDS_BY_NOTICE_ENDPOINT}/${noticeId}`;

      const pkg = await fetchJsonWithRetry(url);
      const releases = Array.isArray(pkg?.releases) ? pkg.releases : [];
      const release = releases[0];

      processed++;

      if (!release) continue;

      // “Live” + rolling window filters
      if (!isDeadlineStillOpen(release)) continue;
      if (!isWithinKeepDays(release)) continue;

      kept++;
      tendersToSave.push(mapReleaseToDbTender(release));

      await sleep(API_PAUSE_MS);
    }

    // Save mapped tenders in DB batches
    for (let j = 0; j < tendersToSave.length; j += DB_BATCH_SIZE) {
      const batch = tendersToSave.slice(j, j + DB_BATCH_SIZE);

      if (batch.length === 0) continue;

      await dbWithRetry(async () => {
        const client = await pool.connect();
        try {
          const { sql, values } = buildUpsertQuery(batch);
          await client.query(sql, values);
        } finally {
          client.release();
        }
      });

      saved += batch.length;
    }

    console.log(
      `📦 Chunk ${Math.floor(i / NOTICE_BATCH) + 1}: processed ${Math.min(i + NOTICE_BATCH, allNoticeIds.length)}/${allNoticeIds.length} | kept ${kept} | saved ${saved}`,
    );
  }

  console.log("\n📈 FINAL SUMMARY");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`   Notice IDs collected: ${allNoticeIds.length}`);
  console.log(`   Notices processed (JSON fetched): ${processed}`);
  console.log(`   Kept (live + within ${KEEP_DAYS}d): ${kept}`);
  console.log(`   Saved/updated: ${saved}`);
  console.log(`   Finished at: ${gbDateTime(new Date())}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  await pool.end();
}

main().catch((e) => {
  console.error("❌ Fatal error:", e.message);
  process.exit(1);
});
