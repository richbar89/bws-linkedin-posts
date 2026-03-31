// linkedin-integration.js
const https = require("https");
const querystring = require("querystring");

const CLIENT_ID = process.env.LINKEDIN_CLIENT_ID;
const CLIENT_SECRET = process.env.LINKEDIN_CLIENT_SECRET;
const REDIRECT_URI = process.env.LINKEDIN_REDIRECT_URI;
const ORG_ID = process.env.LINKEDIN_ORG_ID;

let accessToken = null;

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
        "Content-Length": postData.length,
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.access_token) {
            accessToken = parsed.access_token;
            console.log("✅ LinkedIn access token obtained");
            resolve(parsed.access_token);
          } else {
            reject(new Error("No access token: " + data));
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

function postToLinkedIn(postText) {
  if (!accessToken) {
    throw new Error("Not authenticated with LinkedIn");
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

function isAuthenticated() {
  return !!accessToken;
}

module.exports = { getAuthUrl, exchangeCodeForToken, postToLinkedIn, isAuthenticated };
