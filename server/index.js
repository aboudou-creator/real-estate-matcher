// ─── Real Estate Matcher — Server Entry Point ────────────────────────────────
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const { initDB } = require('./db/postgres');
const { connectWhatsApp, disconnectWhatsApp, getStatus, setIo } = require('./services/whatsapp');

// ─── Express + Socket.IO setup ───────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

app.use(cors());
app.use(express.json());

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/products', require('./routes/products'));
app.use('/api/real-products', require('./routes/realProducts'));
app.use('/api/matches', require('./routes/matches'));

// Admin: flush all data
app.post('/api/admin/flush', async (_req, res) => {
  try {
    const { pool } = require('./db/postgres');
    await pool.query('DELETE FROM raw_message_segments');
    await pool.query('DELETE FROM duplicates');
    await pool.query('DELETE FROM matches');
    await pool.query('DELETE FROM products');
    await pool.query('DELETE FROM real_products');
    await pool.query('DELETE FROM raw_messages');
    res.json({ ok: true, message: 'All tables flushed (including raw_messages and segments)' });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// Admin: one-time import all group history
// This triggers a WhatsApp history fetch for all groups (bypasses TARGET_GROUPS)
app.post('/api/admin/import-history', async (_req, res) => {
  const status = getStatus();
  if (!status.connected) {
    return res.status(400).json({ ok: false, message: 'WhatsApp is not connected. Connect first.' });
  }
  try {
    const { pool } = require('./db/postgres');
    const { saveRawMessage } = require('./services/ingestion');
    // Count before
    const before = await pool.query('SELECT COUNT(*) as c FROM raw_messages');
    const beforeCount = parseInt(before.rows[0].c);

    res.json({
      ok: true,
      message: 'History import initiated. Messages from history sync will be captured automatically. Reconnect WhatsApp to trigger a fresh history sync from all groups.',
      before_count: beforeCount,
      tip: 'Use POST /api/whatsapp/disconnect then POST /api/whatsapp/connect to trigger a full history re-sync.',
    });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// WhatsApp endpoints
app.get('/api/status', (_req, res) => res.json(getStatus()));
app.post('/api/whatsapp/connect', async (_req, res) => {
  try {
    await connectWhatsApp();
    res.json({ ok: true, message: 'WhatsApp connection initiated — QR code will appear shortly' });
  } catch (err) {
    res.json({ ok: false, message: err.message });
  }
});
app.post('/api/whatsapp/disconnect', async (_req, res) => {
  try {
    await disconnectWhatsApp();
    res.json({ ok: true, message: 'Disconnected — scan a new QR code to reconnect' });
  } catch (err) {
    res.json({ ok: false, message: err.message });
  }
});

// ─── Socket.IO ───────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('Client connected');
  socket.on('disconnect', () => console.log('Client disconnected'));
});

// Pass Socket.IO reference to WhatsApp service
setIo(io);

// ─── Start ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3002;

async function start() {
  // Init PostgreSQL tables
  await initDB().catch(err => console.error('PostgreSQL init error:', err));

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on 0.0.0.0:${PORT}`);
    console.log('WhatsApp is NOT auto-started — click "Connect WhatsApp" in the UI to begin');
  });
}

start();
