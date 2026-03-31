// agents/fetcher.js
// Scores and shortlists tenders for LinkedIn posting

const { Client } = require("pg");

// ============================================================================
// SCORING CONFIGURATION
// ============================================================================

// Priority order for BWS Main page:
// Cleaning > Waste > Electrical > Facilities > Grounds > Civil Eng > M&E > Catering
// Security/Fire/Construction are high-value and have dedicated pages
// Sector is the primary scoring factor (max 20) — value is secondary (max 10)
const SECTOR_PRIORITY = {
  security: 20,
  fire: 18,
  construction: 16,
  cleaning: 16,
  waste: 14,
  electrical: 14,
  facilities: 12,
  grounds: 12,
  water_hygiene: 12,
  domiciliary_care: 12,
  civileng: 10,
  me: 10,
  gas: 10,
  catering: 8,
  pest: 8,
  transport: 6,
  landscaping: 6,
  roadworks: 6,
  legal: 4,
  education: 4,
  it: 4,
  general: 2,
  healthcare: 0, // excluded
};

const LOCATION_SCORE = {
  england: 10,
  scotland: 6,
  wales: 4,
  ireland: 2,
  uk: 5, // unknown/generic
};

// English regions/cities for location detection
const ENGLAND_KEYWORDS = [
  "london",
  "manchester",
  "birmingham",
  "leeds",
  "sheffield",
  "liverpool",
  "bristol",
  "newcastle",
  "nottingham",
  "leicester",
  "coventry",
  "bradford",
  "cardiff",
  "plymouth",
  "wolverhampton",
  "southampton",
  "reading",
  "derby",
  "middlesbrough",
  "luton",
  "bolton",
  "sunderland",
  "norwich",
  "oxford",
  "cambridge",
  "ipswich",
  "brighton",
  "gloucester",
  "exeter",
  "york",
  "england",
  "english",
  "lincolnshire",
  "yorkshire",
  "lancashire",
  "essex",
  "kent",
  "surrey",
  "sussex",
  "norfolk",
  "suffolk",
  "hampshire",
  "berkshire",
  "wiltshire",
  "dorset",
  "somerset",
  "devon",
  "cornwall",
  "cheshire",
  "derbyshire",
  "staffordshire",
  "shropshire",
  "warwickshire",
  "leicestershire",
  "northamptonshire",
  "hertfordshire",
  "bedfordshire",
  "cambridgeshire",
  "cumbria",
  "northumberland",
  "durham",
];

const SCOTLAND_KEYWORDS = [
  "scotland",
  "scottish",
  "glasgow",
  "edinburgh",
  "aberdeen",
  "dundee",
  "inverness",
  "stirling",
  "perth",
];

const WALES_KEYWORDS = [
  "wales",
  "welsh",
  "cardiff",
  "swansea",
  "newport",
  "wrexham",
];

const IRELAND_KEYWORDS = [
  "ireland",
  "irish",
  "northern ireland",
  "belfast",
  "dublin",
  "ni tender",
  "nics",
];

// ============================================================================
// LOCATION DETECTION
// ============================================================================

function detectLocation(tender) {
  const text = [
    tender.title || "",
    tender.buyer_name || "",
    tender.description || "",
  ]
    .join(" ")
    .toLowerCase();

  if (IRELAND_KEYWORDS.some((k) => text.includes(k))) return "ireland";
  if (WALES_KEYWORDS.some((k) => text.includes(k))) return "wales";
  if (SCOTLAND_KEYWORDS.some((k) => text.includes(k))) return "scotland";
  if (ENGLAND_KEYWORDS.some((k) => text.includes(k))) return "england";
  return "uk";
}

// ============================================================================
// SCORING
// ============================================================================

function scoreTender(tender, feedbackHistory = []) {
  const reasons = [];
  let score = 0;

  // --- Hard filters (disqualify entirely) ---
  if (!tender.value_amount || parseFloat(tender.value_amount) <= 0) {
    return { score: -1, disqualified: true, reason: "No contract value" };
  }

  const value = parseFloat(tender.value_amount);
  if (value < 100000) {
    return { score: -1, disqualified: true, reason: "Value below £100k" };
  }

  if (tender.deadline_date) {
    const deadline = new Date(tender.deadline_date);
    const twoWeeksFromNow = new Date();
    twoWeeksFromNow.setDate(twoWeeksFromNow.getDate() + 14);
    if (deadline < twoWeeksFromNow) {
      return { score: -1, disqualified: true, reason: "Deadline < 2 weeks" };
    }
  }

  // Exclude healthcare unless domiciliary care
  const aiCat = (tender.ai_category || "").toLowerCase();
  const title = (tender.title || "").toLowerCase();
  const desc = (tender.description || "").toLowerCase();
  if (
    aiCat === "healthcare" &&
    !title.includes("domiciliary") &&
    !desc.includes("domiciliary") &&
    !title.includes("home care") &&
    !desc.includes("home care")
  ) {
    return { score: -1, disqualified: true, reason: "Healthcare excluded" };
  }

  // --- Value score (0-10) — secondary factor, sector drives ranking ---
  let valueScore = 0;
  if (value >= 5000000) valueScore = 10;
  else if (value >= 1000000) valueScore = 7;
  else if (value >= 500000) valueScore = 4;
  else if (value >= 100000) valueScore = 2;
  score += valueScore;
  reasons.push(`Value £${(value / 1000).toFixed(0)}k → +${valueScore}`);

  // --- Location score (0-10) ---
  const location = detectLocation(tender);
  const locationScore = LOCATION_SCORE[location] || 5;
  score += locationScore;
  reasons.push(`Location: ${location} → +${locationScore}`);

  // --- Sector priority score (0-10) ---
  const industryKey = tender.ai_category
    ? aiCategoryToKey(tender.ai_category)
    : "general";
  const sectorScore = SECTOR_PRIORITY[industryKey] || 3;
  score += sectorScore;
  reasons.push(`Sector: ${industryKey} → +${sectorScore}`);

  // --- Description quality score (0-5) ---
  const descLength = (tender.description || "").length;
  let descScore = 0;
  if (descLength > 500) descScore = 5;
  else if (descLength > 200) descScore = 3;
  else if (descLength > 50) descScore = 1;
  score += descScore;

  // --- Feedback history boost (0-10) ---
  // If similar tenders (same sector, similar value band) were previously selected,
  // boost the score. If they were skipped, reduce it.
  if (feedbackHistory.length > 0) {
    const sectorFeedback = feedbackHistory.filter(
      (f) => f.sector === industryKey,
    );
    const selectedCount = sectorFeedback.filter((f) => f.selected).length;
    const skippedCount = sectorFeedback.filter((f) => !f.selected).length;
    const feedbackBoost = Math.min(10, selectedCount * 2 - skippedCount);
    if (feedbackBoost !== 0) {
      score += feedbackBoost;
      reasons.push(
        `Feedback history → ${feedbackBoost > 0 ? "+" : ""}${feedbackBoost}`,
      );
    }
  }

  return {
    score,
    disqualified: false,
    location,
    industryKey,
    value,
    reasons,
  };
}

function aiCategoryToKey(aiCategory) {
  const map = {
    Security: "security",
    "Fire Safety": "fire",
    Construction: "construction",
    "Civil Engineering": "civileng",
    "M&E": "me",
    "Gas Services": "gas",
    "Water Hygiene": "water_hygiene",
    "Grounds Maintenance": "grounds",
    "Waste Management": "waste",
    Cleaning: "cleaning",
    Catering: "catering",
    "Facilities Management": "facilities",
    Electrical: "electrical",
    Transport: "transport",
    Landscaping: "landscaping",
    "Pest Control": "pest",
    Roadworks: "roadworks",
    "Legal/Law": "legal",
    "Domiciliary Care": "domiciliary_care",
    General: "general",
  };
  return map[aiCategory] || "general";
}

// ============================================================================
// DETERMINE WHICH LINKEDIN PAGES A TENDER GOES TO
// ============================================================================

function getTargetPages(industryKey) {
  // Security and construction go to their dedicated pages only.
  // The pipeline adds "main" for top-scoring tenders.
  if (industryKey === "security") return ["security"];
  if (industryKey === "construction") return ["construction"];
  return ["main"];
}

// ============================================================================
// BUILD POSTING SCHEDULE
// ============================================================================

// Given a list of selected tenders and a date, return scheduled times
// Posts spread hourly between startHour and endHour
function buildSchedule(
  tenders,
  date,
  startHour = 7,
  startMinute = 30,
  endHour = 16,
  endMinute = 30,
) {
  const schedule = [];
  const totalMinutes =
    endHour * 60 + endMinute - (startHour * 60 + startMinute);
  const gap =
    tenders.length > 1 ? Math.floor(totalMinutes / (tenders.length - 1)) : 0;

  tenders.forEach((tender, i) => {
    const postTime = new Date(date);
    const minutesFromStart = i * gap;
    postTime.setHours(startHour, startMinute + minutesFromStart, 0, 0);

    schedule.push({
      tender,
      scheduledAt: postTime,
      pages: getTargetPages(tender.industryKey),
    });
  });

  return schedule;
}

// ============================================================================
// MAIN FETCH + SCORE FUNCTION
// ============================================================================

async function fetchAndScoreTenders(options = {}) {
  const {
    hoursBack = 24,
    maxResults = 15, // return top N for approval UI
  } = options;

  const client = new Client({
    connectionString:
      process.env.DATABASE_URL || "postgresql://localhost:5432/tenders",
  });

  await client.connect();

  try {
    const cutoff = new Date();
    cutoff.setHours(cutoff.getHours() - hoursBack);

    // Fetch recent tenders not yet posted to LinkedIn
    const result = await client.query(
      `SELECT * FROM tenders
       WHERE publication_date >= $1
         AND (linkedin_posted_at IS NULL)
       ORDER BY publication_date DESC`,
      [cutoff.toISOString()],
    );

    const tenders = result.rows;
    console.log(
      `\n📋 Fetched ${tenders.length} tenders from last ${hoursBack}h`,
    );

    // Load feedback history for scoring
    let feedbackHistory = [];
    try {
      const fbResult = await client.query(
        `SELECT sector, selected FROM tender_feedback ORDER BY created_at DESC LIMIT 200`,
      );
      feedbackHistory = fbResult.rows;
    } catch (e) {
      // Table may not exist yet — fine, just skip feedback scoring
    }

    // Score each tender
    const scored = tenders
      .map((tender) => {
        const scoring = scoreTender(tender, feedbackHistory);
        return { tender, ...scoring };
      })
      .filter((t) => !t.disqualified)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);

    console.log(`✅ ${scored.length} tenders passed filters and scored`);

    return scored.map((s) => ({
      id: s.tender.id,
      title: s.tender.title,
      buyer_name: s.tender.buyer_name,
      value_amount: s.tender.value_amount,
      deadline_date: s.tender.deadline_date,
      ai_category: s.tender.ai_category,
      description: s.tender.description,
      tender_url: s.tender.tender_url,
      score: s.score,
      location: s.location,
      industryKey: s.industryKey,
      targetPages: getTargetPages(s.industryKey),
      scoreReasons: s.reasons,
    }));
  } finally {
    await client.end();
  }
}

module.exports = {
  fetchAndScoreTenders,
  scoreTender,
  buildSchedule,
  getTargetPages,
  detectLocation,
};
