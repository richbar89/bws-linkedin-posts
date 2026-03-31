// agents/writer.js
// Takes a shortlisted tender, fetches the live page for extra detail,
// and generates a formatted LinkedIn post via Claude

const Anthropic = require("@anthropic-ai/sdk");
const https = require("https");
const http = require("http");

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const ROTATING_MEMBERS = ["James Wignall", "Stacey Crawford", "Jake Swinburn"];
const TEAM_MEMBERS = [...ROTATING_MEMBERS, "Mike Baron"];

const SIGNOFFS = [
  "Let @Bid Writing Service manage the entire bid writing process for you...",
  "@Bid Writing Service are an award winning bid writing consultancy, we're excellently positioned to win tenders just like this!",
  "@Bid Writing Service have won over £5.5 billion in contracts for our clients. Join them!",
  "Interested in this tender? @Bid Writing Service can support!",
  "We have a team of expert bid writers at @Bid Writing Service ready to win this one for your company.",
];

const CONTACT_VERBS = [
  "Contact",
  "Get in touch with",
  "Reach out to",
  "Connect with",
];

// Convert plain text to Unicode Mathematical Bold characters for LinkedIn bold rendering
function toBold(str) {
  return str
    .split("")
    .map((ch) => {
      const code = ch.charCodeAt(0);
      if (code >= 65 && code <= 90)
        return String.fromCodePoint(0x1d400 + code - 65); // A-Z
      if (code >= 97 && code <= 122)
        return String.fromCodePoint(0x1d41a + code - 97); // a-z
      if (code >= 48 && code <= 57)
        return String.fromCodePoint(0x1d7ce + code - 48); // 0-9
      return ch;
    })
    .join("");
}

// Apply bold formatting to the title line and metadata labels before sending to Buffer
function formatForLinkedIn(text) {
  const lines = text.split("\n");

  // Bold the first non-empty line (the title)
  const titleIndex = lines.findIndex((l) => l.trim().length > 0);
  if (titleIndex !== -1) {
    lines[titleIndex] = toBold(lines[titleIndex]);
  }

  // Bold the metadata labels (label word + colon only)
  const labelPatterns = [
    /^(Value:)/,
    /^(Location:)/,
    /^(Submission Deadline:)/,
    /^(Tender Release Date:)/,
  ];

  for (let i = 0; i < lines.length; i++) {
    for (const pattern of labelPatterns) {
      const match = lines[i].match(pattern);
      if (match) {
        lines[i] = lines[i].replace(match[1], toBold(match[1]));
        break;
      }
    }
  }

  return lines.join("\n");
}

function buildSignoff() {
  const signoff = SIGNOFFS[Math.floor(Math.random() * SIGNOFFS.length)];
  const shuffled = [...ROTATING_MEMBERS].sort(() => Math.random() - 0.5);
  const nameStr = shuffled.map((n) => "@" + n).join(", ") + " or @Mike Baron";
  const verb = CONTACT_VERBS[Math.floor(Math.random() * CONTACT_VERBS.length)];
  return signoff + "\n\n" + verb + " " + nameStr + " today!";
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    mod
      .get(url, { headers: { "User-Agent": "Mozilla/5.0" } }, (res) => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => resolve(data));
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

const EXAMPLE_POST_LIVE = `🚨 NEW TENDER ALERT – Municipal Security Guarding 🚨

Boston Borough Council, South Holland District Council, and East Lindsey District Council are seeking a provider for static guarding and security services across their municipal buildings. The contract is expected to run for 3 years with an option to extend, commencing September 2026.

The procurement is split into three lots:
• Lot 1 – Static guarding for Boston Borough Council (DWP site focus)
• Lot 2 – Static guarding for South Holland District Council (DWP site focus)
• Lot 3 – Broader security package for East Lindsey including incident response, committee meeting security, and alarm response

Bidders can apply for one, two, or all three lots independently.

Value: £1.5m (inc. VAT)
Location: Boston, Spalding & Louth, Lincolnshire
Submission Deadline: 2nd March 2026

@Bid Writing Service have won over £5.5 billion in contracts for our clients. Join them!

Connect with @James Wignall, @Stacey Crawford or @Mike Baron today!`;

const EXAMPLE_POST_PLANNING = `🚨 TENDER INCOMING – Comprehensive Security Services 🚨

Derby City Council and Derby Homes are planning to procure a comprehensive security services contract covering proactive risk identification and mitigation to protect people, property, and assets across council operations. The contract is expected to commence Q3 2026 with an initial term of 5 years.

Key requirements include:
• All personnel must be directly employed (no sub-contracting, except CCTV installation/removal)
• A local operational office is required to ensure responsive management
• Customer-focused service delivery across all council sites

Value: N/A
Location: Derby, Derbyshire
Tender Release Date: 2nd March 2026

Interested in this tender? @Bid Writing Service can support!

Reach out to @Stacey Crawford, @Jake Swinburn or @Mike Baron today!`;

// Generate a LinkedIn post for a single tender
async function writeTenderPost(tender, teamMemberIndex = 0, preloadedContent = null) {
  const signoffBlock = buildSignoff();

  // Use pre-loaded content if provided, otherwise try fetching the live page
  let tenderPageText = preloadedContent || null;
  if (!tenderPageText && tender.tender_url) {
    try {
      console.log("    🌐 Fetching: " + tender.tender_url);
      const html = await fetchUrl(tender.tender_url);
      tenderPageText = stripHtml(html);
      if (tenderPageText.length > 8000)
        tenderPageText = tenderPageText.substring(0, 8000) + "...";
    } catch (e) {
      console.log("    ⚠️  Could not fetch page, using DB data only");
    }
  }

  const categoryName = tender.ai_category || "General";

  const prompt = `You are writing LinkedIn posts for "Bid Writing Service", a company that helps businesses win public tenders.

Here are two example posts — one for a LIVE tender, one for a tender still in PLANNING/pre-market stage:

--- EXAMPLE: LIVE TENDER ---
${EXAMPLE_POST_LIVE}
--- END ---

--- EXAMPLE: PLANNING/INCOMING TENDER ---
${EXAMPLE_POST_PLANNING}
--- END ---

Your job:
1. Read the tender information below
2. Determine whether this tender is LIVE (submissions are currently open) or PLANNING/INCOMING (not yet released for bids)
3. Write the post in the correct format based on that determination

RULES FOR DETERMINING STATUS:
- If the page contains a "Tender submission deadline" that is in the future → it is LIVE
- If the notice type says "Prior Information Notice" or "PIN" or "pre-market" → it is PLANNING
- If there is no submission deadline, or the notice says "planned" → it is PLANNING
- If the submission deadline has already passed → treat as LIVE but note it may be closed

FORMATTING RULES:

TITLE:
- If LIVE: "🚨 NEW TENDER ALERT – [2-4 word descriptive title] 🚨"
- If PLANNING: "🚨 TENDER INCOMING – [2-4 word descriptive title] 🚨"
- The 2-4 word title must describe the actual service/works — NOT just the sector name
- Pick one appropriate sector emoji and use it on BOTH sides of the title (replace BOTH 🚨 with the same emoji). The emoji on the left and right MUST always match. (e.g. 🔒 security, ♻️ waste, 💻 IT, 🏗️ construction, 🏥 healthcare, 💧 water, ⚡ energy)

BODY:
- Start directly with a factual description of the tender — no hype, no urgency language, no phrases like "don't miss this one", "hot off the press", "out NOW", "time to start preparing" etc.
- Write 2–3 SHORT sentences covering: the scope of works, the contracting authority/authorities, and contract duration/start date (only if explicitly stated). Keep it punchy — LinkedIn readers skim. No walls of text, no long dense paragraphs.
- If the tender has LOTS, list each lot as a bullet point (• Lot 1 – ..., • Lot 2 – ..., etc.) — keep each bullet to one line
- Do not invent details — only include duration/start date if explicitly stated in the tender data

METADATA BLOCK (always in this order, each on its own line):
- Value: Search the page content for the contract value including VAT. Look for fields like "Estimated value", "Total value", "Framework value". Format as "£Xm (inc. VAT)" or "£Xk (inc. VAT)". If genuinely unavailable, use "N/A"
- Location: Search the page content carefully for specific location. Look for "Place of performance", "Town", "Region", "Delivery location". Use the most specific location found — town + county if possible. NEVER use just "UK" or "England" if a more specific location appears anywhere in the page.
- If LIVE: "Submission Deadline: [date]" — search the page for: "Submission deadline", "Deadline for receipt of tenders", "Deadline for requests to participate", "Time limit for receipt of tenders"
- If PLANNING: "Tender Release Date: [date]"

SIGN-OFF:
- Copy this sign-off block EXACTLY as written, on its own lines — do not alter a single word:
${signoffBlock}

OTHER RULES:
- Do NOT add hashtags
- Do NOT make up details not in the tender data
- Output ONLY the post. No preamble, no explanations.

TENDER DATA FROM DATABASE:
Title: ${tender.title}
Category: ${categoryName}
Buyer: ${tender.buyer_name || "Not specified"}
DB Status: ${tender.status || "unknown"}
DB Deadline: ${tender.deadline_date || "not set"}
DB Value: ${tender.value_amount || "not set"}
Tender URL: ${tender.tender_url || "N/A"}
Description: ${tender.description || "Not available"}

${
  tenderPageText
    ? "LIVE TENDER PAGE CONTENT (use this as the primary source of truth):\n" +
      tenderPageText
    : "Note: The tender page could not be fetched. Use only the database fields above. Mark Value as N/A and Location as UK if those fields are missing."
}

Write the post now:`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1000,
    messages: [{ role: "user", content: prompt }],
  });

  return formatForLinkedIn(message.content[0].text.trim());
}

// Generate posts for a list of tenders (the approved shortlist)
async function writePostsForShortlist(tenders) {
  const results = [];

  for (let i = 0; i < tenders.length; i++) {
    const tender = tenders[i];
    console.log(
      `  ✍️  [${i + 1}/${tenders.length}] Writing post for: ${(tender.title || "").substring(0, 60)}`,
    );

    try {
      const postText = await writeTenderPost(tender, i);
      results.push({
        id: tender.id,
        title: tender.title,
        post_text: postText,
        success: true,
      });
    } catch (err) {
      console.error(`  ❌ Failed for ${tender.id}: ${err.message}`);
      results.push({
        id: tender.id,
        title: tender.title,
        post_text: null,
        success: false,
        error: err.message,
      });
    }

    // Small delay between API calls
    if (i < tenders.length - 1) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  return results;
}

module.exports = { writeTenderPost, writePostsForShortlist };
