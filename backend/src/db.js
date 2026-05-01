// db.js - PostgreSQL connection and schema initialization
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS contractors (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        company_name TEXT,
        email TEXT UNIQUE NOT NULL,
        phone TEXT,
        -- SMS/Voice provider config
        twilio_phone TEXT,
        telnyx_phone TEXT,
        sms_provider TEXT DEFAULT 'twilio',
        -- GoHighLevel CRM
        ghl_contact_id TEXT,
        ghl_location_id TEXT,
        -- AI config
        ai_persona TEXT DEFAULT 'professional HVAC/roofing assistant',
        service_area TEXT,
        services TEXT[],
        -- Subscription
        plan TEXT DEFAULT 'trial',
        active BOOLEAN DEFAULT true,
        onboarded BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contractor_id UUID REFERENCES contractors(id) ON DELETE CASCADE,
        lead_phone TEXT NOT NULL,
        lead_name TEXT,
        channel TEXT DEFAULT 'sms',
        sms_provider TEXT DEFAULT 'twilio',
        status TEXT DEFAULT 'open',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
        content TEXT NOT NULL,
        provider TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS memory (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contractor_id UUID REFERENCES contractors(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        category TEXT DEFAULT 'general',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(contractor_id, key)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS leads (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contractor_id UUID REFERENCES contractors(id) ON DELETE CASCADE,
        name TEXT,
        phone TEXT NOT NULL,
        email TEXT,
        service_type TEXT,
        status TEXT DEFAULT 'new',
        source TEXT DEFAULT 'sms',
        ghl_contact_id TEXT,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contractor_id UUID REFERENCES contractors(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        payload JSONB,
        status TEXT DEFAULT 'pending',
        run_at TIMESTAMPTZ,
        ran_at TIMESTAMPTZ,
        error TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Indexes for performance
    await client.query(`CREATE INDEX IF NOT EXISTS idx_conversations_contractor ON conversations(contractor_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_memory_contractor ON memory(contractor_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_leads_contractor ON leads(contractor_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_tasks_contractor_status ON tasks(contractor_id, status)`);

    console.log('[DB] Schema initialized successfully');
  } finally {
    client.release();
  }
}

module.exports = pool;
module.exports.initDB = initDB;
