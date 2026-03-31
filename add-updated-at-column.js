// Add missing updated_at column to tenders table
const { Client } = require("pg");

async function addUpdatedAtColumn() {
  const client = new Client({
    connectionString:
      process.env.DATABASE_URL || "postgresql://localhost:5432/tenders",
  });

  await client.connect();
  console.log("\n🔧 DATABASE MIGRATION: Adding updated_at column\n");
  console.log("━".repeat(60) + "\n");

  try {
    // Check if column already exists
    const checkColumn = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name='tenders' AND column_name='updated_at'
    `);

    if (checkColumn.rows.length > 0) {
      console.log("✅ Column 'updated_at' already exists\n");
    } else {
      console.log("Adding 'updated_at' column...");

      // Add the column with default value
      await client.query(`
        ALTER TABLE tenders 
        ADD COLUMN updated_at TIMESTAMP DEFAULT NOW()
      `);

      console.log("✅ Column 'updated_at' added successfully\n");
    }

    // Show current schema
    console.log("📋 Current tenders table schema:");
    const schema = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name='tenders'
      ORDER BY ordinal_position
    `);

    schema.rows.forEach((col) => {
      console.log(
        `   ${col.column_name.padEnd(20)} ${col.data_type.padEnd(20)} ${col.is_nullable === "NO" ? "NOT NULL" : "NULL"}`,
      );
    });

    console.log("\n" + "━".repeat(60));
    console.log("✅ Migration complete!\n");
    console.log("💡 You can now run: node fetch-last-24-hours.js\n");
  } catch (error) {
    console.error("❌ Migration error:", error.message);
    console.error("\nFull error:", error);
  } finally {
    await client.end();
  }
}

addUpdatedAtColumn();
