// outboundQueue.js
// Shared in-memory store for outbound Telnyx call metadata.
// Both fieldOffice.js (initiates) and voice.js (webhook handler) import this
// so they can pass the message & contact info across the call lifecycle.

'use strict';

const ENTRY_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_QUEUE_SIZE = 500;           // hard cap — reject new entries beyond this

// keyed by callControlId → { message, contactName, afterHangup, _queuedAt }
const queue = new Map();

// Wrap set() to stamp entries and enforce size cap
const _originalSet = queue.set.bind(queue);
queue.set = function (key, value) {
  if (queue.size >= MAX_QUEUE_SIZE) {
    console.warn('[OutboundQueue] Size cap reached (%d) — dropping oldest entry', MAX_QUEUE_SIZE);
    const firstKey = queue.keys().next().value;
    queue.delete(firstKey);
  }
  return _originalSet(key, { ...value, _queuedAt: Date.now() });
};

// Periodic TTL sweep — runs every 60 s, evicts entries older than ENTRY_TTL_MS
const _sweepInterval = setInterval(() => {
  const now = Date.now();
  let evicted = 0;
  for (const [id, entry] of queue.entries()) {
    if (entry._queuedAt && now - entry._queuedAt > ENTRY_TTL_MS) {
      queue.delete(id);
      evicted++;
    }
  }
  if (evicted > 0) {
    console.log('[OutboundQueue] TTL sweep evicted %d stale entries', evicted);
  }
}, 60_000);

// Don't block process exit
if (_sweepInterval.unref) _sweepInterval.unref();

module.exports = queue;
