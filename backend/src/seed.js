// seed.js - Add contractor record for Joshua Brown / Fluid Productions LLC
// Run once: node src/seed.js
// Or just execute the SQL directly against your Railway Postgres DB

'use strict';
require('dotenv').config();
const pool = require('./db');

async function seed() {
  console.log('Seeding contractor record...');

    const result = await pool.query(`
        INSERT INTO contractors (
              name,
                    company_name,
                          phone,
                                telnyx_phone,
                                      ghl_location_id,
                                            sms_provider,
                                                  active
                                                      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                                                          ON CONFLICT (phone) DO UPDATE SET
                                                                name             = EXCLUDED.name,
                                                                      company_name     = EXCLUDED.company_name,
                                                                            telnyx_phone     = EXCLUDED.telnyx_phone,
                                                                                  ghl_location_id  = EXCLUDED.ghl_location_id,
                                                                                        sms_provider     = EXCLUDED.sms_provider,
                                                                                              active           = EXCLUDED.active
                                                                                                  RETURNING id, name, company_name, phone, telnyx_phone, ghl_location_id
                                                                                                    `, [
                                                                                                        'Joshua Brown',           // name
                                                                                                            'Fluid Productions LLC',  // company_name
                                                                                                                '+13214657132',           // phone  — the number Joshua calls FROM (his cell)
                                                                                                                    '+13217324521',           // telnyx_phone — the field office line he calls TO
                                                                                                                        'zkyEC4YPpQXczjPrdoPb',   // ghl_location_id — Fluid Productions LLC location
                                                                                                                            'telnyx',                 // sms_provider
                                                                                                                                true                      // active
                                                                                                                                  ]);
                                                                                                                                  
                                                                                                                                    const row = result.rows[0];
                                                                                                                                      console.log('✅ Contractor seeded:');
                                                                                                                                        console.log(`   ID:            ${row.id}`);
                                                                                                                                          console.log(`   Name:          ${row.name}`);
                                                                                                                                            console.log(`   Company:       ${row.company_name}`);
                                                                                                                                              console.log(`   Calls from:    ${row.phone}`);
                                                                                                                                                console.log(`   Field office:  ${row.telnyx_phone}`);
                                                                                                                                                  console.log(`   GHL Location:  ${row.ghl_location_id}`);
                                                                                                                                                  
                                                                                                                                                    process.exit(0);
                                                                                                                                                    }
                                                                                                                                                    
                                                                                                                                                    seed().catch(err => {
                                                                                                                                                      console.error('Seed failed:', err.message);
                                                                                                                                                        process.exit(1);
                                                                                                                                                        });
