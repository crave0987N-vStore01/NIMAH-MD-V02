// =========================================================================
// NIMAH MD — Private WhatsApp Bot
// © 2026 Nimah Dev. All Rights Reserved. Proprietary — see LICENSE.
// wa.me/94744136085
// =========================================================================

// --- Web Crypto polyfill ---
// @whiskeysockets/baileys expects a global `crypto` (Web Crypto API) to be
// present, but Node 18 does not expose it as a global by default (only
// Node 19+ does automatically). Without this, pairing-code generation
// throws "ReferenceError: crypto is not defined" from deep inside
// Baileys' internals and the socket loops connecting/closing forever.
// This must run before Baileys is required.
const nodeCrypto = require('crypto');

// ---- Firebase (Firestore) ----
// Persists group settings, AI chat memory, and per-bot customization across
// restarts/redeploys, instead of losing everything from memory each time.
// NOTE: this uses the Firebase client SDK with the web config you gave me —
// there was no service-account key, which is the normal way a Node backend
// talks to Firebase with full admin rights. This works, but it means
// whatever your Firestore Security Rules allow is what this bot can do.
// For anything beyond quick testing, lock down your Firestore rules (e.g.
// restrict to specific fields/collections) rather than leaving it wide
// open — a leaked client apiKey with open rules lets anyone read/write
// your database.
const { initializeApp } = require('firebase/app');
const { getFirestore, doc, getDoc, setDoc, collection, getDocs } = require('firebase/firestore');
const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY || 'AIzaSyBe67RKAUmSYSnOphrPYVCisWdBl3eRZ1w',
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || 'fb-store-bot.firebaseapp.com',
    projectId: process.env.FIREBASE_PROJECT_ID || 'fb-store-bot',
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'fb-store-bot.firebasestorage.app',
    messagingSenderId: process.env.FIREBASE_SENDER_ID || '877752738937',
    appId: process.env.FIREBASE_APP_ID || '1:877752738937:web:c6073288fcd7da97f360a8'
};
const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);
// All Firestore calls are wrapped — if Firestore is unreachable or rules
// reject a call, the bot falls back to its in-memory copy instead of
// crashing the command that triggered it.
async function fsGet(col, id, fallback) {
    try {
        const snap = await getDoc(doc(db, col, id));
        return snap.exists() ? snap.data() : fallback;
    } catch (e) { console.log(`Firestore read failed (${col}/${id}):`, e.message); return fallback; }
}
async function fsSet(col, id, data) {
    try { await setDoc(doc(db, col, id), data, { merge: true }); } catch (e) { console.log(`Firestore write failed (${col}/${id}):`, e.message); }
}
async function fsListIds(col) {
    try { const snap = await getDocs(collection(db, col)); return snap.docs.map(d => d.id); } catch (e) { console.log(`Firestore list failed (${col}):`, e.message); return []; }
}
if (!globalThis.crypto) {
    globalThis.crypto = nodeCrypto.webcrypto;
}

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    Browsers
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const figlet = require('figlet');

const app = express();
app.set('trust proxy', true); // Railway sits behind a proxy — needed for accurate req.ip (used by login rate limiting)
const PORT = process.env.PORT || 3000;
// On Railway, container disk is wiped on every redeploy/restart unless a
// Volume is attached and mounted at a path (Railway sets this in
// RAILWAY_VOLUME_MOUNT_PATH when a volume exists). If a volume is present we
// store the session there so re-pairing isn't required after every deploy;
// otherwise we fall back to local disk (fine for dev, but will require
// re-pairing on Railway restarts without a volume).
const SESSION_ROOT = process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;
const OWNER_NUMBER = ((process.env.OWNER_NUMBER || '94744136085').replace(/[^0-9]/g, '')) || '94744136085';
const BOT_NAME = 'NIMAH MD';
const OWNER_NAME = 'Nimah Dev';
const BOT_LOGO_PATH = path.join(__dirname, 'public', 'logo.jpg');
const getBotLogo = () => { try { return fs.readFileSync(BOT_LOGO_PATH); } catch (e) { return null; } };
// (WhatsApp channel link removed from bot output per request — no longer used.)

// ---- Nimah Private AI Agent ----
// Uses OpenRouter (https://openrouter.ai) with a DeepSeek model. The key
// below is an env-var override with the value you gave me as the fallback —
// same pattern as OWNER_NUMBER. Since it was pasted directly in chat, it's
// worth rotating it from your OpenRouter dashboard and setting it as a
// Railway environment variable (OPENROUTER_API_KEY) instead of leaving it
// hardcoded here, in case this chat or the zip is ever shared with anyone.
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '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';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'deepseek/deepseek-chat';
const AI_WATERMARK = '\n\n🔒 _Nimah Private Agent_\n_Powered By: Nimah MD_';
const chatHistory = new Map();
const chatHistoryLoaded = new Set();
const CHAT_HISTORY_LIMIT = 12;
// Anti-flood: last command timestamp per sender (see the 900ms check in the
// message handler below).
const lastCommandAt = new Map();
// Anti-ban: cooldown for mass-@mention commands per group (see .tagall/.hidetag).
const lastMassTagAt = new Map();
const MASS_TAG_COOLDOWN_MS = 3 * 60 * 1000; // 3 minutes

// ---- Rolling group message buffer (for .vibe and the daily digest) ----
// Separate from the AI agent's chatHistory — this just logs recent plain
// messages per group so those two features have real context to summarize.
const groupMessageLog = new Map(); // jid -> [{sender, text, ts}, ...]
const GROUP_LOG_LIMIT = 60;
function logGroupMessage(jid, sender, text) {
    if (!groupMessageLog.has(jid)) groupMessageLog.set(jid, []);
    const log = groupMessageLog.get(jid);
    log.push({ sender: sender.split('@')[0], text, ts: Date.now() });
    while (log.length > GROUP_LOG_LIMIT) log.shift();
}

// ---- Bot-to-bot / chat-to-chat message bridge ----
// key: "sessionId:jid" of the source chat -> { targetSessionId, targetJid }
const bridges = new Map();
function bridgeKey(sessionId, jid) { return sessionId + ':' + jid; }

// ---- Custom commands (No-Code Command Builder, added via the admin panel) ----
// name -> { reply: string, addedBy: sessionId, createdAt }
const customCommands = new Map();
async function loadCustomCommands() {
    try {
        const ids = await fsListIds('customCommands');
        for (const name of ids) {
            const data = await fsGet('customCommands', name, null);
            if (data && data.reply && !data.deleted) customCommands.set(name, data);
        }
        console.log(`⚙️ Loaded ${customCommands.size} custom command(s) from Firestore.`);
    } catch (e) { console.log('Failed to load custom commands:', e.message); }
}

function pushHistory(jid, role, content) {
    if (!chatHistory.has(jid)) chatHistory.set(jid, []);
    const hist = chatHistory.get(jid);
    hist.push({ role, content });
    while (hist.length > CHAT_HISTORY_LIMIT) hist.shift();
    // Fire-and-forget persistence so a restart doesn't wipe Nimah's memory
    // of the conversation. Firestore doc IDs can't contain '/', which JIDs
    // never do, so the raw jid is safe to use as-is.
    fsSet('chatHistory', jid, { messages: hist });
}
// Lazily restores a chat's saved history from Firestore the first time
// Nimah replies to that jid in this run (mirrors getGroupSettings' pattern).
async function ensureHistoryLoaded(jid) {
    if (chatHistoryLoaded.has(jid)) return;
    chatHistoryLoaded.add(jid);
    const saved = await fsGet('chatHistory', jid, null);
    if (saved && Array.isArray(saved.messages) && !chatHistory.has(jid)) {
        chatHistory.set(jid, saved.messages.slice(-CHAT_HISTORY_LIMIT));
    }
}

async function callNimahAI(jid, userText, senderName) {
    await ensureHistoryLoaded(jid);
    const isGroupChat = jid.endsWith('@g.us');
    const systemPrompt = 'You are Nimah, a warm and friendly private AI agent built into the NIMAH MD WhatsApp bot. You chat naturally like a real friend texting on WhatsApp, not like a formal assistant or a translated robot. Keep replies short and casual (1-3 sentences) unless the person clearly wants a longer, detailed answer. Light emoji use is fine but do not overdo it. IMPORTANT LANGUAGE RULE: always reply in the same language the person is writing in. If they write in Sinhala (Sinhala script or Singlish/romanized Sinhala), reply in natural, everyday SPOKEN Sinhala the way young Sri Lankans actually text each other -- casual words like "monawada", "kohomada", "ela", "hondai", "mokakda" etc are good, and mixing in common English words the way Sri Lankans naturally do (like "ok", "plan", "busy") is fine. Do NOT use stiff, overly formal, or literary Sinhala (avoid words that sound like a textbook or a government notice) -- it should read like a real person texting, not a translation. If they write in English, reply in natural English. You are currently chatting with ' + (senderName || 'someone') + ' on WhatsApp' + (isGroupChat ? ' inside a group chat -- stay friendly and read the flow of the conversation, but do not pretend to know things that were not said' : '') + '.';
    const history = chatHistory.get(jid) || [];
    const messages = [{ role: 'system', content: systemPrompt }].concat(history, [{ role: 'user', content: userText }]);
    const res = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
        model: OPENROUTER_MODEL,
        messages: messages,
        max_tokens: 500
    }, {
        headers: {
            'Authorization': 'Bearer ' + OPENROUTER_API_KEY,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://github.com/',
            'X-Title': BOT_NAME
        },
        timeout: 30000
    });
    const choice = res.data && res.data.choices && res.data.choices[0];
    return choice && choice.message && choice.message.content ? choice.message.content.trim() : null;
}

async function maybeHandleNimahAgent(ctx) {
    const sock = ctx.sock, msg = ctx.msg, from = ctx.from, sender = ctx.sender, isGroup = ctx.isGroup, body = ctx.body, session = ctx.session;
    const mentionsNimah = /\bnimah\b/i.test(body);
    const contextInfo = msg.message && msg.message.extendedTextMessage && msg.message.extendedTextMessage.contextInfo;
    const botId = sock.user && sock.user.id ? sock.user.id.split(':')[0] : null;
    const isReplyToBot = !!(contextInfo && contextInfo.participant && botId && contextInfo.participant.split(':')[0] === botId);
    // In a group: always jump in when named or replied to. Otherwise, join
    // in on a random ~15% of other messages so it feels like a friend who's
    // present in the chat -- not silent unless summoned, but not replying
    // to literally everything either. Skip very short messages (one word
    // like "ok"/"lol") for the random case so it doesn't reply to noise.
    if (isGroup && !mentionsNimah && !isReplyToBot) {
        const longEnough = body.trim().split(/\s+/).length >= 3;
        const randomJoin = longEnough && Math.random() < 0.15;
        if (!randomJoin) return;
    }

    try {
        const senderName = sender ? sender.split('@')[0] : null;
        const answer = await callNimahAI(from, body, senderName);
        if (!answer) return;
        pushHistory(from, 'user', body);
        pushHistory(from, 'assistant', answer);
        // Routed through the session's paced send queue (typing indicator +
        // randomized delay) instead of firing straight through sock, same
        // anti-ban pacing as every other reply.
        await session.queueSend(from, { text: answer + AI_WATERMARK }, { quoted: msg });
    } catch (e) {
        console.log('Nimah agent error:', (e && e.response && e.response.data) || (e && e.message) || e);
        if (isGroup ? (mentionsNimah || isReplyToBot) : true) {
            try { await session.queueSend(from, { text: '⚠️ Nimah is having trouble thinking right now — try again in a moment.' + AI_WATERMARK }, { quoted: msg }); } catch (e2) {}
        }
    }
}
const PUBLIC_DIR = path.join(__dirname, 'public');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(PUBLIC_DIR, { maxAge: '7d', etag: true }));

// ---- Multi-Session Bot Manager ----
// Each browser that opens the pairing page gets its own WhatsApp session, so
// any number of bots can be paired concurrently from the same deployment.
// sessionId -> { sock, isConnected, currentQR, reconnectAttempts, reconnectTimer,
//                pairingInProgress, sessionDir, createdAt }
const sessions = new Map();
const MAX_RECONNECT_DELAY_MS = 60000; // cap backoff at 60s
const startTime = Date.now();

function newSessionId() {
    return nodeCrypto.randomBytes(6).toString('hex');
}
function getSession(id) {
    return id ? sessions.get(id) : undefined;
}
function activeBotCount() {
    let n = 0;
    for (const s of sessions.values()) if (s.isConnected) n++;
    return n;
}

// In-memory (non-persistent) per-group settings — reset on restart.
// Fine for toggles like antilink/warn counts; not meant as a database.
const groupSettings = {}; // jid -> { antilink: bool, rules: string, warns: { participantJid: count } }
const groupSettingsLoaded = new Set(); // jids already pulled from Firestore this run
function getGroupSettings(jid) {
    if (!groupSettings[jid]) groupSettings[jid] = { antilink: false, rules: '', warns: {} };
    // Lazily pull any saved settings from Firestore the first time this
    // group is touched in this run, so settings survive restarts/redeploys
    // without making every single read wait on a network round-trip.
    if (!groupSettingsLoaded.has(jid)) {
        groupSettingsLoaded.add(jid);
        fsGet('groupSettings', jid, null).then((saved) => {
            if (saved) Object.assign(groupSettings[jid], saved);
        });
    }
    return groupSettings[jid];
}
// Fire-and-forget write-through to Firestore — call after any mutation.
// Not awaited by callers so replies stay fast even if Firestore is slow.
function persistGroupSettings(jid) {
    fsSet('groupSettings', jid, groupSettings[jid]);
}
// Sends the AI-summarized daily digest to a group. Triggered opportunistically
// (see the message handler) rather than by a standalone global timer, since
// that avoids needing to track which bot session serves which group.
async function sendDailyDigest(session, jid) {
    const log = groupMessageLog.get(jid) || [];
    if (log.length < 8) return; // not enough activity to bother summarizing
    const transcript = log.map(m => `${m.sender}: ${m.text}`).join('\n');
    try {
        const summary = await callNimahAI(jid + ':digest', `Here are recent messages from a WhatsApp group over roughly the last day:\n\n${transcript}\n\nWrite a short, friendly daily digest (4-6 sentences) covering: the main topics discussed, and the overall mood. Don't quote people by name unless it adds real value.`, null);
        if (!summary) return;
        await session.queueSend(jid, { text: `📰 *Daily Digest*\n\n${summary}\n\n> Auto-generated by Nimah AI` });
    } catch (e) { console.log('Digest generation failed:', e.message); }
}
// Auto Status View/React default — applied per-session below so every bot
// that gets paired through this deployment has it ON out of the box,
// independently of any other bot paired on the same server.
const AUTO_STATUS_DEFAULT = { view: true, react: true, emoji: '💚' };

// ---- Web Pairing Portal ----
// Serve the pairing portal (static file — see public/pair.html)
app.get('/', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'pair.html'));
});
app.get('/admin', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'admin.html'));
});
app.get('/settings', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'settings.html'));
});

// =========================================================================
// Self-Service Settings API (per bot owner — NOT the global admin panel)
// =========================================================================
// Each paired bot gets its own auto-generated password, sent to that
// person's own WhatsApp "You" chat when their bot first connects (see the
// connection.update 'open' handler). Logging in here with phone + that
// password only ever exposes THAT ONE bot's settings, never anyone else's.
function findSessionByLogin(phone, password) {
    const cleanPhone = (phone || '').replace(/[^0-9]/g, '');
    for (const s of sessions.values()) {
        if (s.ownerNumber === cleanPhone && s.userPassword && s.userPassword === password) return s;
    }
    return null;
}
function requireUser(req, res, next) {
    const phone = req.headers['x-user-phone'];
    const password = req.headers['x-user-password'];
    const s = findSessionByLogin(phone, password);
    if (!s) return res.status(401).json({ error: 'Invalid phone number or password.' });
    req.userSession = s;
    next();
}
app.post('/api/user/login', (req, res) => {
    const { phone, password } = req.body || {};
    const s = findSessionByLogin(phone, password);
    if (!s) return res.status(401).json({ error: 'No bot found for that number and password.' });
    res.json({ ok: true });
});
app.get('/api/user/me', requireUser, (req, res) => {
    const s = req.userSession;
    res.json({ id: s.id, label: s.label || null, connected: s.isConnected, autoStatus: s.autoStatus });
});
app.post('/api/user/label', requireUser, (req, res) => {
    const s = req.userSession;
    const { label } = req.body || {};
    s.label = (label || '').slice(0, 40);
    fsSet('botConfig', s.id, { autoStatus: s.autoStatus, label: s.label, userPassword: s.userPassword, ownerNumber: s.ownerNumber });
    res.json({ ok: true, label: s.label });
});
app.post('/api/user/autostatus', requireUser, (req, res) => {
    const s = req.userSession;
    const { view, react, emoji } = req.body || {};
    if (typeof view === 'boolean') s.autoStatus.view = view;
    if (typeof react === 'boolean') s.autoStatus.react = react;
    if (typeof emoji === 'string' && emoji) s.autoStatus.emoji = emoji;
    fsSet('botConfig', s.id, { autoStatus: s.autoStatus, label: s.label || null, userPassword: s.userPassword, ownerNumber: s.ownerNumber });
    res.json({ ok: true, autoStatus: s.autoStatus });
});

// Creates a brand-new bot session so a new device/browser can pair its own
// WhatsApp number without disturbing any bot that's already connected.
app.post('/api/new-session', async (req, res) => {
    try {
        const id = newSessionId();
        await startBotSession(id);
        res.json({ sessionId: id });
    } catch (e) {
        console.log('Error creating session:', e);
        res.status(500).json({ error: 'Failed to create a new session.' });
    }
});

// Live count of currently-connected bots + total sessions ever started this run.
app.get('/api/stats', (req, res) => {
    res.json({ active: activeBotCount(), total: sessions.size });
});

app.get('/health', (req, res) => {
    const s = getSession(req.query.session);
    if (!s) return res.json({ status: 'ok', connected: false, exists: false });
    res.json({ status: 'ok', connected: s.isConnected, exists: true });
});

app.get('/qr', async (req, res) => {
    const s = getSession(req.query.session);
    if (!s) return res.status(404).json({ error: 'Session not found. Refresh the page to start a new one.' });
    if (s.isConnected) return res.status(404).json({ error: 'Bot is already connected!' });
    if (!s.currentQR) return res.status(404).json({ error: 'No QR available yet. Try again in a few seconds.' });
    try {
        const buffer = await QRCode.toBuffer(s.currentQR, { width: 320, margin: 1 });
        res.set('Content-Type', 'image/png');
        res.set('Cache-Control', 'no-store');
        res.send(buffer);
    } catch (e) {
        res.status(500).json({ error: 'Failed to render QR code.' });
    }
});

// ---- Pair-by-code (Empire style) ----
// 8-character custom pairing code. Override with PAIR_CODE env var
// (A-Z / 0-9 only, exactly 8 chars). Falls back to a random code if
// WhatsApp / Baileys rejects the custom one.
const PAIR_CODE_CUSTOM = (process.env.PAIR_CODE || 'NIMAHMD1').toUpperCase().replace(/[^A-Z0-9]/g, '');
function waitForPairReady(s, timeoutMs) {
    return new Promise((resolve) => {
        const t0 = Date.now();
        const iv = setInterval(() => {
            if (s.currentQR || s.isConnected || Date.now() - t0 > timeoutMs) {
                clearInterval(iv);
                resolve();
            }
        }, 250);
    });
}
// Standard pair-site flow: wait until the socket is at the pair-device stage,
// request the code (custom 8-char first, random as fallback), retry a few
// times on transient failures, never run if the session is already linked.
async function requestEmpirePairCode(s, number) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
        await waitForPairReady(s, 15000);
        if (s.isConnected || s.sock?.authState?.creds?.registered) throw new Error('already_connected');
        if (!s.sock) throw new Error('no_socket');
        await sleep(1500);
        try {
            let code = null;
            if (PAIR_CODE_CUSTOM.length === 8) {
                try { code = await s.sock.requestPairingCode(number, PAIR_CODE_CUSTOM); } catch (e) { code = null; }
            }
            if (!code) code = await s.sock.requestPairingCode(number);
            if (code) return code;
        } catch (e) {
            lastErr = e;
            console.log(`pair-code attempt ${attempt} failed:`, e?.message || e);
            await sleep(2000);
        }
    }
    throw lastErr || new Error('pair_failed');
}
app.post('/api/pair-code', async (req, res) => {
    const s = getSession(req.body?.session);
    if (!s) return res.status(404).json({ error: 'Session not found. Refresh the page.' });
    const number = String(req.body?.number || '').replace(/\D/g, '');
    if (number.length < 8 || number.length > 15) {
        return res.status(400).json({ error: 'Enter a valid number with country code (digits only).' });
    }
    try {
        const raw = await requestEmpirePairCode(s, number);
        const code = String(raw).match(/.{1,4}/g)?.join('-') || raw;
        res.json({ code });
    } catch (e) {
        if (e.message === 'already_connected') return res.status(400).json({ error: 'Bot is already connected!' });
        console.log('pair-code error:', e?.message || e);
        res.status(500).json({ error: 'Could not generate a code. Wait a few seconds and try again.' });
    }
});

// =========================================================================
// Admin Panel API
// =========================================================================
// Single shared password, not per-user accounts — this is a private tool
// for the bot owner, not a multi-tenant SaaS. Set ADMIN_PASSWORD as a
// Railway env var; the fallback below is NOT secure to leave as-is on a
// public deployment.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || ('nimah-admin-' + OWNER_NUMBER);
// ---- Admin session tokens ----
// The raw password is only ever sent once, at login. Every request after
// that uses a random token instead, so the password itself isn't
// repeatedly flying over the network on every panel action.
const adminTokens = new Map(); // token -> expiresAt
const ADMIN_TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
function issueAdminToken() {
    const token = nodeCrypto.randomBytes(24).toString('hex');
    adminTokens.set(token, Date.now() + ADMIN_TOKEN_TTL_MS);
    return token;
}
// ---- Login rate limiting ----
// Blocks brute-forcing the admin password: 5 wrong attempts from the same
// IP locks that IP out for 5 minutes.
const loginAttempts = new Map(); // ip -> { count, lockedUntil }
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 5 * 60 * 1000;
function checkRateLimit(ip) {
    const rec = loginAttempts.get(ip);
    if (rec && rec.lockedUntil && Date.now() < rec.lockedUntil) {
        return Math.ceil((rec.lockedUntil - Date.now()) / 1000);
    }
    return 0;
}
function recordFailedLogin(ip) {
    const rec = loginAttempts.get(ip) || { count: 0, lockedUntil: 0 };
    rec.count++;
    if (rec.count >= LOGIN_MAX_ATTEMPTS) { rec.lockedUntil = Date.now() + LOGIN_LOCKOUT_MS; rec.count = 0; }
    loginAttempts.set(ip, rec);
}
function clearLoginAttempts(ip) { loginAttempts.delete(ip); }

function requireAdmin(req, res, next) {
    const token = req.headers['x-admin-token'];
    const expiresAt = token && adminTokens.get(token);
    if (!expiresAt || Date.now() > expiresAt) return res.status(401).json({ error: 'Session expired. Please log in again.' });
    next();
}
app.post('/api/admin/login', (req, res) => {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const lockedFor = checkRateLimit(ip);
    if (lockedFor > 0) return res.status(429).json({ error: `Too many attempts. Try again in ${lockedFor}s.` });
    const { password } = req.body || {};
    if (password !== ADMIN_PASSWORD) { recordFailedLogin(ip); return res.status(401).json({ error: 'Wrong password.' }); }
    clearLoginAttempts(ip);
    res.json({ ok: true, token: issueAdminToken() });
});
app.post('/api/admin/logout', requireAdmin, (req, res) => {
    adminTokens.delete(req.headers['x-admin-token']);
    res.json({ ok: true });
});
app.get('/api/admin/sessions', requireAdmin, (req, res) => {
    const list = Array.from(sessions.values()).map(s => ({
        id: s.id,
        label: s.label || null,
        connected: s.isConnected,
        createdAt: s.createdAt,
        autoStatus: s.autoStatus
    }));
    res.json({ sessions: list });
});
app.get('/api/admin/stats', requireAdmin, (req, res) => {
    res.json({
        active: activeBotCount(),
        total: sessions.size,
        commands: new Set(Object.values(commands)).size,
        uptimeSec: Math.floor(process.uptime()),
        memoryMb: (process.memoryUsage().rss / 1024 / 1024).toFixed(1)
    });
});
app.post('/api/admin/sessions/:id/autostatus', requireAdmin, (req, res) => {
    const s = getSession(req.params.id);
    if (!s) return res.status(404).json({ error: 'Session not found.' });
    const { view, react, emoji } = req.body || {};
    if (typeof view === 'boolean') s.autoStatus.view = view;
    if (typeof react === 'boolean') s.autoStatus.react = react;
    if (typeof emoji === 'string' && emoji) s.autoStatus.emoji = emoji;
    fsSet('botConfig', s.id, { autoStatus: s.autoStatus, label: s.label || null });
    res.json({ ok: true, autoStatus: s.autoStatus });
});
app.post('/api/admin/sessions/:id/label', requireAdmin, (req, res) => {
    const s = getSession(req.params.id);
    if (!s) return res.status(404).json({ error: 'Session not found.' });
    const { label } = req.body || {};
    s.label = (label || '').slice(0, 40);
    fsSet('botConfig', s.id, { autoStatus: s.autoStatus, label: s.label });
    res.json({ ok: true, label: s.label });
});
app.post('/api/admin/sessions/:id/restart', requireAdmin, async (req, res) => {
    const s = getSession(req.params.id);
    if (!s) return res.status(404).json({ error: 'Session not found.' });
    try { s.sock?.end?.(); } catch (e) {}
    startBotSession(req.params.id).catch((err) => console.log('Admin restart failed:', err));
    res.json({ ok: true });
});
app.post('/api/admin/broadcast', requireAdmin, async (req, res) => {
    const { sessionId, jid, text } = req.body || {};
    const s = getSession(sessionId);
    if (!s) return res.status(404).json({ error: 'Session not found.' });
    if (!s.isConnected) return res.status(400).json({ error: 'That bot is not connected right now.' });
    if (!jid || !text) return res.status(400).json({ error: 'jid and text are both required.' });
    try {
        await s.queueSend(jid, { text });
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message || 'Failed to send.' });
    }
});

// ---- No-Code Command Builder ----
// Lets the owner add a simple text-reply command from the admin panel,
// with no code changes or redeploy needed. These live alongside the
// built-in commands but can't override them (checked before creating).
app.get('/api/admin/custom-commands', requireAdmin, (req, res) => {
    res.json({ commands: Array.from(customCommands.entries()).map(([name, data]) => ({ name, ...data })) });
});
app.post('/api/admin/custom-commands', requireAdmin, async (req, res) => {
    let { name, reply } = req.body || {};
    name = (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!name || !reply) return res.status(400).json({ error: 'name and reply are both required.' });
    if (commands[name]) return res.status(400).json({ error: `".${name}" is already a built-in command and can't be overridden.` });
    const data = { reply: reply.slice(0, 2000), createdAt: Date.now() };
    customCommands.set(name, data);
    await fsSet('customCommands', name, data);
    res.json({ ok: true, name });
});
app.delete('/api/admin/custom-commands/:name', requireAdmin, async (req, res) => {
    const name = req.params.name.toLowerCase();
    customCommands.delete(name);
    await fsSet('customCommands', name, { reply: null, deleted: true });
    res.json({ ok: true });
});

// =========================================================================
// Helpers
// =========================================================================
function safeCalculate(expression) {
    const sanitized = expression.replace(/\s+/g, '');
    if (!/^[0-9+\-*/().%]+$/.test(sanitized)) throw new Error('Invalid characters in expression');
    if (sanitized.length > 100) throw new Error('Expression too long');
    // eslint-disable-next-line no-new-func
    const result = Function(`"use strict"; return (${sanitized});`)();
    if (typeof result !== 'number' || !Number.isFinite(result)) throw new Error('Invalid result');
    return result;
}
function fmtDuration(ms) {
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return `${d}d ${h}h ${m}m ${sec}s`;
}
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function genPassword(len = 12) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    let out = '';
    for (let i = 0; i < len; i++) out += chars[randInt(0, chars.length - 1)];
    return out;
}

// =========================================================================
// Static content banks
// =========================================================================
const QUOTES = [
    'Success is not final; failure is not fatal: It is the courage to continue that counts.',
    'Code is like humor. When you have to explain it, it’s bad.',
    'Stay focused, work hard, and make it happen!',
    'The only way to do great work is to love what you do.',
    'Don’t watch the clock; do what it does. Keep going.'
];
const JOKES = [
    'Why do programmers prefer dark mode? Because light attracts bugs! 🐛',
    'There are 10 types of people in the world: those who understand binary, and those who don\'t.',
    'Why did the developer go broke? Because he used up all his cache.',
    'I would tell you a UDP joke, but you might not get it.',
    'A SQL query walks into a bar, walks up to two tables and asks: "Can I join you?"'
];
const FACTS = [
    'Honey never spoils — archaeologists have found 3000-year-old honey that’s still edible.',
    'Bananas are berries, but strawberries aren’t.',
    'A day on Venus is longer than a year on Venus.',
    'Octopuses have three hearts and blue blood.',
    'The first computer bug was an actual moth stuck in a relay in 1947.'
];
const CATFACTS = [
    'Cats spend 70% of their lives sleeping.',
    'A group of cats is called a clowder.',
    'Cats can\'t taste sweetness.'
];
const DOGFACTS = [
    'A dog\'s nose print is unique, like a human fingerprint.',
    'Puppies are born deaf, blind, and toothless.',
    'Dogs have three eyelids.'
];
const RIDDLES = [
    { q: 'What has keys but no locks, space but no room, and you can enter but not go in?', a: 'A keyboard' },
    { q: 'The more you take, the more you leave behind. What am I?', a: 'Footsteps' },
    { q: 'What has a head, a tail, is brown, and has no legs?', a: 'A penny' }
];
const WISDOM = [
    'A smooth sea never made a skilled sailor.',
    'Fall seven times, stand up eight.',
    'The best time to plant a tree was 20 years ago. The second best time is now.'
];
const PROVERBS = [
    'Actions speak louder than words.',
    'Where there’s a will, there’s a way.',
    'A bird in hand is worth two in the bush.'
];
const ROASTS = [
    'You bring everyone so much joy... when you leave the room. 😏',
    'You\'re not stupid, you just have bad luck thinking. 😂'
];
const PRAISES = [
    'You\'re doing amazing, keep shining! ✨',
    'Your energy today is unmatched! 🔥'
];
const COMPLIMENTS = [
    'You have a great sense of humor! 😄',
    'You\'re one of a kind! 🌟'
];
const TRUTHS = [
    'What is your biggest fear?',
    'What is the most embarrassing thing that happened to you?'
];
const DARES = [
    'Send a voice note singing your favorite song.',
    'Text your crush "hi" right now.'
];
const WOULD = [
    'Would you rather have the ability to fly or be invisible?',
    'Would you rather live without music or without TV?'
];
const TRIVIA = [
    { q: 'What is the capital of Japan?', a: 'Tokyo' },
    { q: 'How many continents are there?', a: '7' }
];
const HOROSCOPES = {
    aries: 'Today calls for bold decisions.', taurus: 'Patience will pay off today.',
    gemini: 'A good day for conversations.', cancer: 'Focus on family and comfort.',
    leo: 'Your confidence shines today.', virgo: 'Details matter — stay sharp.',
    libra: 'Balance work and rest today.', scorpio: 'Trust your instincts.',
    sagittarius: 'Adventure calls, say yes.', capricorn: 'Discipline brings results.',
    aquarius: 'Innovative ideas flow easily.', pisces: 'Your intuition is strong today.'
};
const MOTIVATE = [
    'Push yourself, because no one else is going to do it for you.',
    'Great things never come from comfort zones.'
];

// =========================================================================
// Command registry
// commands: canonical name -> { category, desc, adminOnly, groupOnly, ownerOnly, aliases: [], run(ctx) }
// =========================================================================
const commands = {};
function reg(name, def) { commands[name] = def; (def.aliases || []).forEach(a => { commands[a] = def; }); }

// =========================================================================
// GHOST-STYLE TEXT DESIGN ENGINE
// Status-panel cards, small-caps text, Sinhala greeting, and "reply with a
// number" menus (reply to the menu message with 1, 2, 3 ... to open it).
// =========================================================================
const osMod = require('os');
const SMALL_CAPS = { a:'ᴀ',b:'ʙ',c:'ᴄ',d:'ᴅ',e:'ᴇ',f:'ꜰ',g:'ɢ',h:'ʜ',i:'ɪ',j:'ᴊ',k:'ᴋ',l:'ʟ',m:'ᴍ',n:'ɴ',o:'ᴏ',p:'ᴘ',q:'ǫ',r:'ʀ',s:'ꜱ',t:'ᴛ',u:'ᴜ',v:'ᴠ',w:'ᴡ',x:'x',y:'ʏ',z:'ᴢ' };
const sc = (t) => String(t).replace(/[a-z]/gi, (c) => SMALL_CAPS[c.toLowerCase()] || c);

// Sri Lanka time (UTC+5:30), independent of the server's timezone.
const BOT_TZ = process.env.BOT_TIMEZONE || 'Asia/Colombo';
function nowParts() {
    const d = new Date();
    const time = d.toLocaleTimeString('en-US', { timeZone: BOT_TZ, hour12: true });
    const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: BOT_TZ, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(d);
    const g = (t) => ymd.find((x) => x.type === t).value;
    const hour = parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: BOT_TZ, hour: '2-digit', hour12: false }).format(d), 10) % 24;
    return { time, date: `${g('year')}/${g('month')}/${g('day')}`, hour };
}
function greetingSi(hour) {
    if (hour >= 5 && hour < 12) return 'සුබ උදෑසනක්.';
    if (hour >= 12 && hour < 16) return 'සුබ දහවලක්.';
    if (hour >= 16 && hour < 19) return 'සුබ සන්ධ්‍යාවක්.';
    return 'සුබ රාත්‍රියක්.';
}
const PLATFORM_NAMES = { linux: 'Linux', win32: 'Windows', darwin: 'macOS', android: 'Android' };
const FOOTER = () => `> ${sc(BOT_NAME)} ${sc('bot')} ᴠ${require('./package.json').version}\n> _${sc('crafted by')} ${sc(OWNER_NAME)}_ ⚡`;

// The "STATUS PANEL" box, same layout as the Ghost Air bot.
function statusPanel() {
    const { time, date, hour } = nowParts();
    return [
        `╭──「 *${sc('status panel')}* 」`,
        `│ 🔮 \`${greetingSi(hour)}\``,
        `│ ⏰ ${sc('time')} : *${time}*`,
        `│ 📅 ${sc('date')} : *${date}*`,
        `│ 🎃 ${sc('bot name')} : *${BOT_NAME}*`,
        `│ 🎡 ${sc('owner')} : *${OWNER_NAME.toUpperCase()}*`,
        `│ 📟 ${sc('platform')} : *${PLATFORM_NAMES[osMod.platform()] || osMod.platform()}*`,
        `╰──────────────●●►`
    ].join('\n');
}

// Ordered category list used for the numbered menu.
function menuCategories() {
    const grouped = {};
    const printed = new Set();
    for (const def of Object.values(commands)) {
        if (printed.has(def)) continue;
        printed.add(def);
        (grouped[def.category] = grouped[def.category] || []).push(def.desc);
    }
    const ORDER = ['System', 'Owner', 'Group', 'Fun', 'Tools', 'Text', 'Sticker', 'Search'];
    const cats = Object.keys(grouped).sort((a, b) => {
        const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
        if (ia === -1 && ib === -1) return a.localeCompare(b);
        if (ia === -1) return 1;
        if (ib === -1) return -1;
        return ia - ib;
    });
    return { grouped, cats, total: printed.size };
}

function mainMenuCaption(pushName) {
    const { grouped, cats } = menuCategories();
    const lines = cats.map((c, i) => `${i + 1} ❯❯ *${(CATEGORY_EMOJI[c] || '✨')} ${sc(c + ' menu')}* (${grouped[c].length})`);
    lines.push(`${cats.length + 1} ❯❯ *📜 ${sc('all menu')}*`);
    return `🌟 *_Hey_ , ${pushName || 'User'}* ✨\n🍟 *${sc('welcome to')} ${BOT_NAME}* 🦊\n\n` +
        `${statusPanel()}\n\n` +
        `👋 *${sc('hey')} , ${pushName || 'User'} ${sc("i'm alive!")}* ⚡ ${sc('so what can i do for you?')} 😊\n\n` +
        `☲ 🔢 *${sc('reply with number')}* ☲\n\n` +
        lines.join('\n') + `\n\n${FOOTER()}`;
}

function categoryCaption(cat) {
    const { grouped } = menuCategories();
    const list = grouped[cat] || [];
    const bullets = CATEGORY_BULLETS[cat] || ['✨'];
    const body = list.map((d, i) => `│ ${bullets[i % bullets.length]} ${d}`).join('\n');
    return `╭──「 ${CATEGORY_EMOJI[cat] || '✨'} *${sc(cat + ' menu')}* 」\n│ ${sc('total')} : *${list.length}*\n├──────────────\n${body}\n╰──────────────●●►\n\n` +
        `↩️ ${sc('reply')} *0* ${sc('to go back to the main menu')}\n\n${FOOTER()}`;
}
function allMenuCaption() {
    const { grouped, cats } = menuCategories();
    let out = `${statusPanel()}\n`;
    for (const c of cats) {
        const bullets = CATEGORY_BULLETS[c] || ['✨'];
        out += `\n╭──「 ${CATEGORY_EMOJI[c] || '✨'} *${sc(c + ' menu')}* 」\n` +
            grouped[c].map((d, i) => `│ ${bullets[i % bullets.length]} ${d}`).join('\n') + `\n╰──────────────●●►\n`;
    }
    return out + `\n↩️ ${sc('reply')} *0* ${sc('to go back')}\n\n${FOOTER()}`;
}

// sent-message-id -> { kind: 'main' | 'sub' }  (so "1", "2"... replies are understood)
const menuReplyMap = new Map();
function rememberMenu(from, sent, kind) {
    const id = sent && sent.key && sent.key.id;
    if (!id) return;
    menuReplyMap.set(`${from}:${id}`, { kind, at: Date.now() });
    if (menuReplyMap.size > 500) { // keep memory small
        for (const [k, v] of menuReplyMap) if (Date.now() - v.at > 60 * 60 * 1000) menuReplyMap.delete(k);
    }
}
async function sendDesignedMenu(session, from, msg, caption, kind) {
    const logo = getBotLogo();
    const content = logo ? { image: logo, caption } : { text: caption };
    const sent = await session.queueSend(from, content, { quoted: msg });
    rememberMenu(from, sent, kind);
}
// Called from the message handler for plain-number messages. Returns true if it handled it.
async function handleMenuNumberReply({ session, msg, from, body }) {
    if (!/^\d{1,2}$/.test(body.trim())) return false;
    const ctx = msg.message && msg.message.extendedTextMessage && msg.message.extendedTextMessage.contextInfo;
    const quotedId = ctx && ctx.stanzaId;
    if (!quotedId) return false;
    const entry = menuReplyMap.get(`${from}:${quotedId}`);
    if (!entry) return false;
    const n = parseInt(body.trim(), 10);
    const { cats } = menuCategories();
    if (n === 0) { await sendDesignedMenu(session, from, msg, mainMenuCaption(msg.pushName), 'main'); return true; }
    if (entry.kind === 'main') {
        if (n >= 1 && n <= cats.length) { await sendDesignedMenu(session, from, msg, categoryCaption(cats[n - 1]), 'sub'); return true; }
        if (n === cats.length + 1) { await sendDesignedMenu(session, from, msg, allMenuCaption(), 'sub'); return true; }
        await session.queueSend(from, { text: `❌ ${sc('invalid number. reply with')} 1 - ${cats.length + 1}` }, { quoted: msg });
        return true;
    }
    return false;
}

// ---- SYSTEM ----
reg('ping', { category: 'System', desc: '.ping', aliases: ['speed'], run: async ({ sock, from, msg, session }) => {
    // Round-trip time of a tiny reaction message (no extra "pinging..." text).
    const t0 = process.hrtime.bigint();
    try { await sock.sendMessage(from, { react: { text: '⚡', key: msg.key } }); } catch (e) {}
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const status = ms < 300 ? '🟢 Good' : ms < 800 ? '🟡 Average' : '🔴 Slow';
    const caption = `╭──◄📡►──────────\n│ 🚀 *${sc('bot speed')}*\n╰──◄📡►──────────\n\n` +
        `📡 *${sc('ping')}:* \`${ms.toFixed(3)}ms\`\n🛰️ *${sc('status')}:* ${status}\n\n${FOOTER()}`;
    const logo = getBotLogo();
    await session.queueSend(from, logo ? { image: logo, caption } : { text: caption }, { quoted: msg });
}});
reg('alive', { category: 'System', desc: '.alive', run: async ({ from, msg, session }) => {
    const up = Math.floor(process.uptime());
    const h = Math.floor(up / 3600), m = Math.floor((up % 3600) / 60), sec = up % 60;
    const name = msg.pushName || 'User';
    const caption = `🌟 *_Hey_ , ${name}* ✨\n🍟 *${sc('welcome to')} ${BOT_NAME}* 🦊\n\n${statusPanel()}\n\n` +
        `👋 *${sc("i'm alive!")}* ⚡\n⏱️ *${sc('uptime')}:* ${h}h ${m}m ${sec}s\n✨ ${sc('type')} *.menu* ${sc('to see all commands')}\n\n${FOOTER()}`;
    const logo = getBotLogo();
    await session.queueSend(from, logo ? { image: logo, caption } : { text: caption }, { quoted: msg });
}});
reg('runtime', { category: 'System', desc: '.runtime', aliases: ['uptime'], run: async ({ reply }) => {
    await reply(`╭━━━〔 ⏱️ *RUNTIME* 〕━━━┈⊷\n┃ Online for: *${fmtDuration(Date.now() - startTime)}*\n╰━━━━━━━━━━━━━━━━━━━━━━━┈⊷`);
}});
reg('owner', { category: 'System', desc: '.owner', run: async ({ reply }) => {
    await reply(OWNER_NUMBER ? `╭━━━〔 👑 *OWNER INFO* 〕━━━┈⊷\n┃ 👤 *Name:* ${OWNER_NAME}\n┃ 📞 *Contact:* wa.me/${OWNER_NUMBER}\n╰━━━━━━━━━━━━━━━━━━━━━━━┈⊷` : '👑 Owner number not configured (set OWNER_NUMBER env var).');
}});
reg('autostatus', { category: 'Owner', desc: '.autostatus [view/react/emoji] [on/off/emoji]', ownerOnly: true, run: async ({ reply, args, session }) => {
    const mode = (args[0] || '').toLowerCase();
    const val = (args[1] || '').toLowerCase();
    if (!mode) {
        return reply(`👁️ *Auto Status Settings*\n┃ View: ${session.autoStatus.view ? '✅ ON' : '❌ OFF'}\n┃ React: ${session.autoStatus.react ? '✅ ON' : '❌ OFF'}\n┃ Emoji: ${session.autoStatus.emoji}\n\n📌 Usage:\n.autostatus view on/off\n.autostatus react on/off\n.autostatus emoji 🔥`);
    }
    if (mode === 'view' || mode === 'react') {
        if (val !== 'on' && val !== 'off') return reply('❌ Use on or off.');
        session.autoStatus[mode] = val === 'on';
        fsSet('botConfig', session.id, { autoStatus: session.autoStatus });
        return reply(`✅ Auto status *${mode}* turned *${val.toUpperCase()}*.`);
    }
    if (mode === 'emoji') {
        if (!val) return reply('❌ Provide an emoji, e.g. .autostatus emoji 🔥');
        session.autoStatus.emoji = args[1];
        fsSet('botConfig', session.id, { autoStatus: session.autoStatus });
        return reply(`✅ Auto status react emoji set to ${session.autoStatus.emoji}`);
    }
    await reply('❌ Unknown option. Use view / react / emoji.');
}});
reg('support', { category: 'System', desc: '.support', aliases: ['report', 'feedback'], run: async ({ reply }) => {
    await reply('🛠️ For support or feedback, please contact the bot owner via `.owner`.');
}});
reg('script', { category: 'System', desc: '.script', run: async ({ reply }) => {
    await reply(`📜 *${BOT_NAME}* is a Baileys-based WhatsApp bot. Ask the owner for the repository link.`);
}});
reg('donate', { category: 'System', desc: '.donate', run: async ({ reply }) => {
    await reply('💗 If you enjoy this bot, consider supporting the developer!');
}});
reg('credits', { category: 'System', desc: '.credits', run: async ({ reply }) => {
    await reply(`✨ *${BOT_NAME}* — built on @whiskeysockets/baileys. Developed by Nimah Dev.`);
}});
reg('about', { category: 'System', desc: '.about', aliases: ['botinfo'], run: async ({ reply }) => {
    await reply(`🤖 *${BOT_NAME}*\nA multi-device WhatsApp bot with 100+ commands: system tools, fun, group management and more.`);
}});
reg('id', { category: 'System', desc: '.id', run: async ({ reply, from }) => { await reply(`🆔 Chat ID: ${from}`); }});
reg('mention', { category: 'System', desc: '.mention', run: async ({ reply, sender }) => { await reply(`👤 Your ID: ${sender}`); }});
reg('menu', { category: 'System', desc: '.menu', aliases: ['help'], run: async ({ from, msg, session }) => {
    await sendDesignedMenu(session, from, msg, mainMenuCaption(msg.pushName), 'main');
}});
// ---- FUN ----
reg('quote', { category: 'Fun', desc: '.quote', run: async ({ reply }) => await reply(`💬 *Motivation Quote:*\n\n"${pick(QUOTES)}" ✨`) });
reg('joke', { category: 'Fun', desc: '.joke', run: async ({ reply }) => await reply(`🎭 *Funny Joke:*\n\n${pick(JOKES)}`) });
reg('fact', { category: 'Fun', desc: '.fact', run: async ({ reply }) => await reply(`🧠 *Random Fact:*\n\n${pick(FACTS)}`) });
reg('catfact', { category: 'Fun', desc: '.catfact', run: async ({ reply }) => await reply(`🐱 *Cat Fact:*\n\n${pick(CATFACTS)}`) });
reg('dogfact', { category: 'Fun', desc: '.dogfact', run: async ({ reply }) => await reply(`🐶 *Dog Fact:*\n\n${pick(DOGFACTS)}`) });
reg('riddle', { category: 'Fun', desc: '.riddle', run: async ({ reply }) => { const r = pick(RIDDLES); await reply(`🧩 *Riddle:*\n${r.q}\n\n_Reply .riddle again for another one!_\n||Answer: ${r.a}||`); }});
reg('wisdom', { category: 'Fun', desc: '.wisdom', run: async ({ reply }) => await reply(`🦉 *Wisdom:*\n\n${pick(WISDOM)}`) });
reg('proverb', { category: 'Fun', desc: '.proverb', run: async ({ reply }) => await reply(`📖 *Proverb:*\n\n${pick(PROVERBS)}`) });
reg('motivate', { category: 'Fun', desc: '.motivate', run: async ({ reply }) => await reply(`🔥 *Motivation:*\n\n${pick(MOTIVATE)}`) });
reg('goodmorning', { category: 'Fun', desc: '.goodmorning', run: async ({ reply }) => await reply('☀️ Good Morning! Wishing you a fantastic day ahead! 🌸') });
reg('goodnight', { category: 'Fun', desc: '.goodnight', run: async ({ reply }) => await reply('🌙 Good Night! Sleep well and sweet dreams! ✨') });
reg('roast', { category: 'Fun', desc: '.roast', run: async ({ reply }) => await reply(`🔥 *Roast:*\n\n${pick(ROASTS)}`) });
reg('praise', { category: 'Fun', desc: '.praise', run: async ({ reply }) => await reply(`🙌 *Praise:*\n\n${pick(PRAISES)}`) });
reg('compliment', { category: 'Fun', desc: '.compliment', run: async ({ reply }) => await reply(`💖 *Compliment:*\n\n${pick(COMPLIMENTS)}`) });
reg('truth', { category: 'Fun', desc: '.truth', run: async ({ reply }) => await reply(`🤫 *Truth:*\n\n${pick(TRUTHS)}`) });
reg('dare', { category: 'Fun', desc: '.dare', run: async ({ reply }) => await reply(`😈 *Dare:*\n\n${pick(DARES)}`) });
reg('8ball', { category: 'Fun', desc: '.8ball [question]', run: async ({ reply, q }) => {
    if (!q) return reply('❌ Ask a question! Example: `.8ball Will I be rich?`');
    const answers = ['Yes, definitely.', 'No way.', 'Ask again later.', 'Absolutely!', 'Very doubtful.', 'It is certain.'];
    await reply(`🎱 ${pick(answers)}`);
}});
reg('roll', { category: 'Fun', desc: '.roll', run: async ({ reply }) => await reply(`🎲 You rolled a *${randInt(1, 6)}*!`) });
reg('flip', { category: 'Fun', desc: '.flip', run: async ({ reply }) => await reply(`🪙 It's *${pick(['Heads', 'Tails'])}*!`) });
reg('rps', { category: 'Fun', desc: '.rps [rock/paper/scissors]', run: async ({ reply, q }) => {
    const choices = ['rock', 'paper', 'scissors'];
    const user = q.toLowerCase().trim();
    if (!choices.includes(user)) return reply('❌ Choose rock, paper, or scissors. Example: `.rps rock`');
    const bot = pick(choices);
    let result;
    if (bot === user) result = "It's a tie!";
    else if ((user === 'rock' && bot === 'scissors') || (user === 'paper' && bot === 'rock') || (user === 'scissors' && bot === 'paper')) result = 'You win! 🎉';
    else result = 'I win! 🤖';
    await reply(`✊✋✌️ You: ${user} | Bot: ${bot}\n${result}`);
}});
reg('ship', { category: 'Fun', desc: '.ship', aliases: ['lovecalc'], run: async ({ reply }) => await reply(`💘 Love Match: *${randInt(0, 100)}%*`) });
reg('horoscope', { category: 'Fun', desc: '.horoscope [sign]', run: async ({ reply, q }) => {
    const sign = q.toLowerCase().trim();
    if (!HOROSCOPES[sign]) return reply('❌ Provide a valid zodiac sign. Example: `.horoscope leo`');
    await reply(`🔮 *${sign.charAt(0).toUpperCase() + sign.slice(1)} Horoscope:*\n${HOROSCOPES[sign]}`);
}});
reg('fortune', { category: 'Fun', desc: '.fortune', run: async ({ reply }) => await reply(`🥠 *Fortune:* ${pick(WISDOM.concat(PROVERBS))}`) });
reg('burn', { category: 'Fun', desc: '.burn', run: async ({ reply }) => await reply(`🔥 ${pick(ROASTS)}`) });

// ---- TOOLS ----
reg('date', { category: 'Tools', desc: '.date', run: async ({ reply }) => await reply(`📅 Current Date: ${new Date().toDateString()}`) });
reg('text2hex', { category: 'Tools', desc: '.text2hex [text]', run: async ({ reply, q }) => {
    if (!q) return reply('❌ Provide text.'); await reply(`🔢 ${Buffer.from(q).toString('hex')}`);
}});
reg('hex2text', { category: 'Tools', desc: '.hex2text [hex]', run: async ({ reply, q }) => {
    if (!q) return reply('❌ Provide hex.');
    try { await reply(`🔤 ${Buffer.from(q.replace(/\s+/g, ''), 'hex').toString('utf-8')}`); } catch (e) { await reply('❌ Invalid hex string.'); }
}});
reg('text2binary', { category: 'Tools', desc: '.text2binary [text]', run: async ({ reply, q }) => {
    if (!q) return reply('❌ Provide text.');
    await reply(q.split('').map(c => c.charCodeAt(0).toString(2).padStart(8, '0')).join(' '));
}});
reg('binary2text', { category: 'Tools', desc: '.binary2text [binary]', run: async ({ reply, q }) => {
    if (!q) return reply('❌ Provide binary.');
    try { await reply(q.trim().split(/\s+/).map(b => String.fromCharCode(parseInt(b, 2))).join('')); } catch (e) { await reply('❌ Invalid binary string.'); }
}});
reg('urlencode', { category: 'Tools', desc: '.urlencode [text]', run: async ({ reply, q }) => {
    if (!q) return reply('❌ Provide text.'); await reply(encodeURIComponent(q));
}});
reg('urldecode', { category: 'Tools', desc: '.urldecode [text]', run: async ({ reply, q }) => {
    if (!q) return reply('❌ Provide text.');
    try { await reply(decodeURIComponent(q)); } catch (e) { await reply('❌ Invalid encoded string.'); }
}});
reg('capitalize', { category: 'Tools', desc: '.capitalize [text]', run: async ({ reply, q }) => {
    if (!q) return reply('❌ Provide text.'); await reply(q.replace(/\b\w/g, c => c.toUpperCase()));
}});
reg('countchar', { category: 'Tools', desc: '.countchar [text]', run: async ({ reply, q }) => { if (!q) return reply('❌ Provide text.'); await reply(`🔡 Characters: ${q.length}`); }});
reg('countword', { category: 'Tools', desc: '.countword [text]', run: async ({ reply, q }) => { if (!q) return reply('❌ Provide text.'); await reply(`📝 Words: ${q.trim().split(/\s+/).length}`); }});
reg('palindrome', { category: 'Tools', desc: '.palindrome [text]', run: async ({ reply, q }) => {
    if (!q) return reply('❌ Provide text.');
    const clean = q.toLowerCase().replace(/[^a-z0-9]/g, '');
    await reply(clean === clean.split('').reverse().join('') ? '✅ That is a palindrome!' : '❌ Not a palindrome.');
}});
reg('ascii', { category: 'Tools', desc: '.ascii [text]', aliases: ['asciiart'], run: async ({ reply, q }) => {
    if (!q) return reply('❌ Provide text (short words work best).');
    figlet(q.slice(0, 15), (err, data) => { if (err || !data) return reply('❌ Could not generate ASCII art.'); reply('```' + data + '```'); });
}});
reg('qr', { category: 'Tools', desc: '.qr [text]', run: async ({ sock, from, msg, reply, q }) => {
    if (!q) return reply('❌ Provide text or a URL to encode.');
    try {
        const buffer = await QRCode.toBuffer(q, { width: 400 });
        await sock.sendMessage(from, { image: buffer, caption: `📷 QR Code for: ${q}` }, { quoted: msg });
    } catch (e) { await reply('❌ Failed to generate QR code.'); }
}});
reg('randomnumber', { category: 'Tools', desc: '.randomnumber [min] [max]', run: async ({ reply, args }) => {
    const min = parseInt(args[0]) || 1, max = parseInt(args[1]) || 100;
    await reply(`🎲 Random Number: ${randInt(min, max)}`);
}});
reg('randomcolor', { category: 'Tools', desc: '.randomcolor', run: async ({ reply }) => {
    const hex = '#' + randInt(0, 0xFFFFFF).toString(16).padStart(6, '0');
    await reply(`🎨 Random Color: ${hex}`);
}});
reg('lorem', { category: 'Tools', desc: '.lorem [paragraphs]', run: async ({ reply, q }) => {
    const n = Math.min(Math.max(parseInt(q) || 1, 1), 5);
    const p = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.';
    await reply(new Array(n).fill(p).join('\n\n'));
}});
reg('remind', { category: 'Tools', desc: '.remind [seconds] [message]', run: async ({ reply, sock, from, args }) => {
    const seconds = parseInt(args[0]);
    const text = args.slice(1).join(' ');
    if (!seconds || seconds <= 0 || seconds > 3600 || !text) return reply('❌ Usage: `.remind 60 Drink water` (max 3600 seconds)');
    await reply(`⏰ Reminder set for ${seconds}s from now.`);
    setTimeout(() => { sock.sendMessage(from, { text: `⏰ *Reminder:* ${text}` }).catch(() => {}); }, seconds * 1000);
}});

// ---- PUBLIC APIS (free, no key required) ----
reg('weather', { category: 'Tools', desc: '.weather [city]', run: async ({ reply, q }) => {
    if (!q) return reply('❌ Provide a city name. Example: `.weather Colombo`');
    try {
        const geo = await axios.get('https://geocoding-api.open-meteo.com/v1/search', { params: { name: q, count: 1 }, timeout: 10000 });
        const place = geo.data?.results?.[0];
        if (!place) return reply('❌ City not found.');
        const w = await axios.get('https://api.open-meteo.com/v1/forecast', { params: { latitude: place.latitude, longitude: place.longitude, current_weather: true }, timeout: 10000 });
        const cw = w.data?.current_weather;
        if (!cw) return reply('❌ Weather data unavailable.');
        await reply(`🌤️ *Weather in ${place.name}, ${place.country || ''}*\n🌡️ Temp: ${cw.temperature}°C\n💨 Wind: ${cw.windspeed} km/h`);
    } catch (e) { await reply('⚠️ Weather service unavailable right now.'); }
}});
reg('crypto', { category: 'Tools', desc: '.crypto [coin]', aliases: ['price'], run: async ({ reply, q }) => {
    const coin = (q || 'bitcoin').toLowerCase().trim();
    try {
        const res = await axios.get('https://api.coingecko.com/api/v3/simple/price', { params: { ids: coin, vs_currencies: 'usd' }, timeout: 10000 });
        const price = res.data?.[coin]?.usd;
        if (!price) return reply('❌ Coin not found. Try the full name, e.g. `.crypto ethereum`');
        await reply(`💰 *${coin.toUpperCase()}:* $${price}`);
    } catch (e) { await reply('⚠️ Price service unavailable right now.'); }
}});
reg('ai', { category: 'Tools', desc: '.ai [prompt]', aliases: ['gpt'], run: async ({ reply, q, from, sender }) => {
    if (!q) return reply('❌ *Please provide a prompt!* \n📌 *Example:* `.ai Who is Albert Einstein?`');
    try {
        const answer = await callNimahAI(from, q, sender ? sender.split('@')[0] : null);
        if (!answer) return reply('⚠️ *AI service is currently busy. Please try again later!*');
        pushHistory(from, 'user', q);
        pushHistory(from, 'assistant', answer);
        await reply(answer + AI_WATERMARK);
    } catch (e) { await reply('⚠️ *AI service is currently busy. Please try again later!*'); }
}});

// ---- AI IMAGE GENERATION ----
// Uses Pollinations.ai — free, no API key required. Prompt goes straight in
// the URL; Baileys fetches and sends it as an image.
reg('imagine', { category: 'Tools', desc: '.imagine [prompt] — AI image generation', aliases: ['img'], run: async ({ sock, from, msg, reply, q }) => {
    if (!q) return reply('❌ Describe what you want to see.\n📌 Example: `.imagine a dragon made of golden light`');
    try {
        const seed = randInt(1, 999999);
        const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(q)}?width=1024&height=1024&seed=${seed}&nologo=true`;
        await sock.sendMessage(from, { image: { url }, caption: `🎨 *${q}*\n\n> Generated by Nimah AI` }, { quoted: msg });
    } catch (e) { await reply('❌ Image generation failed — try a different prompt or try again shortly.'); }
}});

// ---- TEXT TO SPEECH ----
reg('tts', { category: 'Tools', desc: '.tts [text] — text to speech voice note', run: async ({ sock, from, msg, reply, q }) => {
    if (!q) return reply('❌ Provide text to speak.\n📌 Example: `.tts Hello, how are you?`');
    if (q.length > 200) return reply('❌ Keep it under 200 characters for a voice note.');
    try {
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&q=${encodeURIComponent(q)}&tl=auto`;
        await sock.sendMessage(from, { audio: { url }, mimetype: 'audio/mpeg', ptt: true }, { quoted: msg });
    } catch (e) { await reply('❌ Text-to-speech failed — try shorter text or try again shortly.'); }
}});

// ---- GROUP VIBE TRACKER ----
reg('vibe', { category: 'Group', desc: '.vibe — reads the group\'s recent mood', groupOnly: true, run: async ({ reply, from }) => {
    const log = groupMessageLog.get(from) || [];
    if (log.length < 5) return reply('ℹ️ Not enough recent chat to read a vibe yet — try again once the group has been more active.');
    const transcript = log.slice(-40).map(m => `${m.sender}: ${m.text}`).join('\n');
    try {
        const answer = await callNimahAI(from + ':vibecheck', `Here is a snippet of recent group chat messages:\n\n${transcript}\n\nIn 2-3 short sentences, describe the overall mood/vibe of this conversation right now (e.g. energetic, chill, tense, funny, quiet). Don't quote people directly, just summarize the feeling.`, null);
        await reply(`🌈 *Group Vibe Check*\n\n${answer || 'Could not read the vibe right now.'}`);
    } catch (e) { await reply('❌ Could not read the vibe right now — try again shortly.'); }
}});

// ---- PROACTIVE DAILY DIGEST (opt-in per group) ----
reg('digest', { category: 'Group', desc: '.digest [on/off] — daily AI summary of the group', groupOnly: true, adminOnly: true, run: async ({ reply, from, q }) => {
    const s = getGroupSettings(from);
    if (q === 'on') { s.digest = true; persistGroupSettings(from); return reply('✅ Daily digest enabled — a summary will be posted here once a day.'); }
    if (q === 'off') { s.digest = false; persistGroupSettings(from); return reply('✅ Daily digest disabled.'); }
    await reply(`ℹ️ Daily digest is currently *${s.digest ? 'ON' : 'OFF'}*. Use \`.digest on\` or \`.digest off\`.`);
}});

// ---- BOT-TO-BOT / CHAT-TO-CHAT BRIDGE ----
reg('bridge', { category: 'Owner', desc: '.bridge [target session id]:[target jid] — relay messages to another chat', ownerOnly: true, run: async ({ reply, from, q, session }) => {
    if (!q || !q.includes(':')) return reply('❌ Usage: `.bridge sessionId:targetJid`\nGet the target session ID from the admin panel.');
    const [targetSessionId, targetJid] = q.split(':').map(x => x.trim());
    const target = sessions.get(targetSessionId);
    if (!target) return reply('❌ No bot found with that session ID.');
    bridges.set(bridgeKey(session.id, from), { targetSessionId, targetJid });
    await reply(`🌉 Bridge set up! Messages in this chat will now relay to that chat.`);
}});
reg('unbridge', { category: 'Owner', desc: '.unbridge — remove this chat\'s bridge', ownerOnly: true, run: async ({ reply, from, session }) => {
    const had = bridges.delete(bridgeKey(session.id, from));
    await reply(had ? '✅ Bridge removed.' : 'ℹ️ This chat has no active bridge.');
}});

// ---- GROUP MANAGEMENT (admin-only) ----
// Mass @mention commands are one of the more reliable ways to get a
// WhatsApp account flagged as spam if used often, especially in bigger
// groups. Both commands below share a per-group cooldown for that reason.
function checkMassTagCooldown(from, reply) {
    const last = lastMassTagAt.get(from) || 0;
    const remaining = MASS_TAG_COOLDOWN_MS - (Date.now() - last);
    if (remaining > 0) {
        reply(`⏳ Please wait ${Math.ceil(remaining / 1000)}s before tagging everyone again — this cooldown protects the account from being flagged as spam by WhatsApp.`);
        return false;
    }
    lastMassTagAt.set(from, Date.now());
    return true;
}
reg('tagall', { category: 'Group', desc: '.tagall', groupOnly: true, adminOnly: true, run: async ({ from, groupMetadata, msg, reply, session }) => {
    if (!checkMassTagCooldown(from, reply)) return;
    const mentions = groupMetadata.participants.map(p => p.id);
    const text = '📢 *Attention everyone!*\n\n' + mentions.map(m => `@${m.split('@')[0]}`).join('\n');
    await session.queueSend(from, { text, mentions }, { quoted: msg });
}});
reg('hidetag', { category: 'Group', desc: '.hidetag [message]', groupOnly: true, adminOnly: true, run: async ({ from, groupMetadata, msg, q, reply, session }) => {
    if (!checkMassTagCooldown(from, reply)) return;
    const mentions = groupMetadata.participants.map(p => p.id);
    await session.queueSend(from, { text: q || '📢 Notice', mentions }, { quoted: msg });
}});
reg('groupinfo', { category: 'Group', desc: '.groupinfo', groupOnly: true, run: async ({ reply, groupMetadata }) => {
    await reply(`📋 *Group Info*\n👥 Name: ${groupMetadata.subject}\n🆔 ID: ${groupMetadata.id}\n👤 Members: ${groupMetadata.participants.length}\n📝 Description: ${groupMetadata.desc || 'None'}`);
}});
reg('kick', { category: 'Group', desc: '.kick (reply/mention)', groupOnly: true, adminOnly: true, run: async ({ sock, from, msg, reply }) => {
    const target = msg.message?.extendedTextMessage?.contextInfo?.participant || (msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [])[0];
    if (!target) return reply('❌ Reply to or mention the user you want to kick.');
    await sock.groupParticipantsUpdate(from, [target], 'remove');
    await reply('✅ User removed.');
}});
reg('add', { category: 'Group', desc: '.add [number]', groupOnly: true, adminOnly: true, run: async ({ sock, from, reply, q }) => {
    const num = q.replace(/[^0-9]/g, '');
    if (!num) return reply('❌ Provide a number. Example: `.add 94771234567`');
    await sock.groupParticipantsUpdate(from, [`${num}@s.whatsapp.net`], 'add');
    await reply('✅ Invite sent.');
}});
reg('promote', { category: 'Group', desc: '.promote (reply/mention)', groupOnly: true, adminOnly: true, run: async ({ sock, from, msg, reply }) => {
    const target = msg.message?.extendedTextMessage?.contextInfo?.participant || (msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [])[0];
    if (!target) return reply('❌ Reply to or mention the user you want to promote.');
    await sock.groupParticipantsUpdate(from, [target], 'promote');
    await reply('✅ User promoted to admin.');
}});
reg('demote', { category: 'Group', desc: '.demote (reply/mention)', groupOnly: true, adminOnly: true, run: async ({ sock, from, msg, reply }) => {
    const target = msg.message?.extendedTextMessage?.contextInfo?.participant || (msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [])[0];
    if (!target) return reply('❌ Reply to or mention the user you want to demote.');
    await sock.groupParticipantsUpdate(from, [target], 'demote');
    await reply('✅ User demoted.');
}});
reg('mute', { category: 'Group', desc: '.mute', groupOnly: true, adminOnly: true, run: async ({ sock, from, reply }) => {
    await sock.groupSettingUpdate(from, 'announcement'); await reply('🔇 Group muted — only admins can send messages.');
}});
reg('unmute', { category: 'Group', desc: '.unmute', groupOnly: true, adminOnly: true, run: async ({ sock, from, reply }) => {
    await sock.groupSettingUpdate(from, 'not_announcement'); await reply('🔊 Group unmuted — everyone can send messages.');
}});
reg('setname', { category: 'Group', desc: '.setname [new name]', groupOnly: true, adminOnly: true, run: async ({ sock, from, reply, q }) => {
    if (!q) return reply('❌ Provide a new group name.'); await sock.groupUpdateSubject(from, q); await reply('✅ Group name updated.');
}});
reg('setdesc', { category: 'Group', desc: '.setdesc [new description]', groupOnly: true, adminOnly: true, run: async ({ sock, from, reply, q }) => {
    if (!q) return reply('❌ Provide a new description.'); await sock.groupUpdateDescription(from, q); await reply('✅ Group description updated.');
}});
reg('grouplink', { category: 'Group', desc: '.grouplink', aliases: ['invitelink'], groupOnly: true, adminOnly: true, run: async ({ sock, from, reply }) => {
    const code = await sock.groupInviteCode(from); await reply(`🔗 https://chat.whatsapp.com/${code}`);
}});
reg('revokelink', { category: 'Group', desc: '.revokelink', groupOnly: true, adminOnly: true, run: async ({ sock, from, reply }) => {
    await sock.groupRevokeInvite(from); await reply('✅ Group invite link revoked and regenerated.');
}});
reg('setrules', { category: 'Group', desc: '.setrules [text]', groupOnly: true, adminOnly: true, run: async ({ from, reply, q }) => {
    if (!q) return reply('❌ Provide rules text.'); getGroupSettings(from).rules = q; persistGroupSettings(from); await reply('✅ Group rules updated.');
}});
reg('rules', { category: 'Group', desc: '.rules', groupOnly: true, run: async ({ from, reply }) => {
    const r = getGroupSettings(from).rules; await reply(r ? `📜 *Group Rules:*\n${r}` : 'ℹ️ No rules have been set yet. Use `.setrules` as an admin.');
}});
reg('antilink', { category: 'Group', desc: '.antilink [on/off]', groupOnly: true, adminOnly: true, run: async ({ from, reply, q }) => {
    const setting = getGroupSettings(from);
    if (q === 'on') { setting.antilink = true; persistGroupSettings(from); return reply('✅ Antilink enabled.'); }
    if (q === 'off') { setting.antilink = false; persistGroupSettings(from); return reply('✅ Antilink disabled.'); }
    await reply(`ℹ️ Antilink is currently *${setting.antilink ? 'ON' : 'OFF'}*. Use \`.antilink on\` or \`.antilink off\`.`);
}});
reg('warn', { category: 'Group', desc: '.warn (reply)', groupOnly: true, adminOnly: true, run: async ({ from, reply, msg }) => {
    const target = msg.message?.extendedTextMessage?.contextInfo?.participant;
    if (!target) return reply('❌ Reply to the user you want to warn.');
    const s = getGroupSettings(from);
    s.warns[target] = (s.warns[target] || 0) + 1;
    persistGroupSettings(from);
    await reply(`⚠️ @${target.split('@')[0]} has been warned (${s.warns[target]}/3).`);
}});
reg('resetwarn', { category: 'Group', desc: '.resetwarn (reply)', groupOnly: true, adminOnly: true, run: async ({ from, reply, msg }) => {
    const target = msg.message?.extendedTextMessage?.contextInfo?.participant;
    if (!target) return reply('❌ Reply to the user whose warnings you want to reset.');
    delete getGroupSettings(from).warns[target];
    persistGroupSettings(from);
    await reply('✅ Warnings reset for that user.');
}});

// ---- OWNER-ONLY ----
function isOwner(sender) {
    if (!OWNER_NUMBER) return false;
    return sender.replace(/[^0-9]/g, '').startsWith(OWNER_NUMBER) || sender.split('@')[0] === OWNER_NUMBER;
}
reg('join', { category: 'Owner', desc: '.join [invite link]', ownerOnly: true, run: async ({ sock, reply, q }) => {
    if (!q) return reply('❌ Provide a group invite link.');
    const code = q.split('/').pop();
    try { await sock.groupAcceptInvite(code); await reply('✅ Joined the group.'); } catch (e) { await reply('❌ Failed to join group.'); }
}});
reg('leave', { category: 'Owner', desc: '.leave', groupOnly: true, ownerOnly: true, run: async ({ sock, from, reply }) => {
    await reply('👋 Leaving group...'); await sock.groupLeave(from);
}});
reg('block', { category: 'Owner', desc: '.block (reply)', ownerOnly: true, run: async ({ sock, msg, reply }) => {
    const target = msg.message?.extendedTextMessage?.contextInfo?.participant;
    if (!target) return reply('❌ Reply to the user you want to block.');
    await sock.updateBlockStatus(target, 'block'); await reply('✅ User blocked.');
}});
reg('unblock', { category: 'Owner', desc: '.unblock (reply)', ownerOnly: true, run: async ({ sock, msg, reply }) => {
    const target = msg.message?.extendedTextMessage?.contextInfo?.participant;
    if (!target) return reply('❌ Reply to the user you want to unblock.');
    await sock.updateBlockStatus(target, 'unblock'); await reply('✅ User unblocked.');
}});
reg('restart', { category: 'Owner', desc: '.restart', ownerOnly: true, run: async ({ reply }) => {
    await reply('♻️ Restarting...'); setTimeout(() => process.exit(0), 1000);
}});
reg('setbio', { category: 'Owner', desc: '.setbio [text]', ownerOnly: true, run: async ({ sock, reply, q }) => {
    if (!q) return reply('❌ Provide bio text.'); await sock.updateProfileStatus(q); await reply('✅ Bio updated.');
}});
reg('broadcast', { category: 'Owner', desc: '.broadcast [text] (in a group, sends as announcement)', groupOnly: true, ownerOnly: true, run: async ({ sock, from, reply, q }) => {
    if (!q) return reply('❌ Provide the announcement text.');
    await sock.sendMessage(from, { text: `📢 *ANNOUNCEMENT*\n\n${q}` });
}});
reg('setppic', { category: 'Owner', desc: '.setppic (reply to an image)', ownerOnly: true, run: async ({ reply }) => {
    await reply('ℹ️ Profile picture updates require media download support — ask the developer to enable it.');
}});

// ---- TEXT TOOLS ----
reg('reverse', { category: 'Text', desc: '.reverse [text]', run: async ({ reply, q }) => {
    if (!q) return reply('❌ Provide text. Example: `.reverse hello`');
    await reply(`🔁 ${q.split('').reverse().join('')}`);
}});
reg('upper', { category: 'Text', desc: '.upper [text]', run: async ({ reply, q }) => {
    if (!q) return reply('❌ Provide text.'); await reply(q.toUpperCase());
}});
reg('lower', { category: 'Text', desc: '.lower [text]', run: async ({ reply, q }) => {
    if (!q) return reply('❌ Provide text.'); await reply(q.toLowerCase());
}});
reg('mock', { category: 'Text', desc: '.mock [text] (SpOnGeBoB CaSe)', aliases: ['spongebob'], run: async ({ reply, q }) => {
    if (!q) return reply('❌ Provide text.');
    await reply(q.split('').map((c, i) => i % 2 === 0 ? c.toLowerCase() : c.toUpperCase()).join(''));
}});
reg('count', { category: 'Text', desc: '.count [text]', aliases: ['wordcount'], run: async ({ reply, q }) => {
    if (!q) return reply('❌ Provide text.');
    const words = q.trim().split(/\s+/).filter(Boolean).length;
    await reply(`🔢 Characters: ${q.length}\n📝 Words: ${words}`);
}});
reg('repeat', { category: 'Text', desc: '.repeat [n] [text]', aliases: ['spam'], run: async ({ reply, args }) => {
    const n = parseInt(args[0], 10);
    const text = args.slice(1).join(' ');
    if (!n || n < 1 || !text) return reply('❌ Usage: `.repeat 3 hello`');
    if (n > 10) return reply('❌ Max repeat count is 10 (to avoid spam).');
    await reply(Array(n).fill(text).join('\n'));
}});
reg('binary', { category: 'Text', desc: '.binary [text]', run: async ({ reply, q }) => {
    if (!q) return reply('❌ Provide text.');
    await reply(q.split('').map(c => c.charCodeAt(0).toString(2).padStart(8, '0')).join(' '));
}});
reg('base64encode', { category: 'Text', desc: '.base64encode [text]', run: async ({ reply, q }) => {
    if (!q) return reply('❌ Provide text.'); await reply(Buffer.from(q).toString('base64'));
}});
reg('base64decode', { category: 'Text', desc: '.base64decode [text]', run: async ({ reply, q }) => {
    if (!q) return reply('❌ Provide base64 text.');
    try { await reply(Buffer.from(q, 'base64').toString('utf8')); } catch (e) { await reply('❌ Invalid base64.'); }
}});
reg('clap', { category: 'Text', desc: '.clap [text]', run: async ({ reply, q }) => {
    if (!q) return reply('❌ Provide text.'); await reply(q.trim().split(/\s+/).join(' 👏 '));
}});

// ---- MORE FUN ----
reg('slap', { category: 'Fun', desc: '.slap (reply)', run: async ({ reply, msg }) => {
    const target = msg.message?.extendedTextMessage?.contextInfo?.participant;
    const who = target ? `@${target.split('@')[0]}` : 'someone';
    await reply(`👋 *SLAP!* You slapped ${who} with a large trout! 🐟`);
}});
reg('hug', { category: 'Fun', desc: '.hug (reply)', run: async ({ reply, msg }) => {
    const target = msg.message?.extendedTextMessage?.contextInfo?.participant;
    const who = target ? `@${target.split('@')[0]}` : 'everyone';
    await reply(`🤗 Sending a warm hug to ${who}!`);
}});
reg('kiss', { category: 'Fun', desc: '.kiss (reply)', run: async ({ reply, msg }) => {
    const target = msg.message?.extendedTextMessage?.contextInfo?.participant;
    const who = target ? `@${target.split('@')[0]}` : 'you';
    await reply(`😘 A sweet kiss for ${who}!`);
}});
reg('fight', { category: 'Fun', desc: '.fight (reply)', run: async ({ reply }) => await reply(pick(['🥊 You threw the first punch!', '🥋 Epic battle ensues!', '💥 KO! You win!'])) });
reg('dice', { category: 'Fun', desc: '.dice [sides]', run: async ({ reply, q }) => {
    const sides = parseInt(q, 10) || 6;
    if (sides < 2 || sides > 1000) return reply('❌ Choose between 2 and 1000 sides.');
    await reply(`🎲 Rolled a d${sides}: *${randInt(1, sides)}*`);
}});
reg('choose', { category: 'Fun', desc: '.choose option1, option2, ...', aliases: ['pick'], run: async ({ reply, q }) => {
    const opts = q.split(',').map(s => s.trim()).filter(Boolean);
    if (opts.length < 2) return reply('❌ Give at least 2 options separated by commas.');
    await reply(`🤔 I choose: *${pick(opts)}*`);
}});
reg('rate', { category: 'Fun', desc: '.rate [anything]', run: async ({ reply, q }) => {
    if (!q) return reply('❌ Provide something to rate.');
    await reply(`⭐ I rate "${q}" a *${randInt(1, 10)}/10*!`);
}});
reg('would', { category: 'Fun', desc: '.would', aliases: ['wyr'], run: async ({ reply }) => await reply(`🤔 *Would You Rather:*\n\n${pick(WOULD)}`) });
reg('trivia', { category: 'Fun', desc: '.trivia', run: async ({ reply }) => { const t = pick(TRIVIA); await reply(`🧠 *Trivia:* ${t.q}\n||Answer: ${t.a}||`); }});
reg('meme', { category: 'Fun', desc: '.meme', run: async ({ reply }) => {
    try {
        const res = await axios.get('https://meme-api.com/gimme', { timeout: 10000 });
        if (res.data?.url) await reply(`😂 ${res.data.title || 'Meme'}\n${res.data.url}`);
        else await reply('❌ Could not fetch a meme right now.');
    } catch (e) { await reply('⚠️ Meme service unavailable right now.'); }
}});

// ---- MORE TOOLS ----
reg('short', { category: 'Tools', desc: '.short [url]', aliases: ['shorten'], run: async ({ reply, q }) => {
    if (!q) return reply('❌ Provide a URL. Example: `.short https://example.com`');
    try {
        const res = await axios.get(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(q)}`, { timeout: 10000 });
        await reply(`🔗 ${res.data}`);
    } catch (e) { await reply('⚠️ Shortener service unavailable right now.'); }
}});
reg('translate', { category: 'Tools', desc: '.translate [lang] [text]', aliases: ['tr'], run: async ({ reply, args }) => {
    const lang = args[0]; const text = args.slice(1).join(' ');
    if (!lang || !text) return reply('❌ Usage: `.translate si Hello there`');
    try {
        const res = await axios.get('https://api.mymemory.translated.net/get', { params: { q: text, langpair: `en|${lang}` }, timeout: 10000 });
        const translated = res.data?.responseData?.translatedText;
        if (!translated) return reply('❌ Translation failed.');
        await reply(`🌐 *Translation (${lang}):*\n${translated}`);
    } catch (e) { await reply('⚠️ Translation service unavailable right now.'); }
}});
reg('qrcode', { category: 'Tools', desc: '.qrcode [text]', aliases: ['qr'], run: async ({ sock, from, msg, reply, q }) => {
    if (!q) return reply('❌ Provide text/URL to encode.');
    try {
        const buffer = await QRCode.toBuffer(q, { width: 400 });
        await sock.sendMessage(from, { image: buffer, caption: `📱 QR code for: ${q}` }, { quoted: msg });
    } catch (e) { await reply('❌ Failed to generate QR code.'); }
}});
reg('password', { category: 'Tools', desc: '.password [length]', aliases: ['genpass'], run: async ({ reply, q }) => {
    const len = Math.min(Math.max(parseInt(q, 10) || 12, 6), 64);
    await reply(`🔐 *Generated Password:*\n\`${genPassword(len)}\``);
}});
reg('time', { category: 'Tools', desc: '.time', run: async ({ reply }) => {
    await reply(`🕒 Server time: ${new Date().toUTCString()}`);
}});
reg('calc', { category: 'Tools', desc: '.calc [expression]', aliases: ['calculate'], run: async ({ reply, q }) => {
    if (!q) return reply('❌ Provide a math expression. Example: `.calc 5*(3+2)`');
    try { await reply(`🧮 Result: ${safeCalculate(q)}`); } catch (e) { await reply('❌ Invalid expression.'); }
}});
reg('define', { category: 'Tools', desc: '.define [word]', aliases: ['dictionary'], run: async ({ reply, q }) => {
    if (!q) return reply('❌ Provide a word to define.');
    try {
        const res = await axios.get(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(q)}`, { timeout: 10000 });
        const entry = res.data?.[0];
        const def = entry?.meanings?.[0]?.definitions?.[0]?.definition;
        if (!def) return reply('❌ No definition found.');
        await reply(`📖 *${q}*\n${entry.meanings[0].partOfSpeech ? `(${entry.meanings[0].partOfSpeech}) ` : ''}${def}`);
    } catch (e) { await reply('❌ No definition found.'); }
}});
reg('lyrics', { category: 'Tools', desc: '.lyrics [song title]', run: async ({ reply }) => {
    await reply('ℹ️ Lyrics lookups aren\'t supported here due to copyright — try a licensed lyrics site or app.');
}});

// ---- MORE GROUP MANAGEMENT ----
reg('groupname', { category: 'Group', desc: '.groupname', groupOnly: true, run: async ({ reply, groupMetadata }) => {
    await reply(`📛 Group name: ${groupMetadata.subject}`);
}});
reg('memberlist', { category: 'Group', desc: '.memberlist', groupOnly: true, adminOnly: true, run: async ({ reply, groupMetadata }) => {
    const list = groupMetadata.participants.map((p, i) => `${i + 1}. @${p.id.split('@')[0]}${p.admin ? ' (admin)' : ''}`).join('\n');
    await reply(`👥 *Members (${groupMetadata.participants.length}):*\n${list}`);
}});
reg('adminlist', { category: 'Group', desc: '.adminlist', groupOnly: true, run: async ({ reply, groupMetadata }) => {
    const admins = groupMetadata.participants.filter(p => p.admin);
    if (!admins.length) return reply('ℹ️ No admins found.');
    await reply(`👑 *Admins:*\n${admins.map(a => `@${a.id.split('@')[0]}`).join('\n')}`);
}});
reg('closegroup', { category: 'Group', desc: '.closegroup', groupOnly: true, adminOnly: true, run: async ({ sock, from, reply }) => {
    await sock.groupSettingUpdate(from, 'announcement'); await reply('🔒 Group closed — only admins can send messages.');
}});
reg('opengroup', { category: 'Group', desc: '.opengroup', groupOnly: true, adminOnly: true, run: async ({ sock, from, reply }) => {
    await sock.groupSettingUpdate(from, 'not_announcement'); await reply('🔓 Group opened — everyone can send messages.');
}});
reg('lockinfo', { category: 'Group', desc: '.lockinfo', groupOnly: true, adminOnly: true, run: async ({ sock, from, reply }) => {
    await sock.groupSettingUpdate(from, 'locked'); await reply('🔒 Only admins can edit group info now.');
}});
reg('unlockinfo', { category: 'Group', desc: '.unlockinfo', groupOnly: true, adminOnly: true, run: async ({ sock, from, reply }) => {
    await sock.groupSettingUpdate(from, 'unlocked'); await reply('🔓 All members can edit group info now.');
}});
reg('welcome', { category: 'Group', desc: '.welcome [on/off]', groupOnly: true, adminOnly: true, run: async ({ from, reply, q }) => {
    const s = getGroupSettings(from);
    if (q === 'on') { s.welcome = true; persistGroupSettings(from); return reply('✅ Welcome messages enabled.'); }
    if (q === 'off') { s.welcome = false; persistGroupSettings(from); return reply('✅ Welcome messages disabled.'); }
    await reply(`ℹ️ Welcome messages are currently *${s.welcome ? 'ON' : 'OFF'}*.`);
}});

// =====================================================================
// +100 MORE COMMANDS — all self-contained (no third-party APIs), so
// they work reliably with zero extra setup or external dependencies.
// =====================================================================

// ---- TEXT TOOLS (25) ----
reg('rot13', { category: 'Text', desc: '.rot13 [text]', run: async ({ reply, q }) => {
    if (!q) return reply('❌ Provide text.');
    await reply(q.replace(/[a-zA-Z]/g, c => String.fromCharCode((c <= 'Z' ? 90 : 122) >= (c.charCodeAt(0) + 13) ? c.charCodeAt(0) + 13 : c.charCodeAt(0) - 13)));
}});
reg('rot47', { category: 'Text', desc: '.rot47 [text]', run: async ({ reply, q }) => {
    if (!q) return reply('❌ Provide text.');
    await reply(q.replace(/[!-~]/g, c => String.fromCharCode(33 + ((c.charCodeAt(0) - 33 + 47) % 94))));
}});
reg('atbash', { category: 'Text', desc: '.atbash [text]', run: async ({ reply, q }) => {
    if (!q) return reply('❌ Provide text.');
    await reply(q.replace(/[a-zA-Z]/g, c => {
        const isUpper = c === c.toUpperCase();
        const base = isUpper ? 65 : 97;
        return String.fromCharCode(base + (25 - (c.charCodeAt(0) - base)));
    }));
}});
reg('caesar', { category: 'Text', desc: '.caesar [shift] [text]', run: async ({ reply, args }) => {
    const shift = parseInt(args[0]);
    const text = args.slice(1).join(' ');
    if (isNaN(shift) || !text) return reply('❌ Usage: .caesar [shift] [text]');
    await reply(text.replace(/[a-zA-Z]/g, c => {
        const base = c === c.toUpperCase() ? 65 : 97;
        return String.fromCharCode(((c.charCodeAt(0) - base + shift) % 26 + 26) % 26 + base);
    }));
}});
reg('decaesar', { category: 'Text', desc: '.decaesar [shift] [text]', run: async ({ reply, args }) => {
    const shift = parseInt(args[0]);
    const text = args.slice(1).join(' ');
    if (isNaN(shift) || !text) return reply('❌ Usage: .decaesar [shift] [text]');
    await reply(text.replace(/[a-zA-Z]/g, c => {
        const base = c === c.toUpperCase() ? 65 : 97;
        return String.fromCharCode(((c.charCodeAt(0) - base - shift) % 26 + 26) % 26 + base);
    }));
}});
const MORSE_MAP = { A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..', '0': '-----', '1': '.----', '2': '..---', '3': '...--', '4': '....-', '5': '.....', '6': '-....', '7': '--...', '8': '---..', '9': '----.' };
const MORSE_REV = Object.fromEntries(Object.entries(MORSE_MAP).map(([k, v]) => [v, k]));
reg('morse', { category: 'Text', desc: '.morse [text]', run: async ({ reply, q }) => {
    if (!q) return reply('❌ Provide text.');
    await reply(q.toUpperCase().split('').map(c => c === ' ' ? '/' : (MORSE_MAP[c] || c)).join(' '));
}});
reg('demorse', { category: 'Text', desc: '.demorse [morse code]', run: async ({ reply, q }) => {
    if (!q) return reply('❌ Provide morse code, e.g. .demorse .... ..');
    await reply(q.split(' ').map(c => c === '/' ? ' ' : (MORSE_REV[c] || c)).join(''));
}});
const LEET_MAP = { a: '4', e: '3', i: '1', o: '0', s: '5', t: '7', A: '4', E: '3', I: '1', O: '0', S: '5', T: '7' };
reg('leet', { category: 'Text', desc: '.leet [text]', run: async ({ reply, q }) => {
    if (!q) return reply('❌ Provide text.');
    await reply(q.split('').map(c => LEET_MAP[c] || c).join(''));
}});
reg('vowelcount', { category: 'Text', desc: '.vowelcount [text]', run: async ({ reply, q }) => {
    if (!q) return reply('❌ Provide text.');
    await reply(`🔤 Vowels: ${(q.match(/[aeiouAEIOU]/g) || []).length}`);
}});
reg('consonantcount', { category: 'Text', desc: '.consonantcount [text]', run: async ({ reply, q }) => {
    if (!q) return reply('❌ Provide text.');
    await reply(`🔠 Consonants: ${(q.match(/[b-df-hj-np-tv-zB-DF-HJ-NP-TV-Z]/g) || []).length}`);
}});
reg('removevowels', { category: 'Text', desc: '.removevowels [text]', run: async ({ reply, q }) => {
    if (!q) return reply('❌ Provide text.'); await reply(q.replace(/[aeiouAEIOU]/g, ''));
}});
reg('removespaces', { category: 'Text', desc: '.removespaces [text]', run: async ({ reply, q }) => {
    if (!q) return reply('❌ Provide text.'); await reply(q.replace(/\s+/g, ''));
}});
reg('shuffletext', { category: 'Text', desc: '.shuffletext [text]', run: async ({ reply, q }) => {
    if (!q) return reply('❌ Provide text.');
    const arr = q.split('');
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[arr[i], arr[j]] = [arr[j], arr[i]]; }
    await reply(arr.join(''));
}});
reg('titlecase', { category: 'Text', desc: '.titlecase [text]', run: async ({ reply, q }) => {
    if (!q) return reply('❌ Provide text.');
    await reply(q.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()));
}});
reg('snakecase', { category: 'Text', desc: '.snakecase [text]', run: async ({ reply, q }) => {
    if (!q) return reply('❌ Provide text.'); await reply(q.trim().toLowerCase().replace(/\s+/g, '_'));
}});
reg('camelcase', { category: 'Text', desc: '.camelcase [text]', run: async ({ reply, q }) => {
    if (!q) return reply('❌ Provide text.');
    const words = q.trim().split(/\s+/);
    await reply(words.map((w, i) => i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()).join(''));
}});
reg('kebabcase', { category: 'Text', desc: '.kebabcase [text]', run: async ({ reply, q }) => {
    if (!q) return reply('❌ Provide text.'); await reply(q.trim().toLowerCase().replace(/\s+/g, '-'));
}});
reg('mirror', { category: 'Text', desc: '.mirror [text]', run: async ({ reply, q }) => {
    if (!q) return reply('❌ Provide text.'); await reply(`${q} | ${q.split('').reverse().join('')}`);
}});
reg('acronym', { category: 'Text', desc: '.acronym [text]', run: async ({ reply, q }) => {
    if (!q) return reply('❌ Provide text.');
    await reply(q.trim().split(/\s+/).map(w => w[0].toUpperCase()).join(''));
}});
reg('charfreq', { category: 'Text', desc: '.charfreq [text]', run: async ({ reply, q }) => {
    if (!q) return reply('❌ Provide text.');
    const freq = {};
    for (const c of q.replace(/\s/g, '')) freq[c] = (freq[c] || 0) + 1;
    const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 10);
    await reply('📊 *Character Frequency:*\n' + top.map(([c, n]) => `${c}: ${n}`).join('\n'));
}});
reg('isanagram', { category: 'Text', desc: '.isanagram [word1] , [word2]', run: async ({ reply, q }) => {
    if (!q || !q.includes(',')) return reply('❌ Usage: .isanagram listen , silent');
    const [a, b] = q.split(',').map(s => s.trim().toLowerCase().replace(/\s/g, '').split('').sort().join(''));
    await reply(a === b ? '✅ Yes, these are anagrams!' : '❌ No, these are not anagrams.');
}});
reg('wordfreq', { category: 'Text', desc: '.wordfreq [text]', run: async ({ reply, q }) => {
    if (!q) return reply('❌ Provide text.');
    const freq = {};
    for (const w of q.toLowerCase().trim().split(/\s+/)) freq[w] = (freq[w] || 0) + 1;
    const top = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 10);
    await reply('📊 *Word Frequency:*\n' + top.map(([w, n]) => `${w}: ${n}`).join('\n'));
}});
reg('sentencecount', { category: 'Text', desc: '.sentencecount [text]', run: async ({ reply, q }) => {
    if (!q) return reply('❌ Provide text.');
    await reply(`📝 Sentences: ${(q.match(/[.!?]+/g) || []).length || 1}`);
}});
reg('randomcase', { category: 'Text', desc: '.randomcase [text]', run: async ({ reply, q }) => {
    if (!q) return reply('❌ Provide text.');
    await reply(q.split('').map(c => Math.random() > 0.5 ? c.toUpperCase() : c.toLowerCase()).join(''));
}});
reg('textstats', { category: 'Text', desc: '.textstats [text]', run: async ({ reply, q }) => {
    if (!q) return reply('❌ Provide text.');
    const words = q.trim().split(/\s+/).length;
    const chars = q.length;
    const sentences = (q.match(/[.!?]+/g) || []).length || 1;
    await reply(`📊 *Text Stats*\n┃ 🔡 Characters: ${chars}\n┃ 📝 Words: ${words}\n┃ 📄 Sentences: ${sentences}`);
}});

// ---- UNIT CONVERTERS (15) ----
reg('cm2ft', { category: 'Tools', desc: '.cm2ft [cm]', run: async ({ reply, q }) => {
    const n = parseFloat(q); if (isNaN(n)) return reply('❌ Provide a number.'); await reply(`📏 ${n} cm = ${(n / 30.48).toFixed(2)} ft`);
}});
reg('ft2cm', { category: 'Tools', desc: '.ft2cm [ft]', run: async ({ reply, q }) => {
    const n = parseFloat(q); if (isNaN(n)) return reply('❌ Provide a number.'); await reply(`📏 ${n} ft = ${(n * 30.48).toFixed(2)} cm`);
}});
reg('kg2lb', { category: 'Tools', desc: '.kg2lb [kg]', run: async ({ reply, q }) => {
    const n = parseFloat(q); if (isNaN(n)) return reply('❌ Provide a number.'); await reply(`⚖️ ${n} kg = ${(n * 2.20462).toFixed(2)} lb`);
}});
reg('lb2kg', { category: 'Tools', desc: '.lb2kg [lb]', run: async ({ reply, q }) => {
    const n = parseFloat(q); if (isNaN(n)) return reply('❌ Provide a number.'); await reply(`⚖️ ${n} lb = ${(n / 2.20462).toFixed(2)} kg`);
}});
reg('km2mi', { category: 'Tools', desc: '.km2mi [km]', run: async ({ reply, q }) => {
    const n = parseFloat(q); if (isNaN(n)) return reply('❌ Provide a number.'); await reply(`🛣️ ${n} km = ${(n * 0.621371).toFixed(2)} mi`);
}});
reg('mi2km', { category: 'Tools', desc: '.mi2km [mi]', run: async ({ reply, q }) => {
    const n = parseFloat(q); if (isNaN(n)) return reply('❌ Provide a number.'); await reply(`🛣️ ${n} mi = ${(n / 0.621371).toFixed(2)} km`);
}});
reg('c2f', { category: 'Tools', desc: '.c2f [celsius]', run: async ({ reply, q }) => {
    const n = parseFloat(q); if (isNaN(n)) return reply('❌ Provide a number.'); await reply(`🌡️ ${n}°C = ${(n * 9 / 5 + 32).toFixed(1)}°F`);
}});
reg('f2c', { category: 'Tools', desc: '.f2c [fahrenheit]', run: async ({ reply, q }) => {
    const n = parseFloat(q); if (isNaN(n)) return reply('❌ Provide a number.'); await reply(`🌡️ ${n}°F = ${((n - 32) * 5 / 9).toFixed(1)}°C`);
}});
reg('dec2hex', { category: 'Tools', desc: '.dec2hex [number]', run: async ({ reply, q }) => {
    const n = parseInt(q); if (isNaN(n)) return reply('❌ Provide a decimal number.'); await reply(`🔢 Hex: ${n.toString(16).toUpperCase()}`);
}});
reg('hex2dec', { category: 'Tools', desc: '.hex2dec [hex]', run: async ({ reply, q }) => {
    if (!q) return reply('❌ Provide a hex value.'); const n = parseInt(q, 16); if (isNaN(n)) return reply('❌ Invalid hex.'); await reply(`🔢 Decimal: ${n}`);
}});
reg('dec2oct', { category: 'Tools', desc: '.dec2oct [number]', run: async ({ reply, q }) => {
    const n = parseInt(q); if (isNaN(n)) return reply('❌ Provide a decimal number.'); await reply(`🔢 Octal: ${n.toString(8)}`);
}});
reg('oct2dec', { category: 'Tools', desc: '.oct2dec [octal]', run: async ({ reply, q }) => {
    if (!q) return reply('❌ Provide an octal value.'); const n = parseInt(q, 8); if (isNaN(n)) return reply('❌ Invalid octal.'); await reply(`🔢 Decimal: ${n}`);
}});
reg('dec2bin', { category: 'Tools', desc: '.dec2bin [number]', run: async ({ reply, q }) => {
    const n = parseInt(q); if (isNaN(n)) return reply('❌ Provide a decimal number.'); await reply(`🔢 Binary: ${n.toString(2)}`);
}});
reg('bin2dec', { category: 'Tools', desc: '.bin2dec [binary]', run: async ({ reply, q }) => {
    if (!q) return reply('❌ Provide a binary value.'); const n = parseInt(q, 2); if (isNaN(n)) return reply('❌ Invalid binary.'); await reply(`🔢 Decimal: ${n}`);
}});
reg('inch2cm', { category: 'Tools', desc: '.inch2cm [inches]', run: async ({ reply, q }) => {
    const n = parseFloat(q); if (isNaN(n)) return reply('❌ Provide a number.'); await reply(`📏 ${n} in = ${(n * 2.54).toFixed(2)} cm`);
}});

// ---- MATH (15) ----
reg('average', { category: 'Tools', desc: '.average [numbers separated by space]', run: async ({ reply, args }) => {
    const nums = args.map(Number).filter(n => !isNaN(n));
    if (!nums.length) return reply('❌ Provide numbers, e.g. .average 4 8 15 16');
    await reply(`📊 Average: ${(nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2)}`);
}});
reg('sumnum', { category: 'Tools', desc: '.sumnum [numbers separated by space]', run: async ({ reply, args }) => {
    const nums = args.map(Number).filter(n => !isNaN(n));
    if (!nums.length) return reply('❌ Provide numbers.'); await reply(`➕ Sum: ${nums.reduce((a, b) => a + b, 0)}`);
}});
reg('maxnum', { category: 'Tools', desc: '.maxnum [numbers separated by space]', run: async ({ reply, args }) => {
    const nums = args.map(Number).filter(n => !isNaN(n));
    if (!nums.length) return reply('❌ Provide numbers.'); await reply(`⬆️ Max: ${Math.max(...nums)}`);
}});
reg('minnum', { category: 'Tools', desc: '.minnum [numbers separated by space]', run: async ({ reply, args }) => {
    const nums = args.map(Number).filter(n => !isNaN(n));
    if (!nums.length) return reply('❌ Provide numbers.'); await reply(`⬇️ Min: ${Math.min(...nums)}`);
}});
reg('factorial', { category: 'Tools', desc: '.factorial [n]', run: async ({ reply, q }) => {
    const n = parseInt(q);
    if (isNaN(n) || n < 0 || n > 170) return reply('❌ Provide a whole number between 0 and 170.');
    let result = 1n; for (let i = 2; i <= n; i++) result *= BigInt(i);
    await reply(`🧮 ${n}! = ${result.toString()}`);
}});
reg('isprime', { category: 'Tools', desc: '.isprime [n]', run: async ({ reply, q }) => {
    const n = parseInt(q);
    if (isNaN(n)) return reply('❌ Provide a number.');
    if (n < 2) return reply(`❌ ${n} is not prime.`);
    let prime = true;
    for (let i = 2; i * i <= n; i++) if (n % i === 0) { prime = false; break; }
    await reply(prime ? `✅ ${n} is a prime number.` : `❌ ${n} is not a prime number.`);
}});
reg('gcd', { category: 'Tools', desc: '.gcd [a] [b]', run: async ({ reply, args }) => {
    let a = parseInt(args[0]), b = parseInt(args[1]);
    if (isNaN(a) || isNaN(b)) return reply('❌ Usage: .gcd 12 18');
    while (b) { [a, b] = [b, a % b]; } await reply(`🔢 GCD: ${Math.abs(a)}`);
}});
reg('lcm', { category: 'Tools', desc: '.lcm [a] [b]', run: async ({ reply, args }) => {
    const a = parseInt(args[0]), b = parseInt(args[1]);
    if (isNaN(a) || isNaN(b)) return reply('❌ Usage: .lcm 4 6');
    const gcd = (x, y) => y ? gcd(y, x % y) : x;
    await reply(`🔢 LCM: ${Math.abs(a * b) / gcd(a, b)}`);
}});
reg('fibonacci', { category: 'Tools', desc: '.fibonacci [n]', run: async ({ reply, q }) => {
    const n = parseInt(q);
    if (isNaN(n) || n < 0 || n > 1000) return reply('❌ Provide a whole number between 0 and 1000.');
    let a = 0n, b = 1n; for (let i = 0; i < n; i++) [a, b] = [b, a + b];
    await reply(`🔢 Fibonacci(${n}) = ${a.toString()}`);
}});
reg('sqrtnum', { category: 'Tools', desc: '.sqrtnum [n]', run: async ({ reply, q }) => {
    const n = parseFloat(q); if (isNaN(n) || n < 0) return reply('❌ Provide a non-negative number.'); await reply(`√${n} = ${Math.sqrt(n).toFixed(4)}`);
}});
reg('powernum', { category: 'Tools', desc: '.powernum [base] [exponent]', run: async ({ reply, args }) => {
    const base = parseFloat(args[0]), exp = parseFloat(args[1]);
    if (isNaN(base) || isNaN(exp)) return reply('❌ Usage: .powernum 2 10');
    await reply(`🧮 ${base}^${exp} = ${Math.pow(base, exp)}`);
}});
reg('modnum', { category: 'Tools', desc: '.modnum [a] [b]', run: async ({ reply, args }) => {
    const a = parseFloat(args[0]), b = parseFloat(args[1]);
    if (isNaN(a) || isNaN(b)) return reply('❌ Usage: .modnum 10 3');
    await reply(`🧮 ${a} mod ${b} = ${a % b}`);
}});
reg('roundnum', { category: 'Tools', desc: '.roundnum [number] [decimals]', run: async ({ reply, args }) => {
    const n = parseFloat(args[0]), d = parseInt(args[1]) || 0;
    if (isNaN(n)) return reply('❌ Usage: .roundnum 3.14159 2');
    await reply(`🧮 Rounded: ${n.toFixed(d)}`);
}});
reg('square', { category: 'Tools', desc: '.square [n]', run: async ({ reply, q }) => {
    const n = parseFloat(q); if (isNaN(n)) return reply('❌ Provide a number.'); await reply(`🧮 ${n}² = ${n * n}`);
}});
reg('cube', { category: 'Tools', desc: '.cube [n]', run: async ({ reply, q }) => {
    const n = parseFloat(q); if (isNaN(n)) return reply('❌ Provide a number.'); await reply(`🧮 ${n}³ = ${n * n * n}`);
}});

// ---- GENERATORS (10) ----
reg('uuidgen', { category: 'Tools', desc: '.uuidgen', run: async ({ reply }) => { await reply(`🆔 ${nodeCrypto.randomUUID()}`); }});
reg('pin', { category: 'Tools', desc: '.pin [length]', run: async ({ reply, q }) => {
    const len = Math.min(Math.max(parseInt(q) || 4, 4), 10);
    await reply(`🔢 PIN: ${Array.from({ length: len }, () => randInt(0, 9)).join('')}`);
}});
const RANDOM_NAMES = ['Alex', 'Nadia', 'Kavi', 'Sam', 'Priya', 'Liam', 'Zara', 'Malik', 'Ishara', 'Noah'];
reg('randomname', { category: 'Fun', desc: '.randomname', run: async ({ reply }) => { await reply(`👤 ${pick(RANDOM_NAMES)}`); }});
const RANDOM_EMOJIS = ['😂', '🔥', '💎', '🎉', '🚀', '🌸', '⚡', '🎯', '🦋', '🌟'];
reg('randomemoji', { category: 'Fun', desc: '.randomemoji', run: async ({ reply }) => { await reply(pick(RANDOM_EMOJIS)); }});
reg('yesno', { category: 'Fun', desc: '.yesno', run: async ({ reply }) => { await reply(pick(['✅ Yes', '❌ No'])); }});
const RANDOM_WORDS = ['Serendipity', 'Wanderlust', 'Ephemeral', 'Luminous', 'Mosaic', 'Nostalgia', 'Solitude', 'Euphoria', 'Whimsical', 'Velvet'];
reg('randomword', { category: 'Fun', desc: '.randomword', run: async ({ reply }) => { await reply(`📖 ${pick(RANDOM_WORDS)}`); }});
reg('randomletter', { category: 'Fun', desc: '.randomletter', run: async ({ reply }) => { await reply(String.fromCharCode(65 + randInt(0, 25))); }});
const RANDOM_COUNTRIES = ['Sri Lanka', 'Japan', 'Brazil', 'Canada', 'Kenya', 'Norway', 'India', 'Italy', 'Egypt', 'Australia'];
reg('randomcountry', { category: 'Fun', desc: '.randomcountry', run: async ({ reply }) => { await reply(`🌍 ${pick(RANDOM_COUNTRIES)}`); }});
const RANDOM_ANIMALS = ['Lion', 'Dolphin', 'Eagle', 'Panda', 'Wolf', 'Elephant', 'Tiger', 'Owl', 'Fox', 'Otter'];
reg('randomanimal', { category: 'Fun', desc: '.randomanimal', run: async ({ reply }) => { await reply(`🐾 ${pick(RANDOM_ANIMALS)}`); }});
const RANDOM_SPORTS = ['Cricket', 'Football', 'Badminton', 'Volleyball', 'Chess', 'Tennis', 'Swimming', 'Rugby', 'Basketball', 'Athletics'];
reg('randomsport', { category: 'Fun', desc: '.randomsport', run: async ({ reply }) => { await reply(`🏆 ${pick(RANDOM_SPORTS)}`); }});

// ---- MORE FUN (25) ----
const PICKUP_LINES = ["Are you Wi-Fi? Because I'm really feeling a connection.", "Do you have a map? I keep getting lost in your eyes.", "Is your name Google? Because you have everything I've been searching for.", "Are you a parking ticket? Because you've got fine written all over you.", "If you were a vegetable, you'd be a cute-cumber."];
reg('pickup', { category: 'Fun', desc: '.pickup', run: async ({ reply }) => { await reply(`💘 ${pick(PICKUP_LINES)}`); }});
// A harmless, purely-cosmetic prank — a fake "hacking" progress animation
// that edits one message in place, then reveals it was just a joke. No
// real action is taken against anyone; it's just a fun visual effect.
function wait(ms) { return new Promise((res) => setTimeout(res, ms)); }
reg('hack', { category: 'Fun', desc: '.hack [name] — fake hacking prank animation', run: async ({ sock, from, msg, q }) => {
    const target = q || 'this device';
    const fakeIp = `${randInt(10, 250)}.${randInt(10, 250)}.${randInt(1, 254)}.${randInt(1, 254)}`;
    const fakePort = randInt(1024, 65000);
    const sent = await sock.sendMessage(from, { text: `🖥️ *NIMAH-SEC TOOLKIT v3.1*\n\nInitializing intrusion sequence on *${target}*...\nTarget IP resolved: ${fakeIp}` }, { quoted: msg });
    const steps = [
        `🌐 Connecting to ${fakeIp}:${fakePort}...\n[█░░░░░░░░░] 10%`,
        `🔓 Bypassing firewall (WPA3)...\n[███░░░░░░░] 30%\n⚠️ Intrusion detection: SUPPRESSED`,
        `📡 Accessing mainframe...\n[█████░░░░░] 50%\n📂 Located 2,847 files`,
        `🔑 Cracking password hash (SHA-256)...\n[███████░░░] 70%\n🗝️ Key fragment: 9X..A4..F1..`,
        `📥 Extracting contacts & media...\n[████████░░] 85%\n💬 Downloading chat logs...`,
        `💀 *ACCESS GRANTED* 💀\n[██████████] 100%\n🔴 SYSTEM COMPROMISED`,
    ];
    for (const step of steps) {
        await wait(1000 + Math.random() * 500);
        await sock.sendMessage(from, { text: step, edit: sent.key });
    }
    await wait(1600);
    await sock.sendMessage(from, {
        text: `😂 *RELAX — IT'S JUST A PRANK!* 😂\n\nNothing was actually hacked, accessed, or downloaded. *${target}*'s data is 100% safe.\n\nThis was a harmless fake animation from *${BOT_NAME}* — no real hacking tools were used, no data was touched. Just for laughs 😄🔒`,
        edit: sent.key
    });
}});
const DAD_JOKES = ["Why don't skeletons fight each other? They don't have the guts.", "I'm reading a book on anti-gravity. It's impossible to put down!", "Why did the scarecrow win an award? He was outstanding in his field.", "I used to be a banker, but I lost interest.", "What do you call fake spaghetti? An impasta."];
reg('dadjoke', { category: 'Fun', desc: '.dadjoke', run: async ({ reply }) => { await reply(`👨 ${pick(DAD_JOKES)}`); }});
const KNOCK_KNOCK = ["Knock knock! Who's there? Lettuce. Lettuce who? Lettuce in, it's cold out here!", "Knock knock! Who's there? Boo. Boo who? Aww, don't cry, it's just a joke!", "Knock knock! Who's there? Cargo. Cargo who? Car go 'vroom vroom'!"];
reg('knockknock', { category: 'Fun', desc: '.knockknock', run: async ({ reply }) => { await reply(pick(KNOCK_KNOCK)); }});
reg('luckynumber', { category: 'Fun', desc: '.luckynumber', run: async ({ reply }) => { await reply(`🍀 Your lucky number today is *${randInt(1, 99)}*`); }});
reg('zodiaccompat', { category: 'Fun', desc: '.zodiaccompat [sign1] [sign2]', run: async ({ reply, args }) => {
    if (args.length < 2) return reply('❌ Usage: .zodiaccompat leo aries');
    await reply(`💫 ${args[0]} + ${args[1]} compatibility: *${randInt(30, 100)}%*`);
}});
const SUPERHERO_ADJ = ['Shadow', 'Crimson', 'Iron', 'Silent', 'Blazing', 'Mystic', 'Storm', 'Phantom'];
const SUPERHERO_NOUN = ['Falcon', 'Wolf', 'Blade', 'Guardian', 'Viper', 'Hawk', 'Titan', 'Ghost'];
reg('superhero', { category: 'Fun', desc: '.superhero', run: async ({ reply }) => { await reply(`🦸 ${pick(SUPERHERO_ADJ)} ${pick(SUPERHERO_NOUN)}`); }});
const VILLAIN_ADJ = ['Dark', 'Vile', 'Wicked', 'Grim', 'Toxic', 'Savage', 'Cruel', 'Rogue'];
reg('villainname', { category: 'Fun', desc: '.villainname', run: async ({ reply }) => { await reply(`🦹 ${pick(VILLAIN_ADJ)} ${pick(SUPERHERO_NOUN)}`); }});
const ANIME_FACTS = ["Studio Ghibli was co-founded by Hayao Miyazaki in 1985.", "One Piece has been running since 1997 and is still ongoing.", "Astro Boy is considered one of the earliest anime series, from 1963.", "Naruto's iconic running pose was inspired by real ninja stealth stances."];
reg('animefact', { category: 'Fun', desc: '.animefact', run: async ({ reply }) => { await reply(`🎌 ${pick(ANIME_FACTS)}`); }});
const MOVIE_FACTS = ["The Lumière brothers screened the first public film in 1895.", "Titanic (1997) held the highest-grossing film record for 12 years.", "The Wilhelm Scream sound effect has been used in over 400 films.", "Avatar (2009) took over a decade to develop the technology used to film it."];
reg('moviefact', { category: 'Fun', desc: '.moviefact', run: async ({ reply }) => { await reply(`🎬 ${pick(MOVIE_FACTS)}`); }});
const SPACE_FACTS = ["A day on Venus is longer than its year.", "Neutron stars can spin at over 600 rotations per second.", "There are more stars in the universe than grains of sand on Earth.", "The footprints on the Moon will likely stay there for millions of years."];
reg('spacefact', { category: 'Fun', desc: '.spacefact', run: async ({ reply }) => { await reply(`🚀 ${pick(SPACE_FACTS)}`); }});
const TECH_FACTS = ["The first computer mouse was made of wood.", "More than 90% of the world's currency exists only digitally.", "The first 1GB hard drive (1980) weighed over 500 pounds.", "Email existed before the World Wide Web."];
reg('techfact', { category: 'Fun', desc: '.techfact', run: async ({ reply }) => { await reply(`💻 ${pick(TECH_FACTS)}`); }});
const MYTH_FACTS = ["In Norse mythology, Thor's hammer Mjolnir could only be lifted by the worthy.", "The Greek Titan Atlas was condemned to hold up the sky, not the Earth.", "Anubis, the Egyptian god of the dead, has the head of a jackal.", "In Sri Lankan folklore, the Mahasona is a fearsome graveyard demon."];
reg('mythfact', { category: 'Fun', desc: '.mythfact', run: async ({ reply }) => { await reply(`📜 ${pick(MYTH_FACTS)}`); }});
const BRAIN_TEASERS = [{ q: 'What has to be broken before you can use it?', a: 'An egg' }, { q: 'What gets wetter the more it dries?', a: 'A towel' }, { q: 'What has keys but no locks, space but no room?', a: 'A keyboard' }];
reg('brainteaser', { category: 'Fun', desc: '.brainteaser', run: async ({ reply }) => { const b = pick(BRAIN_TEASERS); await reply(`🧠 ${b.q}\n||Answer: ${b.a}||`); }});
const SCENARIOS = ['You wake up with the ability to talk to animals, but only chickens.', 'You can teleport, but only to places you have already sneezed.', 'You gain super strength, but only on Tuesdays.'];
reg('scenario', { category: 'Fun', desc: '.scenario', run: async ({ reply }) => { await reply(`🎭 ${pick(SCENARIOS)}`); }});
const NICKNAME_ADJ = ['Sunny', 'Sparky', 'Breezy', 'Cosmic', 'Jolly', 'Turbo', 'Lucky', 'Zesty'];
reg('nickname', { category: 'Fun', desc: '.nickname [name]', run: async ({ reply, q }) => {
    if (!q) return reply('❌ Provide a name.'); await reply(`✨ ${pick(NICKNAME_ADJ)} ${q}`);
}});
reg('shipname', { category: 'Fun', desc: '.shipname [name1] [name2]', run: async ({ reply, args }) => {
    if (args.length < 2) return reply('❌ Usage: .shipname Alex Sam');
    const a = args[0], b = args[1];
    await reply(`💞 Ship Name: *${a.slice(0, Math.ceil(a.length / 2))}${b.slice(Math.floor(b.length / 2))}*`);
}});
reg('crushrate', { category: 'Fun', desc: '.crushrate [name]', run: async ({ reply, q }) => {
    if (!q) return reply('❌ Provide a name.'); await reply(`💓 Your crush meter for *${q}*: ${randInt(0, 100)}%`);
}});
reg('iqtest', { category: 'Fun', desc: '.iqtest', run: async ({ reply }) => { await reply(`🧠 Your (very unofficial and just-for-fun) IQ today: *${randInt(85, 145)}*`); }});
reg('luckday', { category: 'Fun', desc: '.luckday', run: async ({ reply }) => {
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    await reply(`🍀 Your lucky day this week is *${pick(days)}*`);
}});
reg('powerlevel', { category: 'Fun', desc: '.powerlevel', run: async ({ reply }) => { await reply(`⚡ Power Level: *${randInt(1000, 9999)}* — it's over 9000... almost!`); }});
const ANIMAL_PERSONALITIES = ['a wise old owl', 'a playful otter', 'a loyal wolf', 'a curious fox', 'a gentle deer', 'a bold lion'];
reg('animalpersonality', { category: 'Fun', desc: '.animalpersonality', run: async ({ reply }) => { await reply(`🐾 Your spirit animal personality: *${pick(ANIMAL_PERSONALITIES)}*`); }});
reg('secretadmirer', { category: 'Fun', desc: '.secretadmirer', run: async ({ reply }) => { await reply(pick(['👀 Someone in this chat might have a crush on you...', '💌 Your secret admirer is closer than you think!', '😏 Someone thinks you are pretty amazing.'])); }});
const FUTURE_JOBS = ['Astronaut', 'Chef', 'Game Developer', 'Detective', 'Musician', 'Marine Biologist', 'Pilot', 'Architect'];
reg('futurejob', { category: 'Fun', desc: '.futurejob', run: async ({ reply }) => { await reply(`💼 Your future job: *${pick(FUTURE_JOBS)}*`); }});
const PAST_LIVES = ['a pirate captain', 'a royal scribe', 'a wandering monk', 'a Viking explorer', 'a court jester', 'a silk road merchant'];
reg('pastlife', { category: 'Fun', desc: '.pastlife', run: async ({ reply }) => { await reply(`🕰️ In a past life, you were *${pick(PAST_LIVES)}*`); }});
const SUPERPOWERS = ['Invisibility', 'Time Travel', 'Mind Reading', 'Super Speed', 'Flight', 'Shape-shifting', 'Teleportation'];
reg('superpower', { category: 'Fun', desc: '.superpower', run: async ({ reply }) => { await reply(`🦸 Your superpower would be: *${pick(SUPERPOWERS)}*`); }});

// ---- GROUP & OWNER UTILITIES (10) ----
reg('groupid', { category: 'Group', desc: '.groupid', groupOnly: true, run: async ({ reply, from }) => { await reply(`🆔 Group ID: ${from}`); }});
reg('grouppic', { category: 'Group', desc: '.grouppic', groupOnly: true, run: async ({ sock, from, reply }) => {
    try {
        const url = await sock.profilePictureUrl(from, 'image');
        await sock.sendMessage(from, { image: { url }, caption: '🖼️ Group Picture' });
    } catch (e) { await reply('❌ This group has no profile picture.'); }
}});
reg('membercount', { category: 'Group', desc: '.membercount', groupOnly: true, run: async ({ reply, groupMetadata }) => {
    await reply(`👥 Members: ${groupMetadata?.participants?.length || 0}`);
}});
reg('groupowner', { category: 'Group', desc: '.groupowner', groupOnly: true, run: async ({ reply, groupMetadata }) => {
    await reply(groupMetadata?.owner ? `👑 Group Owner: @${groupMetadata.owner.split('@')[0]}` : 'ℹ️ Owner info not available for this group.');
}});
reg('tagadmins', { category: 'Group', desc: '.tagadmins [message]', groupOnly: true, run: async ({ sock, from, groupMetadata, q }) => {
    const admins = groupMetadata.participants.filter(p => p.admin === 'admin' || p.admin === 'superadmin');
    if (!admins.length) return sock.sendMessage(from, { text: 'ℹ️ No admins found.' });
    await sock.sendMessage(from, { text: `📢 ${q || 'Attention admins!'}\n\n${admins.map(a => `@${a.id.split('@')[0]}`).join(' ')}`, mentions: admins.map(a => a.id) });
}});
reg('getpp', { category: 'Owner', desc: '.getpp (reply to a message)', run: async ({ sock, from, msg, reply }) => {
    const target = msg.message?.extendedTextMessage?.contextInfo?.participant;
    if (!target) return reply('❌ Reply to a message from the person whose profile picture you want.');
    try {
        const url = await sock.profilePictureUrl(target, 'image');
        await sock.sendMessage(from, { image: { url }, caption: '🖼️ Profile Picture' });
    } catch (e) { await reply('❌ Could not fetch profile picture (may be private).'); }
}});
reg('blocklist', { category: 'Owner', desc: '.blocklist', ownerOnly: true, run: async ({ sock, reply }) => {
    try {
        const list = await sock.fetchBlocklist();
        await reply(list.length ? `🚫 *Blocked Contacts:*\n${list.map(j => j.split('@')[0]).join('\n')}` : 'ℹ️ No blocked contacts.');
    } catch (e) { await reply('❌ Could not fetch blocklist.'); }
}});
reg('groupdesc', { category: 'Group', desc: '.groupdesc', groupOnly: true, run: async ({ reply, groupMetadata }) => {
    await reply(groupMetadata?.desc ? `📄 *Group Description:*\n${groupMetadata.desc}` : 'ℹ️ No description set for this group.');
}});
reg('jid', { category: 'System', desc: '.jid', run: async ({ reply, sender }) => { await reply(`🆔 Your JID: ${sender}`); }});
reg('stats', { category: 'System', desc: '.stats', run: async ({ reply }) => {
    const uptimeSec = Math.floor(process.uptime());
    const h = Math.floor(uptimeSec / 3600), m = Math.floor((uptimeSec % 3600) / 60), sec = uptimeSec % 60;
    const mem = process.memoryUsage();
    const usedMb = (mem.rss / 1024 / 1024).toFixed(1);
    await reply(
        `╔═❖ *SYSTEM STATUS* ❖═╗\n` +
        `║ 🖥️ *Bot:* ${BOT_NAME}\n` +
        `║ ⚡ *Commands:* ${new Set(Object.values(commands)).size}+\n` +
        `║ 🤖 *Active Bots:* ${activeBotCount()}\n` +
        `║ 💾 *Sessions:* ${sessions.size}\n` +
        `║ ⏱️ *Uptime:* ${h}h ${m}m ${sec}s\n` +
        `║ 🧠 *Memory:* ${usedMb} MB\n` +
        `║ 🟢 *Node.js:* ${process.version}\n` +
        `║ 🔧 *Platform:* ${process.platform}\n` +
        `╚══════════════════╝`
    );
}});

// Emoji shown per category header in the menu — keep this consistent with
// the emoji the bot uses elsewhere (alive/owner cards) for a unified feel.
const CATEGORY_EMOJI = {
    System: '🚀',
    Owner: '👑',
    Group: '🛡️',
    Fun: '🎉',
    Tools: '🧰',
    Sticker: '🖼️',
    Search: '🔎',
};
// A small rotating icon set per category so each command line gets its own
// bullet instead of one flat "➤" everywhere — gives the menu a premium feel.
const CATEGORY_BULLETS = {
    System: ['⚡', '🔋', '📶', '🛰️'],
    Owner: ['👑', '💎', '🗝️'],
    Group: ['🛡️', '🔨', '📢', '🔗'],
    Fun: ['🎲', '🎭', '🔥', '💫', '🃏'],
    Tools: ['🧩', '🔧', '📐', '🔢', '📎'],
    Sticker: ['🖼️', '✂️'],
    Search: ['🔎', '🌐'],
};

// Converts plain text into Unicode "Mathematical Sans-Bold" characters —
// these are real, distinct Unicode codepoints (not a custom font), so they
// render as a bold, premium-looking typeface on every device/WhatsApp
// client without needing any special font support. Only letters/digits are
// converted; spaces, emoji, and punctuation pass through unchanged so
// syntax like ".ping [text]" stays fully readable.
// A little "fancy font" engine — converts normal text into several different
// real Unicode typefaces (not images, not a custom font — genuine distinct
// codepoints), so different parts of the menu/replies can each use a
// different eye-catching style, exactly like the popular "fancy font"
// generator apps. Renders correctly on every device/WhatsApp client with no
// special font installed.
const FONT_OFFSETS = {
    boldSans: { upper: 0x1D5D4, lower: 0x1D5EE, digit: 0x1D7EC },       // 𝗕𝗼𝗹𝗱 𝗦𝗮𝗻𝘀
    italicSans: { upper: 0x1D608, lower: 0x1D622, digit: null },        // 𝘐𝘵𝘢𝘭𝘪𝘤
    boldItalicSans: { upper: 0x1D63C, lower: 0x1D656, digit: null },    // 𝙄𝙩𝙖𝙡𝙞𝙘 𝘽𝙤𝙡𝙙
    script: { upper: 0x1D49C, lower: 0x1D4B6, digit: null },            // 𝒮𝒸𝓇𝒾𝓅𝓉 (with known gaps, patched below)
    boldScript: { upper: 0x1D4D0, lower: 0x1D4EA, digit: null },        // 𝓑𝓸𝓵𝓭 𝓢𝓬𝓻𝓲𝓹𝓽
    doubleStruck: { upper: 0x1D538, lower: 0x1D552, digit: 0x1D7D8 },   // 𝔻𝕠𝕦𝕓𝕝𝕖 (with known gaps, patched below)
    fraktur: { upper: 0x1D504, lower: 0x1D51E, digit: null },           // 𝔉𝔯𝔞𝔨𝔱𝔲𝔯 (with known gaps, patched below)
    monospace: { upper: 0x1D670, lower: 0x1D68A, digit: 0x1D7F6 },      // 𝚖𝚘𝚗𝚘
};
// A handful of math-alphanumeric letters were left as their original
// Unicode "compatibility" codepoints instead of getting a spot in the
// dedicated block, so the formula above misses them — patch those in.
const FONT_EXCEPTIONS = {
    script: { C: '𝒞', H: 'ℋ', I: 'ℐ', L: 'ℒ', R: 'ℛ', e: 'ℯ', g: 'ℊ', o: 'ℴ' },
    doubleStruck: { C: 'ℂ', H: 'ℍ', N: 'ℕ', P: 'ℙ', Q: 'ℚ', R: 'ℝ', Z: 'ℤ' },
    fraktur: { C: 'ℭ', H: 'ℌ', I: 'ℑ', R: 'ℜ', Z: 'ℨ' },
};
function toFont(text, style) {
    const cfg = FONT_OFFSETS[style];
    if (!cfg) return String(text);
    const exceptions = FONT_EXCEPTIONS[style] || {};
    return String(text).replace(/[A-Za-z0-9]/g, (ch) => {
        if (exceptions[ch]) return exceptions[ch];
        const code = ch.charCodeAt(0);
        if (code >= 65 && code <= 90 && cfg.upper) return String.fromCodePoint(cfg.upper + (code - 65));
        if (code >= 97 && code <= 122 && cfg.lower) return String.fromCodePoint(cfg.lower + (code - 97));
        if (code >= 48 && code <= 57 && cfg.digit) return String.fromCodePoint(cfg.digit + (code - 48));
        return ch;
    });
}
// Shorthand helpers used throughout the bot's replies.
const toProFont = (t) => toFont(t, 'boldSans');
const toItalic = (t) => toFont(t, 'italicSans');
const toBoldItalic = (t) => toFont(t, 'boldItalicSans');
const toScript = (t) => toFont(t, 'script');
const toBoldScript = (t) => toFont(t, 'boldScript');
const toDoubleStruck = (t) => toFont(t, 'doubleStruck');
const toFraktur = (t) => toFont(t, 'fraktur');
const toMonospaceFont = (t) => toFont(t, 'monospace');

// Big block-letter "ASCII art" banner for headers — a 5-row dot-matrix font
// rendered with █ blocks. Must be wrapped in a ``` monospace code block when
// sent, or the columns won't line up on WhatsApp.
const ART_FONT = {
    M: ['█   █', '██ ██', '█ █ █', '█   █', '█   █'],
    A: [' ███ ', '█   █', '█████', '█   █', '█   █'],
    D: ['████ ', '█   █', '█   █', '█   █', '████ '],
    U: ['█   █', '█   █', '█   █', '█   █', ' ███ '],
    S: [' ████', '█    ', ' ███ ', '    █', '████ '],
    H: ['█   █', '█   █', '█████', '█   █', '█   █'],
    N: ['█   █', '██  █', '█ █ █', '█  ██', '█   █'],
    K: ['█  █ ', '█ █  ', '██   ', '█ █  ', '█  █ '],
    O: [' ███ ', '█   █', '█   █', '█   █', ' ███ '],
    W: ['█   █', '█   █', '█ █ █', '██ ██', '█   █'],
    R: ['████ ', '█   █', '████ ', '█ █  ', '█  █ '],
    P: ['████ ', '█   █', '████ ', '█    ', '█    '],
    ' ': ['  ', '  ', '  ', '  ', '  '],
};
function generateArt(word) {
    const chars = word.toUpperCase().split('').map(c => ART_FONT[c] || ART_FONT[' ']);
    return [0, 1, 2, 3, 4].map(row => chars.map(c => c[row]).join(' ')).join('\n');
}

function getHour() {
    return new Date().getUTCHours();
}
function greeting() {
    const h = getHour();
    if (h < 12) return 'Good Morning 🌅';
    if (h < 17) return 'Good Afternoon ☀️';
    if (h < 20) return 'Good Evening 🌇';
    return 'Good Night 🌙';
}

function buildMenu() {
    const grouped = {};
    const printed = new Set();
    for (const [name, def] of Object.entries(commands)) {
        if (printed.has(def)) continue;
        printed.add(def);
        if (!grouped[def.category]) grouped[def.category] = [];
        grouped[def.category].push(def.desc);
    }
    // Fixed, sensible category order (falls back to alphabetical for any
    // category not listed here) so the menu reads the same every time.
    const CATEGORY_ORDER = ['System', 'Owner', 'Group', 'Fun', 'Tools', 'Text', 'Sticker', 'Search'];
    let cats = Object.keys(grouped).sort((a, b) => {
        const ia = CATEGORY_ORDER.indexOf(a), ib = CATEGORY_ORDER.indexOf(b);
        if (ia === -1 && ib === -1) return a.localeCompare(b);
        if (ia === -1) return 1;
        if (ib === -1) return -1;
        return ia - ib;
    });

    // Full menu — every command, under every category, every time .menu is
    // typed. Header text is kept plain (just "MADUSHANKA MD", no stylized
    // font or ASCII art banner) while category boxes below still use the
    // bullet/emoji styling.
    let out = `╔═❖ *${BOT_NAME}* 👑 ❖═╗\n`;
    out += `║ ${greeting()}\n`;
    out += `║ 💎 *Edition:* PRO\n`;
    out += `║ 👤 *Owner:* ${OWNER_NAME}\n`;
    out += `║ 🤖 *AI Agent:* Just say "Nimah" or DM me\n`;
    out += `║ ⚡ *Commands:* ${printed.size}+ across ${cats.length} categories\n`;
    out += `╚══════════════════╝\n`;

    cats.forEach((cat, idx) => {
        const list = grouped[cat];
        const emoji = CATEGORY_EMOJI[cat] || '✨';
        const bullets = CATEGORY_BULLETS[cat] || ['✨'];
        const num = String(idx + 1).padStart(2, '0');
        out += `\n┏━❮ ${num} ❯━ ${emoji} *${cat.toUpperCase()}* (${list.length}) ━┓\n`;
        list.forEach((d, i) => { out += `┃ ${bullets[i % bullets.length]} ${d}\n`; });
        out += `┗━━━━━━━━━━━━━━━━━┛\n`;
    });

    out += `\n> 💎 *${BOT_NAME} PRO* — Powered By Nimah Dev 🔥`;
    return out;
}

// =========================================================================
// Main Bot Logic
// =========================================================================
async function startBotSession(sessionId) {
    let s = sessions.get(sessionId);
    if (!s) {
        s = {
            id: sessionId,
            sock: null, isConnected: false, currentQR: null,
            reconnectAttempts: 0, reconnectTimer: null, pairingInProgress: false,
            sessionDir: path.join(SESSION_ROOT, 'sessions', sessionId),
            autoStatus: { ...AUTO_STATUS_DEFAULT },
            createdAt: Date.now()
        };
        sessions.set(sessionId, s);
        // Restore this bot's saved autoStatus preference (and any admin-panel
        // customization) from Firestore, if it was paired before.
        fsGet('botConfig', sessionId, null).then((saved) => {
            if (saved && saved.autoStatus) Object.assign(s.autoStatus, saved.autoStatus);
            if (saved && saved.label) s.label = saved.label;
            if (saved && saved.userPassword) s.userPassword = saved.userPassword;
            if (saved && saved.ownerNumber) s.ownerNumber = saved.ownerNumber;
        });
    }
    s.currentQR = null;
    const { state, saveCreds } = await useMultiFileAuthState(s.sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        auth: state,
        // Library helper only — no hardcoded browser version. 'Chrome' is a
        // recognized browser, required for pairing-code linking to work.
        browser: Browsers.ubuntu('Chrome'),
        // Common fixes for pairing failures on resource-constrained hosts
        // (like Railway's free tier): skip syncing full chat history and
        // don't force an "online" presence right after pairing — both can
        // slow down or overload the socket during the critical pairing
        // handshake window, which can make WhatsApp reject the code even
        // though it looked "connected" on our side.
        syncFullHistory: false,
        markOnlineOnConnect: false,
        // Send keep-alive frames more frequently than the 30s default so we
        // detect a dead socket fast (and so Railway's network layer doesn't
        // treat the connection as idle and silently drop it while we wait
        // for the phone to submit the pairing code).
        keepAliveIntervalMs: 15000
    });
    s.sock = sock;

    // ---- Anti-ban send queue ----
    // WhatsApp flags accounts that fire off messages too fast or too
    // uniformly as spam/bot behavior -- a common cause of bans for bots
    // like this. Every outgoing message from this session goes through
    // here instead of calling sock.sendMessage directly: it's queued,
    // paced with a randomized human-like delay, and preceded by a brief
    // "typing..." presence so the traffic pattern looks natural instead of
    // instant machine-gun replies.
    const sendQueue = [];
    let sendQueueBusy = false;
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    async function processSendQueue() {
        if (sendQueueBusy) return;
        sendQueueBusy = true;
        while (sendQueue.length) {
            const job = sendQueue.shift();
            try {
                await sock.sendPresenceUpdate('composing', job.jid).catch(() => {});
                await wait(350 + Math.random() * 450);
                const result = await sock.sendMessage(job.jid, job.content, job.options);
                await sock.sendPresenceUpdate('paused', job.jid).catch(() => {});
                job.resolve(result);
            } catch (e) {
                job.reject(e);
            }
            // Randomized gap between messages -- never fire back-to-back.
            await wait(700 + Math.random() * 900);
        }
        sendQueueBusy = false;
    }
    function queueSend(jid, content, options) {
        return new Promise((resolve, reject) => {
            sendQueue.push({ jid, content, options, resolve, reject });
            processSendQueue();
        });
    }
    s.queueSend = queueSend;

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr, isNewLogin, receivedPendingNotifications } = update;

        // Full diagnostic dump of every connection.update event. This is the
        // piece that was missing before — we only logged on 'close'/'open',
        // so failures that happened silently (e.g. WhatsApp rejecting a
        // pairing attempt without ever emitting our tracked statusCode)
        // left no trace in the logs. Keep this on for now while debugging;
        // it's cheap and text-only.
        console.log(`📶 [${sessionId}] connection.update:`, JSON.stringify({
            connection,
            qr: qr ? '[qr present]' : undefined,
            isNewLogin,
            receivedPendingNotifications,
            errorMessage: lastDisconnect?.error?.message,
            statusCode: lastDisconnect?.error?.output?.statusCode
        }));

        if (qr) s.currentQR = qr;
        if (connection === 'open') s.currentQR = null;

        if (connection === 'close') {
            s.isConnected = false;
            const statusCode = lastDisconnect?.error?.output?.statusCode;

            // Clean up this socket instance's listeners so we don't stack
            // duplicate handlers on every reconnect (memory leak + duplicate replies).
            try {
                sock.ev.removeAllListeners();
            } catch (e) { /* ignore */ }

            if (statusCode === DisconnectReason.loggedOut) {
                const wasRegistered = !!state?.creds?.registered;
                if (!wasRegistered) {
                    // Either the code expired before it was entered, or
                    // WhatsApp rejected the pairing attempt for another
                    // reason. Check the connection.update log lines above
                    // (right before this one) for the real error message.
                    console.log(`⏰ [${sessionId}] Pairing did not complete (code expired or was rejected). Generate a new one from the pairing page.`);
                } else {
                    console.log(`🔌 [${sessionId}] Logged out from a previously linked session. Clearing session and restarting pairing.`);
                }
                s.reconnectAttempts = 0;
                fs.rm(s.sessionDir, { recursive: true, force: true }, () => startBotSession(sessionId));
                return;
            }

            if (statusCode === DisconnectReason.badSession) {
                console.log(`⚠️ [${sessionId}] Bad session file. Clearing session and restarting.`);
                s.reconnectAttempts = 0;
                fs.rm(s.sessionDir, { recursive: true, force: true }, () => startBotSession(sessionId));
                return;
            }

            if (statusCode === DisconnectReason.connectionReplaced) {
                // Another session (e.g. WhatsApp opened elsewhere with same
                // creds) took over. Don't hammer reconnects in this case.
                console.log(`⚠️ [${sessionId}] Connection replaced by another session. Not auto-reconnecting.`);
                return;
            }

            if (statusCode === DisconnectReason.restartRequired) {
                // This is a NORMAL, expected step right after a QR scan —
                // WhatsApp always closes the socket once with this code as
                // part of finishing the pairing handshake, then expects an
                // immediate reconnect (not a real failure). Reconnect right
                // away instead of waiting on the backoff delay below, or the
                // status dot on the pairing page sits on "offline" for
                // several seconds for no real reason.
                console.log(`🔁 [${sessionId}] Restart required (normal post-pairing step) — reconnecting immediately.`);
                startBotSession(sessionId);
                return;
            }

            // For everything else (timedOut, connectionLost, connectionClosed,
            // unknown network blips, etc.) reconnect with exponential backoff
            // instead of a fixed 3s retry loop.
            s.reconnectAttempts++;
            const delay = Math.min(3000 * (2 ** (s.reconnectAttempts - 1)), MAX_RECONNECT_DELAY_MS);
            console.log(`🔌 [${sessionId}] Connection closed. Status: ${statusCode || 'unknown'}. Reconnecting in ${Math.round(delay / 1000)}s (attempt ${s.reconnectAttempts})...`);

            clearTimeout(s.reconnectTimer);
            s.reconnectTimer = setTimeout(() => startBotSession(sessionId), delay);
        } else if (connection === 'open') {
            s.isConnected = true;
            s.reconnectAttempts = 0; // reset backoff once we're stably connected
            clearTimeout(s.reconnectTimer);
            console.log(`🤖 🚀 [${sessionId}] ${BOT_NAME} Power Bot Successfully Connected to WhatsApp! 🔥`);

            // ---- First-time setup: generate this bot's self-service settings login ----
            // Only runs once per bot (skipped on every later reconnect) since
            // s.userPassword is loaded from Firestore at session creation if
            // it was already generated before.
            if (!s.userPassword) {
                s.ownerNumber = (sock.user && sock.user.id ? sock.user.id.split(':')[0] : '').replace(/[^0-9]/g, '');
                s.userPassword = nodeCrypto.randomBytes(4).toString('hex'); // 8-char password
                fsSet('botConfig', s.id, {
                    autoStatus: s.autoStatus, label: s.label || null,
                    userPassword: s.userPassword, ownerNumber: s.ownerNumber
                });
                const selfJid = sock.user.id;
                const settingsMsg =
                    `🎉 *Your bot is connected!*\n\n` +
                    `╭━━━〔 👑 *${BOT_NAME}* 〕━━━┈⊷\n` +
                    `┃ ✅ Successfully linked to this number\n` +
                    `┃ 🤖 Your bot is now online and ready\n` +
                    `╰━━━━━━━━━━━━━━━━━━━━━━━┈⊷\n\n` +
                    `🔐 *Your Settings Panel Login*\n` +
                    `┃ 📱 Number: ${s.ownerNumber}\n` +
                    `┃ 🔑 Password: *${s.userPassword}*\n\n` +
                    `Use these to log in and customize your bot (label, auto status view/react, etc).\n` +
                    `Type *.menu* to see everything your bot can do. 🔥`;
                // Small delay so this doesn't land before WhatsApp has fully
                // settled the new connection.
                setTimeout(() => {
                    sock.sendMessage(selfJid, { text: settingsMsg }).catch((e) => console.log(`[${sessionId}] Failed to send settings-login message:`, e.message));
                }, 2500);
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg.message) return;

            // ---- Auto Status View/React ----
            if (msg.key.remoteJid === 'status@broadcast') {
                if (msg.key.fromMe) return;
                try {
                    if (s.autoStatus.view) await sock.readMessages([msg.key]);
                    if (s.autoStatus.react) {
                        await sock.sendMessage('status@broadcast', {
                            react: { text: s.autoStatus.emoji, key: msg.key }
                        }, { statusJidList: [msg.key.participant, sock.user.id] });
                    }
                } catch (e) { /* ignore status view/react errors */ }
                return;
            }
            if (msg.key.fromMe) return;

            const messageType = Object.keys(msg.message)[0];
            const body = messageType === 'conversation' ? msg.message.conversation :
                         messageType === 'extendedTextMessage' ? msg.message.extendedTextMessage.text : '';
            if (!body) return;

            const args = body.trim().split(/ +/);
            const rawCommand = args[0].toLowerCase();
            const isCommandMsg = rawCommand.startsWith('.') || rawCommand.startsWith('/');
            const from = msg.key.remoteJid;
            const sender = msg.key.participant || msg.key.remoteJid;
            const isGroup = from.endsWith('@g.us');

            // Log every group message (regardless of command or not) for
            // .vibe and the daily digest to summarize later.
            if (isGroup) {
                logGroupMessage(from, sender, body);
                // Opportunistic digest trigger: fires the first time a
                // message arrives in a digest-enabled group more than 24h
                // since the last one, instead of running a standalone timer
                // that would need to track which session serves which group.
                const gs = getGroupSettings(from);
                if (gs.digest && (!gs.lastDigestAt || Date.now() - gs.lastDigestAt > 24 * 60 * 60 * 1000)) {
                    gs.lastDigestAt = Date.now();
                    persistGroupSettings(from);
                    sendDailyDigest(s, from).catch(() => {});
                }
            }

            // Relay to a bridged chat, if this chat has one set up (.bridge).
            const bridge = bridges.get(bridgeKey(s.id, from));
            if (bridge) {
                const targetSession = sessions.get(bridge.targetSessionId);
                if (targetSession && targetSession.isConnected) {
                    const senderTag = sender.split('@')[0];
                    targetSession.queueSend(bridge.targetJid, { text: `🌉 *${senderTag}:* ${body}` }).catch(() => {});
                }
            }

            // Reply-with-number menus (reply "1", "2"... to a menu message).
            if (!isCommandMsg && await handleMenuNumberReply({ session: s, msg, from, body })) return;

            if (!isCommandMsg) {
                // Not a command — let the Nimah AI agent decide whether to
                // jump in (always in a DM, only when addressed in a group).
                await maybeHandleNimahAgent({ sock, msg, from, sender, isGroup, body, session: s });
                return;
            }
            args.shift();
            const command = rawCommand.slice(1);
            const q = args.join(' ');
            const reply = (text) => queueSend(from, { text }, { quoted: msg });

            // Anti-flood: ignore a command from the same person if they
            // fired one less than 900ms ago. This blocks rapid-fire
            // command spam (accidental double-taps or someone deliberately
            // hammering the bot) from turning into a burst of outgoing
            // messages that looks bot-like to WhatsApp.
            const nowTs = Date.now();
            const lastCmdTs = lastCommandAt.get(sender) || 0;
            if (nowTs - lastCmdTs < 900) return;
            lastCommandAt.set(sender, nowTs);

            const def = commands[command];
            if (!def) {
                // Custom commands added via the admin panel's No-Code Command
                // Builder — a simple stored text reply, no code required.
                const custom = customCommands.get(command);
                if (custom) await reply(custom.reply);
                return;
            }

            let groupMetadata = null;
            let isSenderAdmin = false;
            if (isGroup) {
                try {
                    groupMetadata = await sock.groupMetadata(from);
                    const participant = groupMetadata.participants.find(p => p.id === sender);
                    isSenderAdmin = !!(participant && (participant.admin === 'admin' || participant.admin === 'superadmin'));
                } catch (e) { /* ignore */ }
            }

            if (def.groupOnly && !isGroup) return reply('❌ This command only works in groups.');
            if (def.adminOnly && !isSenderAdmin && !isOwner(sender)) return reply('❌ Only group admins can use this command.');
            if (def.ownerOnly && !isOwner(sender)) return reply('❌ Only the bot owner can use this command.');

            // Simple antilink enforcement for groups that enabled it
            if (isGroup) {
                const settings = getGroupSettings(from);
                if (settings.antilink && !isSenderAdmin && /chat\.whatsapp\.com\//i.test(body)) {
                    try {
                        await sock.sendMessage(from, { delete: msg.key });
                        await reply('🚫 Links are not allowed in this group.');
                    } catch (e) { /* ignore */ }
                }
            }

            await def.run({ sock, msg, from, sender, args, q, isGroup, groupMetadata, isSenderAdmin, reply, session: s });
        } catch (err) {
            console.log('Error handling command:', err);
        }
    });

    return sock;
}

// Resume any sessions that already have saved credentials on disk (e.g. a
// bot that was paired before a Railway redeploy, on a mounted volume).
function resumeSavedSessions() {
    const sessionsRoot = path.join(SESSION_ROOT, 'sessions');
    try {
        if (!fs.existsSync(sessionsRoot)) return;
        for (const id of fs.readdirSync(sessionsRoot)) {
            startBotSession(id).catch((err) => console.log(`Failed to resume session ${id}:`, err));
        }
    } catch (e) { /* ignore */ }
}

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Web Server running on port ${PORT}`);
    console.log(`⚡ Loaded ${new Set(Object.values(commands)).size} commands.`);
    resumeSavedSessions();
    loadCustomCommands();
});

process.on('unhandledRejection', (err) => console.log('Unhandled Rejection:', err));
// Never let one bad error take the whole server (and every paired bot) down.
process.on('uncaughtException', (err) => console.log('Uncaught Exception:', err));

// ---- Connection Watchdog ----
// Belt-and-braces on top of the reconnect logic in connection.update: if a
// session is somehow left disconnected with no reconnect scheduled (e.g. an
// edge case that slipped past the handlers above), force a fresh start
// instead of leaving that bot offline indefinitely.
setInterval(() => {
    for (const [id, s] of sessions.entries()) {
        if (!s.isConnected && !s.reconnectTimer && s.sock) {
            console.log(`🩺 [${id}] Watchdog: session looked stuck offline, restarting it.`);
            startBotSession(id).catch((err) => console.log(`Watchdog restart failed for ${id}:`, err));
        }
    }
}, 90000);
