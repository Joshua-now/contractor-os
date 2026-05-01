require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { setupDatabase } = require('./db');
const agentRoutes = require('./routes/agent');
const contractorRoutes = require('./routes/contractors');
const conversationRoutes = require('./routes/conversations');
const memoryRoutes = require('./routes/memory');
const webhookRoutes = require('./routes/webhooks');
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
app.use('/webhooks', webhookRoutes);

// Start server
async function start() {
  await setupDatabase();
  app.listen(PORT, () => {
    console.log(`Contractor OS backend running on port ${PORT}`);
    startHeartbeat();
  });
}

start().catch(console.error);
