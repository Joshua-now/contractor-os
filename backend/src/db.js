// db.js - PostgreSQL connection and schema initialization
// 3-layer memory: contractor-level, lead-level (per phone), job-level (episodic)
// Also includes: contacts + appointments for Joshua's personal Field Office desk

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
                                                                        twilio_phone TEXT,
                                                                                telnyx_phone TEXT,
                                                                                        sms_provider TEXT DEFAULT 'twilio',
                                                                                                ghl_contact_id TEXT,
                                                                                                        ghl_location_id TEXT,
                                                                                                                ai_persona TEXT DEFAULT 'professional HVAC/roofing assistant',
                                                                                                                        service_area TEXT,
                                                                                                                                services TEXT[],
                                                                                                                                        review_link TEXT,
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

          // LAYER 1: contractor-level + lead-level memory
          // lead_phone = NULL means contractor-wide; lead_phone = phone# means scoped to that customer
          await client.query(`
                CREATE TABLE IF NOT EXISTS memory (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                contractor_id UUID REFERENCES contractors(id) ON DELETE CASCADE,
                                        lead_phone TEXT,
                                                key TEXT NOT NULL,
                                                        value TEXT NOT NULL,
                                                                category TEXT DEFAULT 'general',
                                                                        created_at TIMESTAMPTZ DEFAULT NOW(),
                                                                                updated_at TIMESTAMPTZ DEFAULT NOW()
                                                                                      )
                                                                                          `);

          // Safe migration: add lead_phone if it doesn't exist yet
          await client.query(`ALTER TABLE memory ADD COLUMN IF NOT EXISTS lead_phone TEXT`);

          // Safe migration: drop old unique constraint and replace with lead_phone-aware one
          await client.query(`
                DO $body$
                                   BEGIN
                                           IF EXISTS (
                                                     SELECT 1 FROM pg_constraint WHERE conname = 'memory_contractor_id_key_key'
                                                             ) THEN
                                                                       ALTER TABLE memory DROP CONSTRAINT memory_contractor_id_key_key;
                                                                               END IF;
                                                                                     END $body$
                                 `);

          await client.query(`
                CREATE UNIQUE INDEX IF NOT EXISTS memory_contractor_lead_key_idx
                        ON memory(contractor_id, COALESCE(lead_phone, ''), key)
                            `);

          // LAYER 2: per-lead records (for contractor-os customers' inbound leads)
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

          // LAYER 3: episodic job-level memory
          await client.query(`
                CREATE TABLE IF NOT EXISTS jobs (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                contractor_id UUID REFERENCES contractors(id) ON DELETE CASCADE,
                                        customer_phone TEXT NOT NULL,
                                                customer_name TEXT,
                                                        service_type TEXT NOT NULL,
                                                                description TEXT,
                                                                        amount NUMERIC(10,2),
                                                                                status TEXT DEFAULT 'scheduled',
                                                                                        ghl_contact_id TEXT,
                                                                                                invoice_sent_at TIMESTAMPTZ,
                                                                                                        completed_at TIMESTAMPTZ,
                                                                                                                paid_at TIMESTAMPTZ,
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

          // FIELD OFFICE DESK tables (Joshua's personal sales CRM for Fluid Productions)
          // contacts = prospects/clients Joshua is selling AI to
          await client.query(`
                CREATE TABLE IF NOT EXISTS contacts (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                contractor_id UUID REFERENCES contractors(id) ON DELETE CASCADE,
                                        name TEXT NOT NULL,
                                                phone TEXT,
                                                        email TEXT,
                                                                company TEXT,
                                                                        business_type TEXT,
                                                                                ghl_contact_id TEXT,
                                                                                        pipeline_stage TEXT DEFAULT 'New Lead',
                                                                                                notes TEXT,
                                                                                                        created_at TIMESTAMPTZ DEFAULT NOW(),
                                                                                                                updated_at TIMESTAMPTZ DEFAULT NOW()
                                                                                                                      )
                                                                                                                          `);

          // appointments = scheduled calls/demos for Joshua's sales pipeline
          await client.query(`
                CREATE TABLE IF NOT EXISTS appointments (
                        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                contractor_id UUID REFERENCES contractors(id) ON DELETE CASCADE,
                                        contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
                                                scheduled_at TIMESTAMPTZ NOT NULL,
                                                        notes TEXT,
                                                                status TEXT DEFAULT 'scheduled',
                                                                        created_at TIMESTAMPTZ DEFAULT NOW(),
                                                                                updated_at TIMESTAMPTZ DEFAULT NOW()
                                                                                      )
                                                                                          `);

          // Indexes
          await client.query(`CREATE INDEX IF NOT EXISTS idx_conversations_contractor ON conversations(contractor_id)`);
                  await client.query(`CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id)`);
                  await client.query(`CREATE INDEX IF NOT EXISTS idx_memory_contractor ON memory(contractor_id)`);
                  await client.query(`CREATE INDEX IF NOT EXISTS idx_memory_lead_phone ON memory(contractor_id, lead_phone)`);
                  await client.query(`CREATE INDEX IF NOT EXISTS idx_leads_contractor ON leads(contractor_id)`);
                  await client.query(`CREATE INDEX IF NOT EXISTS idx_leads_phone ON leads(contractor_id, phone)`);
                  await client.query(`CREATE INDEX IF NOT EXISTS idx_jobs_contractor ON jobs(contractor_id)`);
                  await client.query(`CREATE INDEX IF NOT EXISTS idx_jobs_phone ON jobs(contractor_id, customer_phone)`);
                  await client.query(`CREATE INDEX IF NOT EXISTS idx_tasks_contractor_status ON tasks(contractor_id, status)`);
                  await client.query(`CREATE INDEX IF NOT EXISTS idx_contacts_contractor ON contacts(contractor_id)`);
                  await client.query(`CREATE INDEX IF NOT EXISTS idx_appointments_contractor ON appointments(contractor_id)`);

          console.log('[DB] Schema initialized — 3-layer memory + field office contacts active');
        } finally {
                  client.release();
        }
}

module.exports = pool;
module.exports.initDB = initDB;
