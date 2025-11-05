// Diagnostic server check
console.log("🔍 Testing server startup...\n");

// Test 1: Can we load the modules?
console.log("1. Testing module imports...");
try {
  const express = require("express");
  const { Client } = require("pg");
  console.log("   ✅ Modules loaded successfully\n");
} catch (error) {
  console.log("   ❌ Module error:", error.message);
  process.exit(1);
}

// Test 2: Can we connect to the database?
console.log("2. Testing database connection...");
const { Client } = require("pg");

async function testDatabase() {
  const client = new Client({
    connectionString:
      process.env.DATABASE_URL || "postgresql://localhost:5432/tenders",
  });

  try {
    await client.connect();
    console.log("   ✅ Database connected\n");

    // Test a simple query
    const result = await client.query("SELECT COUNT(*) FROM tenders");
    console.log(
      `   ✅ Database query works (${result.rows[0].count} tenders)\n`,
    );

    await client.end();
  } catch (error) {
    console.log("   ❌ Database error:", error.message);
    console.log("\n   This is likely why your server is crashing!\n");
    process.exit(1);
  }
}

// Test 3: Can we start Express?
console.log("3. Testing Express server...");
const express = require("express");
const app = express();

app.get("/test", (req, res) => {
  res.json({ message: "Test successful!" });
});

// Try to start the server
const PORT = process.env.PORT || 5000;

testDatabase()
  .then(() => {
    const server = app.listen(PORT, "0.0.0.0", () => {
      console.log(`   ✅ Express server started on port ${PORT}\n`);
      console.log("🎉 All tests passed! Your server should work.\n");
      console.log("If your main server.js still crashes, there might be");
      console.log(
        "a syntax error in the code. Press Ctrl+C to stop this test.\n",
      );
    });

    server.on("error", (error) => {
      console.log("   ❌ Server error:", error.message);
      if (error.code === "EADDRINUSE") {
        console.log("\n   Port is already in use!");
        console.log("   Run: pkill -f node");
        console.log("   Then try again.\n");
      }
      process.exit(1);
    });
  })
  .catch((error) => {
    console.log("❌ Test failed:", error.message);
    process.exit(1);
  });
