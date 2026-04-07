// ─── Baileys v7 WhatsApp connection & message pipeline ───────────────────────
// Baileys v7+ is ESM-only. We use dynamic import() from CJS.
// Connects to WhatsApp ONLY when user clicks "Connect WhatsApp" button.
// No auto-retry — user must manually request a new QR code.

const path = require('path');
const fs = require('fs');
const { ingestMessage } = require('./ingestion');
const { getFullRealProduct } = require('../routes/realProducts');

// Build proxy agent from WA_PROXY_URL env var (dynamic import — these packages are ESM-only)
// Supports: socks5://user:pass@host:port  or  http://user:pass@host:port
async function buildProxyAgent() {
  const url = process.env.WA_PROXY_URL;
  if (!url) return undefined;
  console.log(`Using proxy for WhatsApp: ${url.replace(/\/\/.*@/, '//***@')}`);
  if (url.startsWith('socks')) {
    const { SocksProxyAgent } = await import('socks-proxy-agent');
    return new SocksProxyAgent(url);
  }
  const { HttpsProxyAgent } = await import('https-proxy-agent');
  return new HttpsProxyAgent(url);
}

const AUTH_DIR = path.join(__dirname, '..', 'auth_info');

const TARGET_GROUPS = (process.env.WHATSAPP_GROUP_IDS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

let sock = null;
let qrCode = null;
let io = null;

// Cache group JID → name mapping
const groupNameCache = {};

// Baileys ESM modules — loaded once via dynamic import
let makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers;

async function loadBaileys() {
  if (makeWASocket) return; // already loaded
  const baileys = await import('baileys');
  makeWASocket = baileys.default || baileys.makeWASocket;
  useMultiFileAuthState = baileys.useMultiFileAuthState;
  DisconnectReason = baileys.DisconnectReason;
  Browsers = baileys.Browsers;
}

function setIo(socketIo) {
  io = socketIo;
}

function getStatus() {
  return {
    connected: sock?.user !== undefined,
    qrCode,
    user: sock?.user || null,
  };
}

async function connectWhatsApp() {
  // Close previous socket if any
  if (sock) {
    try { sock.end(); } catch (_) {}
    sock = null;
  }
  qrCode = null;

  await loadBaileys();

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const P = require('pino');

  const agent = await buildProxyAgent();

  sock = makeWASocket({
    auth: state,
    version: [2, 3000, 1034074495],
    logger: P({ level: 'warn' }),
    browser: Browsers ? Browsers.macOS('Google Chrome') : undefined,
    agent,
    fetchAgent: agent,
    getMessage: async (key) => {
      // Required by Baileys v7 for message retries / poll decryption.
      return undefined;
    },
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrCode = qr;
      // Print QR to terminal via Baileys' qrcode-terminal
      try {
        const QRCode = require('qrcode-terminal');
        QRCode.generate(qr, { small: true });
      } catch (_) {
        console.log('QR string:', qr.substring(0, 60) + '...');
      }
      if (io) io.emit('qr', qr);
      console.log('📱 QR code generated — scan it with WhatsApp on your phone');
    }

    if (connection === 'close') {
      const err = lastDisconnect?.error;
      const statusCode = err?.output?.statusCode;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;
      const isRestart = statusCode === DisconnectReason.restartRequired;

      console.log(`WhatsApp disconnected (code ${statusCode})`);
      if (err) console.log(`   Error: ${err.message}`);

      if (isRestart) {
        // Baileys requires a restart — auto-reconnect once
        console.log('   Baileys restart required — reconnecting automatically...');
        setTimeout(() => connectWhatsApp(), 1000);
      } else {
        // All other disconnects: stop and wait for user to click button
        const reason = isLoggedOut
          ? 'WhatsApp logged out — click "Connect WhatsApp" to re-authenticate'
          : `Connection failed (code ${statusCode}) — click "Connect WhatsApp" to try again`;
        console.log(reason);
        sock = null;
        qrCode = null;
        if (io) {
          io.emit('disconnected');
          io.emit('wa_error', reason);
        }
      }
    } else if (connection === 'open') {
      console.log(`✅ WhatsApp connected as ${sock.user?.id}`);
      qrCode = null;
      if (io) io.emit('connected', { user: sock.user });
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // WhatsApp pushes recent history automatically on connect via this event
  sock.ev.on('messaging-history.set', async ({ messages, isLatest }) => {
    const groupMessages = messages.filter(m => m.key?.remoteJid?.endsWith('@g.us'));
    console.log(`📜 History sync received: ${groupMessages.length} group message(s) (isLatest=${isLatest})`);
    let processed = 0;
    for (const message of groupMessages) {
      try {
        const result = await handleMessage(message);
        if (result) processed++;
      } catch (err) {
        // skip individual errors
      }
    }
    if (groupMessages.length > 0) {
      console.log(`📜 History sync done: ${processed} real estate post(s) extracted from ${groupMessages.length} messages`);
    }
  });

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

  return sock;
}

async function resolveGroupName(jid) {
  if (groupNameCache[jid]) return groupNameCache[jid];
  try {
    const metadata = await sock.groupMetadata(jid);
    groupNameCache[jid] = metadata.subject || jid;
    return groupNameCache[jid];
  } catch (_) {
    return jid;
  }
}

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

  const groupName = await resolveGroupName(jid);

  // Centralized ingestion: raw capture → classify → extract → dedup/match
  const result = await ingestMessage({
    whatsappMessageId: message.key.id,
    sender: message.pushName || 'Unknown',
    senderPhone: message.key.participant?.split('@')[0] || null,
    groupId: jid,
    groupName,
    text,
    sourceMode: 'live',
    emit: io ? (event, data) => io.emit(event, data) : null,
    getFullRealProduct,
  });

  return result && result.products && result.products.length > 0;
}

async function disconnectWhatsApp() {
  if (sock) {
    try { await sock.logout(); } catch (_) {}
    try { sock.end(); } catch (_) {}
    sock = null;
  }
  qrCode = null;
  // Wipe auth files so next connect asks for a fresh QR code
  try {
    if (fs.existsSync(AUTH_DIR)) {
      fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    }
  } catch (_) {}
  if (io) {
    io.emit('disconnected');
    io.emit('wa_error', 'Disconnected — click "Connect WhatsApp" to scan a new QR code');
  }
  console.log('🔌 WhatsApp session cleared — ready for fresh QR scan');
}

module.exports = { connectWhatsApp, disconnectWhatsApp, getStatus, setIo };
