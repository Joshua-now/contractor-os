// invoicer.js - Create invoices and send payment links via SMS
// Stores invoice records in DB, sends Stripe payment link or plain amount SMS
'use strict';

const pool = require('../db');
const { sendSMS } = require('./speedToLead');

/**
 * Create an invoice record and send payment SMS to customer
  * @param {object} contractor - contractor row from DB
   * @param {string} customerPhone - customer phone number
    * @param {object} invoiceData - { customerName, serviceType, amount, jobDescription, paymentLink }
     */
     async function createInvoice(contractor, customerPhone, invoiceData) {
       const {
           customerName,
               serviceType,
                   amount,
                       jobDescription,
                           paymentLink = null,
                             } = invoiceData;

                               // Store invoice in jobs table
                                 const invoiceResult = await pool.query(
                                     `INSERT INTO jobs (
                                           contractor_id, customer_phone, customer_name,
                                                 service_type, amount, description, status,
                                                       invoice_sent_at, created_at, updated_at
                                                           ) VALUES ($1,$2,$3,$4,$5,$6,'invoice_sent', NOW(), NOW(), NOW())
                                                               RETURNING id`,
                                                                   [
                                                                         contractor.id,
                                                                               customerPhone,
                                                                                     customerName || 'Customer',
                                                                                           serviceType || 'Service',
                                                                                                 amount,
                                                                                                       jobDescription || '',
                                                                                                           ]
                                                                                                             );
                                                                                                             
                                                                                                               const jobId = invoiceResult.rows[0]?.id;
                                                                                                               
                                                                                                                 // Build the SMS message
                                                                                                                   const companyName = contractor.company_name || contractor.name;
                                                                                                                     let smsBody;
                                                                                                                     
                                                                                                                       if (paymentLink) {
                                                                                                                           smsBody = `Hi ${customerName || 'there'}, your invoice from ${companyName} for ${serviceType} is $${amount}. Pay here: ${paymentLink} — Thank you!`;
                                                                                                                             } else {
                                                                                                                                 smsBody = `Hi ${customerName || 'there'}, your invoice from ${companyName}: ${serviceType} — $${amount}. Reply PAID when complete or call us with questions.`;
                                                                                                                                   }
                                                                                                                                   
                                                                                                                                     // Keep under 160 chars if no payment link
                                                                                                                                       if (smsBody.length > 160 && !paymentLink) {
                                                                                                                                           smsBody = `Invoice from ${companyName}: ${serviceType} $${amount}. Questions? Call us.`;
                                                                                                                                             }
                                                                                                                                             
                                                                                                                                               await sendSMS(contractor, customerPhone, smsBody);
                                                                                                                                               
                                                                                                                                                 console.log(`[Invoicer] Invoice #${jobId} sent to ${customerPhone} for $${amount}`);
                                                                                                                                                 
                                                                                                                                                   return {
                                                                                                                                                       success: true,
                                                                                                                                                           jobId,
                                                                                                                                                               amount,
                                                                                                                                                                   customerPhone,
                                                                                                                                                                       smsSent: smsBody,
                                                                                                                                                                         };
                                                                                                                                                                         }
                                                                                                                                                                         
                                                                                                                                                                         /**
                                                                                                                                                                          * Mark a job/invoice as paid
                                                                                                                                                                           */
                                                                                                                                                                           async function markPaid(contractorId, customerPhone, serviceType) {
                                                                                                                                                                             const result = await pool.query(
                                                                                                                                                                                 `UPDATE jobs SET status = 'paid', paid_at = NOW(), updated_at = NOW()
                                                                                                                                                                                      WHERE contractor_id = $1 AND customer_phone = $2 AND status = 'invoice_sent'
                                                                                                                                                                                           ${serviceType ? "AND LOWER(service_type) LIKE LOWER($3)" : ''}
                                                                                                                                                                                                RETURNING id, amount`,
                                                                                                                                                                                                    serviceType
                                                                                                                                                                                                          ? [contractorId, customerPhone, `%${serviceType}%`]
                                                                                                                                                                                                                : [contractorId, customerPhone]
                                                                                                                                                                                                                  );
                                                                                                                                                                                                                  
                                                                                                                                                                                                                    if (result.rows.length === 0) {
                                                                                                                                                                                                                        return { success: false, message: 'No open invoice found to mark paid' };
                                                                                                                                                                                                                          }
                                                                                                                                                                                                                          
                                                                                                                                                                                                                            return {
                                                                                                                                                                                                                                success: true,
                                                                                                                                                                                                                                    jobId: result.rows[0].id,
                                                                                                                                                                                                                                        amount: result.rows[0].amount,
                                                                                                                                                                                                                                            message: `Invoice marked paid`,
                                                                                                                                                                                                                                              };
                                                                                                                                                                                                                                              }
                                                                                                                                                                                                                                              
                                                                                                                                                                                                                                              /**
                                                                                                                                                                                                                                               * Get outstanding invoices for a contractor
                                                                                                                                                                                                                                                */
                                                                                                                                                                                                                                                async function getOutstandingInvoices(contractorId) {
                                                                                                                                                                                                                                                  const result = await pool.query(
                                                                                                                                                                                                                                                      `SELECT id, customer_name, customer_phone, service_type, amount, invoice_sent_at
                                                                                                                                                                                                                                                           FROM jobs
                                                                                                                                                                                                                                                                WHERE contractor_id = $1 AND status = 'invoice_sent'
                                                                                                                                                                                                                                                                     ORDER BY invoice_sent_at DESC
                                                                                                                                                                                                                                                                          LIMIT 10`,
                                                                                                                                                                                                                                                                              [contractorId]
                                                                                                                                                                                                                                                                                );
                                                                                                                                                                                                                                                                                  return result.rows;
                                                                                                                                                                                                                                                                                  }
                                                                                                                                                                                                                                                                                  
                                                                                                                                                                                                                                                                                  module.exports = { createInvoice, markPaid, getOutstandingInvoices };
                                                                                                                                                                                                                                                                                  
