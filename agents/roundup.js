// agents/roundup.js
// Generates Monday morning round-up posts summarising the week's top tenders by category

const Anthropic = require("@anthropic-ai/sdk");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const ROTATING_MEMBERS = ["James Wignall", "Stacey Crawford", "Jake Swinburn"];

const CATEGORY_PAGE_NAMES = {
  security: "Bid Writing Service | Security",
  construction: "Bid Writing Service | Construction",
};

// ---- Unicode bold helpers (same as writer.js / generate-posts.js) ----
function toBold(str) {
  return str
    .split("")
    .map((ch) => {
      const code = ch.charCodeAt(0);
      if (code >= 65 && code <= 90) return String.fromCodePoint(0x1d400 + code - 65); // A-Z
      if (code >= 97 && code <= 122) return String.fromCodePoint(0x1d41a + code - 97); // a-z
      if (code >= 48 && code <= 57) return String.fromCodePoint(0x1d7ce + code - 48); // 0-9
      return ch;
    })
    .join("");
}

function formatValue(amount, currency) {
  if (!amount) return "N/A";
  const symbol = "£";
  const num = parseFloat(amount);
  if (num >= 1000000) {
    const m = (num / 1000000).toFixed(1).replace(/\.0$/, "");
    return `${symbol}${m}m (inc. VAT)`;
  }
  if (num >= 1000) {
    return `${symbol}${Math.round(num / 1000)}k (inc. VAT)`;
  }
  return `${symbol}${num.toLocaleString()} (inc. VAT)`;
}

function formatDate(dateStr) {
  if (!dateStr) return "Not specified";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

// Apply bold formatting to round-up post text
function applyRoundupBold(text) {
  const lines = text.split("\n");
  const firstNonEmpty = lines.findIndex((l) => l.trim().length > 0);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Bold the header (first non-empty line)
    if (i === firstNonEmpty) {
      lines[i] = toBold(line);
      continue;
    }

    // Bold #1, #2... number + title lines
    const numMatch = line.match(/^(#\d+\s+)(.+)$/);
    if (numMatch) {
      lines[i] = toBold(numMatch[1]) + toBold(numMatch[2]);
      continue;
    }

    // Bold metadata labels
    const labelPatterns = [
      /^(Value:)/,
      /^(Location:)/,
      /^(Submission Deadline:)/,
      /^(Tender Release Date:)/,
    ];
    for (const pattern of labelPatterns) {
      const match = line.match(pattern);
      if (match) {
        lines[i] = line.replace(match[1], toBold(match[1]));
        break;
      }
    }
  }

  return lines.join("\n");
}

// Generate a round-up post for a given category from pool tenders
async function generateRoundupPost(tenders, category) {
  // Take 3-5 tenders, sorted by score desc
  const selected = tenders
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 5)
    .slice(0, Math.max(3, tenders.length));

  const count = selected.length;
  const pageName =
    CATEGORY_PAGE_NAMES[category.toLowerCase()] || "Bid Writing Service";

  // Shuffle rotating members, Mike Baron always last
  const shuffled = [...ROTATING_MEMBERS].sort(() => Math.random() - 0.5);
  const nameStr = shuffled.join(", ") + " or Mike Baron";

  // Build tender data for the prompt
  const tenderSummaries = selected
    .map(
      (t, i) =>
        `Tender ${i + 1}:
Title: ${t.title}
Buyer: ${t.buyer_name || "Unknown"}
Value: ${formatValue(t.value_amount, t.value_currency)}
Deadline: ${formatDate(t.deadline_date)}
Description: ${(t.description || "").substring(0, 600)}`,
    )
    .join("\n\n");

  const EXAMPLE = `🚨🚨 4 Live UK Security Tenders 🚨🚨

Last week we posted all 4 of the most exciting new security tenders, all at Bid Writing Service | Security!

Here are all 4...

#1 Security Systems & CCTV Servicing
Hull City Council is seeking a provider for the servicing, maintenance, and upgrades of security systems and CCTV equipment across its properties. This is a critical infrastructure contract to keep council facilities protected and operational.

Value: £300k (inc. VAT)
Location: Hull, East Yorkshire
Submission Deadline: 16th April 2026

#2 Council Security Services
Neath Port Talbot County Borough Council is seeking a security services provider for Beaufort House and Ty Parc Newydd. This contract covers essential security operations to protect council facilities and assets.

Value: £537,000 (inc. VAT)
Location: Neath Port Talbot, Wales
Submission Deadline: 14th April 2026

If you'd like to discuss any of these tenders with our wonderful tender experts, contact James Wignall, Stacey Crawford, Jake Swinburn or Mike Baron`;

  const prompt = `You are writing a Monday morning LinkedIn round-up post for "Bid Writing Service", summarising last week's best ${category} tenders.

Here is an example of the exact format to follow:
---
${EXAMPLE}
---

Now write a round-up post for ${count} ${category} tenders. RULES:
- Header: "🚨🚨 ${count} Live UK ${category} Tenders 🚨🚨"
- Intro line: "Last week we posted all ${count} of the most exciting new ${category.toLowerCase()} tenders, all at ${pageName}!"
- Then: "Here are all ${count}..."
- Each tender as #1, #2, #3 etc with: a short 2-4 word title (describing the actual service), 2-3 sentence description, then Value / Location / Submission Deadline on separate lines
- Sign-off (copy EXACTLY): "If you'd like to discuss any of these tenders with our wonderful tender experts, contact ${nameStr}"
- Do NOT add hashtags
- Do NOT invent details not in the tender data
- Output ONLY the post, no preamble

TENDER DATA:
${tenderSummaries}

Write the post now:`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    messages: [{ role: "user", content: prompt }],
  });

  return applyRoundupBold(message.content[0].text.trim());
}

module.exports = { generateRoundupPost };
