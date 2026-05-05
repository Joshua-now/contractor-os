// outboundQueue.js
// Shared in-memory store for outbound Telnyx call metadata.
// Both fieldOffice.js (initiates) and voice.js (webhook handler) import this
// so they can pass the message & contact info across the call lifecycle.
//
// COPY TO: backend/src/outboundQueue.js

'use strict';

// keyed by callControlId → { message, contactName, afterHangup }
const queue = new Map();

module.exports = queue;
