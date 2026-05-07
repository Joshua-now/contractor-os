require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const agentRoutes = require('./routes/agent');
const authRoutes  = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const contractorRoutes = require('./routes/contractors');
const conversationRoutes = require('./routes/conversations');
const memoryRoutes = require('./routes/memory');
const webhookRoutes = require('./routes/webhooks');
const voiceRoutes = require('./routes/voice');
const deskRoutes = require('./routes/desk');
const { startHeartbeat } = require('./heartbeat');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware — support comma-separated FRONTEND_URL for multiple origins
app.use(cors({
  origin: function(origin, callback) {
    const raw = process.env.FRONTEND_URL || '';
    const allowed = raw.split(',').map(u => u.trim()).filter(Boolean);
    // Allow if: no FRONTEND_URL set (wildcard), no origin (curl/Postman), or origin in list
    if (!raw || !origin || allowed.includes('*') || allowed.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error(`CORS: origin '${origin}' not allowed`));
  },
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from public/ (desk UI)
app.use(express.static(path.join(__dirname, '../public')));

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Routes
app.use('/api/auth',  authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/agent', agentRoutes);
app.use('/api/contractors', contractorRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/memory', memoryRoutes);
app.use('/api/voice', voiceRoutes);       // Field office voice line
app.use('/api/desk', deskRoutes);          // Field office desk UI API
app.use('/webhooks', webhookRoutes);

// Start server
async function start() {
  await db.initDB();
  app.listen(PORT, () => {
    console.log(`Contractor OS backend running on port ${PORT}`);
    console.log(`Field office voice line: POST /api/voice/telnyx`);
    console.log(`Field office desk UI: GET /desk.html`);
    console.log(`Field office desk API: POST /api/desk/chat`);
    startHeartbeat();
  });
}

start().catch(console.error);
