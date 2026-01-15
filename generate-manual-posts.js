// LinkedIn Post Generator - Manual Copy/Paste Version
// Creates formatted posts in a text file - just copy and paste to LinkedIn!

const { Client } = require("pg");
const fs = require("fs").promises;

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  POSTS_PER_SECTOR: 5, // How many posts per sector to generate
  OUTPUT_FILE: "./linkedin_posts_to_copy.txt",
  HTML_FILE: "./linkedin_posts_to_copy.html",
};

// Team members to rotate through
const TEAM_MEMBERS = [
  "Matt Burton",
  "James Wignall",
  "Stacey Crawford",
  "Mike Baron",
];

// Industry definitions (from your server.js)
const INDUSTRIES = {
  healthcare: {
    name: "Healthcare",
    cpvCodes: [
      "33100000",
      "33600000",
      "33140000",
      "85100000",
      "85110000",
      "85120000",
      "85140000",
    ],
  },
  recruitment: {
    name: "Recruitment",
    cpvCodes: ["79600000", "79610000", "79620000", "79630000"],
  },
  construction: {
    name: "Construction Work",
    cpvCodes: ["45210000", "45220000", "45260000", "45300000", "45400000"],
  },
  waste: {
    name: "Waste Management",
    cpvCodes: [
      "90500000",
      "90510000",
      "90511000",
      "90512000",
      "90513000",
      "90514000",
    ],
  },
  gas: {
    name: "Gas Servicing",
    cpvCodes: ["45331100", "45331210", "50720000"],
  },
  fire: {
    name: "Fire Safety",
    cpvCodes: ["35110000", "35111000", "50413200"],
  },
  it: {
    name: "IT",
    cpvCodes: [
      "48000000",
      "48100000",
      "48200000",
      "48800000",
      "72000000",
      "72200000",
      "72400000",
      "72500000",
    ],
  },
  grounds: {
    name: "Grounds Maintenance",
    cpvCodes: ["77300000", "77310000", "77314100", "77340000"],
  },
  electrical: {
    name: "Electrical Services",
    cpvCodes: [
      "45310000",
      "45311000",
      "45312000",
      "45314000",
      "45315000",
      "50700000",
    ],
  },
  education: {
    name: "Education",
    cpvCodes: [
      "80100000",
      "80200000",
      "80300000",
      "80400000",
      "80500000",
      "80510000",
    ],
  },
  me: {
    name: "M&E",
    cpvCodes: [
      "45300000",
      "45310000",
      "45320000",
      "45330000",
      "45331000",
      "45332000",
      "50700000",
    ],
  },
  cleaning: {
    name: "Cleaning",
    cpvCodes: ["90910000", "90911000", "90919000", "90620000"],
  },
  architect: {
    name: "Architect",
    cpvCodes: ["71200000", "71220000", "71221000", "71222000"],
  },
  civileng: {
    name: "Civil Engineering",
    cpvCodes: ["45221000", "45230000", "71300000", "71320000", "71330000"],
  },
  catering: {
    name: "Catering",
    cpvCodes: [
      "55300000",
      "55320000",
      "55321000",
      "55322000",
      "55500000",
      "55520000",
      "55521000",
    ],
  },
  security: {
    name: "Security",
    cpvCodes: [
      "79700000",
      "79710000",
      "79711000",
      "79713000",
      "79714000",
      "79715000",
    ],
  },
  facilities: {
    name: "Facilities Management",
    cpvCodes: ["98300000", "50800000", "70300000"],
  },
  pest: {
    name: "Pest Control",
    cpvCodes: ["90920000", "90921000", "90922000", "90923000", "90924000"],
  },
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function normalizeCpvCode(cpv) {
  if (!cpv) return "";
  const cpvStr = String(cpv).replace(/-/g, "");
  return cpvStr.substring(0, 8);
}

function cpvCodesMatch(cpv1, cpv2) {
  const cpv1Normalized = normalizeCpvCode(cpv1);
  const cpv2Normalized = normalizeCpvCode(cpv2);

  if (!cpv1Normalized || !cpv2Normalized) return false;
  if (cpv1Normalized === cpv2Normalized) return true;

  if (cpv1Normalized.length >= 6 && cpv2Normalized.length >= 6) {
    if (cpv1Normalized.substring(0, 6) === cpv2Normalized.substring(0, 6))
      return true;
  }

  if (cpv1Normalized.length >= 5 && cpv2Normalized.length >= 5) {
    if (cpv1Normalized.substring(0, 5) === cpv2Normalized.substring(0, 5))
      return true;
  }

  return false;
}

function extractLocation(description, buyerName) {
  const locationPatterns = [
    /in ([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/,
    /Location:\s*([A-Za-z\s,&]+)/i,
    /\(([A-Z][a-z]+(?:\s*[&/]\s*[A-Z][a-z]+)*)\)/,
  ];

  for (const pattern of locationPatterns) {
    const match = description?.match(pattern);
    if (match) return match[1].trim();
  }

  if (buyerName) {
    const namePatterns = [
      /([A-Z][a-z]+)\s+(?:Council|Borough|City|County)/i,
      /(?:Council|Borough|City|County)\s+of\s+([A-Z][a-z]+)/i,
    ];

    for (const pattern of namePatterns) {
      const match = buyerName.match(pattern);
      if (match) return match[1].trim();
    }
  }

  return "UK";
}

function extractValue(title, description) {
  const valuePatterns = [
    /£([\d,]+(?:\.\d+)?)\s*(million|m)/i,
    /£([\d,]+)k/i,
    /value[:\s]+£([\d,]+(?:\.\d+)?)\s*(million|m)?/i,
    /contract value[:\s]+£([\d,]+(?:\.\d+)?)\s*(million|m)?/i,
  ];

  const text = `${title} ${description}`;

  for (const pattern of valuePatterns) {
    const match = text.match(pattern);
    if (match) {
      const value = match[1];
      const unit = match[2]?.toLowerCase();

      if (unit === "million" || unit === "m") {
        return `£${value} million (inc. VAT)`;
      } else if (unit === "k") {
        return `£${value}k (inc. VAT)`;
      }
    }
  }

  return null;
}

function formatDate(dateString) {
  if (!dateString) return null;

  const date = new Date(dateString);
  const day = date.getDate();
  const month = date.toLocaleString("en-GB", { month: "long" });
  const year = date.getFullYear();

  const suffix = ["th", "st", "nd", "rd"][
    day % 10 > 3 || [11, 12, 13].includes(day % 100) ? 0 : day % 10
  ];

  return `${day}${suffix} ${month} ${year}`;
}

function createSummary(description) {
  if (!description) return "";

  let summary = description.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();

  const sentences = summary.match(/[^.!?]+[.!?]+/g) || [summary];
  const firstSentences = sentences.slice(0, 3).join(" ");

  if (firstSentences.length > 250) {
    return firstSentences.substring(0, 247) + "...";
  }

  return firstSentences;
}

function getRandomTeamMember(index) {
  return TEAM_MEMBERS[index % TEAM_MEMBERS.length];
}

function createLinkedInPost(tender, sectorName, teamMember) {
  const title = tender.title;
  const summary = createSummary(tender.description);
  const value = extractValue(tender.title, tender.description);
  const location = extractLocation(tender.description, tender.buyer_name);
  const deadline = formatDate(tender.deadline_date);
  const tenderUrl = tender.tender_url;

  // Format like your screenshot
  let post = `🚨 NEW TENDER ALERT – ${title} 🚨\n\n`;
  post += `${summary}\n\n`;

  if (value) {
    post += `Value: ${value}\n`;
  }

  post += `Location: ${location}\n`;

  if (deadline) {
    post += `Submission Deadline: ${deadline}\n`;
  }

  post += `\n${tenderUrl}\n\n`;
  post += `To discuss how Bid Writing Service can help your company win tenders just like this, contact ${teamMember}.\n\n`;
  post += `#Tenders #${sectorName.replace(/\s+/g, "")} #BidWriting #Procurement`;

  return post;
}

// ============================================================================
// DATABASE FUNCTIONS
// ============================================================================

async function getDbClient() {
  const client = new Client({
    connectionString:
      process.env.DATABASE_URL || "postgresql://localhost:5432/tenders",
  });
  await client.connect();
  return client;
}

async function getTendersBySector(client, industryCpvCodes, limit = 5) {
  const tendersResult = await client.query(
    "SELECT * FROM tenders ORDER BY publication_date DESC",
  );

  const matchingTenders = [];

  for (const tender of tendersResult.rows) {
    let tenderCpvCodes = [];

    if (typeof tender.cpv_codes === "string") {
      try {
        tenderCpvCodes = JSON.parse(tender.cpv_codes);
      } catch (e) {
        continue;
      }
    } else if (Array.isArray(tender.cpv_codes)) {
      tenderCpvCodes = tender.cpv_codes;
    } else if (
      typeof tender.cpv_codes === "object" &&
      tender.cpv_codes !== null
    ) {
      tenderCpvCodes = Object.values(tender.cpv_codes);
    }

    if (!Array.isArray(tenderCpvCodes) || tenderCpvCodes.length === 0) continue;

    let hasMatch = false;
    for (const industryCpv of industryCpvCodes) {
      for (const tenderCpv of tenderCpvCodes) {
        if (!tenderCpv) continue;
        if (cpvCodesMatch(industryCpv, tenderCpv)) {
          hasMatch = true;
          break;
        }
      }
      if (hasMatch) break;
    }

    if (hasMatch) {
      matchingTenders.push(tender);

      if (matchingTenders.length >= limit) break;
    }
  }

  return matchingTenders;
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

async function generateManualPosts() {
  console.log("\n" + "=".repeat(70));
  console.log("📝 LINKEDIN POST GENERATOR - MANUAL COPY/PASTE");
  console.log("=".repeat(70) + "\n");

  const client = await getDbClient();
  console.log("✅ Connected to database\n");

  try {
    let textOutput = "";
    let htmlOutput = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>LinkedIn Posts - Copy & Paste</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      max-width: 900px;
      margin: 40px auto;
      padding: 20px;
      background: #f5f5f5;
    }
    h1 {
      color: #0077b5;
      text-align: center;
    }
    .post {
      background: white;
      border: 1px solid #ddd;
      border-radius: 8px;
      padding: 20px;
      margin: 20px 0;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .post-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 15px;
      padding-bottom: 10px;
      border-bottom: 2px solid #0077b5;
    }
    .sector {
      font-weight: bold;
      color: #0077b5;
      font-size: 18px;
    }
    .page-name {
      color: #666;
      font-size: 14px;
    }
    .post-content {
      white-space: pre-wrap;
      font-family: 'Segoe UI', Arial, sans-serif;
      line-height: 1.6;
      background: #fafafa;
      padding: 15px;
      border-radius: 4px;
      border-left: 4px solid #0077b5;
    }
    .copy-btn {
      background: #0077b5;
      color: white;
      border: none;
      padding: 10px 20px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
      margin-top: 10px;
    }
    .copy-btn:hover {
      background: #005885;
    }
    .copy-btn:active {
      background: #004466;
    }
    .copied {
      background: #28a745 !important;
    }
    .stats {
      background: white;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 30px;
      text-align: center;
    }
    .stat {
      display: inline-block;
      margin: 0 20px;
    }
    .stat-number {
      font-size: 32px;
      font-weight: bold;
      color: #0077b5;
    }
    .stat-label {
      color: #666;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <h1>📱 LinkedIn Posts Ready to Copy</h1>
  <div class="stats">
    <div class="stat">
      <div class="stat-number" id="totalPosts">0</div>
      <div class="stat-label">Total Posts</div>
    </div>
    <div class="stat">
      <div class="stat-number" id="totalSectors">18</div>
      <div class="stat-label">Sectors</div>
    </div>
  </div>
`;

    let totalPosts = 0;
    let teamMemberIndex = 0;
    let allPosts = [];

    // Process each sector
    for (const [industryKey, industry] of Object.entries(INDUSTRIES)) {
      console.log(`📊 Processing: ${industry.name}`);

      const tenders = await getTendersBySector(
        client,
        industry.cpvCodes,
        CONFIG.POSTS_PER_SECTOR,
      );

      if (tenders.length === 0) {
        console.log(`   ⚠️  No tenders found\n`);
        continue;
      }

      console.log(`   ✅ Found ${tenders.length} tenders`);

      for (const tender of tenders) {
        const teamMember = getRandomTeamMember(teamMemberIndex);
        const post = createLinkedInPost(tender, industry.name, teamMember);

        allPosts.push({
          sector: industry.name,
          pageName: `Bid Writing Service | ${industry.name}`,
          post: post,
          teamMember: teamMember,
          title: tender.title,
        });

        teamMemberIndex++;
        totalPosts++;
      }

      console.log("");
    }

    // Sort posts randomly to mix sectors
    allPosts.sort(() => Math.random() - 0.5);

    // Generate text output
    textOutput += "=".repeat(70) + "\n";
    textOutput += "LINKEDIN POSTS - COPY & PASTE THESE\n";
    textOutput += "=".repeat(70) + "\n";
    textOutput += `Generated: ${new Date().toLocaleString("en-GB")}\n`;
    textOutput += `Total Posts: ${totalPosts}\n`;
    textOutput += "=".repeat(70) + "\n\n";

    for (let i = 0; i < allPosts.length; i++) {
      const postData = allPosts[i];

      // Text version
      textOutput += `\n${"=".repeat(70)}\n`;
      textOutput += `POST ${i + 1} of ${totalPosts}\n`;
      textOutput += `${"=".repeat(70)}\n`;
      textOutput += `📄 Page: ${postData.pageName}\n`;
      textOutput += `👤 Team Member: ${postData.teamMember}\n`;
      textOutput += `📋 Title: ${postData.title.substring(0, 60)}...\n`;
      textOutput += `${"-".repeat(70)}\n\n`;
      textOutput += postData.post;
      textOutput += `\n\n${"-".repeat(70)}\n`;
      textOutput += "👆 COPY THE TEXT ABOVE 👆\n";
      textOutput += `${"-".repeat(70)}\n\n`;

      // HTML version with copy button
      htmlOutput += `
  <div class="post">
    <div class="post-header">
      <div>
        <div class="sector">${postData.sector}</div>
        <div class="page-name">${postData.pageName}</div>
      </div>
      <div style="text-align: right;">
        <div style="color: #666; font-size: 12px;">Post ${i + 1} of ${totalPosts}</div>
        <div style="color: #999; font-size: 12px;">👤 ${postData.teamMember}</div>
      </div>
    </div>
    <div class="post-content" id="post-${i}">${postData.post.replace(/\n/g, "<br>")}</div>
    <button class="copy-btn" onclick="copyPost(${i})">📋 Copy to Clipboard</button>
  </div>
`;
    }

    htmlOutput += `
  <script>
    document.getElementById('totalPosts').textContent = ${totalPosts};

    function copyPost(index) {
      const postElement = document.getElementById('post-' + index);
      const text = postElement.innerText;

      navigator.clipboard.writeText(text).then(() => {
        const btn = event.target;
        btn.textContent = '✅ Copied!';
        btn.classList.add('copied');

        setTimeout(() => {
          btn.textContent = '📋 Copy to Clipboard';
          btn.classList.remove('copied');
        }, 2000);
      });
    }
  </script>
</body>
</html>
`;

    // Save files
    await fs.writeFile(CONFIG.OUTPUT_FILE, textOutput, "utf-8");
    await fs.writeFile(CONFIG.HTML_FILE, htmlOutput, "utf-8");

    // Summary
    console.log("=".repeat(70));
    console.log("✅ GENERATION COMPLETE");
    console.log("=".repeat(70));
    console.log(`   Total posts: ${totalPosts}`);
    console.log(`   Sectors covered: ${Object.keys(INDUSTRIES).length}`);
    console.log(`\n   📄 Text file: ${CONFIG.OUTPUT_FILE}`);
    console.log(`   🌐 HTML file: ${CONFIG.HTML_FILE}`);
    console.log(
      "\n💡 Open the HTML file in your browser for easy copy/paste!\n",
    );
    console.log("=".repeat(70) + "\n");
  } catch (error) {
    console.error("\n❌ ERROR:", error.message);
    console.error(error.stack);
  } finally {
    await client.end();
  }
}

// Run if called directly
if (require.main === module) {
  generateManualPosts().catch(console.error);
}

module.exports = { generateManualPosts };
