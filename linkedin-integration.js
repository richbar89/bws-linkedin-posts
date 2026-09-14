// linkedin-integration.js
// LinkedIn OAuth + posting. The access token is persisted in Postgres (app_kv)
// because serverless instances are ephemeral — an in-memory token dies on
// every cold start, which made the connection appear to "keep failing".
const https = require("https");
const querystring = require("querystring");
const { Client } = require("pg");

const CLIENT_ID = process.env.LINKEDIN_CLIENT_ID;
const CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET;
const REDIRECT_URI = process.env.LINKEDIN_REDIRECT_URI;
const ORG_ID = process.env.LINKEDIN_ORG_ID;

let cache = null; // { token, expiresAt } — per-instance cache over the DB copy

async function withDb(fn) {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  try {
    await c.query(
      "CREATE TABLE IF NOT EXISTS app_kv (k text PRIMARY KEY, v text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())"
    );
    return await fn(c);
  } finally {
    await c.end();
  }
}

async function saveToken(token, expiresInSeconds) {
  const expiresAt = Date.now() + (expiresInSeconds || 60 * 24 * 3600) * 1000;
  cache = { token, expiresAt };
  await withDb((c) =>
    c.query(
      `INSERT INTO app_kv (k, v) VALUES ('linkedin_token', $1)
       ON CONFLICT (k) DO UPDATE SET v = $1, updated_at = now()`,
      [JSON.stringify({ token, expiresAt })]
    )
  );
}

async function loadToken() {
  if (cache && cache.expiresAt > Date.now()) return cache.token;
  try {
    const row = await withDb(async (c) => {
      const r = await c.query("SELECT v FROM app_kv WHERE k = 'linkedin_token'");
      return r.rows[0];
    });
    if (!row) return null;
    const parsed = JSON.parse(row.v);
    if (parsed.expiresAt <= Date.now()) return null; // expired — reconnect needed
    cache = parsed;
    return parsed.token;
  } catch (e) {
    console.error("linkedin token load failed:", e.message);
    return null;
  }
}

function getAuthUrl() {
  const params = querystring.stringify({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: "w_organization_social r_organization_social",
  });
  return `https://www.linkedin.com/oauth/v2/authorization?${params}`;
}

function exchangeCodeForToken(code) {
  return new Promise((resolve, reject) => {
    const postData = querystring.stringify({
      grant_type: "authorization_code",
      code: code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
    });

    const options = {
      hostname: "www.linkedin.com",
      path: "/oauth/v2/accessToken",
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.access_token) {
            saveToken(parsed.access_token, parsed.expires_in)
              .then(() => resolve(parsed.access_token))
              .catch((e) => {
                console.error("token save failed:", e.message);
                resolve(parsed.access_token); // still usable this instance
              });
          } else {
            reject(new Error("No access token in response: " + data));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on("error", reject);
    req.write(postData);
    req.end();
  });
}

async function postToLinkedIn(postText) {
  const accessToken = await loadToken();
  if (!accessToken) {
    throw new Error("Not authenticated with LinkedIn — reconnect via /auth/linkedin");
  }

  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      author: "urn:li:organization:" + ORG_ID,
      commentary: postText,
      visibility: "PUBLIC",
      distribution: {
        feedDistribution: "MAIN_FEED",
        targetEntities: [],
        thirdPartyDistributionChannels: []
      },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false
    });

    const options = {
      hostname: "api.linkedin.com",
      path: "/rest/posts",
      method: "POST",
      headers: {
        "Authorization": "Bearer " + accessToken,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
        "LinkedIn-Version": "202401",
        "X-Restli-Protocol-Version": "2.0.0"
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log("✅ Posted to LinkedIn");
          resolve({ success: true, data: data });
        } else {
          console.error("❌ LinkedIn error:", res.statusCode, data);
          reject(new Error("LinkedIn API error " + res.statusCode + ": " + data));
        }
      });
    });

    req.on("error", reject);
    req.write(postData);
    req.end();
  });
}

async function isAuthenticated() {
  return !!(await loadToken());
}

module.exports = { getAuthUrl, exchangeCodeForToken, postToLinkedIn, isAuthenticated };
