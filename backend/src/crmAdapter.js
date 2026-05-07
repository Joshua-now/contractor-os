// crmAdapter.js — Multitenant CRM sync layer
//
// Every lead always goes to Joshua's GHL subaccount for that contractor first.
// If the contractor has their own CRM configured, it mirrors there too.
//
// Usage:
//   const { syncLead, syncNote } = require('./crmAdapter')
//   await syncLead(contractor, leadData)
//
// Supported CRM types: 'ghl' | 'servicetitan' | 'jobber' | 'housecall' | 'none'

'use strict';

const axios = require('axios');
const { createGHLContact, addGHLNote, createGHLOpportunity } = require('./ghl');

// ─── GHL WRITE (always runs) ──────────────────────────────────────────────────
// Uses Joshua's Agency PIT token + contractor's GHL subaccount location_id
async function writeToGHL(contractor, lead) {
  try {
    const contact = await createGHLContact(lead, contractor.ghl_location_id);
    if (contact?.id) {
      await createGHLOpportunity({
        ...lead,
        ghlContactId: contact.id,
      }, contractor.ghl_location_id);
    }
    console.log(`[CRM] GHL sync OK for contractor ${contractor.id}`);
    return { ok: true, contactId: contact?.id };
  } catch (err) {
    console.error(`[CRM] GHL sync failed for contractor ${contractor.id}:`, err.message);
    return { ok: false, error: err.message };
  }
}

// ─── SERVICE TITAN ────────────────────────────────────────────────────────────
// Docs: https://developer.servicetitan.io
// Requires: crm_api_key (client_id:client_secret), crm_account_id (tenant_id)
async function writeToServiceTitan(contractor, lead) {
  if (!contractor.crm_api_key || !contractor.crm_account_id) {
    console.warn('[CRM] ServiceTitan: missing crm_api_key or crm_account_id');
    return { ok: false, error: 'missing credentials' };
  }
  try {
    // Step 1: get access token
    const [clientId, clientSecret] = contractor.crm_api_key.split(':');
    const tokenRes = await axios.post('https://auth.servicetitan.io/connect/token', new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });

    const token = tokenRes.data.access_token;
    const tenantId = contractor.crm_account_id;
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    // Step 2: create or find customer
    const customerRes = await axios.post(
      `https://api.servicetitan.io/crm/v2/tenant/${tenantId}/customers`,
      {
        name: lead.name || 'Unknown',
        type: 'Residential',
        phones: lead.phone ? [{ number: lead.phone, type: 'Mobile' }] : [],
        email: lead.email || undefined,
        importId: `cos-${Date.now()}`,
      },
      { headers }
    );

    // Step 3: create booking/job
    if (customerRes.data?.id) {
      await axios.post(
        `https://api.servicetitan.io/jpm/v2/tenant/${tenantId}/bookings`,
        {
          source: 'ContractorOS',
          name: lead.job_type || 'New Lead',
          customerName: lead.name,
          customerId: customerRes.data.id,
          summary: lead.notes || `Lead from ContractorOS — ${lead.source || 'AI'}`,
        },
        { headers }
      );
    }

    console.log(`[CRM] ServiceTitan sync OK for contractor ${contractor.id}`);
    return { ok: true, customerId: customerRes.data?.id };
  } catch (err) {
    console.error(`[CRM] ServiceTitan sync failed:`, err.response?.data || err.message);
    return { ok: false, error: err.message };
  }
}

// ─── JOBBER ───────────────────────────────────────────────────────────────────
// Docs: https://developer.getjobber.com
// Requires: crm_api_key (OAuth access token), crm_account_id (account ID)
async function writeToJobber(contractor, lead) {
  if (!contractor.crm_api_key) {
    console.warn('[CRM] Jobber: missing crm_api_key');
    return { ok: false, error: 'missing credentials' };
  }
  try {
    const headers = {
      Authorization: `Bearer ${contractor.crm_api_key}`,
      'Content-Type': 'application/json',
      'X-JOBBER-GRAPHQL-VERSION': '2024-02-05',
    };

    // Jobber uses GraphQL
    const mutation = `
      mutation CreateClient($input: ClientCreateInput!) {
        clientCreate(input: $input) {
          client { id }
          userErrors { message }
        }
      }
    `;
    const variables = {
      input: {
        firstName: lead.name?.split(' ')[0] || 'Unknown',
        lastName: lead.name?.split(' ').slice(1).join(' ') || '',
        phones: lead.phone ? [{ number: lead.phone, primary: true }] : [],
        emails: lead.email ? [{ address: lead.email, primary: true }] : [],
        notes: lead.notes || `Lead from ContractorOS — ${lead.source || 'AI'}`,
      }
    };

    const res = await axios.post(
      'https://api.getjobber.com/api/graphql',
      { query: mutation, variables },
      { headers }
    );

    const clientId = res.data?.data?.clientCreate?.client?.id;
    console.log(`[CRM] Jobber sync OK for contractor ${contractor.id}, clientId: ${clientId}`);
    return { ok: true, clientId };
  } catch (err) {
    console.error(`[CRM] Jobber sync failed:`, err.response?.data || err.message);
    return { ok: false, error: err.message };
  }
}

// ─── HOUSECALL PRO ────────────────────────────────────────────────────────────
// Docs: https://developers.housecallpro.com
// Requires: crm_api_key (API key)
async function writeToHousecall(contractor, lead) {
  if (!contractor.crm_api_key) {
    console.warn('[CRM] HousecallPro: missing crm_api_key');
    return { ok: false, error: 'missing credentials' };
  }
  try {
    const headers = {
      Authorization: `Token ${contractor.crm_api_key}`,
      'Content-Type': 'application/json',
    };

    const res = await axios.post('https://api.housecallpro.com/customers', {
      first_name: lead.name?.split(' ')[0] || 'Unknown',
      last_name: lead.name?.split(' ').slice(1).join(' ') || '',
      mobile_number: lead.phone,
      email: lead.email,
      notes: lead.notes || `Lead from ContractorOS — ${lead.source || 'AI'}`,
    }, { headers });

    console.log(`[CRM] HousecallPro sync OK for contractor ${contractor.id}`);
    return { ok: true, customerId: res.data?.id };
  } catch (err) {
    console.error(`[CRM] HousecallPro sync failed:`, err.response?.data || err.message);
    return { ok: false, error: err.message };
  }
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

/**
 * syncLead — write a lead to GHL (always) + contractor's own CRM (if set)
 * @param {object} contractor — from req.contractor (has crm_type, crm_api_key, ghl_location_id)
 * @param {object} lead — { name, phone, email, job_type, notes, source }
 * @returns {{ ghl: object, crm: object|null }}
 */
async function syncLead(contractor, lead) {
  const results = { ghl: null, crm: null };

  // Always write to GHL first (Joshua's backbone)
  results.ghl = await writeToGHL(contractor, lead);

  // Mirror to contractor's own CRM if configured
  const crmType = contractor.crm_type;
  if (crmType && crmType !== 'ghl' && crmType !== 'none' && contractor.crm_api_key) {
    switch (crmType) {
      case 'servicetitan': results.crm = await writeToServiceTitan(contractor, lead); break;
      case 'jobber':       results.crm = await writeToJobber(contractor, lead);       break;
      case 'housecall':    results.crm = await writeToHousecall(contractor, lead);    break;
      default:
        console.warn(`[CRM] Unknown crm_type: ${crmType}`);
    }
  }

  return results;
}

/**
 * syncNote — add a note to GHL contact (and CRM if supported)
 * @param {object} contractor
 * @param {string} ghlContactId
 * @param {string} note
 */
async function syncNote(contractor, ghlContactId, note) {
  await addGHLNote(ghlContactId, note);
  // Note sync to ServiceTitan/Jobber can be added here as needed
}

module.exports = { syncLead, syncNote };
