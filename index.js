// =========================================================================
// NIMAH MD — Private WhatsApp Bot
// © 2026 Nimah Dev. All Rights Reserved. Proprietary — see LICENSE.
// wa.me/94744136085
// =========================================================================

// --- Minimal .env loader (no extra dependency; real env vars win) ---
try {
    const _fs = require('fs'), _path = require('path');
    const _envFile = _path.join(__dirname, '.env');
    if (_fs.existsSync(_envFile)) {
        for (const line of _fs.readFileSync(_envFile, 'utf8').split(/\r?\n/)) {
            const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
            if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) {
                process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
            }
        }
    }
} catch (e) {}

// --- Web Crypto polyfill ---
// @whiskeysockets/baileys expects a global `crypto` (Web Crypto API) to be
// present, but Node 18 does not expose it as a global by default (only
// Node 19+ does automatically). Without this, pairing-code generation
// throws "ReferenceError: crypto is not defined" from deep inside
// Baileys' internals and the socket loops connecting/closing forever.
// This must run before Baileys is required.
const nodeCrypto = require('crypto');
const osMod = require('os');

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
    downloadMediaMessage,
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
let BOT_NAME = 'NIMAH MD';
let OWNER_NAME = 'Nimah Dev';
const ASSET_DIR = path.join(SESSION_ROOT, 'assets');
const BOT_LOGO_PATH = path.join(__dirname, 'public', 'logo.jpg');
let _logoCache;
// Logo: an uploaded one (admin panel -> Brand) wins over the bundled public/logo.jpg.
const getBotLogo = () => {
    if (_logoCache === undefined) {
        for (const f of [path.join(ASSET_DIR, 'logo.jpg'), BOT_LOGO_PATH]) { try { _logoCache = fs.readFileSync(f); break; } catch (e) { /* try next */ } }
        if (_logoCache === undefined) _logoCache = null;
    }
    return _logoCache;
};
// Premium look: every text reply carries a small "Nimah MD" link-card header
// (title + thumbnail). Turn off with AD_CARD=off.
const AD_CARD_ENABLED = String(process.env.AD_CARD || 'on').toLowerCase() !== 'off';
function withAdCard(content) {
    if (!AD_CARD_ENABLED || !content || typeof content.text !== 'string' || content.contextInfo) return content;
    const thumb = getBotLogo();
    return Object.assign({}, content, { contextInfo: { externalAdReply: Object.assign({
        title: BOT_NAME, body: BRAND.description || 'Private AI Agent',
        sourceUrl: 'https://wa.me/' + (process.env.OWNER_NUMBER || '94744136085').replace(/[^0-9]/g, ''),
        mediaType: 1, renderLargerThumbnail: false, showAdAttribution: false
    }, thumb ? { thumbnail: thumb } : {}) } });
}
// (WhatsApp channel link removed from bot output per request — no longer used.)

// ---- Welcome voice (your own audio, in /public/audio) ----
// .ping and .alive send public/audio/welcome.ogg as a voice note
// (falls back to welcome.mp3 as a normal audio file).
const _audioCache = {};
function readAudio(file) {
    if (_audioCache[file] === undefined) {
        try { _audioCache[file] = fs.readFileSync(path.join(__dirname, 'public', 'audio', file)); }
        catch (e) { _audioCache[file] = null; }
    }
    return _audioCache[file];
}
// Your welcome voice (changeable from the admin panel -> Brand). Sent with .ping / .alive.
async function sendWelcomeAudio(session, from, msg, kind) {
    if (!session.soundOn || String(process.env.SOUND || 'on').toLowerCase() === 'off') return;
    if ((kind === 'ping' && BRAND.voiceOnPing === false) || (kind === 'alive' && BRAND.voiceOnAlive === false)) return;
    const v = currentVoice();
    if (!v) return;
    try { await session.queueSend(from, { audio: v.buf, mimetype: v.mime, ptt: v.ptt }, { quoted: msg }); }
    catch (e) { console.log('Welcome audio failed:', e.message); }
}
const saveBotCfg = (session) => fsSet('botConfig', session.id, { autoStatus: session.autoStatus, soundOn: session.soundOn, anticall: session.anticall, antidelete: session.antidelete, adMode: session.adMode });

// ---- Nimah Private AI Agent ----
// Uses OpenRouter (https://openrouter.ai) with a DeepSeek model.
// The API key is NEVER hardcoded: it is read from the OPENROUTER_API_KEY
// environment variable (Railway Variables) or from the local .env file
// (which is git-ignored).
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
if (!OPENROUTER_API_KEY) console.warn('[nimah] OPENROUTER_API_KEY is not set - AI agent will not work.');
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'deepseek/deepseek-chat';
const AI_WATERMARK = '\n\n┈┈┈┈┈┈┈┈┈┈┈┈\n_ɴɪᴍᴀʜ ᴀɢᴇɴᴛ  ·  ɴɪᴍᴀʜ ᴍᴅ_';
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
            if (data && (data.reply || data.url) && !data.deleted) customCommands.set(name, data);
        }
        console.log(`⚙️ Loaded ${customCommands.size} custom command(s) from Firestore.`);
        await loadStudioData();
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
            try { await session.queueSend(from, { text: decorate('⚠️ Nimah is having trouble thinking right now — try again in a moment.') }, { quoted: msg }); } catch (e2) {}
        }
    }
}
const PUBLIC_DIR = path.join(__dirname, 'public');

app.use('/api/admin/assets', express.json({ limit: '12mb' })); // logo / voice uploads
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// An uploaded logo (admin panel -> Brand) is served to the web pages too; must sit before the static handler.
app.get('/logo.jpg', (req, res, next) => {
    const f = path.join(ASSET_DIR, 'logo.jpg');
    if (!fs.existsSync(f)) return next();
    res.setHeader('Cache-Control', 'no-cache'); res.type('image/jpeg'); res.send(fs.readFileSync(f));
});
app.use(express.static(PUBLIC_DIR, { maxAge: '1h', etag: true }));

// ---- Multi-Session Bot Manager ----
// Each browser that opens the pairing page gets its own WhatsApp session, so
// any number of bots can be paired concurrently from the same deployment.
// sessionId -> { sock, isConnected, currentQR, reconnectAttempts, reconnectTimer,
//                pairingInProgress, sessionDir, createdAt }
const sessions = new Map();
const MAX_RECONNECT_DELAY_MS = 60000; // cap backoff at 60s
const startTime = Date.now();

// =========================================================================
// SESSION BACKUP — keeps every paired bot linked across restarts/redeploys,
// even on hosts with no persistent disk (e.g. Railway without a Volume).
// Files are gzipped + AES-256-GCM encrypted before they touch Firestore, with
// a key derived from BACKUP_SECRET (or your OPENROUTER_API_KEY as fallback).
// =========================================================================
const zlibMod = require('zlib');
const BACKUP_SECRET = process.env.BACKUP_SECRET || process.env.OPENROUTER_API_KEY || '';
const bkKey = BACKUP_SECRET ? nodeCrypto.createHash('sha256').update('nimah-session-backup:' + BACKUP_SECRET).digest() : null;
const BK_CHUNK = 600 * 1024;
const bkLastAt = new Map(); const bkTimers = new Map();
const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]);
function bkEncrypt(buf) {
    const iv = nodeCrypto.randomBytes(12); const c = nodeCrypto.createCipheriv('aes-256-gcm', bkKey, iv);
    const ct = Buffer.concat([c.update(buf), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), ct]);
}
function bkDecrypt(buf) {
    const d = nodeCrypto.createDecipheriv('aes-256-gcm', bkKey, buf.subarray(0, 12)); d.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([d.update(buf.subarray(28)), d.final()]);
}
async function bkUpdateIndex(id, add) {
    const idx = (await withTimeout(fsGet('authBackup', '_index', null), 8000)) || { ids: [] };
    const ids = new Set(idx.ids || []); if (add) ids.add(id); else ids.delete(id);
    await fsSet('authBackup', '_index', { ids: [...ids] });
}
async function backupSession(id) {
    if (!bkKey) return;
    const s = sessions.get(id);
    if (!s || !isPaired(s) || !fs.existsSync(s.sessionDir)) return;
    if (Date.now() - (bkLastAt.get(id) || 0) < 45000) return;
    bkLastAt.set(id, Date.now());
    try {
        const files = {};
        for (const f of fs.readdirSync(s.sessionDir)) {
            const fp = path.join(s.sessionDir, f);
            if (fs.statSync(fp).isFile() && fs.statSync(fp).size < 300 * 1024) files[f] = fs.readFileSync(fp, 'utf8');
        }
        if (!files['creds.json']) return;
        const blob = bkEncrypt(zlibMod.gzipSync(Buffer.from(JSON.stringify(files)))).toString('base64');
        const n = Math.ceil(blob.length / BK_CHUNK);
        if (n > 8) { console.log(`[${id}] Session backup too large (${n} chunks), skipped.`); return; }
        for (let i = 0; i < n; i++) await fsSet('authBackup', id + '_' + i, { d: blob.slice(i * BK_CHUNK, (i + 1) * BK_CHUNK) });
        await fsSet('authBackup', id + '_meta', { n, ts: Date.now(), owner: s.ownerNumber || '' });
        await bkUpdateIndex(id, true);
    } catch (e) { console.log(`[${id}] Session backup failed:`, e.message); }
}
function scheduleBackup(id, delayMs) {
    if (!bkKey || bkTimers.has(id)) return;
    bkTimers.set(id, setTimeout(() => { bkTimers.delete(id); backupSession(id); }, delayMs));
}
async function dropBackup(id) {
    if (!bkKey) return;
    try { await fsSet('authBackup', id + '_meta', { n: 0, ts: Date.now(), deleted: true }); await bkUpdateIndex(id, false); } catch (e) {}
}
async function restoreSessionBackups(sessionsRoot) {
    if (!bkKey) { console.log('ℹ️ Session backup is off (set BACKUP_SECRET or OPENROUTER_API_KEY to enable it).'); return; }
    try {
        const idx = await withTimeout(fsGet('authBackup', '_index', null), 15000);
        for (const id of (idx && idx.ids) || []) {
            const dir = path.join(sessionsRoot, id);
            if (fs.existsSync(path.join(dir, 'creds.json'))) continue; // a Volume copy wins
            const meta = await withTimeout(fsGet('authBackup', id + '_meta', null), 10000);
            if (!meta || !meta.n || meta.deleted) continue;
            let blob = '';
            for (let i = 0; i < meta.n; i++) { const c = await withTimeout(fsGet('authBackup', id + '_' + i, null), 10000); if (!c || !c.d) { blob = null; break; } blob += c.d; }
            if (!blob) continue;
            try {
                const files = JSON.parse(zlibMod.gunzipSync(bkDecrypt(Buffer.from(blob, 'base64'))).toString('utf8'));
                fs.mkdirSync(dir, { recursive: true });
                for (const [f, content] of Object.entries(files)) if (/^[\w.\-]+$/.test(f)) fs.writeFileSync(path.join(dir, f), content);
                console.log(`♻️ Restored bot session ${id} from backup.`);
            } catch (e) { console.log(`Could not restore ${id} (wrong BACKUP_SECRET?):`, e.message); }
        }
    } catch (e) { console.log('Session restore skipped:', e.message); }
}
setInterval(() => { for (const id of sessions.keys()) backupSession(id); }, 20 * 60 * 1000);

// =========================================================================
// COMMAND STUDIO — no-code API commands, API keys and command switches.
// Everything is stored in Firestore and edited from the admin panel
// (/studio), so new commands / fixes never need a redeploy.
// =========================================================================
let apiKeys = {};                 // NAME -> secret (set in the panel)
const disabledCmds = new Set();   // built-in commands switched off
const cmdStats = new Map();       // custom command -> { uses, fails, lastError, lastAt }
const cmdCooldowns = new Map();
const sealKey = (v) => (bkKey ? 'enc:' + bkEncrypt(Buffer.from(v, 'utf8')).toString('base64') : v);
const openKey = (v) => { try { return String(v).startsWith('enc:') ? bkDecrypt(Buffer.from(v.slice(4), 'base64')).toString('utf8') : String(v); } catch (e) { return ''; } };
function getApiKey(name) {
    name = String(name || '').toUpperCase();
    return apiKeys[name] || (name === 'CHAMA' ? (process.env.CHAMA_API_KEY || '') : '');
}
const canonicalName = (def) => Object.keys(commands).find((k) => commands[k] === def);
function maskSecrets(str) {
    let out = String(str);
    for (const v of [...Object.values(apiKeys), process.env.CHAMA_API_KEY]) if (v && v.length > 6) out = out.split(v).join('••••');
    return out;
}
function blockedHost(u) {
    try {
        const h = new URL(u.replace(/\{\{[^}]*\}\}/g, 'x')).hostname.toLowerCase();
        return h === 'localhost' || /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || h.endsWith('.internal') || h.endsWith('.local') || h === '[::1]';
    } catch (e) { return true; }
}
function getPath(obj, p) {
    for (const alt of String(p || '').split('|')) {
        const key = alt.trim(); if (!key) continue;
        let cur = obj;
        for (const part of key.split('.')) { if (cur == null) { cur = undefined; break; } cur = cur[part]; }
        if (cur !== undefined && cur !== null && cur !== '') return cur;
    }
    return undefined;
}
function renderTpl(str, vars, resp, mode) {
    // {{#each data.results limit=8}}{{n}}. {{title}}\n{{/each}}  ->  one line per item of a list
    str = String(str || '').replace(/\{\{#each\s+([^}\s]+)(?:\s+limit=(\d+))?\s*\}\}([\s\S]*?)\{\{\/each\}\}/g, (m, p, lim, inner) => {
        let arr = /^s1\./.test(p) && vars.s1 !== undefined ? getPath(vars.s1, p.slice(3)) : (resp !== undefined ? getPath(resp, p) : undefined);
        if (!Array.isArray(arr)) return '';
        return arr.slice(0, Math.min(parseInt(lim || '10', 10), 30)).map((item, i) => renderTpl(inner, Object.assign({}, vars, { n: i + 1 }), (item !== null && typeof item === 'object') ? item : { value: item }, mode === 'url' ? 'text' : mode)).join('');
    });
    return String(str || '').replace(/\{\{\s*([^}]+?)\s*\}\}/g, (m, expr) => {
        const parts = expr.split('|').map((x) => x.trim());
        let val;
        for (let i = 0; i < parts.length; i++) {
            const t = parts[i];
            if (/^key:/i.test(t)) val = getApiKey(t.slice(4));
            else if (/^s1\./.test(t) && vars.s1 !== undefined) val = getPath(vars.s1, t.slice(3));
            else if (Object.prototype.hasOwnProperty.call(vars, t)) val = vars[t];
            else if (resp !== undefined) val = getPath(resp, t);
            if (val !== undefined && val !== null && String(val) !== '') break;
            if (i === parts.length - 1 && parts.length > 1) val = t; // last token = literal default
        }
        val = val == null ? '' : (typeof val === 'object' ? JSON.stringify(val) : String(val));
        return mode === 'url' ? encodeURIComponent(val) : mode === 'json' ? JSON.stringify(val).slice(1, -1) : val;
    });
}
function walkLeaves(obj, base, out, wantUrl) {
    if (out.length > 60) return out;
    if (obj !== null && typeof obj === 'object') {
        const entries = Array.isArray(obj) ? obj.slice(0, 15).map((v, i) => [String(i), v]) : Object.entries(obj);
        for (const [k, v] of entries) walkLeaves(v, base ? base + '.' + k : k, out, wantUrl);
    } else if (obj !== undefined && obj !== null) {
        const isUrl = typeof obj === 'string' && /^https?:\/\//i.test(obj);
        if (wantUrl ? isUrl : true) out.push({ path: base, value: String(obj).slice(0, 140) });
    }
    return out;
}
const MEDIA_EXT = { image: /\.(jpe?g|png|webp|gif)(\?|$)/i, video: /\.(mp4|mkv|webm|mov)(\?|$)/i, audio: /\.(mp3|m4a|ogg|opus|wav|aac)(\?|$)/i };
function autoMedia(data, type) {
    const urls = walkLeaves(data, '', [], true);
    const bad = /thumb|cover|poster|preview|avatar|icon|original|page/i;
    const re = MEDIA_EXT[type];
    return (re && urls.find((u) => re.test(u.value) && !bad.test(u.path)))
        || urls.find((u) => /download|direct|link|url|video|audio|image|file|play|media/i.test(u.path) && !bad.test(u.path))
        || urls.find((u) => !bad.test(u.path)) || null;
}
function quotedTextOf(msg) {
    const ci = msg && msg.message && msg.message.extendedTextMessage && msg.message.extendedTextMessage.contextInfo;
    const qm = ci && ci.quotedMessage;
    return String((qm && (qm.conversation || (qm.extendedTextMessage && qm.extendedTextMessage.text) || (qm.imageMessage && qm.imageMessage.caption) || (qm.videoMessage && qm.videoMessage.caption))) || '').trim();
}
function buildVars(q, args, name, sender, chat) {
    const v = { q: q || '', name: name || '', sender: String(sender || '').split('@')[0].split(':')[0], chat: chat || '', botname: BOT_NAME };
    for (let i = 1; i <= 9; i++) v['arg' + i] = args[i - 1] || '';
    return v;
}
// Calls the API described by a command definition and works out what to send.
async function runApiDef(def, vars) {
    const missing = new Set();
    for (const m of ((def.preUrl || '') + ' ' + def.url + ' ' + def.headers + ' ' + def.body).matchAll(/\{\{\s*key:([A-Za-z0-9_]+)\s*\}\}/gi)) if (!getApiKey(m[1])) missing.add(m[1].toUpperCase());
    if (missing.size) { const e = new Error('API key not set: ' + [...missing].join(', ') + ' (add it under API keys)'); e.code = 'KEY_MISSING'; throw e; }
    let pre = null;
    if (def.preUrl && def.preUrl.trim()) { // step 1: a lookup whose answer feeds step 2 as {{s1.field}}
        const purl = renderTpl(def.preUrl, vars, undefined, 'url');
        if (blockedHost(purl)) throw new Error('Step 1 address is not allowed.');
        const pr = await axios({ method: 'GET', url: purl, timeout: (def.timeout || 60) * 1000, maxContentLength: 8 * 1024 * 1024, validateStatus: () => true, responseType: 'text', transformResponse: (x) => x });
        let pj = pr.data; try { pj = JSON.parse(pr.data); } catch (e) { /* not JSON */ }
        pre = { status: pr.status, raw: maskSecrets(typeof pr.data === 'string' ? pr.data : JSON.stringify(pr.data)).slice(0, 3000), fields: typeof pj === 'object' && pj ? walkLeaves(pj, '', [], false).slice(0, 40).map((x) => ({ path: x.path, value: maskSecrets(x.value) })) : [] };
        if (pr.status >= 400 || typeof pj !== 'object' || !pj) { const e = new Error(`Step 1 failed (HTTP ${pr.status}).`); e.pre = pre; throw e; }
        vars = Object.assign({}, vars, { s1: pj });
    }
    const url = renderTpl(def.url, vars, undefined, 'url');
    if (blockedHost(url)) throw new Error('That address is not allowed.');
    let headers = {}, data;
    try { if (def.headers && def.headers.trim()) headers = JSON.parse(renderTpl(def.headers, vars, undefined, 'json')); } catch (e) { throw new Error('Headers are not valid JSON.'); }
    try { if (def.method === 'POST' && def.body && def.body.trim()) data = JSON.parse(renderTpl(def.body, vars, undefined, 'json')); } catch (e) { throw new Error('Body is not valid JSON.'); }
    const t0 = Date.now();
    const r = await axios({ method: def.method, url, headers, data, timeout: (def.timeout || 60) * 1000, validateStatus: () => true, responseType: 'stream' });
    const ct = String(r.headers['content-type'] || '');
    const isFile = /^(image|video|audio)\//i.test(ct) || /octet-stream|application\/(pdf|zip|vnd\.android)/i.test(ct);
    let bodyText = '', resp;
    if (isFile && r.status < 400) { r.data.destroy(); resp = { _file: true }; }
    else {
        const chunks = []; let size = 0;
        for await (const ch of r.data) { size += ch.length; if (size > 8 * 1024 * 1024) { r.data.destroy(); break; } chunks.push(ch); }
        bodyText = Buffer.concat(chunks).toString('utf8'); resp = bodyText;
        try { resp = JSON.parse(bodyText); } catch (e) { /* plain text answer */ }
    }
    const ms = Date.now() - t0;
    const out = { pre, status: r.status, ms, resp, raw: isFile ? `(the API sent a file directly: ${ct}${r.headers['content-length'] ? ', ' + r.headers['content-length'] + ' bytes' : ''})` : maskSecrets(bodyText).slice(0, 6000), ok: false, mediaUrl: null, mediaPath: null, text: '' };
    if (isFile && r.status < 400) {
        // The address itself is the file: let WhatsApp fetch it from there.
        if (def.mediaType === 'text') { out.error = 'The API returns a file directly. Set "What should the bot send?" to Image, Video, Audio or Document.'; return out; }
        out.mediaUrl = url; out.mediaPath = '(direct file)'; out.ok = true;
        out.text = def.textTemplate && def.textTemplate.trim() ? renderTpl(def.textTemplate, vars, {}, 'text') : '';
        return out;
    }
    const apiMsg = resp && typeof resp === 'object' ? (getPath(resp, 'message|error|data.message|data.error') || '') : '';
    if (r.status >= 400) { out.error = `The API answered HTTP ${r.status}. ${typeof apiMsg === 'string' ? apiMsg : ''}`.trim(); return out; }
    if (def.successPath && def.successPath.trim()) {
        const ok = getPath(resp, def.successPath);
        if (!ok || String(ok).toLowerCase() === 'false') { out.error = `Success check failed (${def.successPath}). ${typeof apiMsg === 'string' ? apiMsg : ''}`.trim(); return out; }
    }
    const rv = typeof resp === 'object' ? resp : { text: String(resp) };
    if (def.mediaType !== 'text') {
        let mu = def.mediaPath && def.mediaPath.trim() ? getPath(rv, def.mediaPath) : null, mp = def.mediaPath || '';
        if (typeof mu !== 'string' || !/^https?:\/\//i.test(mu)) { const a = autoMedia(rv, def.mediaType); mu = a ? a.value : null; mp = a ? a.path + ' (auto)' : ''; if (a) { const full = getPath(rv, a.path); if (typeof full === 'string') mu = full; } }
        if (!mu) { out.error = 'No ' + def.mediaType + ' link was found in the answer. Use Test and pick the right field.'; return out; }
        out.mediaUrl = mu; out.mediaPath = mp;
    }
    if (def.textTemplate && def.textTemplate.trim()) out.text = renderTpl(def.textTemplate, vars, rv, 'text');
    else if (def.mediaType === 'text') out.text = typeof resp === 'string' ? resp : JSON.stringify(resp, null, 1).slice(0, 1500);
    else { const title = getPath(rv, 'data.title|title|data.name|name'); out.text = title ? card(def.name || 'Result', 'ready', [kv('title', String(title).slice(0, 90))]) : ''; }
    out.ok = true;
    return out;
}
async function runCustomCommand(name, c, ctx) {
    const st = cmdStats.get(name) || { uses: 0, fails: 0 }; cmdStats.set(name, st);
    const quoted = quotedTextOf(ctx.msg);
    if (!ctx.q && quoted && c.type === 'api') { ctx = Object.assign({}, ctx, { q: quoted.slice(0, 500), args: quoted.slice(0, 500).split(/\s+/).filter(Boolean) }); } // reply to a message instead of typing the link
    const vars = buildVars(ctx.q, ctx.args, ctx.msg.pushName, ctx.sender, ctx.from); vars.quoted = quoted;
    if (c.type !== 'api') { await ctx.reply(renderTpl(c.reply, vars, undefined, 'text')); st.uses++; return; }
    if (c.needsInput && !ctx.q) return ctx.reply(card(name, 'how to use', [c.usage || `.${name} [input]`]));
    if (c.cooldown) {
        const key = name + ':' + vars.sender, left = (cmdCooldowns.get(key) || 0) + c.cooldown * 1000 - Date.now();
        if (left > 0) return ctx.reply(card(name, 'cooldown', [kv('try again in', Math.ceil(left / 1000) + 's')]));
        cmdCooldowns.set(key, Date.now());
    }
    ctx.react('⏳');
    try {
        const res = await runApiDef(Object.assign({ name }, c), vars);
        if (!res.ok) throw new Error(res.error || 'Unknown error');
        const cap = (res.text || '').slice(0, 1000), from = ctx.from, o = { quoted: ctx.msg }, url = res.mediaUrl;
        if (c.mediaType === 'image') await ctx.session.queueSend(from, { image: { url }, caption: cap }, o);
        else if (c.mediaType === 'video') await ctx.session.queueSend(from, { video: { url }, mimetype: 'video/mp4', caption: cap }, o);
        else if (c.mediaType === 'audio') { if (cap) await ctx.reply(cap); await ctx.session.queueSend(from, { audio: { url }, mimetype: 'audio/mpeg' }, o); }
        else if (c.mediaType === 'document') await ctx.session.queueSend(from, { document: { url }, mimetype: c.mimetype || 'application/octet-stream', fileName: (c.fileName || name).replace(/[\\/:*?"<>|]/g, ''), caption: cap }, o);
        else await ctx.reply(res.text || '✅');
        st.uses++; ctx.react('✅');
    } catch (e) {
        st.fails++; st.lastError = maskSecrets(e.message || String(e)).slice(0, 300); st.lastAt = Date.now();
        console.log(`Custom command .${name} failed:`, st.lastError);
        ctx.react('❌');
        await ctx.reply(c.errorText || card(name, 'could not finish', ['Sorry, that did not work right now.'], `↳ ${sc('please try again in a moment')}`));
    }
}
function sanitizeDef(b) {
    const clamp = (v, lo, hi, d) => { v = parseInt(v, 10); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
    const S = (v, n) => String(v == null ? '' : v).slice(0, n);
    const type = b.type === 'api' ? 'api' : 'text';
    const d = { type, enabled: b.enabled !== false, desc: S(b.desc, 80).trim(), updatedAt: Date.now(), access: ['all', 'owner', 'group', 'admin'].includes(b.access) ? b.access : 'all' };
    if (type === 'text') { d.reply = S(b.reply, 3000); return d; }
    d.url = S(b.url, 1500).trim(); d.method = b.method === 'POST' ? 'POST' : 'GET';
    d.headers = S(b.headers, 1500); d.body = S(b.body, 3000);
    d.mediaType = ['text', 'image', 'video', 'audio', 'document'].includes(b.mediaType) ? b.mediaType : 'text';
    d.mediaPath = S(b.mediaPath, 200).trim(); d.textTemplate = S(b.textTemplate, 2000); d.successPath = S(b.successPath, 200).trim();
    d.errorText = S(b.errorText, 300); d.usage = S(b.usage, 120); d.needsInput = !!b.needsInput;
    d.cooldown = clamp(b.cooldown, 0, 3600, 0); d.timeout = clamp(b.timeout, 5, 120, 60);
    d.mimetype = S(b.mimetype, 80).trim(); d.fileName = S(b.fileName, 80).trim();
    d.preUrl = S(b.preUrl, 1500).trim(); d.access = ['all', 'owner', 'group', 'admin'].includes(b.access) ? b.access : 'all';
    return d;
}
function validateDef(name, d) {
    if (!name) return 'Give the command a name (letters and numbers only).';
    const existing = commands[name];
    if (existing && !disabledCmds.has(canonicalName(existing))) return `".${name}" is a built-in command. Switch it off in "Built-in commands" first, then save again to replace it.`;
    if (d.type === 'text' && !d.reply.trim()) return 'The reply text is empty.';
    if (d.type === 'api') {
        if (!/^https?:\/\//i.test(d.url)) return 'The API address must start with http:// or https://';
        if (blockedHost(d.url)) return 'That address is not allowed.';
        if (d.preUrl && (!/^https?:\/\//i.test(d.preUrl) || blockedHost(d.preUrl))) return 'The step-1 address is not valid.';
    }
    return null;
}
async function loadStudioData() {
    try {
        const k = await fsGet('studio', 'apiKeys', {});
        apiKeys = {}; for (const [n, v] of Object.entries(k || {})) if (v) { const o = openKey(v); if (o) apiKeys[n] = o; }
        const dis = await fsGet('studio', 'disabledCommands', { list: [] });
        disabledCmds.clear(); (dis.list || []).forEach((x) => disabledCmds.add(x));
        console.log(`🧪 Studio: ${Object.keys(apiKeys).length} API key(s), ${disabledCmds.size} switched-off command(s).`);
    } catch (e) { console.log('Studio load failed:', e.message); }
}
const saveApiKeys = () => fsSet('studio', 'apiKeys', Object.fromEntries(Object.entries(apiKeys).map(([n, v]) => [n, sealKey(v)])));
const saveDisabled = () => fsSet('studio', 'disabledCommands', { list: [...disabledCmds] });

app.get('/studio', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'studio.html')));
app.get('/api/admin/api-keys', requireAdmin, (req, res) => {
    const mask = (v) => v.length > 10 ? v.slice(0, 4) + '••••' + v.slice(-3) : '••••';
    const list = Object.entries(apiKeys).map(([name, v]) => ({ name, masked: mask(v), source: 'panel' }));
    if (!apiKeys.CHAMA && process.env.CHAMA_API_KEY) list.unshift({ name: 'CHAMA', masked: mask(process.env.CHAMA_API_KEY), source: 'server variable' });
    res.json({ keys: list });
});
app.post('/api/admin/api-keys', requireAdmin, async (req, res) => {
    const name = String((req.body || {}).name || '').toUpperCase().replace(/[^A-Z0-9_]/g, '').slice(0, 24);
    const value = String((req.body || {}).value || '').trim().slice(0, 400);
    if (!name || !value) return res.status(400).json({ error: 'Both a name and the key are required.' });
    apiKeys[name] = value; await saveApiKeys();
    res.json({ ok: true, name });
});
app.delete('/api/admin/api-keys/:name', requireAdmin, async (req, res) => {
    delete apiKeys[String(req.params.name).toUpperCase()]; await saveApiKeys(); res.json({ ok: true });
});
app.get('/api/admin/builtin-commands', requireAdmin, (req, res) => {
    const seen = new Set(), list = [];
    for (const [n, def] of Object.entries(commands)) { if (seen.has(def)) continue; seen.add(def); list.push({ name: n, category: def.category, desc: (def.desc || '.' + n).replace(/^\.\S+\s*(—\s*)?/, '') || def.category, disabled: disabledCmds.has(n) }); }
    res.json({ commands: list.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)) });
});
app.post('/api/admin/builtin-commands/:name', requireAdmin, async (req, res) => {
    const name = String(req.params.name).toLowerCase(), def = commands[name];
    if (!def || canonicalName(def) !== name) return res.status(404).json({ error: 'Unknown command.' });
    if (name === 'menu') return res.status(400).json({ error: 'The menu cannot be switched off.' });
    if ((req.body || {}).disabled) disabledCmds.add(name); else disabledCmds.delete(name);
    await saveDisabled(); res.json({ ok: true });
});
app.get('/api/admin/custom-commands', requireAdmin, (req, res) => {
    res.json({ commands: Array.from(customCommands.entries()).map(([name, data]) => ({ name, ...data, stats: cmdStats.get(name) || { uses: 0, fails: 0 } })) });
});
app.post('/api/admin/custom-commands', requireAdmin, async (req, res) => {
    const b = req.body || {};
    const name = String(b.name || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24);
    const d = sanitizeDef(b);
    const err = validateDef(name, d);
    if (err) return res.status(400).json({ error: err });
    d.createdAt = (customCommands.get(name) || {}).createdAt || Date.now();
    customCommands.set(name, d);
    await fsSet('customCommands', name, d);
    res.json({ ok: true, name });
});
app.post('/api/admin/custom-commands/:name/toggle', requireAdmin, async (req, res) => {
    const name = req.params.name.toLowerCase(), c = customCommands.get(name);
    if (!c) return res.status(404).json({ error: 'Not found.' });
    c.enabled = !!(req.body || {}).enabled; await fsSet('customCommands', name, c);
    res.json({ ok: true });
});
app.post('/api/admin/custom-commands/test', requireAdmin, async (req, res) => {
    const b = req.body || {};
    const d = sanitizeDef(Object.assign({}, b.def, { type: 'api' }));
    if (!/^https?:\/\//i.test(d.url)) return res.json({ ok: false, error: 'The API address must start with http:// or https://' });
    const q = String(b.q || '').slice(0, 500);
    const vars = buildVars(q, q.split(/\s+/).filter(Boolean), 'Tester', '94700000000', 'test');
    try {
        const r = await runApiDef(Object.assign({ name: String(b.name || 'test') }, d), vars);
        const rv = typeof r.resp === 'object' && r.resp ? r.resp : {};
        res.json({ pre: r.pre, ok: r.ok, error: r.error, status: r.status, ms: r.ms, raw: r.raw, mediaUrl: r.mediaUrl ? maskSecrets(r.mediaUrl) : null, mediaPath: r.mediaPath, text: maskSecrets(r.text || ''),
            urls: walkLeaves(rv, '', [], true).map((x) => ({ path: x.path, value: maskSecrets(x.value) })), fields: walkLeaves(rv, '', [], false).slice(0, 40).map((x) => ({ path: x.path, value: maskSecrets(x.value) })) });
    } catch (e) { res.json({ pre: e.pre, ok: false, error: maskSecrets(e.code === 'KEY_MISSING' ? e.message : (e.message || String(e))) }); }
});
app.get('/api/admin/studio-export', requireAdmin, (req, res) => {
    res.setHeader('Content-Disposition', 'attachment; filename="nimah-commands.json"');
    res.json({ version: 1, exportedAt: new Date().toISOString(), commands: Object.fromEntries(customCommands), switchedOff: [...disabledCmds] });
});
app.post('/api/admin/studio-import', requireAdmin, async (req, res) => {
    const src = (req.body || {}).commands;
    if (!src || typeof src !== 'object') return res.status(400).json({ error: 'No commands found in that file.' });
    let added = 0; const skipped = [];
    for (const [rawName, def] of Object.entries(src).slice(0, 200)) {
        const name = String(rawName).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24);
        const d = sanitizeDef(def || {}); const err = validateDef(name, d);
        if (err) { skipped.push(name || rawName); continue; }
        d.createdAt = (customCommands.get(name) || {}).createdAt || Date.now();
        customCommands.set(name, d); await fsSet('customCommands', name, d); added++;
    }
    res.json({ ok: true, added, skipped });
});
app.delete('/api/admin/custom-commands/:name', requireAdmin, async (req, res) => {
    const name = req.params.name.toLowerCase();
    customCommands.delete(name); cmdStats.delete(name);
    await fsSet('customCommands', name, { reply: null, deleted: true });
    res.json({ ok: true });
});

// =========================================================================
// BRAND & MESSAGES — everything below is editable from /brand in the admin
// panel: bot name, descriptions, menu / alive / ping messages, the logo and
// the welcome voice. Stored in Firestore (and on the Volume when present).
// =========================================================================
const { spawnSync } = require('child_process');
const BRAND_DEFAULTS = {
    botName: 'NIMAH MD', ownerName: 'Nimah Dev', tagline: 'private agent', description: 'Private AI Agent  ·  online 24/7', footer: '',
    menuIntro: '', aliveTemplate: '', pingTemplate: '', banner: true, voiceOnPing: true, voiceOnAlive: true
};
let BRAND = Object.assign({}, BRAND_DEFAULTS);
function applyBrand() {
    BOT_NAME = (String(BRAND.botName || '').trim() || BRAND_DEFAULTS.botName).slice(0, 30);
    OWNER_NAME = (String(BRAND.ownerName || '').trim() || BRAND_DEFAULTS.ownerName).slice(0, 30);
}
function sanitizeBrand(b) {
    const S = (v, n) => String(v == null ? '' : v).replace(/\r/g, '').slice(0, n);
    return {
        botName: S(b.botName, 30).trim() || BRAND_DEFAULTS.botName, ownerName: S(b.ownerName, 30).trim() || BRAND_DEFAULTS.ownerName,
        tagline: S(b.tagline, 40).trim(), description: S(b.description, 80).trim(), footer: S(b.footer, 160),
        menuIntro: S(b.menuIntro, 1200), aliveTemplate: S(b.aliveTemplate, 1500), pingTemplate: S(b.pingTemplate, 1000),
        banner: b.banner !== false, voiceOnPing: b.voiceOnPing !== false, voiceOnAlive: b.voiceOnAlive !== false
    };
}
function brandVars(extra) {
    const { time, date, hour } = nowParts();
    return Object.assign({
        bot: BOT_NAME, owner: OWNER_NAME, tagline: BRAND.tagline, description: BRAND.description, greeting: greetingSi(hour), time, date,
        uptime: upShort(process.uptime()), memory: Math.round(process.memoryUsage().rss / 1048576) + ' MB', commands: new Set(Object.values(commands)).size,
        version: BOT_VERSION, platform: PLATFORM_NAMES[osMod.platform()] || osMod.platform(), bots: activeBotCount(), status: '🟢 online 24/7',
        user: 'Friend', footer: FOOTER()
    }, extra || {});
}
const renderBrand = (tpl, vars) => renderTpl(tpl, vars, undefined, 'text');
function signalOf(ms) { return ms < 300 ? 'Excellent' : ms < 800 ? 'Steady' : 'Slow'; }
function aliveText(pushName) {
    if (!BRAND.aliveTemplate.trim()) return null;
    return renderBrand(BRAND.aliveTemplate, brandVars({ user: pushName || 'Friend', header: head(BOT_NAME, 'online') }));
}
function pingText(ms) {
    if (!BRAND.pingTemplate.trim()) return null;
    return renderBrand(BRAND.pingTemplate, brandVars({ ping: ms.toFixed(1), signal: signalOf(ms), meter: meter(1 - ms / 1000), header: head('Ping', 'latency') }));
}

// ---- assets (logo + welcome voice) ----
const LOGO_FILE = path.join(ASSET_DIR, 'logo.jpg');
const VOICE_FILE = path.join(ASSET_DIR, 'voice.bin');
const VOICE_META = path.join(ASSET_DIR, 'voice.json');
function ffmpegPath() {
    const ff = tryRequire('ffmpeg-static');
    if (ff && fs.existsSync(ff)) return ff;
    try { return spawnSync('ffmpeg', ['-version']).status === 0 ? 'ffmpeg' : null; } catch (e) { return null; }
}
let _voiceCache;
function currentVoice() {
    if (_voiceCache === undefined) {
        _voiceCache = null;
        try { const meta = JSON.parse(fs.readFileSync(VOICE_META, 'utf8')); _voiceCache = { buf: fs.readFileSync(VOICE_FILE), mime: meta.mime, ptt: !!meta.ptt, custom: true }; } catch (e) { /* use the bundled one */ }
        if (!_voiceCache) {
            const ogg = readAudio('welcome.ogg'), mp3 = readAudio('welcome.mp3');
            if (ogg) _voiceCache = { buf: ogg, mime: 'audio/ogg; codecs=opus', ptt: true };
            else if (mp3) _voiceCache = { buf: mp3, mime: 'audio/mpeg', ptt: false };
        }
    }
    return _voiceCache;
}
async function remoteAssetSave(kind, buf, meta) {
    const blob = buf.toString('base64'), n = Math.ceil(blob.length / BK_CHUNK);
    for (let i = 0; i < n; i++) await fsSet('studio', `asset_${kind}_${i}`, { d: blob.slice(i * BK_CHUNK, (i + 1) * BK_CHUNK) });
    await fsSet('studio', `asset_${kind}_meta`, Object.assign({ n, ts: Date.now(), deleted: false }, meta || {}));
}
const remoteAssetDrop = (kind) => fsSet('studio', `asset_${kind}_meta`, { n: 0, ts: Date.now(), deleted: true });
async function loadAssets() {
    for (const kind of ['logo', 'voice']) {
        try {
            const local = kind === 'logo' ? LOGO_FILE : VOICE_FILE;
            const meta = await withTimeout(fsGet('studio', `asset_${kind}_meta`, null), 10000);
            if (!meta) continue;
            if (meta.deleted) { for (const f of [local, VOICE_META]) if (kind === 'voice' || f === local) try { fs.rmSync(f, { force: true }); } catch (e) {} continue; }
            if (!meta.n || fs.existsSync(local)) continue;
            let blob = '';
            for (let i = 0; i < meta.n; i++) { const c = await withTimeout(fsGet('studio', `asset_${kind}_${i}`, null), 10000); if (!c || !c.d) { blob = null; break; } blob += c.d; }
            if (!blob) continue;
            fs.mkdirSync(ASSET_DIR, { recursive: true });
            fs.writeFileSync(local, Buffer.from(blob, 'base64'));
            if (kind === 'voice') fs.writeFileSync(VOICE_META, JSON.stringify({ mime: meta.mime, ptt: !!meta.ptt }));
            console.log(`🎨 Restored custom ${kind} from the database.`);
        } catch (e) { console.log(`Asset restore (${kind}) skipped:`, e.message); }
    }
    _logoCache = undefined; _voiceCache = undefined;
}
async function saveLogoAsset(buf) {
    const sharp = tryRequire('sharp');
    let out = buf;
    if (sharp) out = await sharp(buf).rotate().resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 84 }).toBuffer();
    else if (!(buf[0] === 0xFF && buf[1] === 0xD8)) throw new Error('Please upload a JPG image.');
    if (out.length > 1.2 * 1024 * 1024) throw new Error('That picture is too big even after shrinking (max about 1.2 MB). Use a smaller one.');
    fs.mkdirSync(ASSET_DIR, { recursive: true }); fs.writeFileSync(LOGO_FILE, out); _logoCache = undefined;
    await remoteAssetSave('logo', out, {});
    return out.length;
}
async function saveVoiceAsset(buf, ext) {
    ext = String(ext || 'mp3').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'mp3';
    fs.mkdirSync(ASSET_DIR, { recursive: true });
    const tin = path.join(ASSET_DIR, 'upload_in.' + ext), tout = path.join(ASSET_DIR, 'upload_out.ogg');
    fs.writeFileSync(tin, buf);
    let out = buf, meta = null, converted = false;
    const ff = ffmpegPath();
    if (ff) {
        const r = spawnSync(ff, ['-y', '-i', tin, '-vn', '-ac', '1', '-ar', '48000', '-c:a', 'libopus', '-b:a', '48k', '-t', '90', tout], { timeout: 60000 });
        if (r.status === 0 && fs.existsSync(tout)) { out = fs.readFileSync(tout); meta = { mime: 'audio/ogg; codecs=opus', ptt: true }; converted = true; }
    }
    if (!meta) {
        const mimes = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg; codecs=opus', opus: 'audio/ogg; codecs=opus' };
        meta = { mime: mimes[ext] || 'audio/mpeg', ptt: ext === 'ogg' || ext === 'opus' };
    }
    for (const f of [tin, tout]) try { fs.rmSync(f, { force: true }); } catch (e) {}
    if (out.length > 2.2 * 1024 * 1024) throw new Error('That audio is too big (max about 2 MB). Use a shorter clip.');
    fs.writeFileSync(VOICE_FILE, out); fs.writeFileSync(VOICE_META, JSON.stringify(meta)); _voiceCache = undefined;
    await remoteAssetSave('voice', out, meta);
    return { size: out.length, converted, ptt: meta.ptt };
}
async function resetAsset(kind) {
    if (kind === 'logo') { try { fs.rmSync(LOGO_FILE, { force: true }); } catch (e) {} _logoCache = undefined; }
    else { for (const f of [VOICE_FILE, VOICE_META]) try { fs.rmSync(f, { force: true }); } catch (e) {} _voiceCache = undefined; }
    await remoteAssetDrop(kind);
}
async function loadBrand() {
    try {
        const d = await withTimeout(fsGet('studio', 'branding', null), 10000);
        if (d) BRAND = Object.assign({}, BRAND_DEFAULTS, sanitizeBrand(d));
        applyBrand();
        await loadAssets();
        console.log(`🎨 Brand loaded: ${BOT_NAME}${currentVoice() && currentVoice().custom ? ' (custom voice)' : ''}${fs.existsSync(LOGO_FILE) ? ' (custom logo)' : ''}`);
    } catch (e) { console.log('Brand load failed:', e.message); }
}

app.get('/brand', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'brand.html')));
app.get('/api/admin/branding', requireAdmin, (req, res) => {
    const v = currentVoice();
    res.json({ brand: BRAND, defaults: BRAND_DEFAULTS, assets: {
        logo: { custom: fs.existsSync(LOGO_FILE) }, voice: { custom: !!(v && v.custom), ptt: !!(v && v.ptt), size: v ? v.buf.length : 0 }, ffmpeg: !!ffmpegPath(), sharp: !!tryRequire('sharp') } });
});
app.post('/api/admin/branding', requireAdmin, async (req, res) => {
    BRAND = Object.assign({}, BRAND_DEFAULTS, sanitizeBrand(req.body || {}));
    applyBrand();
    await fsSet('studio', 'branding', BRAND);
    res.json({ ok: true, brand: BRAND });
});
app.post('/api/admin/branding/preview', requireAdmin, (req, res) => {
    const saved = BRAND, savedName = BOT_NAME, savedOwner = OWNER_NAME;
    try {
        BRAND = Object.assign({}, BRAND_DEFAULTS, sanitizeBrand((req.body || {}).brand || {})); applyBrand();
        const kind = (req.body || {}).kind;
        let text;
        if (kind === 'menu') text = mainMenuCaption('Sam');
        else if (kind === 'alive') text = aliveText('Sam') || card(BOT_NAME, 'online', [`${greetingSi(nowParts().hour)}, *Sam*\n`, kv('uptime', upShort(process.uptime())), kv('commands', new Set(Object.values(commands)).size)], `↳ ${sc('type')} *.menu* ${sc('to open the index')}`);
        else text = pingText(42.7) || card('Ping', 'latency', [kv('round trip', '42.7 ms'), kv('signal', 'Excellent'), `\n${meter(0.96)}`]);
        res.json({ text });
    } catch (e) { res.status(400).json({ error: e.message }); }
    finally { BRAND = saved; BOT_NAME = savedName; OWNER_NAME = savedOwner; }
});
function decodeUpload(req, maxBytes) {
    const b = req.body || {};
    const raw = String(b.data || '').replace(/^data:[^,]*,/, '');
    const buf = Buffer.from(raw, 'base64');
    if (!buf.length) throw new Error('No file received.');
    if (buf.length > maxBytes) throw new Error('That file is too large.');
    return { buf, name: String(b.name || '') };
}
app.post('/api/admin/assets/logo', requireAdmin, async (req, res) => {
    try { const { buf } = decodeUpload(req, 8 * 1024 * 1024); const size = await saveLogoAsset(buf); res.json({ ok: true, size }); }
    catch (e) { res.status(400).json({ error: e.message || 'Could not use that image.' }); }
});
app.post('/api/admin/assets/voice', requireAdmin, async (req, res) => {
    try { const { buf, name } = decodeUpload(req, 5 * 1024 * 1024); const r = await saveVoiceAsset(buf, (name.split('.').pop() || 'mp3')); res.json(Object.assign({ ok: true }, r)); }
    catch (e) { res.status(400).json({ error: e.message || 'Could not use that audio.' }); }
});
app.delete('/api/admin/assets/:kind', requireAdmin, async (req, res) => {
    if (!['logo', 'voice'].includes(req.params.kind)) return res.status(404).json({ error: 'Unknown asset.' });
    await resetAsset(req.params.kind); res.json({ ok: true });
});
app.get('/api/admin/assets/voice-file', requireAdmin, (req, res) => {
    const v = currentVoice(); if (!v) return res.status(404).end();
    res.type(v.mime.split(';')[0]).send(v.buf);
});

// ---- Multi-bot capacity ----
// Every paired number is its own independent bot. MAX_BOTS caps how many
// sessions (paired + waiting to pair) this server will hold; memory is also
// checked so a full server refuses politely instead of crashing every bot.
function memLimitMb() {
    if (process.env.MEM_LIMIT_MB) return parseInt(process.env.MEM_LIMIT_MB, 10);
    for (const f of ['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes']) {
        try { const v = parseInt(fs.readFileSync(f, 'utf8'), 10); if (v > 0 && v < 1e15) return Math.round(v / 1048576); } catch (e) {}
    }
    return Math.round(osMod.totalmem() / 1048576);
}
// ~45 MB per bot + ~120 MB for the server itself: 512 MB (Railway Free) -> 8 bots, 8 GB -> 60.
const MAX_BOTS = parseInt(process.env.MAX_BOTS || String(Math.min(60, Math.max(3, Math.floor((memLimitMb() - 120) / 45)))), 10);
const isPaired = (s) => !!(s.sock && s.sock.authState && s.sock.authState.creds && s.sock.authState.creds.registered);
function serverFull() {
    const rssMb = process.memoryUsage().rss / 1048576;
    return sessions.size >= MAX_BOTS || rssMb > memLimitMb() * 0.85;
}
function destroySession(id) {
    const s = sessions.get(id);
    if (!s) return;
    clearTimeout(s.reconnectTimer);
    try { s.sock.ev.removeAllListeners(); s.sock.end(undefined); } catch (e) {}
    sessions.delete(id);
    fs.rm(s.sessionDir, { recursive: true, force: true }, () => {});
}
// Reaper: pairing pages that were opened but never completed (visitor left)
// would otherwise keep a live socket forever. Anything unpaired for 20 min goes.
setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions.entries()) {
        if (s.isConnected || isPaired(s)) continue;
        if (now - (s.createdAt || now) > 20 * 60 * 1000) { console.log(`🧹 [${id}] Removing abandoned pairing session.`); destroySession(id); }
    }
}, 2 * 60 * 1000);
// Simple per-IP limiter for creating new pairing sessions.
const newSessionHits = new Map();
function newSessionAllowed(ip) {
    const now = Date.now(); const arr = (newSessionHits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
    if (arr.length >= 8) { newSessionHits.set(ip, arr); return false; }
    arr.push(now); newSessionHits.set(ip, arr); return true;
}
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
        await session.queueSend(jid, { text: `${head('Daily digest', 'last 24h')}\n${summary}\n\n_${sc('auto-written by nimah ai')}_` });
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
    if (!newSessionAllowed(req.ip)) return res.status(429).json({ error: 'Too many attempts. Please wait a few minutes.' });
    if (serverFull()) return res.status(503).json({ error: 'This server is full right now. Please try again later.' });
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
    res.json({ active: activeBotCount(), total: sessions.size, max: MAX_BOTS });
});

app.get('/ping', (req, res) => res.type('text/plain').send('pong'));
app.get('/health', (req, res) => {
    const s = getSession(req.query.session);
    if (!s) return res.json({ status: 'ok', connected: false, exists: false, active: activeBotCount(), total: sessions.size, uptime: Math.round(process.uptime()) });
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
        memoryMb: (process.memoryUsage().rss / 1024 / 1024).toFixed(1),
        memoryLimitMb: memLimitMb(), maxBots: MAX_BOTS,
        categories: Object.fromEntries(Object.entries(menuCategories().grouped).map(([k, v]) => [k, v.length]))
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
// (Custom command, API key and built-in switch endpoints live in the Command Studio block below.)

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
// NIMAH DESIGN SYSTEM
// An original, glyph-based text UI for WhatsApp: ruled headers, numbered
// indexes, key/value cards and a reply-with-a-number menu that can open
// categories, page through them and run commands straight from the list.
// =========================================================================
const SMALL_CAPS = { a:'ᴀ',b:'ʙ',c:'ᴄ',d:'ᴅ',e:'ᴇ',f:'ꜰ',g:'ɢ',h:'ʜ',i:'ɪ',j:'ᴊ',k:'ᴋ',l:'ʟ',m:'ᴍ',n:'ɴ',o:'ᴏ',p:'ᴘ',q:'ǫ',r:'ʀ',s:'ꜱ',t:'ᴛ',u:'ᴜ',v:'ᴠ',w:'ᴡ',x:'x',y:'ʏ',z:'ᴢ' };
const sc = (t) => String(t).replace(/[a-z]/gi, (c) => SMALL_CAPS[c.toLowerCase()] || c);
const B = (t) => toFont(t, 'boldSans');

// Sri Lanka time (UTC+5:30), independent of the server's timezone.
const BOT_TZ = process.env.BOT_TIMEZONE || 'Asia/Colombo';
function nowParts() {
    const d = new Date();
    const time = d.toLocaleTimeString('en-US', { timeZone: BOT_TZ, hour12: true });
    const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: BOT_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
    const g = (t) => ymd.find((x) => x.type === t).value;
    const hour = parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: BOT_TZ, hour: '2-digit', hour12: false }).format(d), 10) % 24;
    return { time, date: `${g('year')}/${g('month')}/${g('day')}`, hour };
}
function greetingSi(hour) {
    if (hour >= 5 && hour < 12) return 'සුබ උදෑසනක්';
    if (hour >= 12 && hour < 16) return 'සුබ දහවලක්';
    if (hour >= 16 && hour < 19) return 'සුබ සන්ධ්‍යාවක්';
    return 'සුබ රාත්‍රියක්';
}
const PLATFORM_NAMES = { linux: 'Linux', win32: 'Windows', darwin: 'macOS', android: 'Android' };
const BOT_VERSION = require('./package.json').version;

// ---- Building blocks ----
const RULE = '━━━━━━━━━━━━━━━━━━━━';
const THIN = '┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈';
const FOOTER = () => (BRAND.footer && BRAND.footer.trim())
    ? `_${renderTpl(BRAND.footer, { bot: BOT_NAME, owner: OWNER_NAME, version: BOT_VERSION }, undefined, 'text')}_`
    : `_${sc(BOT_NAME)}  ·  ${sc('by ' + OWNER_NAME)}  ·  ᴠ${BOT_VERSION}_`;
const head = (title, sub) => `▍${B(String(title).toUpperCase())}${sub ? `  ·  ${sc(sub)}` : ''}\n${RULE}`;
const kv = (label, value) => `◈ ${sc(label)}  ❯  *${value}*`;
const num2 = (n) => String(n).padStart(2, '0');
const tag = (n) => `❬${num2(n)}❭`;
const meter = (ratio, len = 10) => { const f = Math.max(0, Math.min(len, Math.round(ratio * len))); return '▰'.repeat(f) + '▱'.repeat(len - f); };
const onOff = (v) => (v ? '▰▰▰ ᴏɴ' : '▱▱▱ ᴏꜰꜰ');
function upShort(sec) {
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
    return (d ? d + 'd ' : '') + (h || d ? h + 'h ' : '') + m + 'm ' + s + 's';
}
function card(title, sub, rows, note) {
    return `${head(title, sub)}\n${rows.join('\n')}${note ? `\n\n${note}` : ''}\n\n${FOOTER()}`;
}

// ---- Auto-styling of plain replies ----
// Every command reply passes through decorate(): a leading emoji marker is
// swapped for the Nimah bar-header, status prefixes (error / done / notice)
// get a labelled tag, and emoji bullets inside the body become ◈ glyphs.
// Raw utility output (code blocks, converters) is passed through untouched.
const STATUS_MAP = [
    [/^(?:\u274C|\u{1F6AB}|\u26D4)/u, 'error', '✕'],
    [/^(?:\u2705|\u2714\uFE0F?)/u, 'done', '✓'],
    [/^(?:\u26A0\uFE0F?|\u23F3)/u, 'notice', '!'],
    [/^\u2139\uFE0F?/u, 'info', 'i']
];
const EMOJI_LEAD = /^(?:\p{Extended_Pictographic}\uFE0F?(?:\u200D\p{Extended_Pictographic}\uFE0F?)*)\s*/u;
const tidyLines = (s) => s.split('\n').map((l) => l.replace(/^(\s*(?:┃\s*)?)\p{Extended_Pictographic}\uFE0F?\s*/u, '$1◈ ')).join('\n');
function decorate(text) {
    if (typeof text !== 'string' || !text.trim() || text.startsWith('```')) return text;
    const t = text.trim();
    for (const [re, label, glyph] of STATUS_MAP) {
        const m = t.match(re);
        if (m) return `▍${glyph}  ${B(label.toUpperCase())}\n${tidyLines(t.slice(m[0].length).trim())}`;
    }
    const lead = t.match(EMOJI_LEAD);
    if (!lead) return text;
    const rest = t.slice(lead[0].length);
    if (!rest.trim()) return text;
    const nl = rest.indexOf('\n');
    const first = (nl === -1 ? rest : rest.slice(0, nl)).trim();
    const tail = nl === -1 ? '' : rest.slice(nl + 1).replace(/^\n+/, '');
    const hm = first.match(/^\*([^*]{1,45}?)\s*:?\*\s*:?$/);
    if (hm) return `▍${B(hm[1].toUpperCase())}\n${RULE}${tail ? '\n' + tidyLines(tail) : ''}`;
    return `▍ ${first}${tail ? '\n' + tidyLines(tail) : ''}`;
}
function buildOut(text, extra) {
    const out = { text: decorate(text) };
    const ids = [...String(text).matchAll(/@(\d{7,15})/g)].map((m) => `${m[1]}@s.whatsapp.net`);
    if (ids.length) out.mentions = [...new Set(ids)];
    return Object.assign(out, extra || {});
}
async function sendCard(session, from, msg, text, withLogo) {
    const logo = withLogo && BRAND.banner !== false ? getBotLogo() : null;
    return session.queueSend(from, logo ? { image: logo, caption: text } : { text }, { quoted: msg });
}

// ---- Menu data ----
const CAT_ORDER = ['System', 'Search', 'Media', 'Tools', 'Text', 'Fun', 'Economy', 'Custom', 'Group', 'Owner'];
const CAT_TAGLINE = {
    System: 'status · speed · info', Search: 'look things up', Media: 'fetch files by link',
    Tools: 'converters · maths · utilities', Text: 'ciphers · formatting', Fun: 'games · facts · banter', Economy: 'coins · bank · casino · shop', Custom: 'added from the admin panel',
    Group: 'admin · moderation', Owner: 'private controls'
};
const CAT_ICON = { System: '🛰', Search: '🔎', Media: '🎞', Tools: '🧰', Text: '🔤', Fun: '🎲', Economy: '💰', Custom: '🧩', Group: '👥', Owner: '👑' };
const PAGE_SIZE = 25;
function menuCategories() {
    const grouped = {};
    const seen = new Set();
    for (const [name, def] of Object.entries(commands)) {
        if (seen.has(def)) continue;
        seen.add(def);
        if (disabledCmds.has(name)) continue; // switched off (a custom command may replace it)
        (grouped[def.category] = grouped[def.category] || []).push({ name, def });
    }
    for (const [name, c] of customCommands) { // commands made in the admin panel
        if (c.enabled === false || (commands[name] && !disabledCmds.has(name))) continue;
        (grouped.Custom = grouped.Custom || []).push({ name, def: { category: 'Custom', desc: `.${name}${c.type === 'api' && c.needsInput ? ' [input]' : ''} — ${c.desc || 'custom command'}` } });
        seen.add(c);
    }
    const cats = Object.keys(grouped).sort((a, b) => {
        const ia = CAT_ORDER.indexOf(a), ib = CAT_ORDER.indexOf(b);
        if (ia === -1 && ib === -1) return a.localeCompare(b);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
    return { grouped, cats, total: seen.size };
}
function usageOf(def, name) {
    const d = def.desc || '.' + name;
    const i = d.indexOf(' — ');
    return { usage: i > -1 ? d.slice(0, i) : d, info: i > -1 ? d.slice(i + 3) : '' };
}
const needsInput = (usage) => /[\[(]/.test(usage);

function mainMenuCaption(pushName) {
    const { grouped, cats, total } = menuCategories();
    const { time, date, hour } = nowParts();
    const lines = cats.map((c, i) => `${tag(i + 1)}  ${CAT_ICON[c] || '✦'} ${B(c)}  ⋯  ${grouped[c].length}`);
    lines.push(`${tag(cats.length + 1)}  📜 ${B('All commands')}  ⋯  ${total}`);
    const intro = BRAND.menuIntro.trim()
        ? renderBrand(BRAND.menuIntro, brandVars({ user: pushName || 'Friend', commands: total, header: head(BOT_NAME, BRAND.tagline) })) + '\n\n'
        : `${greetingSi(hour)},\n*${pushName || 'Friend'}*\n\n` +
          `${kv('time', time)}\n${kv('date', date)}\n${kv('uptime', upShort(process.uptime()))}\n${kv('memory', Math.round(process.memoryUsage().rss / 1048576) + ' MB')}\n${kv('status', '🟢 online 24/7')}\n${kv('commands', total)}\n\n`;
    return `${head(BOT_NAME, BRAND.tagline)}\n` + intro +
        `${B('INDEX')}  ${THIN}\n${lines.join('\n')}\n\n` +
        `↳ ${sc('reply with a number')}\n\n${FOOTER()}`;
}
function categoryText(cat, page) {
    const list = menuCategories().grouped[cat] || [];
    const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    const p = Math.max(0, Math.min(page, pages - 1));
    const slice = list.slice(p * PAGE_SIZE, p * PAGE_SIZE + PAGE_SIZE);
    const body = slice.map((c, i) => `${tag(p * PAGE_SIZE + i + 1)}  ${usageOf(c.def, c.name).usage}`).join('\n');
    const nav = [`↳ ${sc('reply a number to open or run it')}`];
    if (pages > 1) nav.push(`↳ ${sc('n')} ${sc('next')}  ·  ${sc('p')} ${sc('previous')}   ( ${p + 1} / ${pages} )`);
    nav.push(`↳ ${sc('0')} ${sc('back to index')}`);
    return { p, text: `${head(cat, CAT_TAGLINE[cat] || '')}\n${kv('total', list.length)}\n${THIN}\n${body}\n\n${nav.join('\n')}\n\n${FOOTER()}` };
}
function allMenuText() {
    const { grouped, cats, total } = menuCategories();
    let out = `${head('All commands', total + ' total')}\n`;
    for (const c of cats) {
        out += `\n${B(c)}  ${THIN}\n` + grouped[c].map((x) => '.' + x.name).join('  ') + '\n';
    }
    return `${out}\n↳ ${sc('0')} ${sc('back to index')}\n\n${FOOTER()}`;
}
function commandCard(name, def) {
    const { usage, info } = usageOf(def, name);
    const aliases = Object.keys(commands).filter((n) => commands[n] === def && n !== name).map((n) => '.' + n);
    const access = (def.ownerOnly ? 'Owner only' : def.adminOnly ? 'Group admins' : 'Everyone') + (def.groupOnly ? ' · groups' : '');
    const rows = [kv('usage', usage), kv('section', def.category), kv('access', access)];
    if (aliases.length) rows.push(kv('also', aliases.join(' ')));
    if (info) rows.push(kv('about', info));
    return `${head('.' + name, 'command')}\n${rows.join('\n')}\n\n↳ ${sc('send it with your input, e.g.')} ${usage}\n↳ ${sc('0')} ${sc('back to index')}\n\n${FOOTER()}`;
}

// sent-message-id -> { kind: 'main' | 'cat' | 'all' | 'card', cat, page }
const menuReplyMap = new Map();
function rememberMenu(from, sent, entry) {
    const id = sent && sent.key && sent.key.id;
    if (!id) return;
    menuReplyMap.set(`${from}:${id}`, Object.assign({ at: Date.now() }, entry));
    if (menuReplyMap.size > 600) {
        for (const [k, v] of menuReplyMap) if (Date.now() - v.at > 60 * 60 * 1000) menuReplyMap.delete(k);
    }
}
async function sendMainMenu(session, from, msg) {
    const sent = await sendCard(session, from, msg, mainMenuCaption(msg.pushName), true);
    rememberMenu(from, sent, { kind: 'main' });
}
async function sendCategory(session, from, msg, cat, page) {
    const { p, text } = categoryText(cat, page);
    const sent = await session.queueSend(from, { text }, { quoted: msg });
    rememberMenu(from, sent, { kind: 'cat', cat, page: p });
}
// Plain-number replies to a menu message. Returns true when it handled one.
async function handleMenuNumberReply({ session, msg, from, body, sender, isGroup }) {
    const t = body.trim().toLowerCase();
    if (!/^(\d{1,3}|n|p|next|prev|back)$/.test(t)) return false;
    const ci = msg.message && msg.message.extendedTextMessage && msg.message.extendedTextMessage.contextInfo;
    const quotedId = ci && ci.stanzaId;
    if (!quotedId) return false;
    const entry = menuReplyMap.get(`${from}:${quotedId}`);
    if (!entry) return false;
    const { grouped, cats } = menuCategories();
    const send = (text) => session.queueSend(from, { text }, { quoted: msg });

    if (t === '0' || t === 'back') { await sendMainMenu(session, from, msg); return true; }

    if (entry.kind === 'main') {
        const n = parseInt(t, 10);
        if (n >= 1 && n <= cats.length) { await sendCategory(session, from, msg, cats[n - 1], 0); return true; }
        if (n === cats.length + 1) { const sent = await send(allMenuText()); rememberMenu(from, sent, { kind: 'all' }); return true; }
        await send(decorate(`❌ Pick a number from 1 to ${cats.length + 1}, or 0 for the index.`));
        return true;
    }
    if (entry.kind === 'cat') {
        const list = grouped[entry.cat] || [];
        if (t === 'n' || t === 'next') { await sendCategory(session, from, msg, entry.cat, entry.page + 1); return true; }
        if (t === 'p' || t === 'prev') { await sendCategory(session, from, msg, entry.cat, entry.page - 1); return true; }
        const n = parseInt(t, 10);
        if (!(n >= 1 && n <= list.length)) { await send(decorate(`❌ This list runs from 1 to ${list.length}.`)); return true; }
        const item = list[n - 1];
        const { usage } = usageOf(item.def, item.name);
        if (needsInput(usage)) {
            const sent = await send(commandCard(item.name, item.def));
            rememberMenu(from, sent, { kind: 'card', cat: entry.cat, page: entry.page });
        } else {
            await session.dispatch({ command: item.name, args: [], q: '', msg, from, sender, isGroup, body: '.' + item.name });
        }
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
    const grade = ms < 300 ? 'Excellent' : ms < 800 ? 'Steady' : 'Slow';
    await sendCard(session, from, msg, pingText(ms) || card('Ping', 'latency', [
        kv('round trip', ms.toFixed(1) + ' ms'),
        kv('signal', grade),
        `\n${meter(1 - ms / 1000)}`
    ]), true);
    await sendWelcomeAudio(session, from, msg, 'ping');
}});
reg('alive', { category: 'System', desc: '.alive', run: async ({ from, msg, session }) => {
    const { time, date, hour } = nowParts();
    const name = msg.pushName || 'Friend';
    await sendCard(session, from, msg, aliveText(name) || card(BOT_NAME, 'online', [
        `${greetingSi(hour)}, *${name}*\n`,
        kv('time', time), kv('date', date),
        kv('uptime', upShort(process.uptime())),
        kv('memory', Math.round(process.memoryUsage().rss / 1048576) + ' MB'),
        kv('commands', new Set(Object.values(commands)).size),
        kv('platform', PLATFORM_NAMES[osMod.platform()] || osMod.platform())
    ], `↳ ${sc('type')} *.menu* ${sc('to open the index')}`), true);
    await sendWelcomeAudio(session, from, msg, 'alive');
}});
reg('runtime', { category: 'System', desc: '.runtime', aliases: ['uptime'], run: async ({ reply, session }) => {
    await reply(card('Runtime', 'uptime', [kv('this process', upShort(process.uptime())), kv('this session', upShort((Date.now() - (session.createdAt || startTime)) / 1000))]));
}});
reg('owner', { category: 'System', desc: '.owner', run: async ({ reply }) => {
    await reply(card('Owner', 'contact', [kv('name', OWNER_NAME), kv('chat', 'wa.me/' + OWNER_NUMBER)]));
}});
reg('autostatus', { category: 'Owner', desc: '.autostatus [view/react/emoji] [on/off/emoji]', ownerOnly: true, run: async ({ reply, args, session }) => {
    const mode = (args[0] || '').toLowerCase();
    const val = (args[1] || '').toLowerCase();
    const save = () => saveBotCfg(session);
    if (!mode) {
        return reply(card('Auto status', 'settings', [
            kv('view', onOff(session.autoStatus.view)), kv('react', onOff(session.autoStatus.react)), kv('emoji', session.autoStatus.emoji)
        ], `↳ .autostatus view on|off\n↳ .autostatus react on|off\n↳ .autostatus emoji 🔥`));
    }
    if (mode === 'view' || mode === 'react') {
        if (val !== 'on' && val !== 'off') return reply('❌ Use on or off.');
        session.autoStatus[mode] = val === 'on'; save();
        return reply(`✅ Status ${mode} is now ${val.toUpperCase()}.`);
    }
    if (mode === 'emoji') {
        if (!args[1]) return reply('❌ Give an emoji, e.g. .autostatus emoji 🔥');
        session.autoStatus.emoji = args[1]; save();
        return reply(`✅ Status reaction set to ${session.autoStatus.emoji}`);
    }
    await reply('❌ Unknown option. Use view, react or emoji.');
}});
reg('support', { category: 'System', desc: '.support', aliases: ['report', 'feedback'], run: async ({ reply }) => {
    await reply(card('Support', 'help', [kv('contact', 'wa.me/' + OWNER_NUMBER)], `↳ ${sc('send a short note with a screenshot of the problem')}`));
}});
reg('script', { category: 'System', desc: '.script', run: async ({ reply }) => {
    await reply(card('Source', 'project', [kv('bot', BOT_NAME), kv('engine', 'Baileys multi-device'), kv('author', OWNER_NAME)], `↳ ${sc('private build — ask the owner for access')}`));
}});
reg('donate', { category: 'System', desc: '.donate', run: async ({ reply }) => {
    await reply(card('Support the build', 'donate', [`If ${BOT_NAME} helps you, a message to the developer keeps it growing.`, kv('developer', OWNER_NAME)]));
}});
reg('credits', { category: 'System', desc: '.credits', run: async ({ reply }) => {
    await reply(card('Credits', 'thanks', [kv('built by', OWNER_NAME), kv('library', '@whiskeysockets/baileys'), kv('ai', 'OpenRouter')]));
}});
reg('about', { category: 'System', desc: '.about', aliases: ['botinfo'], run: async ({ reply }) => {
    await reply(card(BOT_NAME, 'about', [
        `A private multi-device WhatsApp agent with ${new Set(Object.values(commands)).size}+ commands, group tools and a built-in AI companion.`,
        '', kv('version', BOT_VERSION), kv('by', OWNER_NAME)
    ]));
}});
reg('id', { category: 'System', desc: '.id', run: async ({ reply, from }) => { await reply(card('Chat id', 'identity', [kv('jid', from)])); }});
reg('mention', { category: 'System', desc: '.mention', run: async ({ reply, sender }) => { await reply(card('Your id', 'identity', [kv('jid', sender)])); }});
reg('menu', { category: 'System', desc: '.menu', aliases: ['help', 'list'], run: async ({ from, msg, session }) => {
    await sendMainMenu(session, from, msg);
}});
reg('allmenu', { category: 'System', desc: '.allmenu', run: async ({ from, msg, session }) => {
    const sent = await session.queueSend(from, { text: allMenuText() }, { quoted: msg });
    rememberMenu(from, sent, { kind: 'all' });
}});

reg('sysinfo', { category: 'System', desc: '.sysinfo', aliases: ['server'], run: async ({ from, msg, session }) => {
    const mu = process.memoryUsage();
    const totalMem = osMod.totalmem(), freeMem = osMod.freemem();
    await sendCard(session, from, msg, card('Server', 'live status', [
        kv('status', '🟢 online'), kv('uptime', upShort(process.uptime())),
        kv('bot memory', Math.round(mu.rss / 1048576) + ' MB'),
        kv('host ram', Math.round((totalMem - freeMem) / 1048576) + ' / ' + Math.round(totalMem / 1048576) + ' MB'),
        kv('cpu cores', osMod.cpus().length), kv('node', process.version),
        kv('bots linked', activeBotCount() + ' / ' + sessions.size),
        `\n${meter((totalMem - freeMem) / totalMem)}`
    ]), true);
}});
reg('currency', { category: 'Tools', desc: '.currency [amount] [from] [to] — e.g. .currency 100 usd lkr', aliases: ['cur', 'convert'], run: async ({ reply, args }) => {
    const amount = parseFloat(args[0]); const from = (args[1] || '').toUpperCase(), to = (args[2] || '').toUpperCase();
    if (!(amount >= 0) || !from || !to) return reply('❌ Usage: .currency 100 usd lkr');
    try {
        const r = await axios.get('https://open.er-api.com/v6/latest/' + encodeURIComponent(from), { timeout: 15000 });
        const rate = r.data && r.data.rates && r.data.rates[to];
        if (!rate) return reply('❌ Unknown currency code.');
        await reply(card('Currency', 'live rate', [kv(from, amount.toLocaleString()), kv(to, (amount * rate).toLocaleString(undefined, { maximumFractionDigits: 2 })), kv('rate', '1 ' + from + ' = ' + rate.toFixed(4) + ' ' + to)]));
    } catch (e) { await reply('❌ Could not fetch exchange rates right now.'); }
}});
function quotedMediaMsg(msg, from, type) {
    if (msg.message && msg.message[type]) return msg;
    const ci = msg.message && msg.message.extendedTextMessage && msg.message.extendedTextMessage.contextInfo;
    if (ci && ci.quotedMessage && ci.quotedMessage[type]) {
        return { key: { remoteJid: from, id: ci.stanzaId, participant: ci.participant }, message: ci.quotedMessage };
    }
    return null;
}
function tryRequire(name) { try { return require(name); } catch (e) { return null; } }
reg('sticker', { category: 'Media', desc: '.sticker — reply to an image', aliases: ['stiker'], run: async ({ sock, from, msg, reply }) => {
    const sharp = tryRequire('sharp');
    if (!sharp) return reply('❌ Sticker engine (sharp) is not installed on this server.');
    const m = quotedMediaMsg(msg, from, 'imageMessage');
    if (!m) return reply('❌ Reply to an image with .sticker');
    const buf = await downloadMediaMessage(m, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage });
    const webp = await sharp(buf).resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 80 }).toBuffer();
    await sock.sendMessage(from, { sticker: webp }, { quoted: msg });
}});
reg('toimg', { category: 'Media', desc: '.toimg — reply to a sticker', aliases: ['stickertoimg'], run: async ({ sock, from, msg, reply }) => {
    const sharp = tryRequire('sharp');
    if (!sharp) return reply('❌ Image engine (sharp) is not installed on this server.');
    const m = quotedMediaMsg(msg, from, 'stickerMessage');
    if (!m) return reply('❌ Reply to a sticker with .toimg');
    const buf = await downloadMediaMessage(m, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage });
    const png = await sharp(buf).png().toBuffer();
    await sock.sendMessage(from, { image: png, caption: `_${sc('converted by')} ${sc(BOT_NAME)}_` }, { quoted: msg });
}});
reg('tiktok', { category: 'Media', desc: '.tiktok [video link]', aliases: ['tt'], run: async ({ sock, from, msg, reply, q }) => {
    if (!/^https?:\/\/\S*tiktok\.com\S*/i.test(q)) return reply('❌ Send a TikTok link. Example: .tiktok https://vm.tiktok.com/xxxx');
    try {
        const r = await axios.post('https://www.tikwm.com/api/', new URLSearchParams({ url: q }).toString(), { timeout: 30000, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        const d = r.data && r.data.data;
        const url = d && (d.hdplay || d.play);
        if (!url) return reply('❌ Could not read that video. It may be private or removed.');
        await sock.sendMessage(from, { video: { url }, caption: `${(d.title || '').slice(0, 200)}\n\n_${sc('delivered by')} ${sc(BOT_NAME)}_` }, { quoted: msg });
    } catch (e) { await reply('❌ TikTok download failed. Try again in a moment.'); }
}});

reg('sound', { category: 'Owner', desc: '.sound [on/off] — welcome voice on .ping and .alive', ownerOnly: true, run: async ({ reply, args, session }) => {
    const v = (args[0] || '').toLowerCase();
    if (v === 'on' || v === 'off') { session.soundOn = v === 'on'; saveBotCfg(session); }
    await reply(card('Sound', 'welcome voice', [kv('ping + alive', onOff(session.soundOn))], `↳ .sound on|off`));
}});
reg('anticall', { category: 'Owner', desc: '.anticall [on/off] — auto-reject calls', ownerOnly: true, run: async ({ reply, args, session }) => {
    const v = (args[0] || '').toLowerCase();
    if (v === 'on' || v === 'off') { session.anticall = v === 'on'; saveBotCfg(session); }
    await reply(card('Anti call', 'protection', [kv('reject calls', onOff(session.anticall))], `↳ .anticall on|off`));
}});
reg('profile', { category: 'Tools', desc: '.profile — your profile card (reply/@mention for others)', aliases: ['me', 'whois'], run: async ({ sock, from, msg, sender, session }) => {
    const ci = msg.message && msg.message.extendedTextMessage && msg.message.extendedTextMessage.contextInfo;
    const target = (ci && ((ci.mentionedJid || [])[0] || ci.participant)) || sender;
    let pp = null, about = '—';
    try { pp = await sock.profilePictureUrl(target, 'image'); } catch (e) {}
    try { const st = await sock.fetchStatus(target); about = (st && (st.status || (st[0] && st[0].status && st[0].status.status))) || '—'; } catch (e) {}
    const text = card('Profile', 'whatsapp', [
        kv('number', '+' + target.split('@')[0]),
        kv('name', target === sender ? (msg.pushName || '—') : '—'),
        kv('about', String(about).slice(0, 80)),
        kv('role', isOwner(target, session) ? 'Owner 👑' : 'Member')
    ]);
    await session.queueSend(from, pp ? { image: { url: pp }, caption: text, mentions: [target] } : { text, mentions: [target] }, { quoted: msg });
}});
// =========================================================================
// ANTI-DELETE + VIEW-ONCE SAVER
// .antidelete  -> from then on, every message someone deletes (for everyone)
//                 is sent back to the owner automatically. No command needed
//                 each time. .vv (reply to a view-once) saves it to the owner.
// =========================================================================
const adCache = new Map();          // `${sessionId}:${msgId}` -> entry
let adMediaBytes = 0;
const AD_MAX_ENTRIES = 600;
const AD_MAX_MEDIA_EACH = 6 * 1024 * 1024;   // 6 MB per file
const AD_MAX_MEDIA_TOTAL = 80 * 1024 * 1024; // 80 MB overall
const MEDIA_TYPES = ['imageMessage', 'videoMessage', 'audioMessage', 'stickerMessage', 'documentMessage'];
const ownerJidOf = (sess) => ((sess && sess.ownerNumber) || OWNER_NUMBER) + '@s.whatsapp.net';

function unwrapMessage(message) {
    let m = message;
    for (let i = 0; i < 5 && m; i++) {
        const inner = (m.ephemeralMessage && m.ephemeralMessage.message) || (m.viewOnceMessage && m.viewOnceMessage.message)
            || (m.viewOnceMessageV2 && m.viewOnceMessageV2.message) || (m.viewOnceMessageV2Extension && m.viewOnceMessageV2Extension.message)
            || (m.documentWithCaptionMessage && m.documentWithCaptionMessage.message) || (m.editedMessage && m.editedMessage.message);
        if (!inner) break;
        m = inner;
    }
    return m || {};
}
function describeMessage(message) {
    const m = unwrapMessage(message);
    const mediaType = MEDIA_TYPES.find((t) => m[t]);
    const text = m.conversation || (m.extendedTextMessage && m.extendedTextMessage.text)
        || (mediaType && m[mediaType].caption) || '';
    const labels = { imageMessage: 'photo', videoMessage: 'video', audioMessage: 'voice / audio', stickerMessage: 'sticker', documentMessage: 'document' };
    return { inner: m, mediaType, text, label: mediaType ? labels[mediaType] : (text ? 'text' : 'message') };
}
function adEvict() {
    for (const [k, e] of adCache) {
        if (adCache.size <= AD_MAX_ENTRIES && adMediaBytes <= AD_MAX_MEDIA_TOTAL) break;
        if (e.media) adMediaBytes -= e.media.length;
        adCache.delete(k);
    }
}
async function antiDeleteHook(s, sock, msg) {
    if (!msg || !msg.message || !s.antidelete) return;
    const jid = msg.key && msg.key.remoteJid;
    if (!jid || jid === 'status@broadcast') return;
    const pm = msg.message.protocolMessage;
    // ---- someone deleted a message ----
    if (pm && (pm.type === 0 || pm.type === 'REVOKE') && pm.key && pm.key.id) {
        const entry = adCache.get(s.id + ':' + pm.key.id);
        if (!entry) return;
        adCache.delete(s.id + ':' + pm.key.id);
        if (entry.media) adMediaBytes -= entry.media.length;
        await reportDeleted(s, sock, entry);
        return;
    }
    // ---- remember incoming messages ----
    if (msg.key.fromMe || pm) return;
    const d = describeMessage(msg.message);
    if (!d.text && !d.mediaType) return;
    const entry = {
        id: msg.key.id, chat: jid, sender: msg.key.participant || jid, name: msg.pushName || '',
        ts: (Number(msg.messageTimestamp) || Math.floor(Date.now() / 1000)) * 1000,
        text: d.text, mediaType: d.mediaType, label: d.label, inner: d.inner, media: null
    };
    if (d.mediaType) {
        const len = Number(d.inner[d.mediaType].fileLength || 0);
        if (len && len <= AD_MAX_MEDIA_EACH) {
            try {
                entry.media = await downloadMediaMessage(msg, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage });
                adMediaBytes += entry.media.length;
            } catch (e) { /* media could not be saved; text/caption is still kept */ }
        }
    }
    adCache.set(s.id + ':' + entry.id, entry);
    adEvict();
}
async function reportDeleted(s, sock, e) {
    const dest = s.adMode === 'chat' ? e.chat : ownerJidOf(s);
    const isGroup = e.chat.endsWith('@g.us');
    let chatName = 'private chat';
    if (isGroup) { try { chatName = (await sock.groupMetadata(e.chat)).subject; } catch (x) { chatName = 'a group'; } }
    const num = e.sender.split('@')[0];
    const when = new Date(e.ts).toLocaleTimeString('en-US', { timeZone: BOT_TZ, hour12: true });
    const header = card('Deleted', 'anti-delete', [
        kv('from', '+' + num + (e.name ? ' (' + e.name + ')' : '')),
        kv('chat', chatName), kv('sent at', when), kv('type', e.label)
    ]);
    const mentions = [e.sender];
    const bodyText = e.text ? `\n\n${B('MESSAGE')}  ${THIN}\n${e.text}` : '';
    const inner = e.inner || {};
    if (e.media && e.mediaType === 'imageMessage') return s.queueSend(dest, { image: e.media, caption: header + bodyText, mentions });
    if (e.media && e.mediaType === 'videoMessage') return s.queueSend(dest, { video: e.media, caption: header + bodyText, mentions });
    if (e.media && e.mediaType === 'documentMessage') {
        await s.queueSend(dest, { text: header + bodyText, mentions });
        return s.queueSend(dest, { document: e.media, mimetype: inner.documentMessage.mimetype || 'application/octet-stream', fileName: inner.documentMessage.fileName || 'file' });
    }
    if (e.media && e.mediaType === 'audioMessage') {
        await s.queueSend(dest, { text: header, mentions });
        return s.queueSend(dest, { audio: e.media, mimetype: inner.audioMessage.mimetype || 'audio/ogg; codecs=opus', ptt: !!inner.audioMessage.ptt });
    }
    if (e.media && e.mediaType === 'stickerMessage') {
        await s.queueSend(dest, { text: header, mentions });
        return s.queueSend(dest, { sticker: e.media });
    }
    const note = e.mediaType && !e.media ? `\n\n↳ ${sc('the file was too large or could not be saved')}` : '';
    return s.queueSend(dest, { text: header + bodyText + note, mentions });
}

reg('antidelete', { category: 'Owner', desc: '.antidelete [on/off/inbox/chat] — see messages people delete', aliases: ['antidel', 'ad'], ownerOnly: true, run: async ({ reply, args, session }) => {
    const v = (args[0] || '').toLowerCase();
    if (v === 'off') session.antidelete = false;
    else if (v === 'chat' || v === 'inbox') { session.adMode = v; session.antidelete = true; }
    else session.antidelete = true; // ".antidelete" or ".antidelete on" -> enable
    saveBotCfg(session);
    await reply(card('Anti delete', 'always watching', [
        kv('status', onOff(session.antidelete)),
        kv('deliver to', session.adMode === 'chat' ? 'same chat' : 'your inbox'),
        kv('keeps', 'text · photo · video · voice · sticker · file')
    ], `↳ ${sc('from now on every deleted message is sent back automatically')}\n↳ .antidelete off\n↳ .antidelete chat  ${sc('(show in the same chat)')}\n↳ .antidelete inbox ${sc('(private, default)')}`));
}});
reg('vv', { category: 'Owner', desc: '.vv — reply to a view-once photo/video/voice to save it', aliases: ['viewonce', 'vo'], ownerOnly: true, run: async ({ sock, from, msg, reply, session }) => {
    const ci = msg.message && msg.message.extendedTextMessage && msg.message.extendedTextMessage.contextInfo;
    if (!ci || !ci.quotedMessage) return reply('❌ Reply to a view-once photo, video or voice note with .vv');
    const d = describeMessage(ci.quotedMessage);
    if (!d.mediaType || d.mediaType === 'stickerMessage' || d.mediaType === 'documentMessage') return reply('❌ That is not a photo, video or voice note.');
    const fake = { key: { remoteJid: from, id: ci.stanzaId, participant: ci.participant }, message: d.inner };
    let buf;
    try { buf = await downloadMediaMessage(fake, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }); }
    catch (e) { return reply('❌ Could not save it. The view-once media has probably already expired.'); }
    const from_ = ((ci.participant || from).split('@')[0]);
    const cap = card('View once', 'saved', [kv('from', '+' + from_), kv('type', d.label)]) + (d.text ? `\n\n${d.text}` : '');
    const dest = ownerJidOf(session);
    if (d.mediaType === 'imageMessage') await session.queueSend(dest, { image: buf, caption: cap });
    else if (d.mediaType === 'videoMessage') await session.queueSend(dest, { video: buf, caption: cap });
    else {
        await session.queueSend(dest, { text: cap });
        await session.queueSend(dest, { audio: buf, mimetype: d.inner.audioMessage.mimetype || 'audio/ogg; codecs=opus', ptt: !!d.inner.audioMessage.ptt });
    }
}});

// =========================================================================
// NIMAH ECONOMY — coins, bank, jobs, gambling, rob, shop, levels, rankings
// Saved to economy.json (use a Railway Volume) + backed up to Firestore.
// =========================================================================
const ECO_CUR = '🪙';
const ECO_FILE = path.join(SESSION_ROOT, 'economy.json');
const ecoStore = { users: {} };
try { if (fs.existsSync(ECO_FILE)) Object.assign(ecoStore, JSON.parse(fs.readFileSync(ECO_FILE, 'utf8'))); } catch (e) { console.log('Economy load failed:', e.message); }
if (!ecoStore.users) ecoStore.users = {};
let ecoDirtyFile = false;
const ecoDirtyFs = new Set();
function ecoWriteFile() {
    try { const tmp = ECO_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(ecoStore)); fs.renameSync(tmp, ECO_FILE); ecoDirtyFile = false; }
    catch (e) { console.log('Economy save failed:', e.message); }
}
setInterval(() => { if (ecoDirtyFile) ecoWriteFile(); }, 4000);
setInterval(() => { for (const k of ecoDirtyFs) { ecoDirtyFs.delete(k); if (ecoStore.users[k]) fsSet('economy', k, ecoStore.users[k]); } }, 30000);
process.on('exit', () => { if (ecoDirtyFile) ecoWriteFile(); });
const ecoSave = (u) => { ecoDirtyFile = true; ecoDirtyFs.add(u.key); };

const ecoLoading = new Map();
async function ecoUser(sid, jid, name) {
    const num = String(jid).split('@')[0].split(':')[0];
    const key = sid + '_' + num;
    let u = ecoStore.users[key];
    if (!u) {
        if (!ecoLoading.has(key)) {
            ecoLoading.set(key, (async () => {
                let saved = null;
                try { saved = await Promise.race([fsGet('economy', key, null), new Promise((r) => setTimeout(() => r(null), 2500))]); } catch (e) {}
                if (!ecoStore.users[key]) {
                    ecoStore.users[key] = Object.assign({ wallet: 500, bank: 0, xp: 0, level: 1, streak: 0, cd: {}, inv: {}, stats: { won: 0, lost: 0, earned: 0 }, created: Date.now() }, saved || {});
                }
                ecoStore.users[key].key = key; ecoStore.users[key].num = num;
                ecoLoading.delete(key); ecoSave(ecoStore.users[key]);
            })());
        }
        await ecoLoading.get(key);
        u = ecoStore.users[key];
    }
    u.cd = u.cd || {}; u.inv = u.inv || {}; u.stats = u.stats || { won: 0, lost: 0, earned: 0 };
    if (name) u.name = String(name).slice(0, 24);
    return u;
}
const N = (n) => Math.floor(n).toLocaleString('en-US');
const levelFor = (xp) => 1 + Math.floor(Math.sqrt(xp / 60));
const xpFloor = (l) => 60 * (l - 1) * (l - 1);
const netWorth = (u) => u.wallet + u.bank;
const bankCap = (u) => 5000 + (u.level - 1) * 1500 + (u.inv.vault || 0) * 25000;
const TITLES = [[10000000, 'Legend 👑'], [1000000, 'Tycoon 💎'], [250000, 'Mogul 🏰'], [50000, 'Merchant 🏪'], [10000, 'Trader 📈'], [1000, 'Hustler 💼'], [0, 'Newbie 🌱']];
const ecoTitle = (u) => (TITLES.find((t) => netWorth(u) >= t[0]) || TITLES[TITLES.length - 1])[1];
function gainXp(u, n) {
    u.xp += n; const nl = levelFor(u.xp);
    if (nl > u.level) { u.level = nl; return `\n\n🎉 ${B('LEVEL UP')}  ❯  *${nl}*\n↳ ${sc('bank space and job pay went up')}`; }
    return '';
}
function ecoCd(u, key, ms) {
    const now = Date.now(); const left = (u.cd[key] || 0) + ms - now;
    if (left > 0) return left;
    u.cd[key] = now; return 0;
}
const fmtCd = (ms) => { const s = Math.ceil(ms / 1000); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return ((h ? h + 'h ' : '') + (m ? m + 'm ' : '') + (!h ? x + 's' : '')).trim(); };
const coolMsg = (left) => card('Cooldown', 'slow down', [kv('try again in', fmtCd(left))]);
function parseAmt(str, max) {
    if (!str) return NaN;
    str = String(str).toLowerCase().replace(/,/g, '');
    if (str === 'all' || str === 'max') return max;
    if (str === 'half') return Math.floor(max / 2);
    const m = str.match(/^(\d+(?:\.\d+)?)([kmb])?$/);
    if (!m) return NaN;
    return Math.min(Math.floor(parseFloat(m[1]) * ({ k: 1e3, m: 1e6, b: 1e9 }[m[2]] || 1)), 1e12);
}
function ecoTarget(msg, args) {
    const ci = msg.message && msg.message.extendedTextMessage && msg.message.extendedTextMessage.contextInfo;
    const rest = args.filter((a) => !/^@/.test(a));
    if (ci && ci.mentionedJid && ci.mentionedJid[0]) return { jid: ci.mentionedJid[0], rest };
    if (ci && ci.participant) return { jid: ci.participant, rest };
    if (rest[0] && /^\d{9,15}$/.test(rest[0])) return { jid: rest[0] + '@s.whatsapp.net', rest: rest.slice(1) };
    return { jid: null, rest };
}
function ecoReg(name, opts, fn) {
    reg(name, Object.assign({ category: 'Economy' }, opts, { run: async (ctx) => {
        const u = await ecoUser(ctx.session.id, ctx.sender, ctx.msg.pushName);
        await fn(ctx, u);
    } }));
}
const SHOP = {
    pickaxe: { icon: '⛏', name: 'Pickaxe', price: 2500, info: 'unlocks .mine' },
    rod: { icon: '🎣', name: 'Fishing rod', price: 1800, info: 'unlocks .fish' },
    laptop: { icon: '💻', name: 'Laptop', price: 6000, info: '+25% pay from .work' },
    padlock: { icon: '🔒', name: 'Padlock', price: 1200, info: 'blocks one robbery (used up)' },
    clover: { icon: '🍀', name: 'Lucky clover', price: 1500, info: '+10% win chance, 5 bets (used up)' },
    vault: { icon: '🏦', name: 'Vault', price: 8000, info: '+25,000 bank space (max 10)' },
    trophy: { icon: '🏆', name: 'Trophy', price: 250000, info: 'flex item for your profile' }
};
function findItem(q) {
    q = String(q || '').toLowerCase();
    return Object.keys(SHOP).find((k) => k === q || SHOP[k].name.toLowerCase() === q || SHOP[k].name.toLowerCase().startsWith(q)) || null;
}
const ecoFoot = (u) => `↳ ${sc('wallet')} ${ECO_CUR} ${N(u.wallet)}`;

// ---- core ----
ecoReg('balance', { desc: '.balance — wallet, bank & rank (reply/@ for others)', aliases: ['bal', 'wallet', 'money', 'cash', 'ecoprofile'] }, async (ctx, u) => {
    const t = ecoTarget(ctx.msg, ctx.args);
    const tu = t.jid ? await ecoUser(ctx.session.id, t.jid, '') : u;
    const cap = bankCap(tu), next = xpFloor(tu.level + 1), cur = xpFloor(tu.level);
    await ctx.reply(card(tu === u ? 'Your wallet' : '+' + tu.num, ecoTitle(tu), [
        kv('wallet', ECO_CUR + ' ' + N(tu.wallet)),
        kv('bank', ECO_CUR + ' ' + N(tu.bank) + ' / ' + N(cap)),
        kv('net worth', ECO_CUR + ' ' + N(netWorth(tu))),
        kv('level', tu.level + '  ' + meter((tu.xp - cur) / Math.max(1, next - cur))),
        kv('xp', N(tu.xp) + ' / ' + N(next)),
        tu.inv.trophy ? kv('trophy', '🏆 ×' + tu.inv.trophy) : null
    ].filter(Boolean), `↳ ${sc('type')} *.eco* ${sc('for all money commands')}`));
});
ecoReg('daily', { desc: '.daily — claim your daily coins' }, async (ctx, u) => {
    const last = u.cd.daily || 0;
    const left = ecoCd(u, 'daily', 24 * 3600e3 - 60e3);
    if (left) return ctx.reply(coolMsg(left));
    u.streak = (Date.now() - last > 48 * 3600e3) ? 1 : (u.streak || 0) + 1;
    const reward = 500 + Math.min(u.streak, 30) * 100 + u.level * 25;
    u.wallet += reward; u.stats.earned += reward;
    const up = gainXp(u, 20); ecoSave(u);
    await ctx.reply(card('Daily reward', 'claimed', [kv('received', ECO_CUR + ' ' + N(reward)), kv('streak', '🔥 ' + u.streak + ' day' + (u.streak > 1 ? 's' : '')), kv('wallet', ECO_CUR + ' ' + N(u.wallet))], `↳ ${sc('come back tomorrow to keep the streak (max bonus at 30 days)')}${up}`));
});
ecoReg('weekly', { desc: '.weekly — claim your weekly bonus' }, async (ctx, u) => {
    const left = ecoCd(u, 'weekly', 7 * 24 * 3600e3 - 60e3);
    if (left) return ctx.reply(coolMsg(left));
    const reward = 4000 + u.level * 150; u.wallet += reward; u.stats.earned += reward;
    const up = gainXp(u, 40); ecoSave(u);
    await ctx.reply(card('Weekly bonus', 'claimed', [kv('received', ECO_CUR + ' ' + N(reward)), kv('wallet', ECO_CUR + ' ' + N(u.wallet))]) + up);
});
const JOBS = ['fixed a neighbour\'s Wi-Fi', 'delivered food across town', 'coded a small website', 'designed a logo', 'drove a tuk-tuk all day', 'taught an evening class', 'repaired phones at the market', 'edited videos for a client', 'ran a tea stall', 'managed a shop till closing'];
ecoReg('work', { desc: '.work — earn coins (every 45 min)', aliases: ['job'] }, async (ctx, u) => {
    const left = ecoCd(u, 'work', 45 * 60e3);
    if (left) return ctx.reply(coolMsg(left));
    let pay = randInt(150, 400) * (1 + u.level * 0.04) * (u.inv.laptop ? 1.25 : 1); pay = Math.floor(pay);
    u.wallet += pay; u.stats.earned += pay; const up = gainXp(u, 15); ecoSave(u);
    await ctx.reply(card('Work', 'paid', [`You ${pick(JOBS)}.`, kv('earned', ECO_CUR + ' ' + N(pay)), u.inv.laptop ? kv('laptop bonus', '+25%') : null].filter(Boolean), ecoFoot(u)) + up);
});
ecoReg('beg', { desc: '.beg — ask for a few coins (every 5 min)' }, async (ctx, u) => {
    const left = ecoCd(u, 'beg', 5 * 60e3);
    if (left) return ctx.reply(coolMsg(left));
    if (Math.random() < 0.25) { ecoSave(u); return ctx.reply(card('Beg', 'ignored', ['Nobody gave you anything this time.'], ecoFoot(u))); }
    const pay = randInt(20, 120); u.wallet += pay; u.stats.earned += pay; const up = gainXp(u, 4); ecoSave(u);
    await ctx.reply(card('Beg', 'kind stranger', [kv('received', ECO_CUR + ' ' + N(pay))], ecoFoot(u)) + up);
});
ecoReg('crime', { desc: '.crime — risky money (every 90 min)' }, async (ctx, u) => {
    const left = ecoCd(u, 'crime', 90 * 60e3);
    if (left) return ctx.reply(coolMsg(left));
    if (Math.random() < 0.55) {
        const pay = randInt(300, 900) + u.level * 20; u.wallet += pay; u.stats.earned += pay; const up = gainXp(u, 22); ecoSave(u);
        return ctx.reply(card('Crime', 'got away', ['The job went perfectly.', kv('loot', ECO_CUR + ' ' + N(pay))], ecoFoot(u)) + up);
    }
    const fine = Math.min(u.wallet, randInt(200, 500)); u.wallet -= fine; ecoSave(u);
    await ctx.reply(card('Crime', 'busted', ['You were caught and fined.', kv('fine', ECO_CUR + ' ' + N(fine))], ecoFoot(u)));
});
ecoReg('fish', { desc: '.fish — needs a fishing rod (every 20 min)' }, async (ctx, u) => {
    if (!u.inv.rod) return ctx.reply(card('Fish', 'no rod', ['You need a 🎣 Fishing rod.'], `↳ .buy rod  ${sc('(1,800)')}`));
    const left = ecoCd(u, 'fish', 20 * 60e3);
    if (left) return ctx.reply(coolMsg(left));
    const catches = [['🐟 fish', 100], ['🐠 tropical fish', 180], ['🦑 squid', 260], ['🦈 baby shark', 400], ['👢 old boot', 5]];
    const c = pick(catches); const pay = c[1] + randInt(0, 80); u.wallet += pay; u.stats.earned += pay; const up = gainXp(u, 10); ecoSave(u);
    await ctx.reply(card('Fish', 'caught', [`You caught a ${c[0]}.`, kv('sold for', ECO_CUR + ' ' + N(pay))], ecoFoot(u)) + up);
});
ecoReg('mine', { desc: '.mine — needs a pickaxe (every 30 min)' }, async (ctx, u) => {
    if (!u.inv.pickaxe) return ctx.reply(card('Mine', 'no pickaxe', ['You need a ⛏ Pickaxe.'], `↳ .buy pickaxe  ${sc('(2,500)')}`));
    const left = ecoCd(u, 'mine', 30 * 60e3);
    if (left) return ctx.reply(coolMsg(left));
    const ores = [['🪨 stone', 120], ['⛓ iron', 260], ['🥇 gold', 480], ['💎 diamond', 800]];
    const o = pick(ores); const pay = o[1] + randInt(0, 150); u.wallet += pay; u.stats.earned += pay; const up = gainXp(u, 14); ecoSave(u);
    await ctx.reply(card('Mine', 'found ore', [`You dug up ${o[0]}.`, kv('sold for', ECO_CUR + ' ' + N(pay))], ecoFoot(u)) + up);
});

// ---- bank ----
ecoReg('deposit', { desc: '.deposit [amount/all] — wallet to bank', aliases: ['dep'] }, async (ctx, u) => {
    const room = Math.max(0, bankCap(u) - u.bank);
    const amt = parseAmt(ctx.args[0], Math.min(u.wallet, room));
    if (!(amt > 0)) return ctx.reply('❌ Usage: .deposit 500  (or all)');
    if (amt > u.wallet) return ctx.reply('❌ You do not have that much in your wallet.');
    if (amt > room) return ctx.reply(card('Bank full', 'no space', [kv('free space', ECO_CUR + ' ' + N(room))], `↳ ${sc('level up or buy a vault for more room')}`));
    u.wallet -= amt; u.bank += amt; ecoSave(u);
    await ctx.reply(card('Deposit', 'saved', [kv('deposited', ECO_CUR + ' ' + N(amt)), kv('bank', ECO_CUR + ' ' + N(u.bank) + ' / ' + N(bankCap(u))), kv('wallet', ECO_CUR + ' ' + N(u.wallet))]));
});
ecoReg('withdraw', { desc: '.withdraw [amount/all] — bank to wallet', aliases: ['wd'] }, async (ctx, u) => {
    const amt = parseAmt(ctx.args[0], u.bank);
    if (!(amt > 0)) return ctx.reply('❌ Usage: .withdraw 500  (or all)');
    if (amt > u.bank) return ctx.reply('❌ You do not have that much in the bank.');
    u.bank -= amt; u.wallet += amt; ecoSave(u);
    await ctx.reply(card('Withdraw', 'done', [kv('withdrew', ECO_CUR + ' ' + N(amt)), kv('bank', ECO_CUR + ' ' + N(u.bank)), kv('wallet', ECO_CUR + ' ' + N(u.wallet))]));
});
ecoReg('send', { desc: '.send [@user] [amount] — give coins (1% fee)', aliases: ['pay', 'give', 'transfer'] }, async (ctx, u) => {
    const t = ecoTarget(ctx.msg, ctx.args);
    if (!t.jid) return ctx.reply('❌ Usage: reply or @mention someone: .send @user 500');
    const amt = parseAmt(t.rest[0], u.wallet);
    if (!(amt > 0)) return ctx.reply('❌ Give an amount. Example: .send @user 500');
    const fee = Math.max(1, Math.floor(amt * 0.01));
    if (amt + fee > u.wallet) return ctx.reply(card('Send', 'not enough', [kv('needed', ECO_CUR + ' ' + N(amt + fee) + ' (incl. fee)'), kv('wallet', ECO_CUR + ' ' + N(u.wallet))]));
    const tu = await ecoUser(ctx.session.id, t.jid, '');
    if (tu.key === u.key) return ctx.reply('❌ You cannot send coins to yourself.');
    u.wallet -= amt + fee; tu.wallet += amt; ecoSave(u); ecoSave(tu);
    await ctx.reply(card('Sent', 'transfer', [kv('to', '@' + tu.num), kv('amount', ECO_CUR + ' ' + N(amt)), kv('fee', ECO_CUR + ' ' + N(fee))], ecoFoot(u)));
});
ecoReg('rob', { desc: '.rob [@user] — steal coins (risky, every 30 min)', aliases: ['steal'] }, async (ctx, u) => {
    const t = ecoTarget(ctx.msg, ctx.args);
    if (!t.jid) return ctx.reply('❌ Usage: reply or @mention someone: .rob @user');
    const v = await ecoUser(ctx.session.id, t.jid, '');
    if (v.key === u.key) return ctx.reply('❌ You cannot rob yourself.');
    if (u.wallet < 500) return ctx.reply(card('Rob', 'too poor', ['Keep at least 500 in your wallet to cover the fine.']));
    if (v.wallet < 300) return ctx.reply(card('Rob', 'not worth it', [`@${v.num} has almost nothing in their wallet.`]));
    const left = ecoCd(u, 'rob', 30 * 60e3);
    if (left) return ctx.reply(coolMsg(left));
    if (v.inv.padlock) {
        v.inv.padlock--; ecoSave(v); ecoSave(u);
        const fine = Math.min(u.wallet, randInt(150, 350)); u.wallet -= fine;
        return ctx.reply(card('Rob', 'blocked', [`@${v.num} had a 🔒 padlock! It broke, but you were caught.`, kv('fine', ECO_CUR + ' ' + N(fine))], ecoFoot(u)));
    }
    if (Math.random() < 0.40) {
        const loot = Math.min(20000, Math.floor(v.wallet * (0.10 + Math.random() * 0.20)));
        v.wallet -= loot; u.wallet += loot; u.stats.earned += loot; const up = gainXp(u, 25); ecoSave(u); ecoSave(v);
        return ctx.reply(card('Rob', 'success', [`You slipped away with coins from @${v.num}.`, kv('stolen', ECO_CUR + ' ' + N(loot))], ecoFoot(u)) + up);
    }
    const fine = Math.min(u.wallet, Math.max(150, Math.floor(u.wallet * 0.15))); u.wallet -= fine; ecoSave(u);
    await ctx.reply(card('Rob', 'failed', ['You got caught red-handed.', kv('fine', ECO_CUR + ' ' + N(fine))], ecoFoot(u)));
});

// ---- gambling ----
function useClover(u) {
    if (!(u.inv.clover > 0)) return false;
    u.cd.cloverUses = (u.cd.cloverUses || 0) + 1;
    if (u.cd.cloverUses >= 5) { u.inv.clover--; u.cd.cloverUses = 0; }
    return true;
}
function betCheck(ctx, u, str) {
    const amt = parseAmt(str, u.wallet);
    if (!(amt > 0)) { ctx.reply('❌ Give a bet amount. Example: ' + ctx.usageHint); return null; }
    if (amt > u.wallet) { ctx.reply(card('Bet', 'not enough', [kv('wallet', ECO_CUR + ' ' + N(u.wallet))])); return null; }
    if (amt < 10) { ctx.reply('❌ Minimum bet is 10.'); return null; }
    return amt;
}
ecoReg('gamble', { desc: '.gamble [amount/all] — 2x or nothing', aliases: ['bet'] }, async (ctx, u) => {
    ctx.usageHint = '.gamble 500'; const amt = betCheck(ctx, u, ctx.args[0]); if (!amt) return;
    const lucky = useClover(u); const win = Math.random() < (lucky ? 0.57 : 0.47);
    if (win) { u.wallet += amt; u.stats.won++; u.stats.earned += amt; } else { u.wallet -= amt; u.stats.lost++; }
    const up = gainXp(u, 5); ecoSave(u);
    await ctx.reply(card('Gamble', win ? 'you won' : 'you lost', [kv(win ? 'won' : 'lost', ECO_CUR + ' ' + N(amt)), lucky ? kv('clover', '🍀 active') : null].filter(Boolean), ecoFoot(u)) + up);
});
ecoReg('coinflip', { desc: '.coinflip [heads/tails] [amount]', aliases: ['cf', 'flipbet'] }, async (ctx, u) => {
    const side = /^t/i.test(ctx.args[0] || '') ? 'tails' : /^h/i.test(ctx.args[0] || '') ? 'heads' : null;
    if (!side) return ctx.reply('❌ Usage: .coinflip heads 500');
    ctx.usageHint = '.coinflip heads 500'; const amt = betCheck(ctx, u, ctx.args[1]); if (!amt) return;
    const lucky = useClover(u); const result = Math.random() < (lucky ? 0.60 : 0.50) ? side : (side === 'heads' ? 'tails' : 'heads');
    const win = result === side; const net = Math.floor(amt * 0.9);
    if (win) { u.wallet += net; u.stats.won++; u.stats.earned += net; } else { u.wallet -= amt; u.stats.lost++; }
    const up = gainXp(u, 5); ecoSave(u);
    await ctx.reply(card('Coin flip', win ? 'you won' : 'you lost', [kv('you picked', side), kv('it landed', (result === 'heads' ? '🙂 ' : '🦅 ') + result), kv(win ? 'won' : 'lost', ECO_CUR + ' ' + N(win ? net : amt))], ecoFoot(u)) + up);
});
const SLOT_SYMS = [['🍒', 5], ['🍋', 8], ['🍇', 10], ['🔔', 15], ['💎', 25], ['7️⃣', 50]];
ecoReg('slots', { desc: '.slots [amount] — spin the reels', aliases: ['slot', 'spin'] }, async (ctx, u) => {
    ctx.usageHint = '.slots 500'; const amt = betCheck(ctx, u, ctx.args[0]); if (!amt) return;
    useClover(u);
    const r = [0, 0, 0].map(() => pick(SLOT_SYMS));
    const names = r.map((x) => x[0]);
    let mult = 0, label = 'no match';
    if (names[0] === names[1] && names[1] === names[2]) { mult = r[0][1]; label = 'JACKPOT ×' + mult; }
    else if (names[0] === names[1] || names[1] === names[2] || names[0] === names[2]) { mult = 1; label = 'pair — bet returned'; }
    if (mult > 1) { const w = amt * (mult - 1); u.wallet += w; u.stats.won++; u.stats.earned += w; }
    else if (mult === 0) { u.wallet -= amt; u.stats.lost++; }
    const up = gainXp(u, 6); ecoSave(u);
    await ctx.reply(card('Slots', label, [`〔 ${names.join('  ')} 〕\n`, kv('result', mult > 1 ? '+' + ECO_CUR + ' ' + N(amt * (mult - 1)) : mult === 1 ? ECO_CUR + ' 0' : '-' + ECO_CUR + ' ' + N(amt))], ecoFoot(u)) + up);
});
ecoReg('roulette', { desc: '.roulette [red/black/green] [amount]', aliases: ['rl'] }, async (ctx, u) => {
    const pickC = /^r/i.test(ctx.args[0] || '') ? 'red' : /^b/i.test(ctx.args[0] || '') ? 'black' : /^g/i.test(ctx.args[0] || '') ? 'green' : null;
    if (!pickC) return ctx.reply('❌ Usage: .roulette red 500   (red/black pay 2x, green pays 14x)');
    ctx.usageHint = '.roulette red 500'; const amt = betCheck(ctx, u, ctx.args[1]); if (!amt) return;
    useClover(u);
    const n = randInt(0, 36); const color = n === 0 ? 'green' : (n % 2 === 0 ? 'black' : 'red');
    const win = color === pickC; const mult = pickC === 'green' ? 14 : 2;
    if (win) { const w = amt * (mult - 1); u.wallet += w; u.stats.won++; u.stats.earned += w; } else { u.wallet -= amt; u.stats.lost++; }
    const up = gainXp(u, 6); ecoSave(u);
    await ctx.reply(card('Roulette', win ? 'you won' : 'you lost', [kv('ball', ({ red: '🔴', black: '⚫', green: '🟢' })[color] + ' ' + n), kv('you picked', pickC), kv(win ? 'won' : 'lost', ECO_CUR + ' ' + N(win ? amt * (mult - 1) : amt))], ecoFoot(u)) + up);
});

// ---- shop ----
ecoReg('shop', { desc: '.shop — items you can buy', aliases: ['store'] }, async (ctx, u) => {
    const rows = Object.keys(SHOP).map((k, i) => `${tag(i + 1)}  ${SHOP[k].icon} ${B(SHOP[k].name)}  ❯  ${ECO_CUR} ${N(SHOP[k].price)}\n      ↳ ${sc(SHOP[k].info)}`);
    await ctx.reply(`${head('Shop', 'spend your coins')}\n${rows.join('\n')}\n\n↳ .buy [item] [qty]\n↳ .sell [item] [qty]\n${ecoFoot(u)}\n\n${FOOTER()}`);
});
ecoReg('buy', { desc: '.buy [item] [qty]', aliases: ['purchase'] }, async (ctx, u) => {
    const k = findItem(ctx.args[0]);
    if (!k) return ctx.reply('❌ Unknown item. Type .shop to see the list.');
    const qty = Math.max(1, Math.min(parseInt(ctx.args[1], 10) || 1, 99));
    const it = SHOP[k]; const cost = it.price * qty;
    if (k === 'vault' && (u.inv.vault || 0) + qty > 10) return ctx.reply('❌ You can own at most 10 vaults.');
    if (cost > u.wallet) return ctx.reply(card('Shop', 'not enough', [kv('cost', ECO_CUR + ' ' + N(cost)), kv('wallet', ECO_CUR + ' ' + N(u.wallet))]));
    u.wallet -= cost; u.inv[k] = (u.inv[k] || 0) + qty; ecoSave(u);
    await ctx.reply(card('Purchased', 'thank you', [kv('item', it.icon + ' ' + it.name + ' ×' + qty), kv('paid', ECO_CUR + ' ' + N(cost))], ecoFoot(u)));
});
ecoReg('sell', { desc: '.sell [item] [qty/all] — 50% refund' }, async (ctx, u) => {
    const k = findItem(ctx.args[0]);
    if (!k || !u.inv[k]) return ctx.reply('❌ You do not own that item. Check .inventory');
    const qty = /^all$/i.test(ctx.args[1] || '') ? u.inv[k] : Math.max(1, Math.min(parseInt(ctx.args[1], 10) || 1, u.inv[k]));
    const gain = Math.floor(SHOP[k].price * 0.5) * qty; u.inv[k] -= qty; if (!u.inv[k]) delete u.inv[k]; u.wallet += gain; ecoSave(u);
    await ctx.reply(card('Sold', 'done', [kv('item', SHOP[k].icon + ' ' + SHOP[k].name + ' ×' + qty), kv('received', ECO_CUR + ' ' + N(gain))], ecoFoot(u)));
});
ecoReg('inventory', { desc: '.inventory — what you own', aliases: ['inv', 'bag'] }, async (ctx, u) => {
    const own = Object.keys(u.inv).filter((k) => u.inv[k] > 0 && SHOP[k]);
    const rows = own.length ? own.map((k) => `◈ ${SHOP[k].icon} ${B(SHOP[k].name)}  ×${u.inv[k]}`) : [sc('empty — visit .shop')];
    await ctx.reply(`${head('Inventory', 'your items')}\n${rows.join('\n')}\n\n${ecoFoot(u)}\n\n${FOOTER()}`);
});

// ---- ranks ----
ecoReg('leaderboard', { desc: '.leaderboard — richest players', aliases: ['top', 'lb', 'rich'] }, async (ctx, u) => {
    const prefix = ctx.session.id + '_';
    const all = Object.values(ecoStore.users).filter((x) => x.key && x.key.startsWith(prefix)).sort((a, b) => netWorth(b) - netWorth(a));
    const medals = ['🥇', '🥈', '🥉'];
    const rows = all.slice(0, 10).map((x, i) => `${medals[i] || tag(i + 1)}  ${B(x.name || '+' + x.num)}  ❯  ${ECO_CUR} ${N(netWorth(x))}`);
    const me = all.findIndex((x) => x.key === u.key) + 1;
    await ctx.reply(`${head('Richest', 'top 10')}\n${rows.join('\n') || sc('nobody yet')}\n\n${kv('your rank', '#' + me + ' of ' + all.length)}\n\n${FOOTER()}`);
});
ecoReg('level', { desc: '.level — your level & xp', aliases: ['rank', 'xp'] }, async (ctx, u) => {
    const next = xpFloor(u.level + 1), cur = xpFloor(u.level);
    await ctx.reply(card('Level', ecoTitle(u), [kv('level', u.level), kv('xp', N(u.xp) + ' / ' + N(next)), `\n${meter((u.xp - cur) / Math.max(1, next - cur), 14)}`, kv('games won', u.stats.won), kv('games lost', u.stats.lost), kv('lifetime earned', ECO_CUR + ' ' + N(u.stats.earned))]));
});
reg('eco', { category: 'Economy', desc: '.eco — all money commands', aliases: ['economy', 'ecohelp'], run: async ({ reply }) => {
    await reply(`${head('Economy', 'earn · save · risk · rule')}\n` +
        `${B('EARN')}  ${THIN}\n.daily  .weekly  .work  .beg  .crime  .fish  .mine\n\n` +
        `${B('BANK')}  ${THIN}\n.balance  .deposit  .withdraw  .send  .rob\n\n` +
        `${B('GAMBLE')}  ${THIN}\n.gamble  .coinflip  .slots  .roulette\n\n` +
        `${B('SHOP')}  ${THIN}\n.shop  .buy  .sell  .inventory\n\n` +
        `${B('RANK')}  ${THIN}\n.leaderboard  .level\n\n↳ ${sc('everyone starts with')} ${ECO_CUR} 500\n\n${FOOTER()}`);
}});
// ---- owner tools ----
reg('addcoins', { category: 'Economy', desc: '.addcoins [@user] [amount] — owner gift', ownerOnly: true, run: async (ctx) => {
    const t = ecoTarget(ctx.msg, ctx.args);
    const amt = parseAmt(t.rest[0], 0);
    if (!t.jid || !(amt > 0)) return ctx.reply('❌ Usage: .addcoins @user 5000');
    const tu = await ecoUser(ctx.session.id, t.jid, ''); tu.wallet += amt; ecoSave(tu);
    await ctx.reply(card('Coins added', 'owner', [kv('to', '@' + tu.num), kv('amount', ECO_CUR + ' ' + N(amt)), kv('wallet', ECO_CUR + ' ' + N(tu.wallet))]));
}});
reg('ecoreset', { category: 'Economy', desc: '.ecoreset [@user] — wipe one account', ownerOnly: true, run: async (ctx) => {
    const t = ecoTarget(ctx.msg, ctx.args);
    if (!t.jid) return ctx.reply('❌ Usage: .ecoreset @user');
    const num = t.jid.split('@')[0].split(':')[0]; const key = ctx.session.id + '_' + num;
    delete ecoStore.users[key]; ecoDirtyFile = true; fsSet('economy', key, { wallet: 500, bank: 0, xp: 0, level: 1, streak: 0, cd: {}, inv: {}, stats: { won: 0, lost: 0, earned: 0 } });
    await ctx.reply(card('Account reset', 'owner', [kv('user', '@' + num)]));
}});


// ---- Chama API (api.chamindu.site) powered commands ----
// Key lives in the CHAMA_API_KEY env var / .env file - never in the code.
const CHAMA_BASE = process.env.CHAMA_BASE || 'https://api.chamindu.site';
const YT_RE = /(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?[^\s]*v=|shorts\/|live\/)|youtu\.be\/)[\w-]{6,}[^\s]*/i;
async function chamaGet(pathname, params) {
    const key = getApiKey('CHAMA');
    if (!key) { const e = new Error('NO_KEY'); e.code = 'NO_KEY'; throw e; }
    const r = await axios.get(CHAMA_BASE + pathname, { params: Object.assign({}, params, { api_key: key }), timeout: 90000 });
    return r.data;
}
reg('ytmp3', { category: 'Media', desc: '.ytmp3 [youtube link] — download a song as MP3', aliases: ['song', 'mp3', 'yta', 'music'], run: async ({ sock, from, msg, reply, q, session }) => {
    let link = (q.match(YT_RE) || [])[0];
    if (!link) { // allow replying to a message that contains the link
        const ci = msg.message && msg.message.extendedTextMessage && msg.message.extendedTextMessage.contextInfo;
        const qm = ci && ci.quotedMessage;
        const qt = qm && (qm.conversation || (qm.extendedTextMessage && qm.extendedTextMessage.text) || '');
        link = qt && (qt.match(YT_RE) || [])[0];
    }
    if (!link) return reply(card('YT MP3', 'how to use', ['Send a YouTube link with the command.', kv('example', '.ytmp3 https://youtu.be/xxxx')], `↳ ${sc('you can also reply to a message that has a link')}`));
    if (!/^https?:\/\//i.test(link)) link = 'https://' + link;
    let data;
    try { data = await chamaGet('/api/v1/music/sinhalahitsongs/download', { url: link }); }
    catch (e) {
        if (e.code === 'NO_KEY') return reply(card('YT MP3', 'not set up', ['The owner has not added the API key yet.'], `↳ CHAMA_API_KEY`));
        const st = e.response && e.response.status;
        console.log('ytmp3 API error:', st || e.message);
        return reply(card('YT MP3', 'service busy', [st === 401 || st === 403 ? 'The API key was rejected or its plan has ended.' : 'The music service did not answer. Please try again shortly.']));
    }
    const d = (data && data.data) || {};
    const url = d.download_link || (data && (data.download_link || data.direct_url));
    if (!data || data.status === false || !url) return reply(card('YT MP3', 'not found', ['Could not get that song. Check the link and try again.']));
    const title = String(d.title || 'song').replace(/\s+/g, ' ').trim();
    const info = card('YT MP3', 'ready', [kv('title', title.slice(0, 90)), kv('quality', d.quality || 'mp3'), kv('format', d.format || 'mp3')], `↳ ${sc('sending audio, please wait')}`);
    let sentCover = false;
    if (d.thumbnail) {
        try {
            const tb = await axios.get(d.thumbnail, { responseType: 'arraybuffer', timeout: 20000 });
            let img = Buffer.from(tb.data);
            const sharp = tryRequire('sharp');
            if (sharp) img = await sharp(img).jpeg({ quality: 82 }).toBuffer();
            await session.queueSend(from, { image: img, caption: info }, { quoted: msg });
            sentCover = true;
        } catch (e) { /* cover is optional */ }
    }
    if (!sentCover) await reply(info);
    await session.queueSend(from, { audio: { url }, mimetype: 'audio/mpeg', fileName: title.slice(0, 80).replace(/[\\/:*?"<>|]/g, '') + '.mp3' }, { quoted: msg });
}});

// ---- Shared helpers for Chama API video commands ----
const FB_RE = /https?:\/\/(?:[\w-]+\.)?(?:facebook\.com|fb\.watch|fb\.com)\/[^\s]+/i;
function linkFrom(msg, q, re) {
    let link = (q.match(re) || [])[0];
    if (!link) {
        const ci = msg.message && msg.message.extendedTextMessage && msg.message.extendedTextMessage.contextInfo;
        const qm = ci && ci.quotedMessage;
        const qt = qm && (qm.conversation || (qm.extendedTextMessage && qm.extendedTextMessage.text) || '');
        link = qt && (qt.match(re) || [])[0];
    }
    if (link && !/^https?:\/\//i.test(link)) link = 'https://' + link;
    return link || null;
}
async function chamaCall(reply, title, pathname, params) {
    try { return await chamaGet(pathname, params); }
    catch (e) {
        if (e.code === 'NO_KEY') { await reply(card(title, 'not set up', ['The owner has not added the API key yet.'], '↳ CHAMA_API_KEY')); return null; }
        const st = e.response && e.response.status;
        console.log(title + ' API error:', st || e.message);
        await reply(card(title, 'service busy', [st === 401 || st === 403 ? 'The API key was rejected or its plan has ended.' : 'The service did not answer. Please try again shortly.']));
        return null;
    }
}
// Finds the best playable video URL in an API response of unknown shape.
function pickVideoUrl(root, skipUrl) {
    const found = [];
    const walk = (v, key) => {
        if (typeof v === 'string') {
            if (!/^https?:\/\//i.test(v) || v === skipUrl) return;
            if (/thumb|image|poster|cover|original|audio|mp3|source_url|page/i.test(key)) return;
            if (!/\.mp4|video|download|play|hd|sd|cdn|fbcdn/i.test(key + ' ' + v)) return;
            const label = (key + ' ' + v).toLowerCase();
            let score = /hd|1080|720/.test(label) ? 3 : /sd|480|360|240/.test(label) ? 2 : 1;
            if (/\.mp4/.test(v)) score += 1;
            found.push({ url: v, score });
        } else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
        else if (v && typeof v === 'object') for (const k of Object.keys(v)) walk(v[k], k + ' ' + (v.quality || v.label || v.resolution || ''));
    };
    walk(root, '');
    found.sort((a, b) => b.score - a.score);
    return found[0] ? found[0].url : null;
}
reg('wadp', { category: 'Media', desc: '.wadp [number] — profile photo of a WhatsApp number', aliases: ['dpnum', 'dpcheck', 'numdp'], run: async ({ from, msg, reply, args, session }) => {
    let num = (args[0] || '').replace(/[^0-9]/g, '');
    if (/^0\d{9}$/.test(num)) num = '94' + num.slice(1); // 07XXXXXXXX -> 947XXXXXXXX
    if (num.length < 9 || num.length > 15) return reply(card('WA DP', 'how to use', ['Send a phone number with the country code.', kv('example', '.wadp 94771234567')]));
    const data = await chamaCall(reply, 'WA DP', '/api/v1/media/whatsapp_dp/infodl', { q: num });
    if (!data) return;
    const d = data.data || {};
    let url = d.has_dp === false ? null : (d.image_url || d.dp_url || d.jpg_url || d.jpg_download_link || (d.downloads && d.downloads[0] && (d.downloads[0].url || d.downloads[0].link)));
    if (url && /api\.chamindu\.site/.test(url) && !/api_key=/.test(url)) url += (url.includes('?') ? '&' : '?') + 'api_key=' + encodeURIComponent(getApiKey('CHAMA'));
    if (!url) return reply(card('WA DP', 'no photo', [kv('number', d.formatted_phone || '+' + num), 'No public profile photo was found.'], `↳ ${sc('it may be hidden by their privacy settings')}`));
    await session.queueSend(from, { image: { url }, caption: card('WA DP', 'found', [kv('number', d.formatted_phone || '+' + num)]) }, { quoted: msg });
}});
reg('fb', { category: 'Media', desc: '.fb [facebook video link] — download a Facebook video', aliases: ['facebook', 'fbdl', 'fbvideo'], run: async ({ from, msg, reply, q, session }) => {
    const link = linkFrom(msg, q, FB_RE);
    if (!link) return reply(card('Facebook', 'how to use', ['Send a public Facebook video link.', kv('example', '.fb https://fb.watch/xxxx')], `↳ ${sc('you can also reply to a message that has a link')}`));
    const data = await chamaCall(reply, 'Facebook', '/api/v1/facebook', { url: link });
    if (!data) return;
    const d = data.data || {};
    const url = d.status === 'inaccessible_or_private' ? null : pickVideoUrl(d, link) || pickVideoUrl(data.data ? null : data, link);
    if (!url) return reply(card('Facebook', 'not available', ['That video is private, removed or the link is not a video.'], `↳ ${sc('only public videos can be downloaded')}`));
    const title = String(d.title || 'Facebook video').replace(/\s+/g, ' ').trim().slice(0, 100);
    await session.queueSend(from, { video: { url }, mimetype: 'video/mp4', caption: card('Facebook', 'downloaded', [kv('title', title)]) + `\n_${sc('delivered by')} ${sc(BOT_NAME)}_` }, { quoted: msg });
}});
reg('ytmp4', { category: 'Media', desc: '.ytmp4 [youtube link] [quality] — download a video (144-1080)', aliases: ['ytv', 'video', 'ytvideo'], run: async ({ from, msg, reply, q, args, session }) => {
    const link = linkFrom(msg, q, YT_RE);
    if (!link) return reply(card('YT MP4', 'how to use', ['Send a YouTube link with the command.', kv('example', '.ytmp4 https://youtu.be/xxxx 480'), kv('qualities', '144 · 240 · 360 · 480 · 720 · 1080')], `↳ ${sc('lower quality = smaller, faster file')}`));
    const qa = args.find((a) => /^(144|240|360|480|720|1080)p?$/i.test(a));
    const quality = qa ? parseInt(qa, 10) : 480;
    const data = await chamaCall(reply, 'YT MP4', '/api/v1/youtube/savetube/mp4', { url: link, quality });
    if (!data) return;
    const d = data.data || {};
    const url = d.download_url || d.download_link || data.download_url;
    if (data.status === false || d.status === false || !url) return reply(card('YT MP4', 'not found', ['Could not get that video. Check the link or try a lower quality.']));
    const mins = parseFloat(String(d.duration || '').replace(/[^0-9.]/g, '')) || 0;
    if (mins > 40) return reply(card('YT MP4', 'too long', [kv('duration', d.duration), 'WhatsApp cannot take videos this long.'], `↳ ${sc('try .ytmp3 for the audio instead')}`));
    const title = String(d.title || 'video').replace(/\s+/g, ' ').trim();
    await session.queueSend(from, { video: { url }, mimetype: 'video/mp4', caption: card('YT MP4', 'ready', [kv('title', title.slice(0, 90)), kv('quality', d.format || quality + 'p'), d.duration ? kv('length', d.duration) : null].filter(Boolean)) + `\n_${sc('delivered by')} ${sc(BOT_NAME)}_` }, { quoted: msg });
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
reg('warn', { category: 'Group', desc: '.warn (reply)', groupOnly: true, adminOnly: true, run: async ({ sock, from, reply, msg }) => {
    const target = msg.message?.extendedTextMessage?.contextInfo?.participant;
    if (!target) return reply('❌ Reply to the user you want to warn.');
    const s = getGroupSettings(from);
    s.warns[target] = (s.warns[target] || 0) + 1;
    persistGroupSettings(from);
    await reply(`⚠️ @${target.split('@')[0]} has been warned (${s.warns[target]}/3).`);
    if (s.warns[target] >= 3) { try { await sock.groupParticipantsUpdate(from, [target], 'remove'); delete s.warns[target]; persistGroupSettings(from); await reply(`✅ @${target.split('@')[0]} reached 3 warnings and was removed.`); } catch (e) { await reply('⚠️ 3 warnings reached, but I need admin rights to remove them.'); } }
}});
reg('resetwarn', { category: 'Group', desc: '.resetwarn (reply)', groupOnly: true, adminOnly: true, run: async ({ from, reply, msg }) => {
    const target = msg.message?.extendedTextMessage?.contextInfo?.participant;
    if (!target) return reply('❌ Reply to the user whose warnings you want to reset.');
    delete getGroupSettings(from).warns[target];
    persistGroupSettings(from);
    await reply('✅ Warnings reset for that user.');
}});

// ---- OWNER-ONLY ----
// Global (platform) owner: OWNER_NUMBER. Works on every bot.
function isSuperOwner(sender) {
    if (!OWNER_NUMBER) return false;
    return sender.replace(/[^0-9]/g, '').startsWith(OWNER_NUMBER) || sender.split('@')[0] === OWNER_NUMBER;
}
// Owner of ONE bot = the number that paired it (plus the global owner).
function isOwner(sender, session) {
    if (isSuperOwner(sender)) return true;
    const own = session && session.ownerNumber;
    return !!own && sender.split('@')[0].split(':')[0] === own;
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
reg('restart', { category: 'Owner', desc: '.restart — restart this bot (platform owner: .restart all)', ownerOnly: true, run: async ({ reply, args, sender, session }) => {
    if ((args[0] || '').toLowerCase() === 'all') {
        if (!isSuperOwner(sender)) return reply('❌ Only the platform owner can restart every bot.');
        await reply('♻️ Restarting the whole server...'); setTimeout(() => process.exit(0), 1000); return;
    }
    await reply('♻️ Restarting this bot...');
    setTimeout(() => { try { session.sock.end(new Error('manual restart')); } catch (e) {} }, 800);
}});
reg('bots', { category: 'Owner', desc: '.bots — all linked bots on this server', superOnly: true, ownerOnly: true, run: async ({ reply }) => {
    const rows = [...sessions.values()].filter((x) => x.ownerNumber || x.isConnected).slice(0, 25).map((x) =>
        `${x.isConnected ? '🟢' : '🔴'} +${x.ownerNumber || '?'}${x.label ? ' · ' + x.label : ''}`);
    await reply(card('Bots', 'this server', [
        kv('online', activeBotCount() + ' / ' + sessions.size), kv('capacity', MAX_BOTS),
        kv('memory', Math.round(process.memoryUsage().rss / 1048576) + ' / ' + memLimitMb() + ' MB'),
        rows.length ? '\n' + rows.join('\n') : ''
    ].filter((x) => x !== '')));
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
reg('getdp', { category: 'Media', desc: '.getdp — reply / @mention / number / group', aliases: ['getpp', 'dp', 'pp', 'profilepic'], run: async ({ sock, from, msg, sender, isGroup, args, session }) => {
    const ci = msg.message && msg.message.extendedTextMessage && msg.message.extendedTextMessage.contextInfo;
    let target = null, label = '';
    const numArg = (args[0] || '').replace(/[^0-9]/g, '');
    if (/^(group|gc|chat)$/i.test(args[0] || '') && isGroup) { target = from; label = 'Group'; }
    else if (ci && ci.mentionedJid && ci.mentionedJid[0]) target = ci.mentionedJid[0];
    else if (ci && ci.participant) target = ci.participant;
    else if (numArg.length >= 7) target = numArg + '@s.whatsapp.net';
    else if (!isGroup) target = from;
    else target = sender;
    if (!label) label = '+' + target.split('@')[0];
    let url = null;
    try { url = await sock.profilePictureUrl(target, 'image'); }
    catch (e) { try { url = await sock.profilePictureUrl(target, 'preview'); } catch (e2) {} }
    if (!url) return session.queueSend(from, buildOut(card('Profile pic', 'not available', [kv('for', label)], `↳ ${sc('no photo set, or privacy settings hide it')}`)), { quoted: msg });
    await session.queueSend(from, {
        image: { url },
        caption: card('Profile pic', 'downloaded', [kv('for', label)]),
        mentions: target.endsWith('@s.whatsapp.net') ? [target] : []
    }, { quoted: msg });
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
reg('jid', { category: 'System', desc: '.jid', run: async ({ reply, sender }) => { await reply(card('Your jid', 'identity', [kv('jid', sender)])); }});
reg('stats', { category: 'System', desc: '.stats', run: async ({ reply }) => {
    const mem = process.memoryUsage();
    await reply(card('System', 'status', [
        kv('uptime', upShort(process.uptime())),
        kv('memory', (mem.rss / 1024 / 1024).toFixed(1) + ' MB'),
        kv('bots online', activeBotCount() + ' / ' + sessions.size),
        kv('commands', new Set(Object.values(commands)).size),
        kv('node', process.version),
        kv('platform', PLATFORM_NAMES[process.platform] || process.platform),
        kv('cpu cores', osMod.cpus().length)
    ]));
}});

// ---- SEARCH ----
const HTTP = { timeout: 12000, headers: { 'User-Agent': 'NimahMD/7 (+https://wa.me/' + OWNER_NUMBER + ')' } };
reg('wiki', { category: 'Search', desc: '.wiki [topic]', aliases: ['wikipedia'], run: async ({ reply, q }) => {
    if (!q) return reply('❌ Tell me what to look up. Example: .wiki Sigiriya');
    try {
        const r = await axios.get('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(q.trim().replace(/\s+/g, '_')), HTTP);
        const d = r.data;
        if (!d || !d.extract) return reply('❌ Nothing found for that topic.');
        await reply(card(d.title || q, 'wikipedia', [d.extract.length > 700 ? d.extract.slice(0, 700).trim() + '…' : d.extract, '', kv('read more', (d.content_urls && d.content_urls.desktop && d.content_urls.desktop.page) || 'wikipedia.org')]));
    } catch (e) { await reply('❌ No article found for that topic.'); }
}});
reg('google', { category: 'Search', desc: '.google [query]', aliases: ['search', 'find'], run: async ({ reply, q }) => {
    if (!q) return reply('❌ Give me something to search. Example: .google best hiking spots');
    const e = encodeURIComponent(q);
    await reply(card('Search', q.slice(0, 30), [kv('google', 'google.com/search?q=' + e), kv('duckduckgo', 'duckduckgo.com/?q=' + e), kv('youtube', 'youtube.com/results?search_query=' + e), kv('maps', 'google.com/maps/search/' + e)]));
}});
reg('github', { category: 'Search', desc: '.github [username]', aliases: ['gh'], run: async ({ reply, q }) => {
    if (!q) return reply('❌ Give a GitHub username. Example: .github torvalds');
    try {
        const d = (await axios.get('https://api.github.com/users/' + encodeURIComponent(q.trim()), HTTP)).data;
        await reply(card(d.login, 'github', [kv('name', d.name || '—'), kv('repos', d.public_repos), kv('followers', d.followers), kv('following', d.following), kv('joined', (d.created_at || '').slice(0, 10)), kv('bio', d.bio || '—'), kv('profile', d.html_url)]));
    } catch (e) { await reply('❌ That user was not found.'); }
}});
reg('npm', { category: 'Search', desc: '.npm [package]', run: async ({ reply, q }) => {
    if (!q) return reply('❌ Give a package name. Example: .npm axios');
    try {
        const d = (await axios.get('https://registry.npmjs.org/' + encodeURIComponent(q.trim()) + '/latest', HTTP)).data;
        await reply(card(d.name, 'npm', [kv('version', d.version), kv('license', d.license || '—'), kv('about', (d.description || '—').slice(0, 160)), kv('install', 'npm i ' + d.name)]));
    } catch (e) { await reply('❌ Package not found.'); }
}});
reg('country', { category: 'Search', desc: '.country [name]', run: async ({ reply, q }) => {
    if (!q) return reply('❌ Give a country name. Example: .country Sri Lanka');
    try {
        const d = (await axios.get('https://restcountries.com/v3.1/name/' + encodeURIComponent(q.trim()) + '?fields=name,capital,region,population,languages,currencies', HTTP)).data[0];
        await reply(card(d.name.common, 'country', [kv('capital', (d.capital || ['—'])[0]), kv('region', d.region), kv('population', Number(d.population).toLocaleString('en-US')), kv('languages', Object.values(d.languages || {}).join(', ') || '—'), kv('currency', Object.values(d.currencies || {}).map((c) => c.name).join(', ') || '—')]));
    } catch (e) { await reply('❌ Country not found.'); }
}});
reg('ipinfo', { category: 'Search', desc: '.ipinfo [ip or domain]', aliases: ['ip'], run: async ({ reply, q }) => {
    if (!q) return reply('❌ Give an IP or domain. Example: .ipinfo 8.8.8.8');
    try {
        const d = (await axios.get('http://ip-api.com/json/' + encodeURIComponent(q.trim()), HTTP)).data;
        if (d.status !== 'success') return reply('❌ Lookup failed for that address.');
        await reply(card(d.query, 'ip lookup', [kv('country', d.country), kv('region', d.regionName), kv('city', d.city), kv('isp', d.isp), kv('timezone', d.timezone)]));
    } catch (e) { await reply('⚠️ Lookup service unavailable right now.'); }
}});

// ---- MEDIA (fetch by direct link) ----
const isHttpUrl = (u) => /^https?:\/\/\S+$/i.test(u || '');
reg('getimg', { category: 'Media', desc: '.getimg [image url]', run: async ({ sock, from, msg, reply, q }) => {
    if (!isHttpUrl(q)) return reply('❌ Send a direct image link. Example: .getimg https://site.com/photo.jpg');
    try { await sock.sendMessage(from, { image: { url: q }, caption: `_${sc('delivered by')} ${sc(BOT_NAME)}_` }, { quoted: msg }); }
    catch (e) { await reply('❌ Could not fetch that image.'); }
}});
reg('getvid', { category: 'Media', desc: '.getvid [video url]', run: async ({ sock, from, msg, reply, q }) => {
    if (!isHttpUrl(q)) return reply('❌ Send a direct video link (.mp4). Example: .getvid https://site.com/clip.mp4');
    try { await sock.sendMessage(from, { video: { url: q }, caption: `_${sc('delivered by')} ${sc(BOT_NAME)}_` }, { quoted: msg }); }
    catch (e) { await reply('❌ Could not fetch that video.'); }
}});
reg('getaudio', { category: 'Media', desc: '.getaudio [audio url]', run: async ({ sock, from, msg, reply, q }) => {
    if (!isHttpUrl(q)) return reply('❌ Send a direct audio link (.mp3). Example: .getaudio https://site.com/song.mp3');
    try { await sock.sendMessage(from, { audio: { url: q }, mimetype: 'audio/mpeg' }, { quoted: msg }); }
    catch (e) { await reply('❌ Could not fetch that audio.'); }
}});
reg('getfile', { category: 'Media', desc: '.getfile [file url]', run: async ({ sock, from, msg, reply, q }) => {
    if (!isHttpUrl(q)) return reply('❌ Send a direct file link. Example: .getfile https://site.com/book.pdf');
    try {
        const name = decodeURIComponent((q.split('?')[0].split('/').pop() || 'file')).slice(0, 80) || 'file';
        await sock.sendMessage(from, { document: { url: q }, fileName: name, mimetype: 'application/octet-stream' }, { quoted: msg });
    } catch (e) { await reply('❌ Could not fetch that file.'); }
}});

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

// =========================================================================
// Main Bot Logic
// =========================================================================
function levenshtein(a, b) {
    const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return dp[a.length][b.length];
}
function closestCommand(word) {
    let best = null, bestD = 3;
    for (const name of Object.keys(commands)) {
        const d = levenshtein(word, name);
        if (d < bestD) { bestD = d; best = name; }
    }
    return best;
}
// Crash-proof wrapper: if starting a session throws for ANY reason (network
// blip, disk hiccup...) it retries instead of leaving that bot dead until
// the next redeploy.
async function startBotSession(sessionId) {
    try {
        return await _startBotSession(sessionId);
    } catch (err) {
        console.log(`❗ [${sessionId}] Start failed (${(err && err.message) || err}). Retrying in 10s.`);
        const s = sessions.get(sessionId);
        if (s) {
            s.isConnected = false;
            clearTimeout(s.reconnectTimer);
            s.reconnectTimer = setTimeout(() => { s.reconnectTimer = null; startBotSession(sessionId); }, 10000);
        }
    }
}
async function _startBotSession(sessionId) {
    let s = sessions.get(sessionId);
    if (!s) {
        s = {
            id: sessionId,
            sock: null, isConnected: false, currentQR: null,
            reconnectAttempts: 0, reconnectTimer: null, pairingInProgress: false,
            sessionDir: path.join(SESSION_ROOT, 'sessions', sessionId),
            autoStatus: { ...AUTO_STATUS_DEFAULT },
            soundOn: true, anticall: false, antidelete: false, adMode: 'inbox',
            createdAt: Date.now()
        };
        sessions.set(sessionId, s);
        // Restore this bot's saved autoStatus preference (and any admin-panel
        // customization) from Firestore, if it was paired before.
        fsGet('botConfig', sessionId, null).then((saved) => {
            if (saved && saved.autoStatus) Object.assign(s.autoStatus, saved.autoStatus);
            if (saved && saved.label) s.label = saved.label;
            if (saved && typeof saved.soundOn === 'boolean') s.soundOn = saved.soundOn;
            if (saved && typeof saved.anticall === 'boolean') s.anticall = saved.anticall;
            if (saved && typeof saved.antidelete === 'boolean') s.antidelete = saved.antidelete;
            if (saved && (saved.adMode === 'chat' || saved.adMode === 'inbox')) s.adMode = saved.adMode;
            if (saved && saved.userPassword) s.userPassword = saved.userPassword;
            if (saved && saved.ownerNumber) s.ownerNumber = saved.ownerNumber;
        });
    }
    s.currentQR = null;
    s.startedAt = Date.now();
    const { state, saveCreds } = await useMultiFileAuthState(s.sessionDir);
    let version;
    try { ({ version } = await fetchLatestBaileysVersion()); }
    catch (e) { console.log(`[${sessionId}] Could not fetch latest WA version, using library default.`); }
    // Make sure a previous socket for this session can't linger and fight us.
    if (s.sock) { try { s.sock.ev.removeAllListeners(); s.sock.end(undefined); } catch (e) { /* ignore */ } }

    const sock = makeWASocket(Object.assign(version ? { version } : {}, {
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
        shouldSyncHistoryMessage: () => false,
        generateHighQualityLinkPreview: false,
        markOnlineOnConnect: false,
        // Send keep-alive frames more frequently than the 30s default so we
        // detect a dead socket fast (and so Railway's network layer doesn't
        // treat the connection as idle and silently drop it while we wait
        // for the phone to submit the pairing code).
        keepAliveIntervalMs: 15000,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        retryRequestDelayMs: 500
    }));
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
                const result = await sock.sendMessage(job.jid, withAdCard(job.content), job.options);
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

    // ---- Command dispatcher ----
    // Shared by typed commands and by commands launched from the reply-menu.
    async function dispatch({ command, args, q, msg, from, sender, isGroup, body }) {
        const reply = (text, extra) => queueSend(from, buildOut(text, extra), { quoted: msg });
        const react = (emoji) => sock.sendMessage(from, { react: { text: emoji, key: msg.key } }).catch(() => {});
        const def = commands[command];
        const custom = customCommands.get(command);
        const builtinOff = !!def && disabledCmds.has(canonicalName(def));
        // Commands made in the admin panel (Command Studio). They also replace a
        // built-in command that has been switched off there.
        const useCustom = !!custom && custom.enabled !== false && (!def || builtinOff);
        if (builtinOff && !useCustom) return reply(card('Switched off', 'unavailable', [`*.${command}* is turned off right now.`], `↳ ${sc('please try again later')}`));
        if (!def && !useCustom) {
            // Typo help: suggest the closest real command.
            if (/^[a-z0-9]{3,}$/.test(command)) {
                const near = closestCommand(command);
                if (near) await reply(card('Not found', 'unknown command', [`I don't know *.${command}*.`, kv('did you mean', '.' + near)], `↳ ${sc('type')} *.menu* ${sc('to see everything')}`));
            }
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
        if (useCustom) {
            const acc = custom.access || 'all';
            if (acc === 'owner' && !isOwner(sender, s)) return reply('❌ Only the bot owner can use this command.');
            if (acc === 'group' && !isGroup) return reply('❌ This command only works inside groups.');
            if (acc === 'admin' && !(isGroup && isSenderAdmin) && !isOwner(sender, s)) return reply('❌ Only group admins can use this command.');
            await runCustomCommand(command, custom, { q, args, msg, from, sender, reply, react, session: s });
            return;
        }
        if (def.groupOnly && !isGroup) return reply('❌ This command only works inside groups.');
        if (def.adminOnly && !isSenderAdmin && !isOwner(sender, s)) return reply('❌ Only group admins can use this command.');
        if (def.superOnly && !isSuperOwner(sender)) return reply('❌ Only the platform owner can use this command.');
        if (def.ownerOnly && !isOwner(sender, s)) return reply('❌ Only the bot owner can use this command.');
        react('⏳');
        try {
            await def.run({ sock, msg, from, sender, args, q, isGroup, groupMetadata, isSenderAdmin, reply, session: s });
            react('✅');
        } catch (err) {
            console.log(`Command .${command} failed:`, (err && err.message) || err);
            react('❌');
            await reply(card('Oops', 'something went wrong', [`*.${command}* hit a problem and did not finish.`], `↳ ${sc('please try again in a moment')}`)).catch(() => {});
        }
    }
    s.dispatch = dispatch;

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
            s.offlineSince = s.offlineSince || Date.now();
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
                s.createdAt = Date.now(); // restart the 20-min pairing window
                s.ownerNumber = null; s.userPassword = null;
                dropBackup(sessionId);
                fs.rm(s.sessionDir, { recursive: true, force: true }, () => startBotSession(sessionId));
                return;
            }

            if (statusCode === DisconnectReason.badSession) {
                console.log(`⚠️ [${sessionId}] Bad session file. Clearing session and restarting.`);
                s.reconnectAttempts = 0;
                dropBackup(sessionId);
                fs.rm(s.sessionDir, { recursive: true, force: true }, () => startBotSession(sessionId));
                return;
            }

            if (statusCode === DisconnectReason.connectionReplaced) {
                // Another session (e.g. WhatsApp opened elsewhere with same
                // creds) took over. Don't hammer reconnects in this case.
                console.log(`⚠️ [${sessionId}] Connection replaced by another session. Will retry in 10 minutes.`);
                s.replacedAt = Date.now();
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
            s.reconnectTimer = setTimeout(() => { s.reconnectTimer = null; startBotSession(sessionId); }, delay);
        } else if (connection === 'open') {
            s.isConnected = true;
            s.offlineSince = 0;
            scheduleBackup(sessionId, 8000);
            if (sock.user && sock.user.id) s.ownerNumber = sock.user.id.split(':')[0].replace(/[^0-9]/g, '');
            s.replacedAt = 0;
            s.lastActivity = Date.now();
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
                const settingsMsg = card('Connected', 'bot is live', [
                    `Your ${BOT_NAME} is now running on this number.\n`,
                    kv('number', s.ownerNumber),
                    kv('password', s.userPassword)
                ], `${B('SETTINGS PAGE')}  ${THIN}\nOpen */settings* on the same website you paired from and sign in with the number and password above.\n\n↳ ${sc('type')} *.menu* ${sc('to start')}`);
                // Small delay so this doesn't land before WhatsApp has fully
                // settled the new connection.
                setTimeout(() => {
                    sock.sendMessage(selfJid, { text: settingsMsg }).catch((e) => console.log(`[${sessionId}] Failed to send settings-login message:`, e.message));
                }, 2500);
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('creds.update', () => scheduleBackup(sessionId, 30000));

    // Anti-call: politely reject incoming calls when enabled (.anticall on)
    sock.ev.on('call', async (calls) => {
        if (!s.anticall) return;
        for (const c of calls) {
            if (c.status !== 'offer') continue;
            try {
                await sock.rejectCall(c.id, c.from);
                await queueSend(c.from, { text: card('Auto reply', 'calls are off', ['I cannot take calls here. Please send a text message instead.']) });
            } catch (e) { console.log('Anti-call failed:', e.message); }
        }
    });

    // Welcome cards (enabled per group with .welcome on)
    sock.ev.on('group-participants.update', async (ev) => {
        try {
            if (ev.action !== 'add') return;
            const gs = getGroupSettings(ev.id);
            if (!gs.welcome) return;
            const meta = await sock.groupMetadata(ev.id);
            for (const jid of ev.participants) {
                const id = typeof jid === 'string' ? jid : jid.id;
                const text = `${head('Welcome', meta.subject.slice(0, 24))}\n` +
                    `@${id.split('@')[0]}, you are now part of *${meta.subject}*.\n\n` +
                    `${kv('members', meta.participants.length)}\n` +
                    (gs.rules ? `\n${B('RULES')}  ${THIN}\n${gs.rules}\n` : '') +
                    `\n↳ ${sc('type')} *.menu* ${sc('to see what I can do')}\n\n${FOOTER()}`;
                await queueSend(ev.id, { text, mentions: [id] });
            }
        } catch (e) { /* ignore */ }
    });

    sock.ev.on('messages.upsert', async (m) => {
        s.lastActivity = Date.now();
        for (const mm of m.messages) antiDeleteHook(s, sock, mm).catch((e) => console.log('antidelete:', e.message));
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
            // The owner's own phone: only real typed commands (type 'notify'); the
            // bot's own sends arrive as 'append' and are ignored, so no loops.
            if (msg.key.fromMe && m.type !== 'notify') return;

            const messageType = Object.keys(msg.message)[0];
            const body = messageType === 'conversation' ? msg.message.conversation :
                         messageType === 'extendedTextMessage' ? msg.message.extendedTextMessage.text : '';
            if (!body) return;

            const args = body.trim().split(/ +/);
            const rawCommand = args[0].toLowerCase();
            const isCommandMsg = rawCommand.startsWith('.') || rawCommand.startsWith('/');
            if (msg.key.fromMe && !isCommandMsg) return;
            const from = msg.key.remoteJid;
            const sender = msg.key.fromMe ? (sock.user.id.split(':')[0] + '@s.whatsapp.net') : (msg.key.participant || msg.key.remoteJid);
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

            // Antilink: applies to every group message, not only commands.
            if (isGroup && getGroupSettings(from).antilink && /chat\.whatsapp\.com\//i.test(body)) {
                try {
                    const gm = await sock.groupMetadata(from);
                    const me = gm.participants.find(p => p.id === sender);
                    const isAdm = !!(me && me.admin) || isOwner(sender, s);
                    if (!isAdm) {
                        await sock.sendMessage(from, { delete: msg.key });
                        await queueSend(from, buildOut(`⚠️ Group invite links are not allowed here, @${sender.split('@')[0]}.`), { quoted: msg });
                        return;
                    }
                } catch (e) { /* bot may not be admin */ }
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
            if (!isCommandMsg && await handleMenuNumberReply({ session: s, msg, from, body, sender, isGroup })) return;

            if (!isCommandMsg) {
                // Not a command — let the Nimah AI agent decide whether to
                // jump in (always in a DM, only when addressed in a group).
                await maybeHandleNimahAgent({ sock, msg, from, sender, isGroup, body, session: s });
                return;
            }
            args.shift();
            const command = rawCommand.slice(1);
            const q = args.join(' ');

            // Anti-flood: ignore a command from the same person if they
            // fired one less than 900ms ago (keeps outgoing traffic human-like).
            const nowTs = Date.now();
            const lastCmdTs = lastCommandAt.get(sender) || 0;
            if (nowTs - lastCmdTs < 900) return;
            lastCommandAt.set(sender, nowTs);

            await dispatch({ command, args, q, msg, from, sender, isGroup, body });
        } catch (err) {
            console.log('Error handling command:', err);
        }
    });

    return sock;
}

// Resume any sessions that already have saved credentials on disk (e.g. a
// bot that was paired before a Railway redeploy, on a mounted volume).
async function resumeSavedSessions() {
    const sessionsRoot = path.join(SESSION_ROOT, 'sessions');
    try {
        await restoreSessionBackups(sessionsRoot);
        if (!fs.existsSync(sessionsRoot)) return;
        // Staggered: starting dozens of sockets in the same instant spikes CPU/RAM
        // and makes WhatsApp rate-limit the logins. One bot every ~1.5s instead.
        const ids = fs.readdirSync(sessionsRoot);
        for (const id of ids.slice()) { // drop leftovers of pairing attempts that never finished
            if (!fs.existsSync(path.join(sessionsRoot, id, 'creds.json'))) { fs.rmSync(path.join(sessionsRoot, id), { recursive: true, force: true }); ids.splice(ids.indexOf(id), 1); }
        }
        ids.forEach((id, i) => setTimeout(() => {
            startBotSession(id).catch((err) => console.log(`Failed to resume session ${id}:`, err));
        }, i * 1500));
        if (ids.length) console.log(`♻️ Resuming ${ids.length} saved bot(s), one every 1.5s.`);
    } catch (e) { /* ignore */ }
}

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Web Server running on port ${PORT}`);
    console.log(`⚡ Loaded ${new Set(Object.values(commands)).size} commands.`);
    resumeSavedSessions();
    loadCustomCommands();
    loadBrand();
});

process.on('unhandledRejection', (err) => console.log('Unhandled Rejection:', err));
// Never let one bad error take the whole server (and every paired bot) down.
process.on('uncaughtException', (err) => console.log('Uncaught Exception:', err));

// ---- 24/7 keep-alive suite ----
// 1) Watchdog: restarts a PAIRED session that has been offline for 3+ minutes
//    with nothing scheduled. It never touches a session that is still waiting
//    for the user to enter a pairing code (restarting it would destroy the code).
setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions.entries()) {
        if (s.isConnected || s.reconnectTimer || !s.sock) continue;
        const registered = !!(s.sock.authState && s.sock.authState.creds && s.sock.authState.creds.registered);
        if (!registered) continue;
        if (s.replacedAt && now - s.replacedAt < 10 * 60 * 1000) continue;
        if (now - (s.startedAt || 0) < 3 * 60 * 1000) continue;
        if (now - (s.offlineSince || s.startedAt || now) < 3 * 60 * 1000) continue;
        console.log(`🩺 [${id}] Watchdog: paired session stuck offline for 3+ min, restarting it.`);
        startBotSession(id).catch((err) => console.log(`Watchdog restart failed for ${id}:`, err));
    }
}, 60000);

// 2) Socket check: if a session says it is connected but its websocket is
//    actually closed, end it so the normal reconnect logic takes over. (Does not
//    send any presence/messages, so it can never disturb the live connection.)
setInterval(() => {
    for (const [id, s] of sessions.entries()) {
        if (!s.isConnected || !s.sock || !s.sock.ws) continue;
        if (s.sock.ws.isOpen === false) {
            console.log(`🩺 [${id}] Socket was closed while marked connected. Forcing reconnect.`);
            try { s.sock.end(new Error('watchdog reconnect')); } catch (e2) { /* ignore */ }
        }
    }
}, 2 * 60 * 1000);

// 3) Self-ping: keeps hosts that sleep idle web services awake.
//    Uses SELF_URL, or Railway / Render public domains when available.
const SELF_URL = process.env.SELF_URL
    || (process.env.RAILWAY_PUBLIC_DOMAIN ? 'https://' + process.env.RAILWAY_PUBLIC_DOMAIN : '')
    || process.env.RENDER_EXTERNAL_URL || '';
if (SELF_URL) {
    setInterval(() => { axios.get(SELF_URL.replace(/\/$/, '') + '/ping', { timeout: 15000 }).catch(() => {}); }, 4 * 60 * 1000);
    console.log('🔔 Self-ping enabled for', SELF_URL);
}

// 4) Memory guard: if the process bloats past the limit, exit cleanly so the
//    host (Railway restartPolicy ALWAYS) starts a fresh one in seconds.
const MAX_RSS_MB = parseInt(process.env.MAX_RSS_MB || String(Math.round(memLimitMb() * 0.92)), 10);
setInterval(() => {
    const mb = process.memoryUsage().rss / 1048576;
    if (mb > MAX_RSS_MB) { console.log(`♻️ Memory ${Math.round(mb)} MB > ${MAX_RSS_MB} MB. Restarting for a clean slate.`); process.exit(1); }
}, 2 * 60 * 1000);

// Clean shutdown on host stop/redeploy.
['SIGTERM', 'SIGINT'].forEach((sig) => process.on(sig, () => { console.log(`Received ${sig}, shutting down.`); process.exit(0); }));
