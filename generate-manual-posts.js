// generate-manual-posts.js
// Upgraded post generator — matches the manual LinkedIn post style exactly
//
// TO USE: Drop this file into your Replit project, replacing the existing
// generate-manual-posts.js. It plugs into your existing server.js API route.
//
// What changed:
//   1. Posts now filter OUT any tender with no contract value
//   2. Headline switches between "NEW TENDER ALERT" and "INCOMING TENDER ALERT"
//      based on the tender status
//   3. Each post gets an editorial hook line (rotates randomly)
//   4. The closing CTA rotates through 5 variations, tagging team members
//   5. Metadata block uses bold labels (Value / Location / Deadline) matching
//      the gold-standard manual post style
// ---------------------------------------------------------------------------

const teamMembers = [
  "James Wignall",
  "Stacey Crawford",
  "Mike Baron",
  "Matt Burton",
];

// ---------------------------------------------------------------------------
// HOOK LINES — short punchy openers that sit between the headline and the
// tender description. Rotate randomly per post.
// ---------------------------------------------------------------------------
const hookLines = [
  "This is a big one – worth keeping an eye on.",
  "One to watch – get in early if this is in your wheelhouse.",
  "This could be a great opportunity – time to get preparing!",
  "A strong one just dropped – make sure you don't miss it.",
  "This is worth your attention – act fast.",
  "Exciting opportunity just came through – have a look below.",
  "Another solid tender just landed – could be right up your street.",
  "This one's just been posted – worth a closer look.",
];

// ---------------------------------------------------------------------------
// CLOSING CTA VARIATIONS — rotate through these. Each one tags 2-3 team
// members naturally in the sentence, matching the style from the manual post.
// ---------------------------------------------------------------------------
const ctaVariations = [
  (members) =>
    `Contact ${members[0]}, ${members[1]} or ${members[2]} to discuss how Bid Writing Service can support (or take the lead!) in preparing for this tender opportunity.`,

  (members) =>
    `If this one's on your radar, reach out to ${members[0]} or ${members[1]} – the team at Bid Writing Service would love to help you put together a winning bid.`,

  (members) =>
    `Thinking about going for this? ${members[0]}, ${members[1]} and ${members[2]} are on hand at Bid Writing Service to help you get ahead of the competition.`,

  (members) =>
    `Don't sleep on this one. Contact ${members[0]} or ${members[1]} at Bid Writing Service to talk through how we can help you win.`,

  (members) =>
    `Want to make sure you're in the running? Get in touch with ${members[0]}, ${members[1]} or ${members[2]} – Bid Writing Service can help you put together a standout submission.`,
];

// ---------------------------------------------------------------------------
// STATUS DETECTION
// Determines whether to use "NEW TENDER ALERT" or "INCOMING TENDER ALERT"
// based on keywords in the tender status or description fields.
// ---------------------------------------------------------------------------
function getAlertType(tender) {
  const status = (tender.status || "").toLowerCase();
  const title = (tender.title || "").toLowerCase();
  const desc = (tender.description || "").toLowerCase();
  const combined = `${status} ${title} ${desc}`;

  // If any of these words appear, it's a planned/future tender
  const plannedKeywords = [
    "planned",
    "planning",
    "prior information",
    "pin",
    "pre-market",
    "pre market",
    "preliminary",
    "market engagement",
    "pmen",
    "advance notice",
    "upcoming",
    "future",
    "anticipated",
  ];

  for (const kw of plannedKeywords) {
    if (combined.includes(kw)) return "INCOMING";
  }

  return "NEW";
}

// ---------------------------------------------------------------------------
// VALUE FILTER
// Returns true if the tender has a usable contract value.
// Filters out anything where value is missing, "TBC", "0", or empty.
// ---------------------------------------------------------------------------
function hasValue(tender) {
  const val = (tender.value || tender.contract_value || "").toString().trim();
  if (!val) return false;
  if (val.toLowerCase() === "tbc" || val.toLowerCase() === "value tbc")
    return false;
  if (val === "0" || val === "£0") return false;
  return true;
}

// ---------------------------------------------------------------------------
// FORMAT VALUE
// Cleans up the value string for display. Ensures it has a £ sign.
// ---------------------------------------------------------------------------
function formatValue(tender) {
  let val = (tender.value || tender.contract_value || "").toString().trim();
  // If it doesn't start with £, add it
  if (!val.startsWith("£")) val = "£" + val;
  return val;
}

// ---------------------------------------------------------------------------
// PICK RANDOM ITEMS
// ---------------------------------------------------------------------------
function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickRandomMembers(count = 3) {
  const shuffled = [...teamMembers].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
}

// ---------------------------------------------------------------------------
// MAIN POST GENERATOR
// Takes a tender object and returns a fully formatted LinkedIn post string.
//
// Expected tender object shape (from your database):
// {
//   title: "Security Services to the Museums Security Consortium",
//   description: "The Museums Security Consortium has issued an advance notice...",
//   value: "£102.9million (inc. VAT)",          // or contract_value
//   location: "London",
//   submission_deadline: "2026-04-15",           // or deadline
//   tender_notice_expected: "Early April 2026", // for planned tenders
//   url: "https://www.find-tender.service.gov.uk/Notice/...",
//   status: "planned",                          // or "active", "open", etc.
//   sector: "Security",
// }
// ---------------------------------------------------------------------------
function generatePost(tender) {
  // --- FILTER: skip if no value ---
  if (!hasValue(tender)) {
    return null; // caller should skip this tender
  }

  const alertType = getAlertType(tender);
  const hook = pickRandom(hookLines);
  const members = pickRandomMembers(3);
  const ctaFn = pickRandom(ctaVariations);
  const cta = ctaFn(members);

  // Clean up title — truncate if absurdly long (LinkedIn headline limit)
  let title = (tender.title || "Untitled Tender").trim();
  if (title.length > 120) {
    title = title.substring(0, 117) + "...";
  }

  // Description — use first ~200 chars as the body paragraph if that's all
  // we have, or use the full description
  let body = (tender.description || "").trim();
  // If description ends mid-sentence with "..." that's fine — keep it natural

  // Location
  const location = (tender.location || "").trim();

  // Value (already confirmed it exists)
  const value = formatValue(tender);

  // Deadline / expected date — figure out which label to use
  let deadlineLabel = "";
  let deadlineValue = "";

  if (alertType === "INCOMING") {
    // For planned tenders, use "Tender Notice Expected"
    const expected =
      tender.tender_notice_expected || tender.expected_date || "";
    if (expected) {
      deadlineLabel = "Tender Notice Expected";
      deadlineValue = expected;
    }
  } else {
    // For live tenders, use "Submission Deadline"
    const deadline = tender.submission_deadline || tender.deadline || "";
    if (deadline) {
      deadlineLabel = "Submission Deadline";
      deadlineValue = deadline;
    }
  }

  // URL
  const url = (tender.url || tender.tender_url || "").trim();

  // Hashtags — use sector name, clean it up
  const sector = (tender.sector || "").trim();
  const sectorTag = sector.replace(/[^a-zA-Z0-9]/g, ""); // remove spaces/special chars

  // ---------------------------------------------------------------------------
  // ASSEMBLE THE POST — matching the gold-standard layout exactly:
  //
  // 🚨 [ALERT TYPE] – [Title] 🚨
  //
  // [Hook line]
  //
  // [Description body]
  //
  // **Value**: £X
  // **Location**: Y
  // **Submission Deadline**: Z          (or Tender Notice Expected)
  //
  // [URL]
  //
  // [CTA with tagged team members]
  //
  // #Tenders #[Sector] #BidWriting #Procurement
  // ---------------------------------------------------------------------------

  let post = `🚨 ${alertType} TENDER ALERT – ${title} 🚨\n\n`;

  post += `${hook}\n\n`;

  if (body) {
    post += `${body}\n\n`;
  }

  // Metadata block
  post += `Value: ${value}\n`;
  if (location) {
    post += `Location: ${location}\n`;
  }
  if (deadlineLabel && deadlineValue) {
    post += `${deadlineLabel}: ${deadlineValue}\n`;
  }
  post += `\n`;

  // URL
  if (url) {
    post += `${url}\n\n`;
  }

  // CTA
  post += `${cta}\n\n`;

  // Hashtags
  post += `#Tenders #${sectorTag} #BidWriting #Procurement`;

  return post;
}

// ---------------------------------------------------------------------------
// BATCH GENERATOR
// Takes an array of tenders, returns an array of { tender, post } objects.
// Tenders without a value are automatically excluded.
// ---------------------------------------------------------------------------
function generatePosts(tenders) {
  const results = [];

  for (const tender of tenders) {
    const post = generatePost(tender);
    if (post) {
      results.push({
        tender,
        post,
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// EXPORTS — works with both CommonJS (Node/Replit) and if you ever move to ESM
// ---------------------------------------------------------------------------
module.exports = {
  generatePost,
  generatePosts,
  hasValue,
  getAlertType,
  formatValue,
  hookLines,
  ctaVariations,
  teamMembers,
};
