require('dotenv').config();
const express = require('express');
const cors = require('cors');
const db = require('./db');
const agentRoutes = require('./routes/agent');
const contractorRoutes = require('./routes/contractors');
const conversationRoutes = require('./routes/conversations');
const memoryRoutes = require('./routes/memory');
const webhookRoutes = require('./routes/webhooks');
const voiceRoutes = require('./routes/voice');
const { startHeartbeat } = require('./heartbeat');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({ origin: process.env.FRONTEND_URL || '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Routes
app.use('/api/agent', agentRoutes);
app.use('/api/contractors', contractorRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/memory', memoryRoutes);
app.use('/api/voice', voiceRoutes);   // Field office voice line
app.use('/webhooks', webhookRoutes);

// Start server
async function start() {
        await db.initDB();
        app.listen(PORT, () => {
                  console.log(`Contractor OS backend running on port ${PORT}`);
                  console.log(`Field office voice line: POST /api/voice/telnyx`);
                  console.log(`Field office test endpoint: POST /api/voice/test`);
                  startHeartbeat();
        });
}

start().catch(console.error);
