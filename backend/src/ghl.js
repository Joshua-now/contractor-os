// GoHighLevel integration using Private Integration Token (PIT)
// GHL_PIT_TOKEN is used instead of API keys for PIT-based auth
const axios = require('axios');

function getGHLHeaders() {
    const token = process.env.GHL_PIT_TOKEN;
    if (!token) throw new Error('GHL_PIT_TOKEN not set');
    return {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Version': '2021-07-28'
    };
}

// locationId param lets multitenant callers pass contractor's GHL subaccount location.
// Falls back to env var for Joshua's own account.
async function createGHLContact(data, locationId) {
    const loc = locationId || process.env.GHL_LOCATION_ID;
    if (!loc) {
          console.warn('GHL_LOCATION_ID not set, skipping GHL contact creation');
          return null;
    }
    try {
          const res = await axios.post('https://services.leadconnectorhq.com/contacts/', {
                  locationId: loc,
                  firstName: data.firstName || data.name?.split(' ')[0] || '',
                  lastName: data.lastName || data.name?.split(' ').slice(1).join(' ') || '',
                  phone: data.phone,
                  email: data.email,
                  customField: {
                            job_type: data.job_type,
                            source: 'contractor-os'
                  },
                  tags: [data.job_type || 'contractor-os', 'ai-qualified']
          }, { headers: getGHLHeaders() });
          return res.data;
    } catch (err) {
          console.error('GHL create contact error:', err.response?.data || err.message);
          return null;
    }
}

async function updateGHLContactStage(ghlContactId, stage) {
    if (!ghlContactId) return null;
    try {
          const res = await axios.put(`https://services.leadconnectorhq.com/contacts/${ghlContactId}`, {
                  customField: { stage }
          }, { headers: getGHLHeaders() });
          return res.data;
    } catch (err) {
          console.error('GHL update contact error:', err.response?.data || err.message);
          return null;
    }
}

async function addGHLNote(ghlContactId, note) {
    if (!ghlContactId) return null;
    try {
          const res = await axios.post(`https://services.leadconnectorhq.com/contacts/${ghlContactId}/notes`, {
                  body: note
          }, { headers: getGHLHeaders() });
          return res.data;
    } catch (err) {
          console.error('GHL add note error:', err.response?.data || err.message);
          return null;
    }
}

async function createGHLOpportunity(data) {
    const locationId = process.env.GHL_LOCATION_ID;
    if (!locationId) return null;
    try {
          const res = await axios.post('https://services.leadconnectorhq.com/opportunities/', {
                  locationId,
                  name: `${data.job_type || 'New Lead'} - ${data.name || 'Unknown'}`,
                  contactId: data.ghlContactId,
                  status: 'open',
                  monetaryValue: data.budget_range ? parseFloat(data.budget_range) || 0 : 0
          }, { headers: getGHLHeaders() });
          return res.data;
    } catch (err) {
          console.error('GHL create opportunity error:', err.response?.data || err.message);
          return null;
    }
}

module.exports = {
    createGHLContact,
    updateGHLContactStage,
    addGHLNote,
    createGHLOpportunity
};
