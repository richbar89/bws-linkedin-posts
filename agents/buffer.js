// agents/buffer.js
// Handles all Buffer GraphQL API interactions

const BUFFER_API = "https://api.buffer.com/graphql";
const ORG_ID = "69b6af11e4bc4b63e1f66953";

const LINKEDIN_PAGES = {
  main: { id: "69b6b0007be9f8b1715b02ae", name: "Bid Writing Service" },
  security: { id: "69b6b0007be9f8b1715b02b0", name: "BWS | Security" },
  construction: { id: "69b6b1527be9f8b1715b0875", name: "BWS | Construction" },
};

function getToken() {
  const token = process.env.BUFFER_ACCESS_TOKEN;
  if (!token) throw new Error("BUFFER_ACCESS_TOKEN not set");
  return token;
}

async function bufferQuery(query, variables = {}) {
  const response = await fetch(BUFFER_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await response.json();

  if (json.errors) {
    throw new Error("Buffer API error: " + json.errors[0].message);
  }

  return json.data;
}

// Schedule a post to a Buffer channel at a specific time
// scheduledAt is a JS Date object
async function schedulePost(channelId, text, scheduledAt) {
  const mutation = `
    mutation CreatePost($input: CreatePostInput!) {
      createPost(input: $input) {
        __typename
        ... on InvalidInputError {
          message
        }
      }
    }
  `;

  const variables = {
    input: {
      channelId,
      text,
      schedulingType: "automatic",
      mode: "customScheduled",
      dueAt: scheduledAt.toISOString(),
    },
  };

  const data = await bufferQuery(mutation, variables);
  const result = data.createPost;

  // Catch any inline error type from Buffer
  if (result && result.__typename !== "PostActionSuccess") {
    throw new Error(
      `Buffer error (${result.__typename}): ${result.message || "unknown"}`,
    );
  }

  return result;
}

// Schedule a post to multiple channels
async function scheduleToChannels(channelKeys, text, scheduledAt) {
  const results = [];
  for (const key of channelKeys) {
    const page = LINKEDIN_PAGES[key];
    if (!page) {
      console.warn(`⚠️  Unknown channel key: ${key}`);
      continue;
    }
    try {
      console.log(
        `  📤 Scheduling to ${page.name} at ${scheduledAt.toISOString()}`,
      );
      const result = await schedulePost(page.id, text, scheduledAt);
      results.push({ channel: key, name: page.name, result });
      console.log(`  ✅ Scheduled to ${page.name}`);
    } catch (err) {
      console.error(`  ❌ Failed for ${page.name}: ${err.message}`);
      results.push({ channel: key, name: page.name, error: err.message });
    }
  }
  return results;
}

// Get upcoming scheduled posts for a channel
async function getScheduledPosts(channelId) {
  const query = `
    query GetPosts($input: PostsInput!) {
      posts(input: $input) {
        edges {
          node {
            id
            status
            scheduledAt
            content {
              ... on TextContent {
                text
              }
            }
          }
        }
      }
    }
  `;

  const variables = {
    input: {
      channelId,
      status: "SCHEDULED",
    },
  };

  const data = await bufferQuery(query, variables);
  return data.posts?.edges?.map((e) => e.node) || [];
}

module.exports = {
  LINKEDIN_PAGES,
  schedulePost,
  scheduleToChannels,
  getScheduledPosts,
  bufferQuery,
  ORG_ID,
};
