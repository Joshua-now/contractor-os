const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function setupDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS contractors (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        business_name VARCHAR(255) NOT NULL,
        trade_type VARCHAR(50) NOT NULL CHECK (trade_type IN ('hvac', 'roofing', 'plumbing', 'general')),
        service_zips TEXT[],
        working_hours JSONB DEFAULT '{"start":"08:00","end":"18:00","days":["Mon","Tue","Wed","Thu","Fri"]}',
        phone_number VARCHAR(20),
        ghl_api_key TEXT,
        ghl_location_id VARCHAR(255),
        twilio_phone VARCHAR(20),
        calendly_url TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contractor_id UUID REFERENCES contractors(id) ON DELETE CASCADE,
        channel VARCHAR(50) DEFAULT 'sms',
        direction VARCHAR(10) DEFAULT 'inbound',
        from_number VARCHAR(20),
        to_number VARCHAR(20),
        message TEXT,
        ai_response TEXT,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS memory (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contractor_id UUID REFERENCES contractors(id) ON DELETE CASCADE,
        key VARCHAR(255) NOT NULL,
        value TEXT NOT NULL,
        category VARCHAR(100) DEFAULT 'general',
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(contractor_id, key)
      );

      CREATE TABLE IF NOT EXISTS leads (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contractor_id UUID REFERENCES contractors(id) ON DELETE CASCADE,
        name VARCHAR(255),
        phone VARCHAR(20),
        email VARCHAR(255),
        address TEXT,
        job_type VARCHAR(255),
        urgency VARCHAR(50) DEFAULT 'normal',
        budget_range VARCHAR(100),
        status VARCHAR(50) DEFAULT 'new',
        ghl_contact_id VARCHAR(255),
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contractor_id UUID REFERENCES contractors(id) ON DELETE CASCADE,
        lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
        type VARCHAR(100) NOT NULL,
        description TEXT,
        due_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('Database tables ready');
  } finally {
    client.release();
  }
}

module.exports = { pool, setupDatabase };
