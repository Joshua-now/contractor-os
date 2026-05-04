// maintenancePlan.js - Enroll customers in recurring maintenance plans
// Updates GHL stage, stores plan record, sends confirmation SMS
'use strict';

const pool = require('../db');
const { sendSMS } = require('./speedToLead');
const { updateGHLContactStage, addGHLNote } = require('../ghl');

/**
 * Enroll a customer in a maintenance/service plan
  * @param {object} contractor - contractor row from DB
   * @param {string} customerPhone - customer phone
    * @param {object} planData - { customerName, planType, price, frequency, ghlContactId }
     */
     async function enrollMaintenancePlan(contractor, customerPhone, planData) {
       const {
           customerName,
               planType = 'Annual Maintenance Plan',
                   price,
                       frequency = 'annual',
                           ghlContactId = null,
                             } = planData;

                               // Save to jobs table as a maintenance plan record
                                 await pool.query(
                                     `INSERT INTO jobs (
                                           contractor_id, customer_phone, customer_name,
                                                 service_type, amount, description, status,
                                                       created_at, updated_at
                                                           ) VALUES ($1,$2,$3,$4,$5,$6,'maintenance_active', NOW(), NOW())
                                                               ON CONFLICT DO NOTHING`,
                                                                   [
                                                                         contractor.id,
                                                                               customerPhone,
                                                                                     customerName || 'Customer',
                                                                                           planType,
                                                                                                 price || 0,
                                                                                                       `${frequency} maintenance plan enrolled`,
                                                                                                           ]
                                                                                                             );
                                                                                                             
                                                                                                               // Save to lead memory — this customer is now on a plan
                                                                                                                 await pool.query(
                                                                                                                     `INSERT INTO memory (contractor_id, key, value, category, created_at, updated_at)
                                                                                                                          VALUES ($1, $2, $3, 'job', NOW(), NOW())
                                                                                                                               ON CONFLICT (contractor_id, key) DO UPDATE SET value = $3, updated_at = NOW()`,
                                                                                                                                   [contractor.id, `maintenance_plan_${customerPhone}`, `${planType} — ${frequency}${price ? ` — $${price}` : ''}`, ]
                                                                                                                                     );
                                                                                                                                     
                                                                                                                                       // Update GHL contact stage to "Maintenance Plan" if we have the contact ID
                                                                                                                                         if (ghlContactId) {
                                                                                                                                             await updateGHLContactStage(ghlContactId, contractor.id, 'Maintenance Plan');
                                                                                                                                                 await addGHLNote(
                                                                                                                                                       ghlContactId,
                                                                                                                                                             contractor.id,
                                                                                                                                                                   `Enrolled in ${planType} (${frequency}${price ? `, $${price}` : ''})`
                                                                                                                                                                       );
                                                                                                                                                                         }
                                                                                                                                                                         
                                                                                                                                                                           // Send confirmation SMS
                                                                                                                                                                             const companyName = contractor.company_name || contractor.name;
                                                                                                                                                                               let smsBody = `Hi ${customerName || 'there'}! You're enrolled in our ${planType} with ${companyName}. We'll reach out to schedule your first visit. Thank you!`;
                                                                                                                                                                               
                                                                                                                                                                                 if (smsBody.length > 160) {
                                                                                                                                                                                     smsBody = `You're enrolled in our ${planType} with ${companyName}. We'll schedule your first visit soon. Thank you!`;
                                                                                                                                                                                       }
                                                                                                                                                                                       
                                                                                                                                                                                         await sendSMS(contractor, customerPhone, smsBody);
                                                                                                                                                                                         
                                                                                                                                                                                           console.log(`[MaintenancePlan] Enrolled ${customerPhone} in ${planType}`);
                                                                                                                                                                                           
                                                                                                                                                                                             return {
                                                                                                                                                                                                 success: true,
                                                                                                                                                                                                     customerPhone,
                                                                                                                                                                                                         planType,
                                                                                                                                                                                                             frequency,
                                                                                                                                                                                                                 price,
                                                                                                                                                                                                                     smsSent: smsBody,
                                                                                                                                                                                                                       };
                                                                                                                                                                                                                       }
                                                                                                                                                                                                                       
                                                                                                                                                                                                                       /**
                                                                                                                                                                                                                        * Get all active maintenance plan customers for a contractor
                                                                                                                                                                                                                         */
                                                                                                                                                                                                                         async function getMaintenancePlanCustomers(contractorId) {
                                                                                                                                                                                                                           const result = await pool.query(
                                                                                                                                                                                                                               `SELECT customer_name, customer_phone, service_type, amount, created_at
                                                                                                                                                                                                                                    FROM jobs
                                                                                                                                                                                                                                         WHERE contractor_id = $1 AND status = 'maintenance_active'
                                                                                                                                                                                                                                              ORDER BY created_at DESC`,
                                                                                                                                                                                                                                                  [contractorId]
                                                                                                                                                                                                                                                    );
                                                                                                                                                                                                                                                      return result.rows;
                                                                                                                                                                                                                                                      }
                                                                                                                                                                                                                                                      
                                                                                                                                                                                                                                                      module.exports = { enrollMaintenancePlan, getMaintenancePlanCustomers };
                                                                                                                                                                                                                                                      
