// ─── Real Estate Matcher — Server Entry Point ────────────────────────────────
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const { initDB } = require('./db/postgres');
const { connectWhatsApp, getStatus } = require('./services/whatsapp');

// ─── Express + Socket.IO setup ───────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: 'http://localhost:3000', methods: ['GET', 'POST'] },
});

app.use(cors());
app.use(express.json());

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/products', require('./routes/products'));
app.use('/api/real-products', require('./routes/realProducts'));
app.use('/api/matches', require('./routes/matches'));

// WhatsApp endpoints
app.get('/api/status', (_req, res) => res.json(getStatus()));
app.post('/api/whatsapp/reconnect', async (_req, res) => {
  try {
    await connectWhatsApp(io);
    res.json({ ok: true, message: 'Reconnection initiated' });
  } catch (err) {
    res.json({ ok: false, message: err.message });
  }
});

// ─── Socket.IO ───────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log('Client connected');
  socket.on('disconnect', () => console.log('Client disconnected'));
});

// ─── Start ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3002;
const WA_ENABLED = (process.env.WHATSAPP_ENABLED || 'true') !== 'false';

async function start() {
  // Init PostgreSQL tables
  await initDB().catch(err => console.error('PostgreSQL init error:', err));

  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });

  // Connect WhatsApp (optional)
  if (WA_ENABLED) {
    try {
      await connectWhatsApp(io);
    } catch (err) {
      console.error('WhatsApp connection error:', err.message);
      console.log('Server continues without WhatsApp — set WHATSAPP_ENABLED=false to suppress');
    }
  } else {
    console.log('WhatsApp disabled (WHATSAPP_ENABLED=false)');
  }
}

start();
