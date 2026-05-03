// seed.js - Add contractor record for Joshua Brown / Fluid Productions LLC
// Run once via Railway start command or direct node execution
'use strict';
require('dotenv').config();
const pool = require('./db');

async function seed() {
    console.log('Seeding contractor record...');

  // Delete existing record for this phone first (idempotent)
  await pool.query(
        `DELETE FROM contractors WHERE phone = $1`,
        ['+13214657132']
      );

  // Insert fresh record
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
    console.log('Contractor seeded successfully:');
    console.log(`  ID:           ${row.id}`);
    console.log(`  Name:         ${row.name}`);
    console.log(`  Company:      ${row.company_name}`);
    console.log(`  Calls from:   ${row.phone}`);
    console.log(`  Field office: ${row.telnyx_phone}`);
    console.log(`  GHL Location: ${row.ghl_location_id}`);

  await pool.end();
    process.exit(0);
}

seed().catch(err => {
    console.error('Seed failed:', err.message);
    process.exit(1);
});
