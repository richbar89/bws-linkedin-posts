// generate-posts.js
// Fetches the live tender page, then uses Claude to generate the LinkedIn post
const Anthropic = require("@anthropic-ai/sdk");
const https = require("https");
const http = require("http");

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

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

// All 3 rotating members appear each time in random order — Mike Baron always last
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

function buildSignoff() {
  // Pick a random sign-off
  const signoff = SIGNOFFS[Math.floor(Math.random() * SIGNOFFS.length)];

  // All 3 rotating members in random order, Mike Baron always last
  const shuffled = [...ROTATING_MEMBERS].sort(() => Math.random() - 0.5);
  const nameStr = shuffled.map((n) => "@" + n).join(", ") + " or @Mike Baron";

  // Pick a random contact verb
  const verb = CONTACT_VERBS[Math.floor(Math.random() * CONTACT_VERBS.length)];

  return signoff + "\n\n" + verb + " " + nameStr + " today!";
}

// ---- Fetch a URL and return the text body ----
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

// ---- Strip HTML to readable text ----
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

async function generatePost(tender, categoryName, teamMember, postIndex) {
  const signoffBlock = buildSignoff();

  // Fetch the live tender page
  let tenderPageText = null;
  if (tender.tender_url) {
    try {
      console.log("    🌐 Fetching tender page: " + tender.tender_url);
      const html = await fetchUrl(tender.tender_url);
      tenderPageText = stripHtml(html);
      if (tenderPageText.length > 8000)
        tenderPageText = tenderPageText.substring(0, 8000) + "...";
    } catch (e) {
      console.log("    ⚠️  Could not fetch tender page, using DB data only");
    }
  }

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
- The 2-4 word title must describe the actual service/works (e.g. "Highway Maintenance Services", "School Catering Contract", "IT Support Procurement") — NOT just the sector name
- Pick one appropriate sector emoji and use it on BOTH sides of the title (replace BOTH 🚨 with the same emoji). The emoji on the left and right MUST always match. (e.g. 🔒 security, ♻️ waste, 💻 IT, 🏗️ construction, 🏥 healthcare, 💧 water, ⚡ energy)

BODY:
- Start directly with a factual description of the tender — no hype, no urgency language, no phrases like "don't miss this one", "hot off the press", "out NOW", "time to start preparing" etc.
- A detailed paragraph covering: the scope of works, the contracting authority/authorities, expected contract duration (if stated), and expected start date (if stated)
- If the tender has LOTS, list each lot as a bullet point (• Lot 1 – ..., • Lot 2 – ..., etc.)
- Do not invent details — only include duration/start date if explicitly stated in the tender data

METADATA BLOCK (always in this order, each on its own line):
- Value: Find the contract value on the page. First look for a field explicitly labelled "Value including VAT" or "Total value including VAT" — if found, format as "£Xm (inc. VAT)". If you only find "Estimated value", "Estimated value excluding VAT", or any figure labelled as excluding VAT, format as "£Xm (exc. VAT)". NEVER add "(inc. VAT)" unless the page explicitly states the value includes VAT. If no value is found at all, use "N/A".
- Location: Search the page content carefully for the most specific location available. Look for "Place of performance", "Town", "Region", "Delivery location", "Nuts code description", and the buyer's address. Use the most specific location found — town + county if possible (e.g. "Derby, Derbyshire"). NEVER use "UK", "United Kingdom", "England", or "GB" as the location — if the only location information is country-level, use "N/A" instead.
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
DB Location: ${tender.delivery_location || "not set"}
Tender URL: ${tender.tender_url || "N/A"}
Description: ${tender.description || "Not available"}

${tenderPageText ? "LIVE TENDER PAGE CONTENT (use this as the primary source of truth):\n" + tenderPageText : "Note: The tender page could not be fetched (e.g. access restricted). You MUST still write the post using ONLY the database fields above. Do not mention that the page was unavailable. Do not ask for more information. Do not refuse. Use the title, buyer, deadline and value from the database to write the best post you can — mark Value as N/A and Location as UK if those fields are missing."}

Write the post now:`;

  try {
    const message = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    });

    const postText = message.content[0].text.trim();
    return { success: true, post_text: postText, team_member: teamMember };
  } catch (error) {
    console.error(
      "❌ Anthropic error for tender " + tender.id + ": " + error.message,
    );
    return { success: false, error: error.message };
  }
}

async function generatePostsForTenders(tenders, categoryName) {
  const results = [];
  for (let i = 0; i < tenders.length; i++) {
    const tender = tenders[i];
    const teamMember = TEAM_MEMBERS[i % TEAM_MEMBERS.length];
    console.log(
      "  📝 Generating post " +
        (i + 1) +
        "/" +
        tenders.length +
        " for: " +
        (tender.title || "").substring(0, 60),
    );
    const result = await generatePost(tender, categoryName, teamMember, i);
    if (result.success) {
      results.push({
        tender_id: tender.id,
        tender_title: tender.title,
        tender_url: tender.tender_url,
        category: categoryName,
        post_text: result.post_text,
        team_member: result.team_member,
      });
    } else {
      console.error("  ⚠️  Skipped tender " + tender.id + ": " + result.error);
    }
    if (i < tenders.length - 1) await new Promise((r) => setTimeout(r, 300));
  }
  return results;
}

module.exports = { generatePost, generatePostsForTenders, TEAM_MEMBERS };
