// ─── Baileys v7 WhatsApp connection & message pipeline ───────────────────────
// Baileys v7+ is ESM-only. We use dynamic import() from CJS.
// Connects to WhatsApp ONLY when user clicks "Connect WhatsApp" button.
// No auto-retry — user must manually request a new QR code.

const path = require('path');
const { extractRealEstateInfo } = require('./extractor');
const { processNewPost } = require('./dedup');
const { findMatchesForProduct } = require('./matcher');
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

      // Auto-fetch recent messages from monitored groups
      fetchGroupHistory(sock).catch(err =>
        console.error('Error fetching group history:', err.message)
      );
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

async function fetchGroupHistory(socket) {
  console.log('📜 Fetching recent messages from groups...');

  let groups = [];
  if (TARGET_GROUPS.length > 0) {
    groups = TARGET_GROUPS;
  } else {
    // Get all groups the user is part of
    try {
      const allGroups = await socket.groupFetchAllParticipating();
      groups = Object.keys(allGroups);
    } catch (err) {
      console.error('Failed to fetch groups:', err.message);
      return;
    }
  }

  console.log(`📜 Scanning ${groups.length} group(s) for recent messages...`);

  for (const jid of groups) {
    try {
      const groupName = await resolveGroupName(jid);
      console.log(`📜 Fetching history from: ${groupName}`);

      // Fetch messages in batches using Baileys store-less pagination
      let cursor = undefined;
      let fetched = 0;
      const BATCH = 50;
      const MAX = 500;

      while (fetched < MAX) {
        const limit = Math.min(BATCH, MAX - fetched);
        const result = await socket.fetchMessageHistory(limit, jid, cursor);
        const messages = result?.messages || result || [];
        if (!Array.isArray(messages) || messages.length === 0) break;

        for (const msg of messages) {
          try {
            await handleMessage(msg);
          } catch (err) {
            // skip individual message errors
          }
        }

        fetched += messages.length;
        if (messages.length < limit) break;

        // Set cursor for next batch
        const lastMsg = messages[messages.length - 1];
        cursor = lastMsg.key;
      }

      console.log(`   ✅ Processed ${fetched} messages from ${groupName}`);
    } catch (err) {
      console.error(`   ❌ Error fetching history for ${jid}:`, err.message);
    }
  }

  console.log('📜 History fetch complete.');
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

  // Normalize to array: single product or multiple products
  const products = extracted.multiple ? extracted.products : [extracted];

  console.log(`📨 ${products.length} product(s) detected from ${message.pushName || 'Unknown'} in ${jid}`);

  const groupName = await resolveGroupName(jid);

  for (let i = 0; i < products.length; i++) {
    const item = products[i];
    const postData = {
      title: item.title,
      description: item.description,
      type: item.type,
      category: item.category,
      transaction_type: item.transactionType,
      price: item.price,
      currency: 'XOF',
      city: item.city,
      neighborhood: item.neighborhood,
      latitude: null,
      longitude: null,
      bedrooms: item.bedrooms,
      bathrooms: null,
      area: item.area,
      sender: message.pushName || 'Unknown',
      phone: item.phone,
      // Append index for multi-product posts to avoid unique constraint collision
      whatsapp_message_id: products.length > 1 ? `${message.key.id}_${i}` : message.key.id,
      group_id: jid,
      group_name: groupName,
    };

    try {
      const result = await processNewPost(postData);
      if (!result) continue;

      const { rawPost, realProductId, isDuplicate } = result;

      let newMatches = [];
      if (!isDuplicate) {
        newMatches = await findMatchesForProduct(realProductId);
      }

      // Fetch the full real product (with linked_posts + match_count) and push to frontend
      const fullRP = await getFullRealProduct(realProductId);
      if (fullRP) {
        if (isDuplicate) {
          io.emit('realProductUpdated', fullRP);
        } else {
          io.emit('newRealProduct', fullRP);
        }
      }

      io.emit('newPost', rawPost);
      if (isDuplicate) {
        io.emit('duplicateDetected', { rawPost, realProductId });
      }
      for (const match of newMatches) {
        io.emit('newMatch', match);
        // Re-emit updated real products for both sides of the match
        const [rpA, rpB] = await Promise.all([
          getFullRealProduct(match.post1?._id || match.product1_id),
          getFullRealProduct(match.post2?._id || match.product2_id),
        ]);
        if (rpA) io.emit('realProductUpdated', rpA);
        if (rpB) io.emit('realProductUpdated', rpB);
      }

      console.log(
        `   → [${i + 1}/${products.length}] ${item.title}: ${isDuplicate ? 'Duplicate (#' + realProductId + ')' : 'New #' + realProductId}` +
        (newMatches.length > 0 ? ` + ${newMatches.length} match(es)` : '')
      );
    } catch (err) {
      console.error(`   ✗ Error processing product ${i + 1}/${products.length}: ${err.message}`);
    }
  }
}

module.exports = { connectWhatsApp, getStatus, setIo };
