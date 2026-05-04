// thankYou.js - Post-job thank you SMS and Google review request
// Fires after job completion — thanks customer, marks job done, requests review
'use strict';

const pool = require('../db');
const { sendSMS } = require('./speedToLead');
const { addGHLNote, updateGHLContactStage } = require('../ghl');

/**
 * Send thank you message and optional review request after job completion
 * @param {object} contractor - contractor row from DB
 * @param {string} customerPhone - customer phone number
 * @param {object} jobData - { customerName, serviceType, jobId, requestReview, reviewLink, ghlContactId }
 */
async function sendThankYou(contractor, customerPhone, jobData) {
    const {
          customerName,
          serviceType,
          jobId = null,
          requestReview = true,
          reviewLink = null,
          ghlContactId = null,
    } = jobData;

  const companyName = contractor.company_name || contractor.name;

  // Mark the job as complete in DB
  if (jobId) {
        await pool.query(
                `UPDATE jobs SET status = 'complete', completed_at = NOW(), updated_at = NOW()
                       WHERE id = $1 AND contractor_id = $2`,
                [jobId, contractor.id]
              );
  } else {
        // Find the most recent in-progress job for this customer and mark it complete
      await pool.query(
              `UPDATE jobs SET status = 'complete', completed_at = NOW(), updated_at = NOW()
                     WHERE contractor_id = $1 AND customer_phone = $2
                              AND status IN ('invoice_sent', 'in_progress', 'scheduled')
                                     ORDER BY created_at DESC
                                            LIMIT 1`,
              [contractor.id, customerPhone]
            );
  }

  // Update GHL stage to "Job Complete"
  if (ghlContactId) {
        await updateGHLContactStage(ghlContactId, contractor.id, 'Job Complete');
        await addGHLNote(
                ghlContactId,
                contractor.id,
                `Job completed: ${serviceType || 'Service'}. Thank you message sent.`
              );
  }

  // Build thank you SMS
  let smsBody;
    if (requestReview && reviewLink) {
          smsBody = `${customerName ? `Hi ${customerName}! ` : ''}Thanks for choosing ${companyName}! We hope everything looks great. Mind leaving us a quick review? ${reviewLink}`;
    } else if (requestReview) {
          smsBody = `${customerName ? `Hi ${customerName}! ` : ''}Thanks for choosing ${companyName}! We hope you're happy with the work. A Google review means the world to us — just search "${companyName}" on Google Maps!`;
    } else {
          smsBody = `${customerName ? `Hi ${customerName}! ` : ''}Thanks for choosing ${companyName}! We hope everything looks great. Don't hesitate to call if you need anything.`;
    }

  // Trim to 160 if needed
  if (smsBody.length > 160) {
        if (requestReview && reviewLink) {
                smsBody = `Thanks for choosing ${companyName}! Please leave us a review: ${reviewLink}`;
        } else {
                smsBody = `Thanks for choosing ${companyName}! We appreciate your business. Call us anytime.`;
        }
  }

  await sendSMS(contractor, customerPhone, smsBody);

  // Save to memory — this customer had a completed job
  await pool.query(
        `INSERT INTO memory (contractor_id, key, value, category, created_at, updated_at)
             VALUES ($1, $2, $3, 'job', NOW(), NOW())
                  ON CONFLICT (contractor_id, key) DO UPDATE SET value = $3, updated_at = NOW()`,
        [
                contractor.id,
                `last_completed_job_${customerPhone}`,
                `${serviceType || 'Service'} — completed ${new Date().toLocaleDateString()}`,
              ]
      );

  console.log(`[ThankYou] Sent to ${customerPhone} — review requested: ${requestReview}`);

  return {
        success: true,
        customerPhone,
        smsSent: smsBody,
        reviewRequested: requestReview,
  };
}

module.exports = { sendThankYou };
