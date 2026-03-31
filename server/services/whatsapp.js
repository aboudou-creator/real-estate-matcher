// ─── Baileys v7 WhatsApp connection & message pipeline ───────────────────────
// Baileys v7+ is ESM-only. We use dynamic import() from CJS.
// Connects to WhatsApp, listens for group messages, extracts real estate info,
// deduplicates, matches, and emits updates to frontend via Socket.IO.

const path = require('path');
const { extractRealEstateInfo } = require('./extractor');
const { processNewPost } = require('./dedup');
const { findMatchesForProduct } = require('./matcher');

const AUTH_DIR = path.join(__dirname, '..', 'auth_info');

const TARGET_GROUPS = (process.env.WHATSAPP_GROUP_IDS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

let sock = null;
let qrCode = null;
let io = null;
let retryCount = 0;
const MAX_RETRIES = 5;

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

function getStatus() {
  return {
    connected: sock?.user !== undefined,
    qrCode,
    user: sock?.user || null,
    retryCount,
  };
}

async function connectWhatsApp(socketIo) {
  io = socketIo;

  await loadBaileys();

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const P = require('pino');

  sock = makeWASocket({
    auth: state,
    logger: P({ level: 'warn' }),
    browser: Browsers ? Browsers.macOS('Google Chrome') : undefined,
    getMessage: async (key) => {
      // Required by Baileys v7 for message retries / poll decryption.
      // We don't store messages in memory, so return undefined.
      return undefined;
    },
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      retryCount = 0;
      qrCode = qr;
      // Print QR to terminal
      try {
        const QRCode = require('qrcode-terminal');
        QRCode.generate(qr, { small: true });
      } catch (_) {
        console.log('QR string (paste into a QR renderer):', qr.substring(0, 60) + '...');
      }
      io.emit('qr', qr);
      console.log('📱 Scan the QR code above with WhatsApp on your phone');
      console.log('   Or view it in the browser at http://localhost:3000');
    }

    if (connection === 'close') {
      const err = lastDisconnect?.error;
      const statusCode = err?.output?.statusCode;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;
      const isRestart = statusCode === DisconnectReason.restartRequired;

      console.log(`WhatsApp disconnected (code ${statusCode}), attempt ${retryCount + 1}/${MAX_RETRIES}`);
      if (err) console.log(`   Error: ${err.message}`);

      if (isLoggedOut) {
        console.log('WhatsApp logged out — delete auth_info/ and restart to re-authenticate');
        sock = null;
        qrCode = null;
        io.emit('disconnected');
      } else if (isRestart || retryCount < MAX_RETRIES) {
        retryCount = isRestart ? retryCount : retryCount + 1;
        const delay = isRestart ? 1000 : Math.min(3000 * Math.pow(2, retryCount - 1), 60000);
        console.log(`   Reconnecting in ${(delay / 1000).toFixed(0)}s...`);
        setTimeout(() => connectWhatsApp(io), delay);
      } else {
        console.log(`WhatsApp: max retries (${MAX_RETRIES}) reached. Use /api/whatsapp/reconnect or restart.`);
        sock = null;
        io.emit('disconnected');
      }
    } else if (connection === 'open') {
      retryCount = 0;
      console.log(`✅ WhatsApp connected as ${sock.user?.id}`);
      qrCode = null;
      io.emit('connected', { user: sock.user });
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

  return sock;
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

  const extracted = extractRealEstateInfo(text);
  if (!extracted.isRealEstatePost) return;

  console.log(`📨 Real estate post detected from ${message.pushName || 'Unknown'}: ${extracted.title}`);

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

  io.emit('newPost', rawPost);
  if (isDuplicate) {
    io.emit('duplicateDetected', { rawPost, realProductId });
  }
  for (const match of newMatches) {
    io.emit('newMatch', match);
  }

  console.log(
    `   → ${isDuplicate ? 'Duplicate (linked to product #' + realProductId + ')' : 'New product #' + realProductId}` +
    (newMatches.length > 0 ? ` + ${newMatches.length} match(es)` : '')
  );
}

module.exports = { connectWhatsApp, getStatus };
