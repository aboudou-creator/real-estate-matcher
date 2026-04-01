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
const { extractRealEstateInfo } = require('./services/extractor');
const { processNewPost } = require('./services/dedup');
const { findMatchesForProduct } = require('./services/matcher');

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
    getMessage: async () => undefined,
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

// ─── Message handling pipeline ───────────────────────────────────────────────
async function handleMessage(message) {
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

  const extracted = extractRealEstateInfo(text);
  if (!extracted.isRealEstatePost) return;

  console.log(`📨 Real estate post from ${message.pushName || 'Unknown'}: ${extracted.title}`);

  const postData = {
    title: extracted.title,
    description: extracted.description,
    type: extracted.type,
    category: extracted.category,
    transaction_type: extracted.transactionType,
    price: extracted.price,
    currency: 'XOF',
    city: extracted.city,
    neighborhood: extracted.neighborhood,
    latitude: null,
    longitude: null,
    bedrooms: extracted.bedrooms,
    bathrooms: null,
    area: extracted.area,
    sender: message.pushName || 'Unknown',
    phone: extracted.phone,
    whatsapp_message_id: message.key.id,
    group_id: jid,
  };

  const result = await processNewPost(postData);
  if (!result) return;

  const { rawPost, realProductId, isDuplicate } = result;

  let newMatches = [];
  if (!isDuplicate) {
    newMatches = await findMatchesForProduct(realProductId);
  }

  emit('newPost', rawPost);
  if (isDuplicate) {
    emit('duplicateDetected', { rawPost, realProductId });
  }
  for (const match of newMatches) {
    emit('newMatch', match);
  }

  console.log(
    `   → ${isDuplicate ? 'Duplicate (linked to product #' + realProductId + ')' : 'New product #' + realProductId}` +
    (newMatches.length > 0 ? ` + ${newMatches.length} match(es)` : '')
  );
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
