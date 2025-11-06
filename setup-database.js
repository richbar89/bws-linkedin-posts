// Database setup script
const { Client } = require("pg");

async function setupDatabase() {
  console.log("🗄️  Setting up database...\n");

  const client = new Client({
    connectionString:
      process.env.DATABASE_URL || "postgresql://localhost:5432/tenders",
  });

  try {
    await client.connect();
    console.log("✅ Connected to PostgreSQL\n");

    console.log("🧹 Cleaning up old tables...");
    await client.query("DROP TABLE IF EXISTS tender_matches CASCADE");
    await client.query("DROP TABLE IF EXISTS companies CASCADE");
    await client.query("DROP TABLE IF EXISTS tenders CASCADE");
    console.log("✅ Old tables removed\n");

    console.log("📋 Creating tenders table...");
    await client.query(`
      CREATE TABLE tenders (
        id VARCHAR(100) PRIMARY KEY,
        title TEXT,
        description TEXT,
        cpv_codes JSONB,
        publication_date TIMESTAMP,
        deadline_date TIMESTAMP,
        status VARCHAR(50),
        buyer_name VARCHAR(500),
        tender_url TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log("✅ Tenders table created\n");

    console.log("🏢 Creating companies table...");
    await client.query(`
      CREATE TABLE companies (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        cpv_codes JSONB NOT NULL,
        first_name VARCHAR(100),
        last_name VARCHAR(100),
        email VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log("✅ Companies table created\n");

    console.log("⚡ Creating indexes...");
    await client.query("CREATE INDEX idx_tenders_status ON tenders(status)");
    await client.query(
      "CREATE INDEX idx_tenders_cpv ON tenders USING GIN(cpv_codes)",
    );
    await client.query(
      "CREATE INDEX idx_tenders_publication_date ON tenders(publication_date)",
    );
    await client.query(
      "CREATE INDEX IF NOT EXISTS idx_companies_email ON companies(email)",
    );
    console.log("✅ Indexes created\n");

    console.log("🎉 Database setup complete!\n");
  } catch (error) {
    console.log("❌ Error:", error.message);
  } finally {
    await client.end();
  }
}

setupDatabase();
