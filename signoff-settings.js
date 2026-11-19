// signoff-settings.js
// The CTA sign-off rotation (salespeople + CTA lines), editable from the ⚙️
// settings panel. Stored in Postgres so every generation path — the Generate
// button, the daily pipeline writer and the Monday round-up — reads the same
// list. Falls back to DEFAULTS if the DB is unreachable so posts never fail.

const { Client } = require("pg");

const DEFAULTS = {
  // Everyone here is named in every sign-off, shuffled each time...
  members: [
    "James Wignall",
    "Stacey Crawford",
    "Jake Swinburn",
    "Natasha Marshall",
    "James Kerwin",
    "Mike Baron",
  ],
  // ...except the anchor, who always goes last ("… or @Mike Baron"). "" = none.
  anchor: "Mike Baron",
  ctas: [
    "Let @Bid Writing Service manage the entire bid writing process for you...",
    "@Bid Writing Service are an award winning bid writing consultancy, we're excellently positioned to win tenders just like this!",
    "@Bid Writing Service have won over £5.5 billion in contracts for our clients. Join them!",
    "Interested in this tender? @Bid Writing Service can support!",
    "We have a team of expert bid writers at @Bid Writing Service ready to win this one for your company.",
  ],
};

const CONTACT_VERBS = [
  "Contact",
  "Get in touch with",
  "Reach out to",
  "Connect with",
];

const KEY = "signoff_rotation";

async function withClient(fn) {
  const client = new Client({
    connectionString:
      process.env.DATABASE_URL || "postgresql://localhost:5432/tenders",
  });
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_settings (
        key        TEXT PRIMARY KEY,
        value      JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    return await fn(client);
  } finally {
    await client.end();
  }
}

// Trim, drop blanks and duplicates (case-insensitive), cap lengths.
function cleanList(list, maxLen) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const s = String(raw || "").replace(/\s+/g, " ").trim().slice(0, maxLen);
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
  }
  return out;
}

// Returns { settings } or { error } — used by the PUT endpoint.
function validate(input) {
  const members = cleanList(input && input.members, 80).map((n) =>
    n.replace(/^@+/, ""),
  );
  const ctas = cleanList(input && input.ctas, 400);
  let anchor = String((input && input.anchor) || "").replace(/^@+/, "").trim();
  if (members.length === 0) return { error: "Add at least one salesperson" };
  if (ctas.length === 0) return { error: "Add at least one CTA" };
  if (anchor && !members.some((m) => m.toLowerCase() === anchor.toLowerCase()))
    anchor = "";
  else if (anchor)
    anchor = members.find((m) => m.toLowerCase() === anchor.toLowerCase());
  return { settings: { members, anchor, ctas } };
}

async function getSignoffSettings() {
  try {
    const row = await withClient((c) =>
      c.query("SELECT value, updated_at FROM app_settings WHERE key = $1", [KEY]),
    );
    if (row.rows.length === 0) return { ...DEFAULTS, updated_at: null };
    const { settings } = validate(row.rows[0].value);
    return settings
      ? { ...settings, updated_at: row.rows[0].updated_at }
      : { ...DEFAULTS, updated_at: null };
  } catch (err) {
    console.error("⚠️  Sign-off settings unavailable, using defaults:", err.message);
    return { ...DEFAULTS, updated_at: null };
  }
}

async function saveSignoffSettings(input) {
  const { settings, error } = validate(input);
  if (error) return { error };
  await withClient((c) =>
    c.query(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [KEY, JSON.stringify(settings)],
    ),
  );
  return { settings };
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

// "A, B, C or Anchor" — rotating names shuffled, anchor (if any) always last.
function formatNames(settings, { at = true } = {}) {
  const tag = (n) => (at ? "@" + n : n);
  const rotating = settings.members
    .filter((m) => m !== settings.anchor)
    .sort(() => Math.random() - 0.5);
  const names = settings.anchor ? [...rotating, settings.anchor] : rotating;
  if (names.length === 1) return tag(names[0]);
  return names.slice(0, -1).map(tag).join(", ") + " or " + tag(names[names.length - 1]);
}

// The block posts end with: a random CTA line, then "<verb> @A, @B or @C today!"
function buildSignoff(settings) {
  return (
    pick(settings.ctas) +
    "\n\n" +
    pick(CONTACT_VERBS) +
    " " +
    formatNames(settings) +
    " today!"
  );
}

module.exports = {
  DEFAULTS,
  getSignoffSettings,
  saveSignoffSettings,
  buildSignoff,
  formatNames,
};
