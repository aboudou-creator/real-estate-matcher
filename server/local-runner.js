#!/usr/bin/env node
// ─── Local WhatsApp Runner ──────────────────────────────────────────────────
// Runs Baileys on YOUR machine (residential IP) so WhatsApp doesn't block it.
// Writes scraped real-estate data directly to Supabase PostgreSQL.
// Optionally pushes real-time events to the Fly.io backend via Socket.IO.
//
// Usage:
//   1. Copy .env.example to .env and fill in DATABASE_URL
//   2. npm run local
//
// The QR code will appear in your terminal. Scan it with WhatsApp.
// ─────────────────────────────────────────────────────────────────────────────

require('dotenv').config();

const path = require('path');
const { initDB } = require('./db/postgres');
const { ingestMessage } = require('./services/ingestion');

const AUTH_DIR = path.join(__dirname, 'auth_info');
const API_URL = process.env.API_URL || 'https://real-estate-matcher-api.fly.dev';

const TARGET_GROUPS = (process.env.WHATSAPP_GROUP_IDS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

let sock = null;
let remoteSocket = null; // Socket.IO client to Fly.io backend

// ─── Connect to Fly.io Socket.IO (optional, for real-time frontend updates) ─
async function connectRemoteSocket() {
  try {
    const { io } = await import('socket.io-client');
    remoteSocket = io(API_URL, { transports: ['websocket'] });
    remoteSocket.on('connect', () => console.log(`🔗 Connected to remote API (${API_URL})`));
    remoteSocket.on('disconnect', () => console.log('🔗 Disconnected from remote API'));
    remoteSocket.on('connect_error', () => {}); // silent — not critical
  } catch (_) {
    console.log('ℹ️  socket.io-client not installed — frontend won\'t get real-time updates');
    console.log('   Run: npm install socket.io-client   (optional)');
  }
}

function emit(event, data) {
  if (remoteSocket?.connected) remoteSocket.emit(event, data);
}

// ─── Baileys WhatsApp connection ─────────────────────────────────────────────
async function startWhatsApp() {
  const baileys = await import('baileys');
  const makeWASocket = baileys.default || baileys.makeWASocket;
  const { useMultiFileAuthState, DisconnectReason, Browsers } = baileys;
  const P = require('pino');
  const QRCode = require('qrcode-terminal');

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  sock = makeWASocket({
    auth: state,
    version: [2, 3000, 1034074495],
    logger: P({ level: 'warn' }),
    browser: Browsers.macOS('Google Chrome'),
    syncFullHistory: true,
    getMessage: async () => undefined,
  });

  // 14-day history window on connect
  const HISTORY_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
  sock.ev.on('messaging-history.set', async ({ messages, isLatest }) => {
    const cutoffMs = Date.now() - HISTORY_WINDOW_MS;
    const groupMessages = messages.filter(m => {
      if (!m.key?.remoteJid?.endsWith('@g.us')) return false;
      const tsMs = Number(m.messageTimestamp || 0) * 1000;
      return tsMs >= cutoffMs;
    });
    console.log(`📜 History sync: ${groupMessages.length} messages within 14-day window (isLatest=${isLatest})`);
    let processed = 0;
    for (let i = 0; i < groupMessages.length; i += 25) {
      const chunk = groupMessages.slice(i, i + 25);
      for (const msg of chunk) {
        try {
          const r = await handleMessage(msg, { sourceMode: 'history' });
          if (r) processed++;
        } catch (_) {}
      }
      await new Promise(r => setTimeout(r, 50));
    }
    if (groupMessages.length > 0) {
      console.log(`📜 History sync done: ${processed} listings from ${groupMessages.length} messages`);
    }
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n╔══════════════════════════════════════════╗');
      console.log('║   SCAN THIS QR CODE WITH WHATSAPP       ║');
      console.log('╚══════════════════════════════════════════╝\n');
      QRCode.generate(qr, { small: true });
      emit('qr', qr);
    }

    if (connection === 'close') {
      const err = lastDisconnect?.error;
      const code = err?.output?.statusCode;
      console.log(`\n❌ WhatsApp disconnected (code ${code})`);
      if (err) console.log(`   ${err.message}`);

      if (code === DisconnectReason.restartRequired) {
        console.log('   Restarting automatically...');
        setTimeout(startWhatsApp, 1000);
      } else if (code === DisconnectReason.loggedOut) {
        console.log('   Logged out — delete auth_info/ folder and restart to re-link');
        emit('disconnected');
        process.exit(0);
      } else {
        console.log('   Reconnecting in 5 seconds...');
        emit('disconnected');
        setTimeout(startWhatsApp, 5000);
      }
    } else if (connection === 'open') {
      console.log(`\n✅ WhatsApp connected as ${sock.user?.id}`);
      console.log('   Listening for real estate messages...\n');
      emit('connected', { user: sock.user });
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const message of messages) {
      try {
        await handleMessage(message);
      } catch (err) {
        console.error('Error handling message:', err.message);
      }
    }
  });
}

// ─── Message handling pipeline ───────────────────────────────────────
async function handleMessage(message, opts = {}) {
  const jid = message.key.remoteJid;
  if (!jid || !jid.endsWith('@g.us')) return;
  if (TARGET_GROUPS.length > 0 && !TARGET_GROUPS.includes(jid)) return;
  if (message.key.fromMe) return;

  const text =
    message.message?.conversation ||
    message.message?.extendedTextMessage?.text ||
    message.message?.imageMessage?.caption ||
    message.message?.videoMessage?.caption ||
    '';

  if (!text || text.length < 15) return;

  const tsSec = Number(message.messageTimestamp || 0);
  const createdAt = tsSec > 0 ? new Date(tsSec * 1000) : new Date();

  const result = await ingestMessage({
    whatsappMessageId: message.key.id,
    sender: message.pushName || 'Unknown',
    senderPhone: message.key.participant?.split('@')[0] || null,
    groupId: jid,
    groupName: jid,
    text,
    createdAt,
    sourceMode: opts.sourceMode || 'local',
    emit: (event, data) => emit(event, data),
  });

  if (result && result.listingId) {
    console.log(`   → listing #${result.listingId} (cluster #${result.clusterId}, ${result.matchCount} matches)`);
  } else if (result && !result.isNewCluster) {
    console.log(`   → duplicate (cluster #${result.clusterId}, now ${result.duplicateCount} copies)`);
  }
  return result && result.listingId != null;
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  Real Estate Matcher — Local WhatsApp Runner    ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');

  // Init database
  console.log('📦 Connecting to PostgreSQL...');
  await initDB();

  // Connect to remote API for real-time frontend updates
  await connectRemoteSocket();

  // Start WhatsApp
  console.log('📱 Starting WhatsApp connection...');
  await startWhatsApp();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
