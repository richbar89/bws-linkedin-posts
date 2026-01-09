// Check and fix database schema to prevent duplicates
const { Client } = require("pg");

async function fixDatabaseSchema() {
  console.log("\n🔧 Checking and fixing database schema...\n");

  const client = new Client({
    connectionString:
      process.env.DATABASE_URL || "postgresql://localhost:5432/tenders",
  });

  await client.connect();

  try {
    // Check current schema
    console.log("📋 Checking current schema...");

    const tableInfo = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'tenders'
      ORDER BY ordinal_position
    `);

    console.log("\nCurrent columns:");
    tableInfo.rows.forEach((col) => {
      console.log(
        `  - ${col.column_name}: ${col.data_type} ${col.is_nullable === "NO" ? "(NOT NULL)" : ""}`,
      );
    });

    // Check for primary key or unique constraint on id
    const constraints = await client.query(`
      SELECT constraint_name, constraint_type
      FROM information_schema.table_constraints
      WHERE table_name = 'tenders'
    `);

    console.log("\nCurrent constraints:");
    if (constraints.rows.length === 0) {
      console.log("  ⚠️  No constraints found!");
    } else {
      constraints.rows.forEach((c) => {
        console.log(`  - ${c.constraint_name} (${c.constraint_type})`);
      });
    }

    // Check for duplicates
    console.log("\n🔍 Checking for duplicates...");
    const duplicates = await client.query(`
      SELECT id, COUNT(*) as count
      FROM tenders
      GROUP BY id
      HAVING COUNT(*) > 1
      ORDER BY count DESC
      LIMIT 10
    `);

    if (duplicates.rows.length > 0) {
      console.log(`\n⚠️  Found ${duplicates.rows.length} duplicate IDs:`);
      duplicates.rows.forEach((dup) => {
        console.log(`  - ${dup.id}: ${dup.count} copies`);
      });

      console.log("\n🧹 Cleaning up duplicates...");

      // For each duplicate, keep the most recently created one
      for (const dup of duplicates.rows) {
        await client.query(
          `
          DELETE FROM tenders
          WHERE id = $1
          AND created_at NOT IN (
            SELECT MAX(created_at)
            FROM tenders
            WHERE id = $1
          )
        `,
          [dup.id],
        );
      }

      const afterCleanup = await client.query(`
        SELECT COUNT(*) FROM tenders
      `);
      console.log(
        `✅ Cleanup complete. Tenders remaining: ${afterCleanup.rows[0].count}`,
      );
    } else {
      console.log("✅ No duplicates found!");
    }

    // Check if id is primary key
    const hasPrimaryKey = constraints.rows.some(
      (c) =>
        c.constraint_type === "PRIMARY KEY" &&
        c.constraint_name.includes("tenders"),
    );

    if (!hasPrimaryKey) {
      console.log("\n⚠️  No primary key on 'id' field!");
      console.log("🔧 Adding primary key constraint...");

      try {
        await client.query(`
          ALTER TABLE tenders
          ADD PRIMARY KEY (id)
        `);
        console.log("✅ Primary key added successfully!");
      } catch (error) {
        if (error.message.includes("already exists")) {
          console.log("✅ Primary key already exists (different name)");
        } else {
          console.log(`❌ Error adding primary key: ${error.message}`);
          console.log("\n💡 Try this manually:");
          console.log("   ALTER TABLE tenders ADD PRIMARY KEY (id);");
        }
      }
    } else {
      console.log("\n✅ Primary key already exists on 'id' field");
    }

    // Final verification
    console.log("\n📊 Final verification:");
    const totalTenders = await client.query("SELECT COUNT(*) FROM tenders");
    const uniqueIds = await client.query(
      "SELECT COUNT(DISTINCT id) FROM tenders",
    );

    console.log(`  Total rows: ${totalTenders.rows[0].count}`);
    console.log(`  Unique IDs: ${uniqueIds.rows[0].count}`);

    if (totalTenders.rows[0].count === uniqueIds.rows[0].count) {
      console.log("  ✅ All tenders have unique IDs!");
    } else {
      console.log("  ⚠️  Still have duplicates - may need manual cleanup");
    }
  } catch (error) {
    console.error("\n❌ Error:", error.message);
    console.error("\nStack:", error.stack);
  } finally {
    await client.end();
    console.log("\n");
  }
}

fixDatabaseSchema();
