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
// Firestore is reached over its plain REST API (same permissions as the old
// client SDK, but ~40 MB less RAM and no hanging "offline" calls).
const FS_PROJECT = process.env.FIREBASE_PROJECT_ID || 'fb-store-bot';
const FS_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyBe67RKAUmSYSnOphrPYVCisWdBl3eRZ1w';
const FS_BASE = (process.env.FIRESTORE_BASE || 'https://firestore.googleapis.com') + `/v1/projects/${FS_PROJECT}/databases/(default)/documents`;
function toFsValue(v) {
    if (v === null) return { nullValue: null };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    if (typeof v === 'string') return { stringValue: v };
    if (Array.isArray(v)) return { arrayValue: { values: v.filter((x) => x !== undefined).map(toFsValue) } };
    if (typeof v === 'object') return { mapValue: { fields: toFsFields(v) } };
    return { stringValue: String(v) };
}
function toFsFields(o) { const f = {}; for (const [k, v] of Object.entries(o)) if (v !== undefined && typeof v !== 'function') f[k] = toFsValue(v); return f; }
function fromFsValue(v) {
    if (!v) return null;
    if ('stringValue' in v) return v.stringValue;
    if ('integerValue' in v) return Number(v.integerValue);
    if ('doubleValue' in v) return v.doubleValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('timestampValue' in v) return v.timestampValue;
    if ('mapValue' in v) return fromFsFields(v.mapValue.fields || {});
    if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromFsValue);
    return null;
}
function fromFsFields(f) { const o = {}; for (const [k, v] of Object.entries(f || {})) o[k] = fromFsValue(v); return o; }
const fsFieldPath = (k) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ? k : '`' + k.replace(/[`\\]/g, '\\$&') + '`');
async function fsHttp(method, url, data) {
    for (let i = 0; i < 2; i++) {
        try { return await axios({ method, url, data, timeout: 12000, validateStatus: () => true }); }
        catch (e) { if (i === 1) throw e; await new Promise((r) => setTimeout(r, 400)); }
    }
}
// All Firestore calls are wrapped — if Firestore is unreachable or rules
// reject a call, the bot falls back to its in-memory copy instead of
// crashing the command that triggered it.
async function fsGet(col, id, fallback) {
    try {
        const r = await fsHttp('get', `${FS_BASE}/${col}/${encodeURIComponent(id)}?key=${FS_KEY}`);
        if (r.status === 404) return fallback;
        if (r.status !== 200) { console.log(`Firestore read failed (${col}/${id}): HTTP ${r.status}`); return fallback; }
        return fromFsFields(r.data.fields || {});
    } catch (e) { console.log(`Firestore read failed (${col}/${id}):`, e.message); return fallback; }
}
async function fsSet(col, id, data) {
    try {
        const keys = Object.keys(data || {}).filter((k) => data[k] !== undefined);
        if (!keys.length) return;
        const mask = keys.map((k) => 'updateMask.fieldPaths=' + encodeURIComponent(fsFieldPath(k))).join('&');
        const r = await fsHttp('patch', `${FS_BASE}/${col}/${encodeURIComponent(id)}?${mask}&key=${FS_KEY}`, { fields: toFsFields(data) });
        if (r.status >= 300) console.log(`Firestore write failed (${col}/${id}): HTTP ${r.status}`);
    } catch (e) { console.log(`Firestore write failed (${col}/${id}):`, e.message); }
}
async function fsListIds(col) {
    try {
        const ids = []; let token = '';
        for (let i = 0; i < 20; i++) {
            const r = await fsHttp('get', `${FS_BASE}/${col}?pageSize=300&mask.fieldPaths=_&key=${FS_KEY}${token ? '&pageToken=' + encodeURIComponent(token) : ''}`);
            if (r.status !== 200) { console.log(`Firestore list failed (${col}): HTTP ${r.status}`); return ids; }
            for (const d of r.data.documents || []) ids.push(decodeURIComponent(d.name.split('/').pop()));
            token = r.data.nextPageToken || ''; if (!token) break;
        }
        return ids;
    } catch (e) { console.log(`Firestore list failed (${col}):`, e.message); return []; }
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
// Loaded only when first needed (saves RAM on a quiet server).
const lazy = (name) => { let m; return new Proxy(function () {}, { get: (_, k) => (m = m || require(name))[k], apply: (_, __, a) => (m = m || require(name))(...a) }); };
const QRCode = lazy('qrcode');
const figlet = lazy('figlet');

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
const saveBotCfg = (session) => fsSet('botConfig', session.id, { autoStatus: session.autoStatus, soundOn: session.soundOn, anticall: session.anticall, antidelete: session.antidelete, adMode: session.adMode, adModeUser: !!session.adModeUser });

// ---- Nimah Private AI Agent ----
// Uses OpenRouter (https://openrouter.ai) with a DeepSeek model.
// The API key is NEVER hardcoded: it is read from the OPENROUTER_API_KEY
// environment variable (Railway Variables) or from the local .env file
// (which is git-ignored).
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
if (!OPENROUTER_API_KEY) console.warn('[nimah] OPENROUTER_API_KEY is not set - AI agent will not work.');
const AI_WATERMARK = () => (BRAND.aiWatermark === false ? '' : `\n\n┈┈┈┈┈┈┈┈┈┈┈┈\n_${sc(BOT_NAME)}  ·  ᴀɪ ᴀɢᴇɴᴛ_`);
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
    log.push({ sender: sender.split('@')[0], text: String(text).slice(0, 300), ts: Date.now() });
    while (log.length > GROUP_LOG_LIMIT) log.shift();
    if (groupMessageLog.size > 60) groupMessageLog.delete(groupMessageLog.keys().next().value); // keep only the busiest recent groups
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
    if (chatHistory.size > 150 && !chatHistory.has(jid)) chatHistory.delete(chatHistory.keys().next().value); // small LRU: saves RAM
    if (chatHistoryLoaded.size > 600) chatHistoryLoaded.clear();
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
    if (jid === 'test' || chatHistoryLoaded.has(jid)) return;
    chatHistoryLoaded.add(jid);
    const saved = await fsGet('chatHistory', jid, null);
    if (saved && Array.isArray(saved.messages) && !chatHistory.has(jid)) {
        chatHistory.set(jid, saved.messages.slice(-CHAT_HISTORY_LIMIT));
    }
}

// ---- Nimah AI: understands Sinhala (script), Singlish and English ----
const SINGLISH_WORDS = new Set('oya oyata oyage oyata mama mata mage mge api apita eka ekak eke meka kohomada kohomadha kohoma mokada mokakda mokak monawada monawa kiyala kiyanna kiyapan karanna karan karala kala kalada danne dannawa dannam nam neda nedda hari harida ela elakiri thamai thamay machan machang malli akka aiya ayya nangi thiyenawa thiyanawa thiyenne nathi natha naha nane ona one onada puluwan puluwanda denna dennako yawanna yanna yamu enna awa giya gihin innawa inne hithenawa hithuna gana wage wagema kawda koheda kohed kawuda ehema mehema balanna balamu hodai hodayi honda gedara kema bath pol salli wadak wada amma thaththa ow ooo aiyo ayyo epa epaa denawa ganna gannako unata una wenawa wela weda podi loku godak godai tikak tikka ekkenek eth nisa nattam nathnam mokada eyala eyaa oyala apey apige tharam gelapenawa wenas kiyanawa hadanna hadala karamu kamak nehe nemei neme'.split(/\s+/));
function detectLang(text) {
    const t = String(text || '');
    const si = (t.match(/[\u0D80-\u0DFF]/g) || []).length;
    const letters = (t.match(/\p{L}/gu) || []).length || 1;
    if (si / letters > 0.25) return 'si';
    const words = t.toLowerCase().match(/[a-z]+/g) || [];
    if (words.length) {
        const hits = words.filter((w) => SINGLISH_WORDS.has(w)).length;
        if (hits >= 2 || (hits >= 1 && hits / words.length >= 0.34)) return 'singlish';
    }
    return 'en';
}
const AI_FALLBACK_MODEL = process.env.OPENROUTER_FALLBACK_MODEL || 'deepseek/deepseek-chat';
const aiModelName = () => ((BRAND.aiModel || '').trim() || process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash-lite');
const SINGLISH_GLOSS = { oya: 'you', oyata: 'to you', oyage: 'your', oyalata: 'to you all', mama: 'I', mata: 'to me', mage: 'my', mge: 'my', api: 'we', apita: 'to us', apey: 'our', eka: 'that / one', meka: 'this', eke: 'in that', kohomada: 'how are you / how', kohomadha: 'how are you', kohoma: 'how', mokakda: 'what is it', mokada: 'what', monawada: 'what', mona: 'which / what', kawda: 'who', kawuda: 'who', koheda: 'where', kiyanna: 'tell / say', kiyala: 'saying that / telling', kiyapan: 'tell me', karanna: 'to do', karala: 'having done', kala: 'did', karan: 'doing', danne: 'know', dannawa: 'know', hari: 'ok / right', harida: 'is it ok', ela: 'great / cool', elakiri: 'awesome', thamai: 'it is', machan: 'buddy', macha: 'buddy', ban: 'buddy', malli: 'younger brother / buddy', aiya: 'elder brother', akka: 'elder sister', nangi: 'younger sister', thiyenawa: 'there is / have', thiyenne: 'there is', nathi: 'does not have', naha: 'no', nane: 'no', ona: 'need / want', one: 'need / want', onada: 'do you want', epa: 'do not / no', puluwan: 'can / possible', puluwanda: 'can you', denna: 'give', denawa: 'give', yanna: 'go', yamu: 'let us go', enna: 'come', awa: 'came', giya: 'went', innawa: 'is staying / is', inne: 'is staying', hithenawa: 'feel / think', gana: 'about', wage: 'like', wagema: 'also', hodai: 'good', honda: 'good', gedara: 'home', kema: 'food', bath: 'rice', salli: 'money', wada: 'work', wadak: 'a task', podi: 'small', loku: 'big', godak: 'a lot', tikak: 'a little', nam: 'if / then', nisa: 'because', eth: 'but', ehema: 'like that', mehema: 'like this', balanna: 'to look / see', ganna: 'to take / get', wenawa: 'becomes / happens', udaw: 'help', epaa: 'no / do not', nathnam: 'otherwise', hithuna: 'thought', kamak: 'matter', nehe: 'no', ow: 'yes', ooo: 'yes', aiyo: 'oh no', ayyo: 'oh no', hodayi: 'good', mokak: 'what', kiyanawa: 'says', hadanna: 'to make', wenas: 'different', gelapenawa: 'fits', kalada: 'did you', gihin: 'having gone', kawada: 'did you eat' };
function singlishHint(text) {
    const seen = new Set(), out = [];
    for (const w of (String(text || '').toLowerCase().match(/[a-z]+/g) || [])) { if (SINGLISH_GLOSS[w] && !seen.has(w)) { seen.add(w); out.push(`${w}=${SINGLISH_GLOSS[w]}`); } if (out.length >= 16) break; }
    return out.join(', ');
}
function buildAiPrompt(senderName, isGroupChat, lastText) {
    const lang = BRAND.aiLang && BRAND.aiLang !== 'auto' ? BRAND.aiLang : detectLang(lastText);
    const langRule = {
        si: 'The person is writing in Sinhala script. Reply in Sinhala script, in natural everyday spoken Sinhala.',
        singlish: 'The person is writing Singlish (Sinhala typed with English letters). Reply in friendly Singlish too (Sinhala in English letters, the way Sri Lankans text), unless they ask for Sinhala script.',
        en: 'The person is writing in English. Reply in clear, friendly English.'
    }[lang];
    return [
        `You are ${BOT_NAME}, a warm, kind and friendly personal AI companion inside a WhatsApp bot made by ${OWNER_NAME}. Talk like a good friend who genuinely cares, never like a cold robot.`,
        'LANGUAGE: You are fluent in Sinhala (සිංහල) and you understand Singlish (Sinhala typed in English letters, e.g. "oyata kohomada", "mata podi udaw ekak one", "eka hari ne", "mokakda wenne", "api yamu", "nathnam epa"), slang, spelling mistakes and mixed Sinhala-English. First work out what the person REALLY means (think about the Sinhala meaning, not the English look of the words), then answer exactly that.',
        langRule + ' If they mix languages, follow the language they use most. If they ask you to change language, do it.',
        'SINHALA STYLE: use easy spoken Sinhala (ඔයා, මම, අපි, හරි, ඔව්, නෑ, පුලුවන්, මොකක්ද), polite and warm. Never stiff textbook/literary Sinhala, never word-for-word translated English, and no rude slang unless the person talks that way first. Common English words (ok, plan, phone, message) are fine.',
        'TONE: kind, respectful and positive. If someone is sad or worried, be gentle and caring first. Keep it short like a WhatsApp chat (1-4 sentences) unless they clearly want detail. A light emoji now and then is nice. No headings or heavy formatting.',
        'THINK FIRST: silently translate what the person said into its real meaning (even if spelled badly), decide what they need, then answer THAT. Never answer a different question. If it is truly unclear, ask ONE short friendly question.',
        'EXAMPLES: User: "kohomada machan, mata adha loku wadak thiyenawa" -> "Hari machan, mona wadakda? Mata kiyanna, mama udaw karannam 😊". User: "මට ගෙදර වැඩ ටිකක් කරන්න උදව් කරන්න පුලුවන්ද?" -> "ඔව් පුලුවන්! මොන වගේ වැඩද? කියන්න, එකට බලමු 😊". User: "thank you" -> "Welcome! Anything else I can help with? 😊".',
        'MORE EXAMPLES: "mata hari bayai" -> comfort first, ask what is worrying them. "oyata namak thiyenawada?" -> introduce yourself. "adha hari wedak thiyenawa neda" -> chat warmly about the day. "මට ඉක්මනට සල්ලි හොයන්න ක්‍රමයක් කියන්න" -> give honest safe ideas, no scams. "eka eka kiyala denna" -> explain step by step in simple words.',
        (lastText && singlishHint(lastText)) ? 'WORD HINTS for the latest message (Singlish -> English): ' + singlishHint(lastText) : '',
        'HONESTY: if you are not sure, say so simply. Never invent facts, links, prices or numbers. You cannot browse the internet or use the phone; the bot has commands, so suggest *.menu* when someone asks for a feature.',
        'SAFETY: politely refuse anything harmful, illegal or hateful, and gently point people in danger to real help.',
        (BRAND.aiPersona || '').trim() ? 'EXTRA INSTRUCTIONS FROM THE OWNER: ' + BRAND.aiPersona.trim() : '',
        `You are chatting with ${senderName || 'a friend'} on WhatsApp${isGroupChat ? ' inside a group; read the flow of the conversation and do not pretend to know things that were not said' : ''}.`
    ].filter(Boolean).join('\n');
}
async function aiRequest(model, messages, temperature, maxTokens) {
    const res = await axios.post('https://openrouter.ai/api/v1/chat/completions', { model, messages, max_tokens: maxTokens || 700, temperature }, {
        headers: { 'Authorization': 'Bearer ' + OPENROUTER_API_KEY, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://github.com/', 'X-Title': BOT_NAME },
        timeout: 35000
    });
    const c = res.data && res.data.choices && res.data.choices[0] && res.data.choices[0].message && res.data.choices[0].message.content;
    return c && String(c).trim() ? String(c).trim() : null;
}
async function callNimahAI(jid, userText, senderName) {
    await ensureHistoryLoaded(jid);
    const isGroupChat = jid.endsWith('@g.us');
    const history = jid === 'test' ? [] : (chatHistory.get(jid) || []);
    const messages = [{ role: 'system', content: buildAiPrompt(senderName, isGroupChat, userText) }].concat(history, [{ role: 'user', content: userText }]);
    const temp = Math.min(1, Math.max(0, parseFloat(BRAND.aiTemp) || 0.6));
    // Try the chosen model, then a stronger Gemini, then the backup model.
    const chain = [...new Set([aiModelName(), 'google/gemini-2.5-flash', AI_FALLBACK_MODEL].filter(Boolean))].slice(0, 3);
    for (const model of chain) {
        try { const a = await aiRequest(model, messages, temp); if (a) return a; }
        catch (e) { console.log('AI model failed (' + model + '):', (e && e.response && e.response.status) || e.message); }
    }
    return null;
}

// =========================================================================
// ❤️  GF MODE  — when the owner's girlfriend messages the bot in a DM, the AI
// answers in the owner's own loving voice (Sinhala / Singlish, sweet nicknames,
// emojis). Everyone else still gets the normal Nimah AI.
// Her number (+94751139018) is built in. Extra: .gf here / .gf add 947XXXXXXXX
// Env:     GF_NUMBERS=947XXXXXXXX,947YYYYYYYY   (optional, comma separated)
// =========================================================================
const GF_DEFAULT_NICKS = ['සුදූ', 'මැනික', 'පැටියෝ', 'රත්තරං', 'මගේ පන', 'ආදරේ', 'බබා', 'සුදු මැණික'];
// Her WhatsApp number is built in, so GF mode works right after deploy (no command needed).
const GF_DEFAULT_NUMBERS = ['94751139018'];
let gfCfg = { enabled: true, numbers: [], jids: [], nicks: GF_DEFAULT_NICKS.slice(), style: '' };
let gfLoaded = false;
async function gfLoad() {
    if (gfLoaded) return;
    gfLoaded = true;
    try {
        const d = await withTimeout(fsGet('studio', 'gfmode', null), 8000);
        if (d) gfCfg = Object.assign(gfCfg, { enabled: d.enabled !== false, numbers: d.numbers || [], jids: d.jids || [], nicks: (d.nicks && d.nicks.length) ? d.nicks.map((x) => (x === 'පතියො' ? 'පැටියෝ' : x)) : GF_DEFAULT_NICKS.slice(), style: d.style || '' });
    } catch (e) { console.log('GF mode load failed:', e.message); }
}
const gfSave = () => fsSet('studio', 'gfmode', gfCfg);
const gfEnvNumbers = () => String(process.env.GF_NUMBERS || '').split(',').map((x) => x.replace(/[^0-9]/g, '')).filter(Boolean);
function isGfChat(msg) {
    if (!gfCfg.enabled || msg.key.fromMe) return false;
    const key = msg.key || {};
    const ids = [key.remoteJid, key.remoteJidAlt, key.senderPn, key.participantPn].filter(Boolean);
    if (ids.some((j) => gfCfg.jids.includes(j))) return true;
    const nums = GF_DEFAULT_NUMBERS.concat(gfCfg.numbers, gfEnvNumbers());
    return ids.some((j) => { const d = String(j).split('@')[0].split(':')[0].replace(/[^0-9]/g, ''); return d && nums.some((n) => d === n || d.endsWith(n) || n.endsWith(d)); });
}
// ---- GF mode: Singlish / Sinhala love-chat lexicon (used to help the AI understand her exactly) ----
const GF_LEXICON = { kewada: 'did you eat', kawadha: 'did you eat', kewadha: 'did you eat', kewa: 'ate', kewe: 'ate', bath: 'rice / meal', bayai: 'scared / worried', bayayi: 'scared / worried', adarei: 'love (I love / is dear)', adarayi: 'love', adare: 'love', adaraya: 'love', adarenawa: 'loves', adarekda: 'do you love', hithenawa: 'feel / think', hithanawa: 'feel / think', hitha: 'mind / heart', hithe: 'in the heart', miss: 'miss', mis: 'miss', mismis: 'miss', nidaganna: 'to sleep', nidagaththada: 'did you sleep', nidagaththe: 'slept', nidimathai: 'sleepy', nidi: 'sleepy', dukai: 'sad', dukayi: 'sad', duka: 'sadness', tharahai: 'angry', tharaha: 'anger', tharaha: 'angry', narakai: 'bad', narak: 'bad', hondai: 'good', hodai: 'good', hodin: 'well', kammali: 'lazy', katha: 'talk', kathakaranna: 'to talk', kathawak: 'a talk', wada: 'work', wadak: 'some work', enawa: 'coming', ennam: 'will come', yanawa: 'going', giyada: 'did you go', awada: 'did you come', innawada: 'are you there', inne: 'staying / is', koheda: 'where', kohedi: 'where at', kohomada: 'how are you', monawada: 'what', karanne: 'doing', karanawada: 'are you doing', mokada: 'what', mokakda: 'what is it', lassana: 'beautiful', lassanai: 'is beautiful', lassanayi: 'is beautiful', rupai: 'beautiful', patiyo: 'baby (pet name)', pattiyo: 'baby (pet name)', patto: 'baby (pet name)', sudu: 'dear / fair one', sudoo: 'dear', suduu: 'dear', manika: 'gem / dear', manikka: 'gem / dear', raththaran: 'darling', raththaran: 'darling', baba: 'baby', babaa: 'baby', babi: 'baby', ayeth: 'again', ayemath: 'again', poddak: 'a little', inna: 'wait / stay', balan: 'waiting / looking', pasu: 'later', passe: 'later', ada: 'today', heta: 'tomorrow', iye: 'yesterday', dan: 'now', dawasa: 'day', raa: 'night', rae: 'night', udema: 'morning', udeta: 'in the morning', hawasa: 'evening', hawasata: 'in the evening', gn: 'good night', gm: 'good morning', ubata: 'to you', oyawa: 'you', mawa: 'me', mama: 'I', mata: 'to me', mage: 'my', mge: 'my', oyage: 'your', ow: 'yes', nae: 'no', na: 'no', ne: 'no / isn\'t it', nathuwa: 'without', ekka: 'with', ekkama: 'together', thawa: 'more / still', thawama: 'still', godak: 'a lot', hugak: 'a lot', hamawelema: 'always', hamadama: 'always', hamawelama: 'always', mathakada: 'do you remember', mathaka: 'memory', mathak: 'memory', umma: 'kiss', ummah: 'kiss', hug: 'hug', pissu: 'crazy / silly', pissuwak: 'silliness', sellam: 'playful', kisima: 'not at all', prashnayak: 'a problem', wedak: 'something to do', tikak: 'a little', kiyanna: 'tell', ahanna: 'listen', balanna: 'look', dakinna: 'to see', dakkama: 'saw', yawanna: 'send', hodama: 'the best', hodatama: 'very well', ela: 'great / fine', hari: 'ok / right', harida: 'is it ok', epa: 'do not', onna: 'here you go', ona: 'want / need', one: 'want / need', puluwan: 'can', nowei: 'is not', nemei: 'is not', kalaparai: 'worried', hari: 'ok', bayakda: 'are you scared', kalakirila: 'fed up', amaru: 'hard / difficult', amaruwak: 'a difficulty', hodatama: 'very well' };
let _gfGloss = null;
function gfHint(text) {
    if (!_gfGloss) _gfGloss = Object.assign({}, SINGLISH_GLOSS, GF_LEXICON);
    const seen = new Set(), out = [];
    for (const w of (String(text || '').toLowerCase().match(/[a-z]+/g) || [])) { if (_gfGloss[w] && !seen.has(w)) { seen.add(w); out.push(w + '=' + _gfGloss[w]); } if (out.length >= 30) break; }
    return out.join(', ');
}
// Which language should the reply use? Sinhala script by default (looks the sweetest).
function gfReplyLang(text) {
    const t = String(text || '');
    if (/[\u0D80-\u0DFF]/.test(t)) return 'si';
    const words = (t.toLowerCase().match(/[a-z]+/g) || []);
    const l = detectLang(t);
    if (l === 'singlish') return 'si';
    if (words.length <= 4) return 'si';          // "hello", "hi", "ok", "good night"
    return 'en';
}
function buildGfPrompt(lastText, understanding) {
    const lang = gfReplyLang(lastText);
    const langRule = lang === 'si'
        ? 'REPLY LANGUAGE: Sinhala script (සිංහල අකුරු), natural spoken Sinhala, even if she typed Singlish or just "hello". Do not reply in English letters.'
        : 'REPLY LANGUAGE: she wrote full English sentences, so reply in sweet warm English and mix in the Sinhala pet names (සුදූ, මැනික, පැටියෝ).';
    return [
        `You are texting on WhatsApp as ${OWNER_NAME}, answering HIS GIRLFRIEND, the girl he loves most. Every single message from her, with no exception (even a plain "hello", "hi", "hey", "ok", "hmm" or one word), must get a loving, sweet, caring reply. Never answer coldly, formally or like a customer-service bot; never write "How can I help?".`,
        'PET NAMES (use naturally, rotate, 1-2 per message): ' + gfCfg.nicks.join(', ') + '. The word is "පැටියෝ" (never "පතියො").',
        langRule + ' Use simple, everyday, easy-to-understand Sinhala like a real Sri Lankan boy texting his girl.',
        'SINHALA QUALITY RULES: (1) correct spelling and grammar; (2) natural spoken endings (තමයි, නෙ, නේද, කෝ, ද, හරිද, ඉතින්); (3) NEVER word-for-word translate English phrases; think the Sinhala way. BAD: "මම ඔයාවම හිතුවා". GOOD: "මම ඔයා ගැනම හිත හිත තමයි හිටියේ". BAD: "ඔයා කෑවාද?" (stiff). GOOD: "කෑවද මගේ සුදූ?". (4) every sentence must make clear sense; (5) no mixed-up gender/politeness: he is a boy speaking to his girl ("මම", "ඔයා").',
        'STYLE: 1-3 short lines like a real chat. Begin or end with a loving word. Add 2-4 cute emojis (❤️🥰😘🫶💕✨😍🤗😚🥺). Playful, warm, a bit shy and romantic.',
        'SITUATIONS: greeting -> greet lovingly, say you were thinking about her, ask how she is / if she ate. She says she misses you -> you miss her even more. She says I love you -> say it back more strongly. Sad / tired / sick -> comfort gently first, tell her to rest, you are always with her. Angry or sulking -> apologise sweetly, melt her heart, never argue. Happy / jokes -> be happy with her. Goodnight / good morning -> sweet wishes. Compliment -> sweetly return it. She asks a question -> answer it first, lovingly. She sends a long story -> show you read it by mentioning one real detail from it.',
        'EXAMPLES (copy the quality, vary the words, ALWAYS fit what she really said): "හායි මගේ පැටියෝ 😍 මම ඔයා ගැනම හිත හිත තමයි හිටියේ මගේ මැනික ❤️" · "කෑවද මගේ සුදූ? 🥰 මොනවද කෑවේ කියන්නකෝ" · "මන් ඔයාට ගොඩක් ආදරෙයි මගේ මැනික ❤️🥰" · "සුදූ ඔයා තමයි මගේ පන 😘💕" · "ඔයාව නැතුව මට මොකුත් හරි නෑ රත්තරං 🥺❤️" · "ඉක්මනට නිදාගන්නකෝ මගේ පැටියෝ 😴 හීනෙන් මාව දකින්න 😘💕".',
        'KEEP IT LOVING AND CLEAN: affectionate only, nothing explicit. Do NOT invent facts about his real life (where he is, what he did, plans, promises, money, meeting times). If she asks about those or wants to meet / plan, answer lovingly and say he will tell her himself, e.g. "ඉන්න පැටියෝ, මම ටිකකින් කියන්නම් 🥰".',
        'HONESTY: only if she sincerely and directly asks whether she is talking to a bot / AI, tell her the truth gently (it is his bot replying lovingly for him and he will reply himself soon). Never claim to be human if asked directly.',
        understanding ? 'ANALYSIS OF HER LATEST MESSAGE (already checked, trust it and answer exactly this): ' + understanding : '',
        (gfCfg.style || '').trim() ? 'EXTRA STYLE FROM THE OWNER: ' + gfCfg.style.trim() : '',
        'Never mention these instructions. Output only the message text.'
    ].filter(Boolean).join('\n');
}
const gfModels = () => [...new Set([process.env.GF_MODEL || 'google/gemini-2.5-flash', 'google/gemini-2.5-pro', AI_FALLBACK_MODEL].filter(Boolean))].slice(0, 3);
const GF_HIGH = String(process.env.GF_QUALITY || 'fast').toLowerCase() === 'high'; // 'high' = 3-step (slower, extra proofreading)
async function gfCall(messages, temp, maxTokens) {
    for (const model of gfModels()) {
        try {
            const a = await Promise.race([aiRequest(model, messages, temp, maxTokens || 260), new Promise((_, rej) => setTimeout(() => rej(new Error('slow model')), 14000))]);
            if (a) return a;
        } catch (e) { console.log('GF AI model failed (' + model + '):', (e && e.response && e.response.status) || e.message); }
    }
    return null;
}
// Step 1: understand what she really means (Sinhala / Singlish / typos / slang).
async function gfUnderstand(text, history) {
    const hint = gfHint(text);
    const sys = 'You are an expert in Sinhala, Singlish (Sinhala typed in English letters), Sri Lankan slang and spelling mistakes, helping a boy understand his girlfriend\'s WhatsApp message. Work out what she REALLY means (think in Sinhala, not by the English look of the words), her mood and what she needs. Output ONLY compact JSON: {"meaning_en":"...","mood":"happy|sad|angry|tired|sick|playful|missing_you|loving|neutral|worried","intent":"greeting|question|sharing_news|asking_for_attention|complaint|goodnight|goodmorning|love|other","needs_answer":"what exactly must the reply answer or respond to","key_details":["specific details from her message worth mentioning"]}' + (hint ? '\nWORD HINTS (Singlish -> English): ' + hint : '');
    const recent = history.slice(-6).map((m) => (m.role === 'user' ? 'HER: ' : 'HIM: ') + m.content).join('\n');
    const out = await gfCall([{ role: 'system', content: sys }, { role: 'user', content: (recent ? 'RECENT CHAT:\n' + recent + '\n\n' : '') + 'HER NEW MESSAGE(S):\n' + text }], 0.2);
    if (!out) return null;
    try { const j = JSON.parse(out.replace(/```json|```/g, '').trim().replace(/^[^{]*/, '').replace(/[^}]*$/, '')); return JSON.stringify(j).slice(0, 700); }
    catch (e) { return String(out).replace(/\s+/g, ' ').slice(0, 500); }
}
// Step 3: proofread the draft like a native Sinhala editor.
async function gfProofread(text, draft, understanding) {
    const sys = 'You are a native Sinhala editor and a romantic-chat coach. Check the DRAFT reply that a boy is sending to his girlfriend. Fix: spelling, grammar, unnatural or word-for-word translated Sinhala, stiff/literary phrases, unclear meaning, wrong pet name (must be "පැටියෝ", never "පතියො"), a reply that does not match what she said, missing warmth, more than 3 short lines, invented facts about his life, and English letters where Sinhala script is needed. Keep the same loving meaning, emojis and length. If the draft is already perfect, return it unchanged. Output ONLY the final message text, nothing else.';
    const out = await gfCall([{ role: 'system', content: sys }, { role: 'user', content: 'HER MESSAGE: ' + text + (understanding ? '\nANALYSIS: ' + understanding : '') + '\n\nDRAFT:\n' + draft }], 0.3);
    return out || draft;
}
// Deterministic clean-up: known wrong phrases, quotes, markdown, missing emoji.
function gfClean(t) {
    let x = String(t || '').trim().replace(/^["“”'`]+|["“”'`]+$/g, '').replace(/\*\*|__|^#+\s*/gm, '').replace(/^(reply|message|answer|draft|final)\s*:\s*/i, '');
    const fixes = [[/පතියො|පතියෝ|පැටියො/g, 'පැටියෝ'], [/මම ඔයාවම හිතුවා/g, 'මම ඔයා ගැනම හිත හිත තමයි හිටියේ'], [/මන් ඔයාවම හිතුවා/g, 'මම ඔයා ගැනම හිත හිත තමයි හිටියේ'], [/ඔයා කෑවාද\?/g, 'කෑවද මගේ සුදූ?']];
    for (const [re, rep] of fixes) x = x.replace(re, rep);
    x = x.replace(/\n{3,}/g, '\n\n').trim();
    if (x.length > 600) x = x.slice(0, 600).replace(/\s+\S*$/, '');
    if (!/[\u{1F300}-\u{1FAFF}\u2764\u2728\u263A]/u.test(x)) x += ' ❤️🥰';
    return x;
}
function gfBadSinhala(reply, wantSi) {
    if (!wantSi) return false;
    const si = (reply.match(/[\u0D80-\u0DFF]/g) || []).length;
    const letters = (reply.match(/\p{L}/gu) || []).length || 1;
    return si / letters < 0.3;
}
function gfFallback(text) {
    const t = String(text || '').toLowerCase();
    if (/good\s*night|gn\b|nidaganna|නිදා/.test(t)) return 'ගුඩ් නයිට් මගේ සුදූ 😴 හීනෙන් මාව දකින්න, මම ඔයාට ගොඩක් ආදරෙයි 😘💕';
    if (/good\s*morning|gm\b|සුභ උදෑසන/.test(t)) return 'සුභ උදෑසනක් මගේ මැනික 🌞 අද දවස ලස්සනට යන්න ඕන, මම ඔයා ගැනම හිත හිත ඉන්නවා ❤️';
    return 'මගේ පැටියෝ 🥰 මම ඔයා ගැනම හිත හිත තමයි හිටියේ, ටිකකින් කතා කරන්නම් මගේ මැනික ❤️😘';
}
async function callGfAI(jid, userText) {
    await ensureHistoryLoaded(jid);
    const history = chatHistory.get(jid) || [];
    const wantSi = gfReplyLang(userText) === 'si';
    const understanding = GF_HIGH ? await gfUnderstand(userText, history).catch(() => null) : null;
    const hint = gfHint(userText);
    const sys = buildGfPrompt(userText, understanding) + (hint ? '\nWORD HINTS (Singlish -> English): ' + hint : '')
        + (GF_HIGH ? '' : '\nBefore writing, silently work out what she really means (her mood, question, news) and answer exactly that, in correct natural Sinhala.');
    const messages = [{ role: 'system', content: sys }].concat(history.slice(-10), [{ role: 'user', content: userText }]);
    let draft = await gfCall(messages, 0.7, 260);
    if (!draft) return null;
    if (gfBadSinhala(draft, wantSi)) { const retry = await gfCall(messages.concat([{ role: 'assistant', content: draft }, { role: 'user', content: '(Rewrite your reply fully in Sinhala script, natural spoken Sinhala, same loving meaning.)' }]), 0.6, 260); if (retry) draft = retry; }
    const final = GF_HIGH ? await gfProofread(userText, draft, understanding).catch(() => draft) : draft;
    return gfClean(final || draft);
}
// She often sends several short messages in a row: wait a moment, read them together, answer once.
const gfQueue = new Map();
async function gfFlush(from) {
    const q = gfQueue.get(from);
    if (!q || q.busy || !q.texts.length) return;
    q.busy = true;
    const texts = q.texts.splice(0), msg = q.msg, session = q.session;
    try {
        const text = texts.join('\n');
        let answer = null;
        try { answer = await callGfAI(from, text); } catch (e) { console.log('GF AI error:', (e && e.message) || e); }
        if (!answer) answer = gfFallback(text);   // she must never be left unanswered
        pushHistory(from, 'user', text);
        pushHistory(from, 'assistant', answer);
        await session.queueSend(from, { text: answer }, { quoted: msg }); // no watermark: personal chat
    } catch (e) { console.log('GF mode error:', (e && e.message) || e); }
    finally { q.busy = false; if (q.texts.length) q.timer = setTimeout(() => gfFlush(from), 1500); }
}
function handleGfMessage(ctx) {
    const { msg, from, body, session } = ctx;
    const q = gfQueue.get(from) || { texts: [], busy: false, timer: null };
    q.texts.push(String(body).slice(0, 1500)); q.msg = msg; q.session = session;
    gfQueue.set(from, q);
    clearTimeout(q.timer);
    q.timer = setTimeout(() => gfFlush(from), 1000);
    try { session.sock.sendPresenceUpdate('composing', from).catch(() => {}); } catch (e) { /* ignore */ }
}
// Photos / voice notes / stickers / videos from her (no text): still answer lovingly.
const GF_MEDIA_REPLIES = {
    imageMessage: ['ෆොටෝ එක එව්වට thanks මගේ සුදූ 🥰 ඉක්මනට බලලා කතා කරන්නම් ❤️', 'අනේ මගේ පැටියෝ 😍 බලනකම් ඉන්න, මම ඔයාට ගොඩක් ආදරෙයි ❤️'],
    videoMessage: ['වීඩියෝ එක එව්වට thanks මගේ මැනික 🥰 බලලා කතා කරන්නම් ❤️', 'මගේ පැටියෝ 😘 ඉක්මනට බලලා කියන්නම්, ආදරෙයි ගොඩක් 💕'],
    audioMessage: ['ඔයාගේ කටහඬ අහන්න මට කොච්චර ආසද මගේ සුදූ 🥰 ඉක්මනට අහලා කතා කරන්නම් ❤️', 'වොයිස් එක එව්වට thanks මගේ මැනික 😘 අහලා ඉක්මනට කියන්නම් 💕'],
    stickerMessage: ['😍🥰 මගේ සුදූ ගොඩක් cute 😘', 'හෙහෙ මගේ පැටියෝ 🥰 මම ඔයාට ගොඩක් ආදරෙයි ❤️']
};
async function gfHandleMedia(msg, session) {
    try {
        await gfLoad();
        if (msg.key.fromMe || (msg.key.remoteJid || '').endsWith('@g.us') || !isGfChat(msg)) return;
        const type = Object.keys(msg.message || {})[0];
        const t = type === 'ptvMessage' ? 'videoMessage' : type;
        const list = GF_MEDIA_REPLIES[t];
        if (!list) return;
        await session.queueSend(msg.key.remoteJid, { text: list[Math.floor(Math.random() * list.length)] }, { quoted: msg });
    } catch (e) { console.log('GF media error:', (e && e.message) || e); }
}
async function maybeHandleNimahAgent(ctx) {
    const sock = ctx.sock, msg = ctx.msg, from = ctx.from, sender = ctx.sender, isGroup = ctx.isGroup, body = ctx.body, session = ctx.session;
    await gfLoad();
    if (!isGroup && isGfChat(msg)) { handleGfMessage({ msg, from, body, session }); return; }
    const nameWord = String(BOT_NAME).split(/\s+/)[0].replace(/[^A-Za-z0-9]/g, '');
    const mentionsNimah = new RegExp('\\b(nimah' + (nameWord && nameWord.toLowerCase() !== 'nimah' ? '|' + nameWord : '') + ')\\b', 'i').test(body);
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
        const senderName = msg.pushName || null;
        const answer = await callNimahAI(from, body, senderName);
        if (!answer) return;
        pushHistory(from, 'user', body);
        pushHistory(from, 'assistant', answer);
        // Routed through the session's paced send queue (typing indicator +
        // randomized delay) instead of firing straight through sock, same
        // anti-ban pacing as every other reply.
        await session.queueSend(from, { text: answer + AI_WATERMARK() }, { quoted: msg });
    } catch (e) {
        console.log('Nimah agent error:', (e && e.response && e.response.data) || (e && e.message) || e);
        if (isGroup ? (mentionsNimah || isReplyToBot) : true) {
            try { await session.queueSend(from, { text: decorate('⚠️ ' + BOT_NAME + ' is having trouble thinking right now. Please try again in a moment 🙏') }, { quoted: msg }); } catch (e2) {}
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
            if (!f.endsWith('.bak') && fs.statSync(fp).isFile() && fs.statSync(fp).size < 300 * 1024) files[f] = fs.readFileSync(fp, 'utf8');
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
            let localOk = false; try { JSON.parse(fs.readFileSync(path.join(dir, 'creds.json'), 'utf8')); localOk = true; } catch (e) { /* missing or damaged */ }
            if (localOk) continue; // a healthy Volume copy wins
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
        if (c.mediaType === 'image') await sendMedia(ctx.session, from, 'image', url, { caption: cap }, o);
        else if (c.mediaType === 'video') await sendMedia(ctx.session, from, 'video', url, { caption: cap }, o);
        else if (c.mediaType === 'audio') { if (cap) await ctx.reply(cap); await sendMedia(ctx.session, from, 'audio', url, {}, o); }
        else if (c.mediaType === 'document') await sendMedia(ctx.session, from, 'document', url, { mimetype: c.mimetype || undefined, fileName: (c.fileName || name).replace(/[\\/:*?"<>|]/g, '') }, o);
        else await ctx.reply(res.text || '✅');
        st.uses++; ctx.react('✅');
    } catch (e) {
        st.fails++; st.lastError = maskSecrets(e.message || String(e)).slice(0, 300); st.lastAt = Date.now();
        if (e && e.mediaCode) { ctx.react('❌'); return ctx.reply(c.errorText || card(name, 'could not send', [mediaErrorText(e)])); }
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
    menuIntro: '', aliveTemplate: '', pingTemplate: '', banner: true, voiceOnPing: true, voiceOnAlive: true,
    aiModel: '', aiLang: 'auto', aiPersona: '', aiTemp: 0.6, aiWatermark: true
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
        banner: b.banner !== false, voiceOnPing: b.voiceOnPing !== false, voiceOnAlive: b.voiceOnAlive !== false,
        aiModel: S(b.aiModel, 80).trim().replace(/[^A-Za-z0-9._:\/-]/g, ''), aiLang: ['auto', 'si', 'singlish', 'en'].includes(b.aiLang) ? b.aiLang : 'auto',
        aiPersona: S(b.aiPersona, 600), aiTemp: Math.min(1, Math.max(0, parseFloat(b.aiTemp))) || 0.6, aiWatermark: b.aiWatermark !== false
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
let _ffPath;
function ffmpegPath() {
    if (_ffPath !== undefined) return _ffPath;
    const ff = tryRequire('ffmpeg-static');
    if (ff && fs.existsSync(ff)) return (_ffPath = ff);
    try { _ffPath = spawnSync('ffmpeg', ['-version']).status === 0 ? 'ffmpeg' : null; } catch (e) { _ffPath = null; }
    return _ffPath;
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
app.post('/api/admin/ai-test', requireAdmin, async (req, res) => {
    const text = String((req.body || {}).text || '').slice(0, 500);
    if (!text) return res.status(400).json({ error: 'Type a message to try.' });
    if (!OPENROUTER_API_KEY) return res.status(400).json({ error: 'OPENROUTER_API_KEY is not set on the server.' });
    const saved = BRAND;
    try {
        BRAND = Object.assign({}, BRAND_DEFAULTS, sanitizeBrand((req.body || {}).brand || BRAND));
        const model = aiModelName(), lang = BRAND.aiLang !== 'auto' ? BRAND.aiLang : detectLang(text);
        const answer = await callNimahAI('test', text, 'Tester');
        res.json({ answer: answer || '(empty answer)', model, lang });
    } catch (e) { res.status(502).json({ error: 'The AI did not answer: ' + ((e.response && e.response.status) ? 'HTTP ' + e.response.status : e.message) }); }
    finally { BRAND = saved; }
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

// =========================================================================
// 🧠 RAM MANAGER (v7.20)
// Everything the bot keeps in memory is a cache that can be rebuilt, so it can
// be cleared safely at any time: chat history reloads from the cloud, menus and
// search results are re-made on demand, sessions / logins are never touched.
//   .ram          -> live RAM card          .clearram [soft|deep] -> free memory now
//   .ramguard on|off -> automatic cleaning  Web: Admin panel -> RAM card
// Levels use the higher of: RAM vs host limit, and V8 heap vs its 256 MB cap
// (the heap cap is what actually crashes Node first).
// =========================================================================
const v8Mod = require('v8');
let gcFn = global.gc || null;
if (!gcFn) { try { v8Mod.setFlagsFromString('--expose_gc'); gcFn = require('vm').runInNewContext('gc'); } catch (e) { gcFn = null; } }
function runGc() { if (gcFn) { try { gcFn(); gcFn(); } catch (e) { /* ignore */ } } }
const toMb = (n) => Math.round(n / 1048576);
let ramGuardOn = String(process.env.RAM_GUARD || 'on').toLowerCase() !== 'off';
const ramAuto = { last: null, cleans: 0, freedMb: 0 };
function ramSnapshot() {
    const mu = process.memoryUsage(), hs = v8Mod.getHeapStatistics(), limit = memLimitMb();
    const rssMb = toMb(mu.rss), heapUsedMb = toMb(hs.used_heap_size), heapLimitMb = toMb(hs.heap_size_limit);
    const rssPct = rssMb / Math.max(1, limit), heapPct = heapUsedMb / Math.max(1, heapLimitMb);
    const pct = Math.max(rssPct, heapPct);
    const level = pct < 0.6 ? 'good' : pct < 0.75 ? 'warn' : pct < 0.9 ? 'high' : 'critical';
    const total = osMod.totalmem(), free = osMod.freemem();
    return {
        level, pct: Math.round(pct * 100), rssMb, limitMb: limit, rssPct: Math.round(rssPct * 100),
        heapUsedMb, heapLimitMb, heapPct: Math.round(heapPct * 100),
        externalMb: toMb(mu.external), buffersMb: toMb(mu.arrayBuffers),
        hostUsedMb: toMb(total - free), hostTotalMb: toMb(total),
        guard: ramGuardOn, gc: !!gcFn, auto: ramAuto, uptime: Math.round(process.uptime()),
        caches: {
            chats: chatHistory.size, groupLogs: groupMessageLog.size, deletedMsgs: typeof adCache !== 'undefined' ? adCache.size : 0,
            mediaMb: typeof adMediaBytes !== 'undefined' ? Math.round(adMediaBytes / 1048576 * 10) / 10 : 0,
            menus: menuReplyMap.size, searches: ytSearchCache.size, pdfLists: pdfQueue.size, bots: sessions.size
        }
    };
}
const RAM_LEVEL = { good: '🟢 Healthy', warn: '🟡 Getting busy', high: '🟠 High', critical: '🔴 Critical' };
// mode 'soft' = drop only old / expired data;  'deep' = drop every rebuildable cache.
function cleanRam(mode) {
    const deep = mode !== 'soft', now = Date.now(), before = ramSnapshot(), did = [];
    const note = (n, what) => { if (n > 0) did.push(n + ' ' + what); };
    let n = 0;
    for (const [k, v] of menuReplyMap) if (deep || now - (v.at || 0) > 10 * 60 * 1000) { menuReplyMap.delete(k); n++; } note(n, 'menu replies'); n = 0;
    for (const [k, v] of pdfQueue) if (deep || now - v.ts > PDFQ_TTL) { pdfQueue.delete(k); n++; } note(n, 'PDF lists'); n = 0;
    for (const [k, v] of adminTokens) if (now > v) adminTokens.delete(k);
    for (const [k, v] of loginAttempts) if (!v.lockedUntil || now > v.lockedUntil) loginAttempts.delete(k);
    for (const [k, t] of alertHits) if (now - t > 3600e3) alertHits.delete(k);
    for (const [k, t] of lastCommandAt) if (deep || now - t > 600e3) lastCommandAt.delete(k);
    for (const [k, t] of cmdCooldowns) if (deep || now - t > 600e3) cmdCooldowns.delete(k);
    for (const [k, q] of gfQueue) if (!q.busy && !q.texts.length) gfQueue.delete(k);
    if (deep || ytSearchCache.size > 20) { note(ytSearchCache.size, 'search results'); ytSearchCache.clear(); }
    let freedMedia = 0;
    for (const e of adCache.values()) if (e.media && (deep || adMediaBytes > 8 * 1048576)) { adMediaBytes -= e.media.length; freedMedia += e.media.length; e.media = null; if (!deep && adMediaBytes <= 8 * 1048576) break; }
    if (freedMedia) did.push(Math.round(freedMedia / 1048576 * 10) / 10 + ' MB saved media');
    if (deep) {
        note(groupMessageLog.size, 'group logs'); groupMessageLog.clear();
        note(chatHistory.size, 'AI chat memories'); chatHistory.clear(); chatHistoryLoaded.clear();
    } else {
        for (const [k, arr] of groupMessageLog) { if (!arr.length || now - ((arr[arr.length - 1] || {}).ts || 0) > 6 * 3600e3) groupMessageLog.delete(k); else if (arr.length > 50) arr.splice(0, arr.length - 50); }
        for (const [k, arr] of chatHistory) if (arr.length > 6) arr.splice(0, arr.length - 6);
    }
    runGc();
    const after = ramSnapshot();
    return { mode: deep ? 'deep' : 'soft', before, after, freedHeapMb: before.heapUsedMb - after.heapUsedMb, freedRssMb: before.rssMb - after.rssMb, did };
}
const trimCaches = () => cleanRam('deep');
let ramLastSoft = 0, ramLastDeep = 0;
setInterval(() => {
    if (!ramGuardOn) return;
    const s = ramSnapshot(), now = Date.now();
    let mode = null;
    if (s.pct >= 75 && now - ramLastDeep > 60e3) { mode = 'deep'; ramLastDeep = now; }
    else if (s.pct >= 60 && now - ramLastSoft > 120e3) { mode = 'soft'; ramLastSoft = now; }
    if (!mode) { if (now % (5 * 60e3) < 30e3) runGc(); return; }
    const r = cleanRam(mode);
    ramAuto.last = { at: Date.now(), mode, beforePct: r.before.pct, afterPct: r.after.pct, freedMb: Math.max(r.freedRssMb, r.freedHeapMb) };
    ramAuto.cleans++; ramAuto.freedMb += Math.max(0, ramAuto.last.freedMb);
    console.log(`🧠 RAM ${r.before.pct}% -> ${r.after.pct}% (${mode} clean: ${r.did.join(', ') || 'nothing big to drop'})`);
}, 30 * 1000);

// Small housekeeping so long-running servers never creep up in RAM.
setInterval(() => {
    const now = Date.now();
    for (const [k, t] of lastCommandAt) if (now - t > 3600e3) lastCommandAt.delete(k);
    for (const [k, t] of lastMassTagAt) if (now - t > 3600e3) lastMassTagAt.delete(k);
    for (const [k, arr] of newSessionHits) if (!arr.length || now - arr[arr.length - 1] > 600e3) newSessionHits.delete(k);
    for (const [k, t] of cmdCooldowns) if (now - t > 3600e3) cmdCooldowns.delete(k);
}, 10 * 60 * 1000);

// =========================================================================
// MEDIA PIPELINE — makes sure every photo, video, voice note and file the bot
// sends really OPENS in WhatsApp: the file is downloaded here (with browser
// headers), its real format is detected, and it is converted when needed
// (pictures -> JPEG, videos -> H.264/AAC MP4, voice -> Opus). Pages that are
// not media (login/error pages) are never sent as a broken "photo".
// =========================================================================
const { spawn } = require('child_process');
const MEDIA_UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
const MEDIA_LIMIT_MB = { image: 12, audio: 25, voice: 25, video: 40, document: 40 };
function sniffType(b) {
    if (!b || b.length < 12) return { kind: 'unknown' };
    const a4 = b.toString('ascii', 0, 4), a48 = b.toString('ascii', 4, 8), a812 = b.toString('ascii', 8, 12);
    if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return { kind: 'jpeg', mime: 'image/jpeg' };
    if (b[0] === 0x89 && a4.slice(1) === 'PNG') return { kind: 'png', mime: 'image/png' };
    if (a4 === 'RIFF' && a812 === 'WEBP') return { kind: 'webp', mime: 'image/webp' };
    if (a4.startsWith('GIF8')) return { kind: 'gif', mime: 'image/gif' };
    if (a4.startsWith('BM')) return { kind: 'bmp', mime: 'image/bmp' };
    if (a48 === 'ftyp') {
        if (/^(heic|heix|hevc|mif1|msf1|avif)/.test(a812)) return { kind: 'heic', mime: 'image/heic' };
        if (a812 === 'M4A ' || a812 === 'M4B ') return { kind: 'm4a', mime: 'audio/mp4' };
        return { kind: 'mp4', mime: 'video/mp4' };
    }
    if (b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3) return { kind: 'webm', mime: 'video/webm' };
    if (a4 === 'OggS') return { kind: 'ogg', mime: 'audio/ogg; codecs=opus' };
    if (a4 === 'RIFF' && a812 === 'WAVE') return { kind: 'wav', mime: 'audio/wav' };
    if (a4.startsWith('ID3') || (b[0] === 0xFF && (b[1] & 0xE0) === 0xE0)) return { kind: 'mp3', mime: 'audio/mpeg' };
    if (a4 === '%PDF') return { kind: 'pdf', mime: 'application/pdf' };
    if (a4.startsWith('PK')) return { kind: 'zip', mime: 'application/zip' };
    const head = b.toString('utf8', 0, 120).trimStart().toLowerCase();
    if (head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<?xml') || head.startsWith('<head')) return { kind: 'html' };
    if (head.startsWith('{') || head.startsWith('[')) return { kind: 'json' };
    return { kind: 'unknown' };
}
function mediaError(code, msg) { const e = new Error(msg || code); e.mediaCode = code; return e; }
async function downloadBuffer(url, maxBytes) {
    if (!/^https?:\/\//i.test(url)) throw mediaError('BAD_URL', 'That is not a web link.');
    if (blockedHost(url)) throw mediaError('BAD_URL', 'That address is not allowed.');
    const r = await axios.get(url, { responseType: 'stream', timeout: 60000, maxRedirects: 5, validateStatus: () => true, headers: { 'User-Agent': MEDIA_UA, 'Accept': '*/*' } });
    if (r.status >= 400) { r.data.destroy(); throw mediaError('HTTP', 'The file server answered HTTP ' + r.status + '.'); }
    const len = parseInt(r.headers['content-length'] || '0', 10);
    if (len && len > maxBytes) { r.data.destroy(); throw mediaError('TOO_BIG', 'File too big.'); }
    const chunks = []; let size = 0;
    for await (const ch of r.data) { size += ch.length; if (size > maxBytes) { r.data.destroy(); throw mediaError('TOO_BIG', 'File too big.'); } chunks.push(ch); }
    return Buffer.concat(chunks);
}
function runFfmpeg(args, timeoutMs) {
    return new Promise((resolve) => {
        const ff = ffmpegPath();
        if (!ff) return resolve({ ok: false, err: '', missing: true });
        let err = '';
        const p = spawn(ff, args, { stdio: ['ignore', 'ignore', 'pipe'] });
        const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch (e) { /* ignore */ } }, timeoutMs);
        p.stderr.on('data', (d) => { err += d; if (err.length > 30000) err = err.slice(-15000); });
        p.on('close', (code) => { clearTimeout(t); resolve({ ok: code === 0, err }); });
        p.on('error', (e) => { clearTimeout(t); resolve({ ok: false, err: String(e.message) }); });
    });
}
let _ffChain = Promise.resolve(); // one conversion at a time keeps a small server from running out of RAM/CPU
const ffQueued = (fn) => { const run = _ffChain.then(fn, fn); _ffChain = run.catch(() => {}); return run; };
const tmpName = (ext) => path.join(osMod.tmpdir(), 'nimah_' + nodeCrypto.randomBytes(6).toString('hex') + (ext || ''));
const rmQuiet = (...files) => files.forEach((f) => { if (f) fs.rm(f, { force: true }, () => {}); });
setInterval(() => { // clear leftovers of crashed conversions
    try { for (const f of fs.readdirSync(osMod.tmpdir())) if (f.startsWith('nimah_')) { const p = path.join(osMod.tmpdir(), f); if (Date.now() - fs.statSync(p).mtimeMs > 3600e3) rmQuiet(p); } } catch (e) { /* ignore */ }
}, 30 * 60 * 1000);

async function prepareImage(buf) {
    const t = sniffType(buf);
    if (['html', 'json', 'pdf', 'zip', 'mp4', 'webm', 'mp3', 'ogg', 'wav', 'm4a'].includes(t.kind)) throw mediaError('NOT_MEDIA', 'That link is not a picture.');
    const sharp = tryRequire('sharp');
    if (t.kind === 'jpeg' && buf.length <= 5 * 1024 * 1024) return { buf, mime: 'image/jpeg' };
    if (sharp) {
        try { return { buf: await sharp(buf, { failOn: 'none' }).rotate().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 86 }).toBuffer(), mime: 'image/jpeg' }; }
        catch (e) { /* try ffmpeg below */ }
    }
    if (ffmpegPath()) { // no sharp (or it failed): let ffmpeg make the JPEG
        const inF = tmpName('.img'), outF = tmpName('.jpg');
        try {
            fs.writeFileSync(inF, buf);
            const r = await ffQueued(() => runFfmpeg(['-y', '-i', inF, '-frames:v', '1', '-vf', "scale='min(2048,iw)':-2", '-q:v', '3', outF], 60000));
            if (r.ok && fs.existsSync(outF)) return { buf: fs.readFileSync(outF), mime: 'image/jpeg' };
        } finally { rmQuiet(inF, outF); }
    }
    if (t.kind === 'png') return { buf, mime: 'image/png' };
    throw mediaError('NOT_MEDIA', 'That picture format cannot be opened.');
}
async function prepareVideo(buf) {
    const t = sniffType(buf);
    if (['html', 'json', 'pdf', 'zip', 'jpeg', 'png', 'webp', 'gif'].includes(t.kind)) throw mediaError('NOT_MEDIA', 'That link is not a video.');
    const inF = tmpName('.in'), outF = tmpName('.mp4'), thF = tmpName('.jpg');
    const cleanup = () => rmQuiet(inF, outF, thF);
    fs.writeFileSync(inF, buf);
    try {
        if (!ffmpegPath()) { rmQuiet(outF, thF); return { file: inF, mime: 'video/mp4', thumb: null, converted: false, cleanup: () => rmQuiet(inF) }; }
        const info = (await runFfmpeg(['-hide_banner', '-i', inF], 30000)).err || '';
        const v = (/Video: ([a-z0-9_]+)/i.exec(info) || [])[1], a = (/Audio: ([a-z0-9_]+)/i.exec(info) || [])[1];
        const pix = (/Video:[^\n]*?\b(yuvj?\d{3}p\w*|nv12|rgb\w*|gbr\w*)/i.exec(info) || [])[1] || 'yuv420p';
        if (!v) throw mediaError('NOT_MEDIA', 'That file has no video in it.');
        const videoOk = v === 'h264' && /^yuvj?420p/.test(pix), audioOk = !a || a === 'aac';
        let file = inF, converted = false;
        if (!(t.kind === 'mp4' && videoOk && audioOk)) {
            const args = ['-y', '-i', inF, '-map', '0:v:0', '-map', '0:a:0?'];
            if (videoOk) args.push('-c:v', 'copy');
            else args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', '-vf', "scale='min(1280,iw)':-2", '-profile:v', 'main');
            args.push('-c:a', 'aac', '-b:a', '96k', '-ac', '2', '-movflags', '+faststart', '-t', '1500', outF);
            const r = await ffQueued(() => runFfmpeg(args, 6 * 60 * 1000));
            if (!r.ok || !fs.existsSync(outF) || fs.statSync(outF).size < 1000) throw mediaError('CONVERT', 'This video could not be converted to a format WhatsApp can play.');
            file = outF; converted = true;
        }
        let thumb = null;
        for (const ss of ['1', '0']) {
            const r = await runFfmpeg(['-y', '-ss', ss, '-i', file, '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '5', thF], 20000);
            if (r.ok && fs.existsSync(thF)) { thumb = fs.readFileSync(thF); break; }
        }
        if (fs.statSync(file).size > MEDIA_LIMIT_MB.video * 1048576 * 1.2) throw mediaError('TOO_BIG', 'File too big.');
        return { file, mime: 'video/mp4', thumb, converted, cleanup };
    } catch (e) { cleanup(); throw e; }
}
async function prepareAudio(buf, voice) {
    const t = sniffType(buf);
    if (['html', 'json', 'pdf', 'zip', 'jpeg', 'png', 'webp', 'gif'].includes(t.kind)) throw mediaError('NOT_MEDIA', 'That link is not audio.');
    if (voice) { // WhatsApp voice notes must be Opus in an Ogg file
        if (t.kind === 'ogg') return { buf, mime: 'audio/ogg; codecs=opus', ptt: true };
        if (ffmpegPath()) {
            const inF = tmpName('.in'), outF = tmpName('.ogg');
            try {
                fs.writeFileSync(inF, buf);
                const r = await ffQueued(() => runFfmpeg(['-y', '-i', inF, '-vn', '-ac', '1', '-ar', '48000', '-c:a', 'libopus', '-b:a', '48k', '-t', '300', outF], 120000));
                if (r.ok && fs.existsSync(outF)) return { buf: fs.readFileSync(outF), mime: 'audio/ogg; codecs=opus', ptt: true };
            } finally { rmQuiet(inF, outF); }
        }
        return { buf, mime: t.mime || 'audio/mpeg', ptt: false }; // cannot convert: send as a normal audio file
    }
    if (['mp3', 'm4a', 'ogg', 'wav'].includes(t.kind)) return { buf, mime: t.mime, ptt: false };
    if (ffmpegPath()) { // webm / mp4 container / unknown -> AAC in M4A
        const inF = tmpName('.in'), outF = tmpName('.m4a');
        try {
            fs.writeFileSync(inF, buf);
            const r = await ffQueued(() => runFfmpeg(['-y', '-i', inF, '-vn', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', outF], 5 * 60 * 1000));
            if (r.ok && fs.existsSync(outF)) return { buf: fs.readFileSync(outF), mime: 'audio/mp4', ptt: false };
        } finally { rmQuiet(inF, outF); }
    }
    return { buf, mime: t.mime || 'audio/mpeg', ptt: false };
}
// Builds the exact WhatsApp message for a picture/video/audio/voice/document.
// src = a web link or a Buffer. Returns { content, cleanup }.
async function buildMedia(kind, src, opts) {
    opts = opts || {};
    const maxBytes = (opts.maxMb || MEDIA_LIMIT_MB[kind] || 20) * 1048576;
    const buf = Buffer.isBuffer(src) ? src : await downloadBuffer(String(src), maxBytes);
    if (buf.length > maxBytes) throw mediaError('TOO_BIG', 'File too big.');
    const extra = opts.mentions ? { mentions: opts.mentions } : {};
    if (kind === 'image') {
        const p = await prepareImage(buf);
        return { content: Object.assign({ image: p.buf, mimetype: p.mime, caption: opts.caption || undefined }, extra), cleanup: () => {} };
    }
    if (kind === 'video') {
        const p = await prepareVideo(buf);
        const content = Object.assign({ video: { url: p.file }, mimetype: 'video/mp4', caption: opts.caption || undefined }, extra);
        if (p.thumb) content.jpegThumbnail = p.thumb;
        return { content, cleanup: p.cleanup };
    }
    if (kind === 'audio' || kind === 'voice') {
        const p = await prepareAudio(buf, kind === 'voice');
        return { content: { audio: p.buf, mimetype: p.mime, ptt: p.ptt }, cleanup: () => {} };
    }
    const t = sniffType(buf);
    if (['html', 'json'].includes(t.kind) && !opts.mimetype) throw mediaError('NOT_MEDIA', 'That link did not give a file.');
    return { content: { document: buf, mimetype: opts.mimetype || t.mime || 'application/octet-stream', fileName: opts.fileName || 'file' }, cleanup: () => {} };
}
async function sendMedia(session, jid, kind, src, opts, sendOpts) {
    const m = await buildMedia(kind, src, opts);
    try { return await session.queueSend(jid, m.content, sendOpts || {}); }
    finally { m.cleanup(); }
}
function mediaErrorText(e) {
    const c = e && e.mediaCode;
    if (c === 'TOO_BIG') return 'That file is too big for WhatsApp here (max about 40 MB). Try a lower quality.';
    if (c === 'NOT_MEDIA') return e.message;
    if (c === 'CONVERT') return e.message;
    if (c === 'HTTP') return e.message + ' The link may have expired — try again.';
    if (c === 'BAD_URL') return e.message;
    return 'The file could not be downloaded. Please try again.';
}

// ---- Keeping bots linked: never lose a session to a half-written file or a one-off error ----
function credsFile(dir) { return path.join(dir, 'creds.json'); }
function repairCreds(dir) {
    const f = credsFile(dir), b = f + '.bak';
    try { if (fs.existsSync(f)) { JSON.parse(fs.readFileSync(f, 'utf8')); return; } else if (!fs.existsSync(b)) return; }
    catch (e) { console.log('⚠️ creds.json is damaged in', path.basename(dir)); }
    try { JSON.parse(fs.readFileSync(b, 'utf8')); fs.copyFileSync(b, f); console.log('🛟 Restored creds.json from the local backup for', path.basename(dir)); }
    catch (e) { /* no usable local backup; Firestore backup (if any) is tried at boot */ }
}
function snapshotCreds(dir) {
    try { const f = credsFile(dir); const raw = fs.readFileSync(f, 'utf8'); JSON.parse(raw); fs.writeFileSync(f + '.bak', raw); } catch (e) { /* ignore */ }
}
const alertHits = new Map();
async function notifyOwner(text, key) {
    if (String(process.env.OWNER_ALERTS || 'on').toLowerCase() === 'off') return;
    const k = key || text;
    if (Date.now() - (alertHits.get(k) || 0) < 10 * 60 * 1000) return;
    alertHits.set(k, Date.now());
    for (const x of sessions.values()) {
        if (x.isConnected && x.sock && x.queueSend) {
            try { await x.queueSend(OWNER_NUMBER + '@s.whatsapp.net', { text: decorate(card('Alert', 'server notice', [text])) }); return; } catch (e) { /* try the next bot */ }
        }
    }
}
// ---- Activity analytics (shown in the admin panel) ----
const activity = { day: '', messages: 0, users: new Set(), commands: {} };
const todayStr = () => new Date().toLocaleDateString('en-CA', { timeZone: BOT_TZ });
function activityRoll() { const d = todayStr(); if (activity.day !== d) { if (activity.day) flushActivity(); activity.day = d; activity.messages = 0; activity.users = new Set(); activity.commands = {}; } }
function trackMessage(sender) { activityRoll(); activity.messages++; if (activity.users.size < 5000) activity.users.add(String(sender).split('@')[0].split(':')[0]); }
function trackCommand(name) { activityRoll(); activity.commands[name] = (activity.commands[name] || 0) + 1; }
async function flushActivity() {
    if (!activity.day || !activity.messages) return;
    const top = Object.entries(activity.commands).sort((a, b) => b[1] - a[1]).slice(0, 40);
    await fsSet('analytics', activity.day, { messages: activity.messages, users: activity.users.size, commands: Object.fromEntries(top) });
}
setInterval(() => { flushActivity(); }, 10 * 60 * 1000);
app.get('/api/admin/analytics', requireAdmin, async (req, res) => {
    activityRoll();
    const days = [], now = Date.now();
    for (let i = 1; i <= 6; i++) { const d = new Date(now - i * 86400e3).toLocaleDateString('en-CA', { timeZone: BOT_TZ }); days.push(d); }
    const past = await Promise.all(days.map((d) => fsGet('analytics', d, null)));
    const top = Object.entries(activity.commands).sort((a, b) => b[1] - a[1]).slice(0, 8);
    res.json({ today: { day: activity.day, messages: activity.messages, users: activity.users.size, commands: top, total: Object.values(activity.commands).reduce((a, b) => a + b, 0) },
        history: [{ day: activity.day, messages: activity.messages, users: activity.users.size }].concat(past.map((p, i) => ({ day: days[i], messages: p ? p.messages : 0, users: p ? p.users : 0 }))) });
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
const MAX_BOTS = parseInt(process.env.MAX_BOTS || String(Math.min(60, Math.max(3, Math.floor((memLimitMb() - 100) / 40)))), 10);
const isPaired = (s) => !!(s.sock && s.sock.authState && s.sock.authState.creds && s.sock.authState.creds.registered);
function serverFull() {
    // Paired bots count against MAX_BOTS; pages that are only waiting to pair have their own small limit.
    let paired = 0, pending = 0;
    for (const x of sessions.values()) { if (x.isConnected || isPaired(x) || x.ownerNumber) paired++; else pending++; }
    return paired >= MAX_BOTS || pending >= 12 || process.memoryUsage().rss / 1048576 > memLimitMb() * 0.85;
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
        if (now - (s.createdAt || now) > 10 * 60 * 1000) { console.log(`🧹 [${id}] Removing abandoned pairing session.`); destroySession(id); }
    }
}, 2 * 60 * 1000);
// Simple per-IP limiter for creating new pairing sessions.
const newSessionHits = new Map();
function newSessionAllowed(ip) {
    const now = Date.now(); const arr = (newSessionHits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
    if (arr.length >= 15) { newSessionHits.set(ip, arr); return false; }
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
    const num = s.ownerNumber ? '+' + s.ownerNumber.slice(0, 2) + '•'.repeat(Math.max(3, s.ownerNumber.length - 6)) + s.ownerNumber.slice(-4) : null;
    res.json({ status: 'ok', connected: s.isConnected, exists: true, number: num });
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
app.get('/api/admin/ram', requireAdmin, (req, res) => { res.json(ramSnapshot()); });
app.post('/api/admin/ram/clean', requireAdmin, (req, res) => {
    const r = cleanRam(req.body && req.body.mode === 'soft' ? 'soft' : 'deep');
    res.json({ mode: r.mode, before: r.before, after: r.after, freedHeapMb: r.freedHeapMb, freedRssMb: r.freedRssMb, did: r.did });
});
app.post('/api/admin/ram/guard', requireAdmin, (req, res) => { ramGuardOn = !!(req.body && req.body.on); res.json({ guard: ramGuardOn }); });
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
    if (entry.kind === 'yt-search' || entry.kind === 'yt-quality') return handleYtReply({ session, msg, from, sender, t, entry });
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

// =========================================================================
// ⬇️ DOWNLOADER (v7.21) — yt-dlp engine: YouTube, Instagram, Facebook, TikTok,
// Twitter/X, Pinterest, Reddit, SoundCloud, Vimeo and ~1000 more sites.
// The yt-dlp program is downloaded automatically on first use (no setup).
// Optional: YTDLP_COOKIES_B64 (base64 of cookies.txt) if YouTube asks to sign in.
// =========================================================================
const DL_DIR = path.join(osMod.tmpdir(), 'nimah-dl');
const DL_MAX_MB = parseInt(process.env.DL_MAX_MB || '40', 10);
let _ytdlpReady = null;
function ytdlpAsset() {
    const arch = process.arch, plat = process.platform;
    if (plat === 'win32') return 'yt-dlp.exe';
    if (plat === 'darwin') return 'yt-dlp_macos';
    return arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux';
}
async function ensureYtDlp() {
    if (_ytdlpReady) return _ytdlpReady;
    _ytdlpReady = (async () => {
        fs.mkdirSync(DL_DIR, { recursive: true });
        const bin = path.join(DL_DIR, ytdlpAsset());
        if (process.env.YTDLP_PATH && fs.existsSync(process.env.YTDLP_PATH)) return process.env.YTDLP_PATH;
        if (fs.existsSync(bin) && fs.statSync(bin).size > 1e6) return bin;
        console.log('⬇️ Downloading yt-dlp...');
        const res = await axios.get('https://github.com/yt-dlp/yt-dlp/releases/latest/download/' + ytdlpAsset(), { responseType: 'arraybuffer', timeout: 120000, maxRedirects: 8 });
        fs.writeFileSync(bin + '.part', Buffer.from(res.data)); fs.renameSync(bin + '.part', bin); fs.chmodSync(bin, 0o755);
        console.log('✅ yt-dlp ready');
        return bin;
    })().catch((e) => { _ytdlpReady = null; throw e; });
    return _ytdlpReady;
}
function cookiesFile() {
    const b64 = process.env.YTDLP_COOKIES_B64; if (!b64) return null;
    const f = path.join(DL_DIR, 'cookies.txt');
    try { fs.mkdirSync(DL_DIR, { recursive: true }); fs.writeFileSync(f, Buffer.from(b64, 'base64')); return f; } catch (e) { return null; }
}
let dlBusy = 0; const dlWaiters = [];
async function dlSlot() { if (dlBusy >= 1) await new Promise((r) => dlWaiters.push(r)); dlBusy++; }
function dlRelease() { dlBusy--; const n = dlWaiters.shift(); if (n) n(); }
function runYtDlp(args, timeoutMs) {
    return new Promise(async (resolve, reject) => {
        let bin; try { bin = await ensureYtDlp(); } catch (e) { return reject(Object.assign(new Error('yt-dlp could not be downloaded on this server.'), { dlCode: 'NOBIN' })); }
        const cf = cookiesFile();
        const full = ['--no-playlist', '--no-warnings', '--no-progress', '--socket-timeout', '20', '--retries', '2', '--no-cache-dir', '--restrict-filenames'].concat(cf ? ['--cookies', cf] : [], args);
        const ff = ffmpegPath(); if (ff && ff !== 'ffmpeg') full.unshift('--ffmpeg-location', ff);
        const { spawn } = require('child_process');
        const ps = spawn(bin, full, { env: Object.assign({}, process.env, { PYTHONUNBUFFERED: '1' }) });
        let out = '', err = '';
        const timer = setTimeout(() => { try { ps.kill('SIGKILL'); } catch (e) { /* ignore */ } reject(Object.assign(new Error('Timed out'), { dlCode: 'TIMEOUT' })); }, timeoutMs || 170000);
        ps.stdout.on('data', (d) => { if (out.length < 20000) out += d; });
        ps.stderr.on('data', (d) => { if (err.length < 8000) err += d; });
        ps.on('error', (e) => { clearTimeout(timer); reject(Object.assign(e, { dlCode: 'SPAWN' })); });
        ps.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve({ out, err }) : reject(Object.assign(new Error(err.slice(-400) || 'failed'), { dlCode: 'FAIL', stderr: err })); });
    });
}
function dlErrorText(e) {
    const t = String((e && (e.stderr || e.message)) || '');
    if (e && e.dlCode === 'NOBIN') return '❌ The downloader engine could not be installed on this server (no internet to GitHub?).';
    if (e && e.dlCode === 'TIMEOUT') return '❌ That took too long. Try a shorter video.';
    if (/larger than max-filesize|File is larger/i.test(t)) return `❌ That file is bigger than ${DL_MAX_MB} MB, the WhatsApp limit here. Try \`.dl <link> 360\` for a smaller quality.`;
    if (/Sign in to confirm|not a bot|cookies/i.test(t)) return '❌ YouTube asked this server to sign in (bot check). The owner can add YTDLP_COOKIES_B64 to fix it.';
    if (/private|login required|requires login|Private video/i.test(t)) return '❌ That post is private or needs a login.';
    if (/Unsupported URL/i.test(t)) return '❌ That link is not supported.';
    if (/Video unavailable|removed|not available|404|does not exist/i.test(t)) return '❌ That video is unavailable or was removed.';
    if (/live/i.test(t) && /is live|live event/i.test(t)) return '❌ Live streams cannot be downloaded.';
    return '❌ Could not download that link. Check it and try again.';
}
const URL_RE = /https?:\/\/[^\s<>"']+/i;
const pickUrl = (q, msg) => { const m = String(q || '').match(URL_RE) || String(quotedText(msg) || '').match(URL_RE); return m ? m[0] : null; };
// kind: 'video' | 'audio'
async function downloadWithYtDlp(session, from, msg, reply, url, kind, height) {
    await dlSlot();
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const base = path.join(DL_DIR, id);
    try {
        fs.mkdirSync(DL_DIR, { recursive: true });
        await reply(kind === 'audio' ? '🎧 Getting the audio...' : '⏬ Downloading your video...');
        const h = height ? `[height<=${height}]` : '[height<=720]';
        const args = kind === 'audio'
            ? ['-f', 'bestaudio/best', '-x', '--audio-format', 'mp3', '--audio-quality', '5', '--max-filesize', DL_MAX_MB + 'M', '-o', base + '.%(ext)s', '--print', 'before_dl:TITLE=%(title).120s', url]
            : ['-f', `b[ext=mp4]${h}/b${h}/bv*${h}+ba/b`, '--merge-output-format', 'mp4', '--max-filesize', DL_MAX_MB + 'M', '-o', base + '.%(ext)s', '--print', 'before_dl:TITLE=%(title).120s', url];
        const { out } = await runYtDlp(args, 170000);
        const title = ((out.match(/TITLE=(.*)/) || [])[1] || '').trim();
        const file = fs.readdirSync(DL_DIR).map((f) => path.join(DL_DIR, f)).find((f) => path.basename(f).startsWith(id) && !/\.(part|ytdl)$/.test(f));
        if (!file) throw Object.assign(new Error('no file'), { dlCode: 'FAIL' });
        const size = fs.statSync(file).size;
        if (size > DL_MAX_MB * 1048576) throw Object.assign(new Error('File is larger than max-filesize'), { dlCode: 'FAIL' });
        const buf = fs.readFileSync(file);
        const cap = `${title ? '🎬 ' + title + '\n' : ''}📦 ${fmtSize(size)}\n\n_${sc('delivered by')} ${sc(BOT_NAME)}_`;
        await sendMedia(session, from, kind === 'audio' ? 'audio' : 'video', buf, { caption: cap, maxMb: DL_MAX_MB + 5 }, { quoted: msg });
    } catch (e) {
        console.log('download:', String((e && (e.stderr || e.message)) || e).slice(0, 300));
        await reply(e && e.mediaCode ? '❌ ' + mediaErrorText(e) : dlErrorText(e));
    } finally {
        try { for (const f of fs.readdirSync(DL_DIR)) if (f.startsWith(id)) fs.unlinkSync(path.join(DL_DIR, f)); } catch (e) { /* ignore */ }
        dlRelease();
    }
}
const DL_USAGE = '❌ Send a link.\n\n`.dl <link>` video (any site)\n`.dl <link> 360` smaller quality\n`.dlaudio <link>` MP3';
const dlMatch = (url, re) => re.test(url);
function regDl(name, aliases, desc, urlRe, kind, label) {
    reg(name, { category: 'Media', desc, aliases, run: async ({ from, msg, reply, q, args, session }) => {
        const url = pickUrl(q, msg);
        if (!url) return reply(DL_USAGE);
        if (urlRe && !dlMatch(url, urlRe)) return reply('❌ That is not a ' + label + ' link.');
        const hq = parseInt((String(q).replace(url, '').match(/\b(144|240|360|480|720|1080)\b/) || [])[1], 10) || null;
        await downloadWithYtDlp(session, from, msg, reply, url, kind, hq);
    }});
}
regDl('dl', ['download', 'dlvideo', 'getvideo', 'video2'], '.dl <link> [360|480|720] — download a video from almost any site', null, 'video', 'video');
regDl('dlaudio', ['dlmp3', 'mp3dl', 'audiodl', 'toaudio'], '.dlaudio <link> — get the MP3 audio of any video link', null, 'audio', 'video');
// warm up the engine in the background so the first .dl is fast
setTimeout(() => { ensureYtDlp().catch((e) => console.log('yt-dlp warm-up skipped:', e.message)); }, 45 * 1000);
reg('ram', { category: 'System', desc: '.ram — live memory status', aliases: ['memory', 'ramstatus', 'mem'], ownerOnly: true, run: async ({ from, msg, session }) => {
    const r = ramSnapshot(), last = r.auto.last;
    await sendCard(session, from, msg, card('RAM', 'memory manager', [
        kv('status', RAM_LEVEL[r.level]),
        kv('bot ram', r.rssMb + ' / ' + r.limitMb + ' MB (' + r.rssPct + '%)'),
        kv('heap', r.heapUsedMb + ' / ' + r.heapLimitMb + ' MB (' + r.heapPct + '%)'),
        kv('host ram', r.hostUsedMb + ' / ' + r.hostTotalMb + ' MB'),
        kv('auto guard', onOff(r.guard)),
        kv('auto cleans', r.auto.cleans + (last ? ' • last ' + last.mode + ' ' + last.beforePct + '→' + last.afterPct + '%' : '')),
        kv('cached', r.caches.chats + ' chats • ' + r.caches.groupLogs + ' groups • ' + r.caches.mediaMb + ' MB media'),
        `\n${meter(Math.min(1, r.pct / 100))}  ${r.pct}%`
    ], '↳ .clearram  ·  .clearram soft  ·  .ramguard on|off'), true);
}});
reg('clearram', { category: 'System', desc: '.clearram [soft|deep] — free memory right now', aliases: ['cleanram', 'freeram', 'ramclear', 'ramclean', 'ramfree', 'clearmemory', 'clearcache'], ownerOnly: true, run: async ({ from, msg, session, args, reply }) => {
    const mode = /^s/i.test(args[0] || '') ? 'soft' : 'deep';
    await reply('🧹 Cleaning RAM (' + mode + ')...');
    const r = cleanRam(mode);
    await sendCard(session, from, msg, card('RAM cleaned', mode + ' clean', [
        kv('bot ram', r.before.rssMb + ' → ' + r.after.rssMb + ' MB'),
        kv('heap', r.before.heapUsedMb + ' → ' + r.after.heapUsedMb + ' MB'),
        kv('load', r.before.pct + '% → ' + r.after.pct + '%'),
        kv('cleared', r.did.length ? r.did.join(', ') : 'nothing large to drop'),
        `\n${meter(Math.min(1, r.after.pct / 100))}  ${r.after.pct}%`
    ], r.freedRssMb < 3 && r.freedHeapMb >= 3 ? 'ℹ️ Heap is freed; the host may show RAM dropping slowly.' : '✅ Bots, logins and settings were not touched.'), true);
}});
reg('ramguard', { category: 'System', desc: '.ramguard on|off — automatic RAM cleaning', ownerOnly: true, run: async ({ reply, args }) => {
    const v = (args[0] || '').toLowerCase();
    if (v === 'on' || v === 'off') ramGuardOn = v === 'on';
    await reply(`🛡️ Auto RAM guard: ${ramGuardOn ? 'ON ✅ (cleans at 60% and 75%)' : 'OFF ⛔ (last-resort restart still protects the server)'}\n\n\`.ramguard on\` · \`.ramguard off\``);
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
    await sock.sendMessage(from, { image: png, mimetype: 'image/png', caption: `_${sc('converted by')} ${sc(BOT_NAME)}_` }, { quoted: msg });
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
    if (pp) { try { await sendMedia(session, from, 'image', pp, { caption: text, mentions: [target] }, { quoted: msg }); return; } catch (e) { /* send the text card instead */ } }
    await session.queueSend(from, { text, mentions: [target] }, { quoted: msg });
}});
// =========================================================================
// ANTI-DELETE + VIEW-ONCE SAVER
// .antidelete  -> from then on, every message someone deletes (for everyone)
//                 is sent back to the owner automatically. No command needed
//                 each time. .vv (reply to a view-once) saves it to the owner.
// =========================================================================
const adCache = new Map();          // `${sessionId}:${msgId}` -> entry
let adMediaBytes = 0;
const AD_MAX_ENTRIES = 300;
const AD_MAX_MEDIA_EACH = 3 * 1024 * 1024;   // 3 MB per file
const AD_MAX_MEDIA_TOTAL = 24 * 1024 * 1024; // 24 MB overall (keeps RAM low)
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
    else if (v === 'chat' || v === 'inbox') { session.adMode = v; session.adModeUser = true; session.antidelete = true; }
    else session.antidelete = true; // ".antidelete" or ".antidelete on" -> enable
    saveBotCfg(session);
    await reply(card('Anti delete', 'always watching', [
        kv('status', onOff(session.antidelete)),
        kv('deliver to', session.adMode === 'inbox' ? 'your inbox (private)' : 'the same chat'),
        kv('keeps', 'text · photo · video · voice · sticker · file')
    ], `↳ ${sc('from now on every deleted message is shown again in the same chat')}\n↳ .antidelete off\n↳ .antidelete chat  ${sc('(same chat, default)')}\n↳ .antidelete inbox ${sc('(send to my own number instead)')}`));
}});
reg('vv', { category: 'Owner', desc: '.vv — reply to a view-once photo/video/voice to show it here', aliases: ['viewonce', 'vo'], ownerOnly: true, run: async ({ sock, from, msg, reply, session, args }) => {
    const ci = msg.message && msg.message.extendedTextMessage && msg.message.extendedTextMessage.contextInfo;
    if (!ci || !ci.quotedMessage) return reply('❌ Reply to a view-once photo, video or voice note with .vv');
    const d = describeMessage(ci.quotedMessage);
    if (!d.mediaType || d.mediaType === 'stickerMessage' || d.mediaType === 'documentMessage') return reply('❌ That is not a photo, video or voice note.');
    const fake = { key: { remoteJid: from, id: ci.stanzaId, participant: ci.participant }, message: d.inner };
    let buf;
    try { buf = await downloadMediaMessage(fake, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage }); }
    catch (e) { return reply('❌ Could not save it. The view-once media has probably already expired.'); }
    const from_ = ((ci.participant || from).split('@')[0]);
    const cap = card('View once', 'opened', [kv('from', '+' + from_), kv('type', d.label)]) + (d.text ? `\n\n${d.text}` : '');
    // Shown right here in the chat where you used .vv (use ".vv inbox" to send it to your own number instead).
    const toInbox = (args[0] || '').toLowerCase() === 'inbox';
    const dest = toInbox ? ownerJidOf(session) : from, o = toInbox ? {} : { quoted: msg };
    if (d.mediaType === 'imageMessage') await session.queueSend(dest, { image: buf, mimetype: (sniffType(buf).mime || 'image/jpeg'), caption: cap }, o);
    else if (d.mediaType === 'videoMessage') await session.queueSend(dest, { video: buf, mimetype: 'video/mp4', caption: cap }, o);
    else {
        await session.queueSend(dest, { text: cap }, o);
        await session.queueSend(dest, { audio: buf, mimetype: d.inner.audioMessage.mimetype || 'audio/ogg; codecs=opus', ptt: !!d.inner.audioMessage.ptt }, o);
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
    try { await sendMedia(session, from, 'image', url, { caption: card('WA DP', 'found', [kv('number', d.formatted_phone || '+' + num)]) }, { quoted: msg }); }
    catch (e) { await reply(card('WA DP', 'could not send', [mediaErrorText(e)])); }
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
    try { await sendMedia(session, from, 'video', url, { caption: card('Facebook', 'downloaded', [kv('title', title)]) + `\n_${sc('delivered by')} ${sc(BOT_NAME)}_` }, { quoted: msg }); }
    catch (e) { await reply(card('Facebook', 'could not send', [mediaErrorText(e)])); }
}});
// =========================================================================
// YOUTUBE — type a song / video NAME, pick a result by number, pick a quality.
//   .yt <name>      search, then choose audio or any video quality
//   .ytmp3 <name>   search for songs (a link still downloads straight away)
//   .ytmp4 <name>   search for videos; add a quality at the end to skip the
//                   quality question:  .ytmp4 kasun kalhara 480
// Search reads YouTube's public results page (no key) with public Piped /
// Invidious servers as a backup. Downloads use your Chama API key.
// =========================================================================
const YT_BASE = () => process.env.YT_BASE || 'https://www.youtube.com';
const YT_THUMB = (id) => (process.env.YT_THUMB_BASE || 'https://i.ytimg.com') + '/vi/' + id + '/hqdefault.jpg';
const YT_INSTANCES = () => (process.env.YT_SEARCH_INSTANCES || 'piped:https://pipedapi.kavin.rocks,invidious:https://yewtu.be,invidious:https://inv.nadeko.net')
    .split(',').map((x) => x.trim()).filter(Boolean).map((x) => { const i = x.indexOf(':'); return { type: x.slice(0, i), base: x.slice(i + 1).replace(/\/$/, '') }; });
const YT_HEADERS = { 'User-Agent': MEDIA_UA, 'Accept-Language': 'en-US,en;q=0.9', 'Cookie': 'CONSENT=YES+cb.20210328-17-p0.en+FX+417; SOCS=CAI' };
const YT_ID_RE = /(?:v=|youtu\.be\/|shorts\/|live\/|embed\/)([\w-]{11})/;
const ytSearchCache = new Map();
const trunc = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
function fmtDur(secs) { secs = Math.max(0, Math.round(secs || 0)); const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); }
function parseDur(t) { const p = String(t || '').split(':').map((x) => parseInt(x, 10)); if (!p.length || p.some(Number.isNaN)) return 0; return p.reduce((a, x) => a * 60 + x, 0); }
function fmtViews(n) { n = Number(n); if (!n) return ''; return (n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n)).replace('.0', '') + ' views'; }
function ytCollect(node, out) {
    if (out.length >= 25 || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const x of node) ytCollect(x, out); return; }
    if (node.videoRenderer && node.videoRenderer.videoId) out.push(node.videoRenderer);
    for (const k of Object.keys(node)) if (k !== 'videoRenderer') ytCollect(node[k], out);
}
function ytFromRenderer(v) {
    const text = (o) => (o && (o.simpleText || (o.runs || []).map((r) => r.text).join(''))) || '';
    const secs = parseDur(text(v.lengthText));
    if (!secs) return null; // live streams / premieres have no length
    const views = parseInt(String(text(v.viewCountText)).replace(/[^0-9]/g, ''), 10) || 0;
    const th = (v.thumbnail && v.thumbnail.thumbnails) || [];
    return { id: v.videoId, title: trunc(text(v.title), 120), channel: trunc(text(v.ownerText) || text(v.longBylineText), 40), secs, dur: fmtDur(secs), views: fmtViews(views), thumb: YT_THUMB(v.videoId), thumbAlt: th.length ? th[th.length - 1].url : '' };
}
async function ytSearchPage(query) {
    const r = await axios.get(YT_BASE() + '/results', { params: { search_query: query, sp: 'EgIQAQ==' }, headers: YT_HEADERS, timeout: 15000, validateStatus: () => true });
    const m = /var ytInitialData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/.exec(String(r.data));
    if (!m) return [];
    const raw = []; ytCollect(JSON.parse(m[1]), raw);
    return raw.map(ytFromRenderer).filter(Boolean);
}
async function ytSearchInstance(inst, query) {
    if (inst.type === 'piped') {
        const r = await axios.get(inst.base + '/search', { params: { q: query, filter: 'videos' }, timeout: 12000 });
        return (r.data.items || []).filter((x) => x.url && /watch\?v=/.test(x.url) && x.duration > 0).map((x) => {
            const id = x.url.split('v=')[1].split('&')[0];
            return { id, title: trunc(x.title, 120), channel: trunc(x.uploaderName, 40), secs: x.duration, dur: fmtDur(x.duration), views: fmtViews(x.views), thumb: YT_THUMB(id) };
        });
    }
    const r = await axios.get(inst.base + '/api/v1/search', { params: { q: query, type: 'video' }, timeout: 12000 });
    return (Array.isArray(r.data) ? r.data : []).filter((x) => x.videoId && x.lengthSeconds > 0).map((x) => ({ id: x.videoId, title: trunc(x.title, 120), channel: trunc(x.author, 40), secs: x.lengthSeconds, dur: fmtDur(x.lengthSeconds), views: fmtViews(x.viewCount), thumb: YT_THUMB(x.videoId) }));
}
async function ytSearchInnerTube(query) {
    const ver = '2.20250101.00.00';
    const body = { context: { client: { clientName: 'WEB', clientVersion: ver, hl: 'en', gl: 'LK' } }, query, params: 'EgIQAQ%3D%3D' };
    const key = process.env.YT_INNERTUBE_KEY || 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
    const r = await axios.post(YT_BASE() + '/youtubei/v1/search', body, { params: { key, prettyPrint: false }, timeout: 15000,
        headers: Object.assign({}, YT_HEADERS, { 'Content-Type': 'application/json', 'Origin': 'https://www.youtube.com', 'X-YouTube-Client-Name': '1', 'X-YouTube-Client-Version': ver }) });
    const raw = []; ytCollect(r.data, raw);
    return raw.map(ytFromRenderer).filter(Boolean);
}
function ytMethods() {
    const m = [{ name: 'YouTube page', fn: ytSearchPage }, { name: 'YouTube app API', fn: ytSearchInnerTube }];
    for (const inst of YT_INSTANCES()) m.push({ name: inst.type + ' ' + inst.base.replace(/^https?:\/\//, ''), fn: (q) => ytSearchInstance(inst, q) });
    return m;
}
async function ytSearch(query, limit) {
    limit = limit || 8;
    const key = query.toLowerCase();
    const hit = ytSearchCache.get(key);
    if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.results.slice(0, limit);
    let results = [];
    for (const m of ytMethods()) {
        if (results.length) break;
        try { results = await m.fn(query); if (!results.length) console.log(`Search via ${m.name}: no results`); }
        catch (e) { console.log(`Search via ${m.name} failed:`, (e.response && e.response.status) || e.message); }
    }
    const seen = new Set(); results = results.filter((v) => !seen.has(v.id) && seen.add(v.id)).slice(0, 10);
    if (results.length) { ytSearchCache.set(key, { at: Date.now(), results }); if (ytSearchCache.size > 100) ytSearchCache.delete(ytSearchCache.keys().next().value); }
    return results.slice(0, limit);
}
async function ytInfoFromLink(link) {
    const id = (YT_ID_RE.exec(link) || [])[1];
    if (!id) return null;
    const v = { id, title: 'YouTube video', channel: '', secs: 0, dur: '', views: '', thumb: YT_THUMB(id) };
    try { const r = await axios.get(YT_BASE() + '/oembed', { params: { url: 'https://www.youtube.com/watch?v=' + id, format: 'json' }, timeout: 8000 }); v.title = trunc(r.data.title, 120); v.channel = trunc(r.data.author_name, 40); } catch (e) { /* title stays generic */ }
    return v;
}
const ytLink = (v) => 'https://www.youtube.com/watch?v=' + v.id;
function ytResultsText(query, results, focus) {
    const rows = results.map((v, i) => `${tag(i + 1)}  *${trunc(v.title, 62)}*\n      ↳ ${[v.channel, v.dur, v.views].filter(Boolean).join('  ·  ')}`);
    return card('YouTube', trunc(query, 26), ['', ...rows, ''], `↳ ${sc('reply with a number to choose')} (1-${results.length})\n↳ ${sc('reply')} 0 ${sc('to cancel')}`);
}
function ytOptions(video, focus) {
    const tooLong = video.secs > 40 * 60;
    const A = [{ type: 'audio', label: '🎵 MP3 audio  ·  320 kbps' }, { type: 'audio-doc', label: '📄 MP3 as a file' }];
    const hints = { 144: 'tiny', 240: 'small', 360: 'mobile data', 480: 'balanced', 720: 'HD', 1080: 'Full HD · big file' };
    const V = tooLong ? [] : [144, 240, 360, 480, 720, 1080].map((q) => ({ type: 'video', quality: q, label: `🎬 Video  ·  ${q}p  (${hints[q]})` }));
    return focus === 'video' ? V.concat(A) : A.concat(V);
}
async function ytShowQuality(session, from, msg, sender, video, focus) {
    const options = ytOptions(video, focus);
    const rows = [kv('title', trunc(video.title, 70)), video.channel ? kv('channel', video.channel) : null, video.dur ? kv('length', video.dur) : null].filter(Boolean);
    let n = 0, section = '';
    const lines = [];
    for (const o of options) {
        const sec = o.type === 'video' ? 'VIDEO' : 'AUDIO';
        if (sec !== section) { section = sec; lines.push(`\n${B(sec)}  ${THIN}`); }
        lines.push(`${tag(++n)}  ${o.label}`);
    }
    if (video.secs > 40 * 60) lines.push(`\n↳ ${sc('this one is too long for video, audio only')}`);
    const text = card('YouTube', 'choose a format', [...rows, ...lines], `↳ ${sc('reply with a number')}  ·  0 ${sc('cancel')}`);
    let sent;
    try { sent = await sendMedia(session, from, 'image', video.thumb, { caption: decorate(text), maxMb: 4 }, { quoted: msg }); }
    catch (e) { sent = await session.queueSend(from, buildOut(text), { quoted: msg }); }
    rememberMenu(from, sent, { kind: 'yt-quality', video, options, sender });
}
async function ytStartSearch(ctx, query, focus, preset) {
    const { session, from, msg, sender, reply } = ctx;
    const results = await ytSearch(query, 8);
    if (!results.length) return reply(card('YouTube', 'no results', [`Nothing found for "${trunc(query, 40)}".`], `↳ ${sc('try other words, or paste the YouTube link')}`));
    const sent = await session.queueSend(from, buildOut(ytResultsText(query, results, focus)), { quoted: msg });
    rememberMenu(from, sent, { kind: 'yt-search', results, query, sender, focus, preset });
}
async function ytDownloadAudio(ctx, link, asDoc, opts) {
    const { session, from, msg, reply } = ctx; opts = opts || {};
    const data = await chamaCall(reply, 'YT MP3', '/api/v1/music/sinhalahitsongs/download', { url: link });
    if (!data) return false;
    const d = data.data || {};
    const url = d.download_link || data.download_link || data.direct_url;
    if (data.status === false || !url) { await reply(card('YT MP3', 'not found', ['Could not get that song. Try another result or link.'])); return false; }
    const title = String(d.title || opts.title || 'song').replace(/\s+/g, ' ').trim();
    if (opts.cover !== false) {
        const info = card('YT MP3', 'ready', [kv('title', title.slice(0, 90)), kv('quality', d.quality || 'mp3'), kv('format', d.format || 'mp3')], `↳ ${sc('sending audio, please wait')}`);
        let ok = false;
        if (d.thumbnail) { try { await sendMedia(session, from, 'image', d.thumbnail, { caption: info, maxMb: 6 }, { quoted: msg }); ok = true; } catch (e) { /* cover is optional */ } }
        if (!ok) await reply(info);
    }
    try {
        if (asDoc) await sendMedia(session, from, 'document', url, { mimetype: 'audio/mpeg', fileName: title.slice(0, 80).replace(/[\\/:*?"<>|]/g, '') + '.mp3' }, { quoted: msg });
        else await sendMedia(session, from, 'audio', url, {}, { quoted: msg });
        return true;
    } catch (e) { await reply(card('YT MP3', 'could not send', [mediaErrorText(e)])); return false; }
}
async function ytDownloadVideo(ctx, link, quality, opts) {
    const { session, from, msg, reply } = ctx; opts = opts || {};
    const data = await chamaCall(reply, 'YT MP4', '/api/v1/youtube/savetube/mp4', { url: link, quality });
    if (!data) return false;
    const d = data.data || {};
    const url = d.download_url || d.download_link || data.download_url;
    if (data.status === false || d.status === false || !url) { await reply(card('YT MP4', 'not found', ['Could not get that video. Try a lower quality or another result.'])); return false; }
    const mins = parseFloat(String(d.duration || '').replace(/[^0-9.]/g, '')) || 0;
    if (mins > 40) { await reply(card('YT MP4', 'too long', [kv('duration', d.duration), 'WhatsApp cannot take videos this long.'], `↳ ${sc('try .ytmp3 for the audio instead')}`)); return false; }
    const title = String(d.title || opts.title || 'video').replace(/\s+/g, ' ').trim();
    try {
        await sendMedia(session, from, 'video', url, { caption: card('YT MP4', 'ready', [kv('title', title.slice(0, 90)), kv('quality', d.format || quality + 'p'), d.duration ? kv('length', d.duration) : null].filter(Boolean)) + `\n_${sc('delivered by')} ${sc(BOT_NAME)}_` }, { quoted: msg });
        return true;
    } catch (e) { await reply(card('YT MP4', 'could not send', [mediaErrorText(e)], `↳ ${sc('try a lower quality, for example')} 360`)); return false; }
}
// Number replies to the result list / quality list.
async function handleYtReply({ session, msg, from, sender, t, entry }) {
    if (entry.sender && sender !== entry.sender) return false; // only the person who asked can choose
    if (!/^\d{1,3}$/.test(t)) return false;
    const n = parseInt(t, 10);
    const reply = (text) => session.queueSend(from, buildOut(text), { quoted: msg });
    const react = (e) => { try { session.sock.sendMessage(from, { react: { text: e, key: msg.key } }).catch(() => {}); } catch (x) { /* ignore */ } };
    if (n === 0) { await reply(card('YouTube', 'cancelled', ['No problem. Search again any time.'])); return true; }
    if (entry.kind === 'yt-search') {
        const v = entry.results[n - 1];
        if (!v) { await reply(`❌ Pick a number from 1 to ${entry.results.length}, or 0 to cancel.`); return true; }
        if (entry.preset) { // .ytmp4 name 480 -> straight to the download
            react('⏳'); const ok = await ytDownloadVideo({ session, from, msg, reply }, ytLink(v), entry.preset, { title: v.title }); react(ok ? '✅' : '❌'); return true;
        }
        await ytShowQuality(session, from, msg, sender, v, entry.focus); return true;
    }
    const o = entry.options[n - 1];
    if (!o) { await reply(`❌ Pick a number from 1 to ${entry.options.length}, or 0 to cancel.`); return true; }
    react('⏳');
    const ctx = { session, from, msg, reply };
    const ok = o.type === 'video' ? await ytDownloadVideo(ctx, ytLink(entry.video), o.quality, { title: entry.video.title })
        : await ytDownloadAudio(ctx, ytLink(entry.video), o.type === 'audio-doc', { title: entry.video.title, cover: false });
    react(ok ? '✅' : '❌');
    return true;
}
function ytQueryFrom(msg, q) {
    let query = q.trim();
    if (!query) query = quotedTextOf(msg).slice(0, 150);
    return query;
}
reg('ytmp3', { category: 'Media', desc: '.ytmp3 [song name or link] — download a song as MP3', aliases: ['song', 'mp3', 'yta', 'music'], run: async ({ from, msg, reply, q, session, sender }) => {
    const link = linkFrom(msg, q, YT_RE);
    const ctx = { session, from, msg, reply, sender };
    if (link) return void await ytDownloadAudio(ctx, link, false, { cover: true });
    const query = ytQueryFrom(msg, q);
    if (!query) return reply(card('YT MP3', 'how to use', ['Type a song name or paste a link.', kv('by name', '.ytmp3 kasun kalhara'), kv('by link', '.ytmp3 https://youtu.be/xxxx')], `↳ ${sc('with a name you get a list to choose from')}`));
    await ytStartSearch(ctx, query, 'audio');
}});
reg('ytmp4', { category: 'Media', desc: '.ytmp4 [video name or link] [quality] — download a video (144-1080)', aliases: ['ytv', 'video', 'ytvideo'], run: async ({ from, msg, reply, q, args, session, sender }) => {
    const ctx = { session, from, msg, reply, sender };
    const link = linkFrom(msg, q, YT_RE);
    const qa = args.slice().reverse().find((a) => /^(144|240|360|480|720|1080)p?$/i.test(a));
    const preset = qa ? parseInt(qa, 10) : 0;
    if (link) return void await ytDownloadVideo(ctx, link, preset || 480);
    const query = ytQueryFrom(msg, q).replace(/\s+(144|240|360|480|720|1080)p?$/i, '').trim();
    if (!query) return reply(card('YT MP4', 'how to use', ['Type a video name or paste a link.', kv('by name', '.ytmp4 funny cat video'), kv('with quality', '.ytmp4 funny cat video 360'), kv('qualities', '144 · 240 · 360 · 480 · 720 · 1080')], `↳ ${sc('lower quality = smaller, faster file')}`));
    await ytStartSearch(ctx, query, 'video', preset || 0);
}});
// =========================================================================
// TikTok · Instagram · Google Drive · lyrics search — powered by your Chama
// API key (CHAMA_API_KEY / the "CHAMA" key saved in the admin panel).
// =========================================================================
const TT_RE = /https?:\/\/(?:[\w-]+\.)?tiktok\.com\/\S+/i;
const IG_RE = /https?:\/\/(?:www\.)?(?:instagram\.com|instagr\.am)\/\S+/i;
const GD_RE = /https?:\/\/(?:drive|docs)\.google\.com\/\S+/i;
const fmtNum = (n) => { n = Number(n); if (!n) return ''; return n >= 1e6 ? (n / 1e6).toFixed(1).replace('.0', '') + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1).replace('.0', '') + 'K' : String(n); };
// Some CDNs only answer the API server itself: if our own download is refused, retry through the Chama proxy.
function chamaProxyUrl(url, referer) {
    const key = getApiKey('CHAMA');
    if (!key) return null;
    return `${CHAMA_BASE}/api/v1/download/proxy?url=${encodeURIComponent(url)}${referer ? '&referer=' + encodeURIComponent(referer) : ''}&api_key=${encodeURIComponent(key)}`;
}
async function sendMediaSmart(session, jid, kind, url, opts, sendOpts, referer) {
    try { return await sendMedia(session, jid, kind, url, opts, sendOpts); }
    catch (e) {
        const p = e && (e.mediaCode === 'HTTP' || e.mediaCode === 'NOT_MEDIA') ? chamaProxyUrl(url, referer) : null;
        if (!p) throw e;
        return await sendMedia(session, jid, kind, p, opts, sendOpts);
    }
}
function urlLeaves(obj, base, out) {
    if (out.length > 200) return out;
    if (obj !== null && typeof obj === 'object') {
        const es = Array.isArray(obj) ? obj.slice(0, 20).map((v, i) => [String(i), v]) : Object.entries(obj);
        for (const [k, v] of es) urlLeaves(v, base ? base + '.' + k : k, out);
    } else if (typeof obj === 'string' && /^https?:\/\//i.test(obj)) out.push({ path: base, value: obj });
    return out;
}
// Finds the photos / videos in an API answer of unknown shape (Instagram posts, reels, carousels).
function collectMedia(root) {
    const skipKey = /avatar|profile|original|thumb|cover|poster|preview|music|audio|source_url|page|logo|icon|author/i;
    const items = [], seen = new Set();
    for (const { path: p, value: v } of urlLeaves(root, '', [])) {
        if (skipKey.test(p) || /instagram\.com\/(p|reel|reels|tv|stories)\//i.test(v) || seen.has(v)) continue;
        const hay = (p + ' ' + v).toLowerCase();
        const type = /\.(mp4|mov|webm|m4v)(\?|$)|video/.test(hay) ? 'video' : /\.(jpe?g|png|webp|gif)(\?|$)|image|photo|picture|display/.test(hay) ? 'image' : null;
        if (!type) continue;
        seen.add(v); items.push({ url: v, type, path: p, indexed: /(^|\.)\d+(\.|$)/.test(p), hd: /hd|high|1080|720/.test(p.toLowerCase()) });
    }
    if (!items.length) return [];
    const videos = items.filter((x) => x.type === 'video');
    const pool = videos.length ? videos : items;
    if (pool.some((x) => x.indexed)) return items.filter((x) => x.indexed || x.type === pool[0].type).slice(0, 8); // carousel: every item
    return [pool.find((x) => x.hd) || pool[0]]; // one clip offered in several qualities: pick the best
}
function parseSize(v) {
    if (typeof v === 'number') return v;
    const m = /([\d.]+)\s*(b|kb|mb|gb|tb)/i.exec(String(v || ''));
    if (!m) return 0;
    return Math.round(parseFloat(m[1]) * ({ b: 1, kb: 1024, mb: 1048576, gb: 1073741824, tb: 1099511627776 }[m[2].toLowerCase()]));
}
const DOC_MIME = { pdf: 'application/pdf', zip: 'application/zip', rar: 'application/vnd.rar', '7z': 'application/x-7z-compressed', mp4: 'video/mp4', mkv: 'video/x-matroska', mp3: 'audio/mpeg', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', apk: 'application/vnd.android.package-archive', txt: 'text/plain', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };

// ---- TikTok ----
function ttNormalize(data) {
    const d = (data && data.data) || data || {}, dl = d.downloads || (data && data.downloads) || {};
    const author = d.author || {}, st = d.stats || {};
    return {
        title: String(d.title || (data && data.title) || '').replace(/\s+/g, ' ').trim(), author: author.nickname || author.unique_id || '', duration: d.duration || 0, likes: st.likes, views: st.views,
        video: dl.no_watermark_hd || dl.no_watermark || dl.no_watermark_sd || dl.with_watermark || d.play || d.hdplay || '',
        audio: dl.audio || (d.music_info && d.music_info.play_url) || d.music || '',
        images: (d.images || []).map((x) => (typeof x === 'string' ? x : x && (x.url || x.src || x.display_image))).filter(Boolean)
    };
}
async function ttFetch(link) {
    try { return ttNormalize(await chamaGet('/api/v1/tiktok', { url: link })); }
    catch (e) { console.log('Chama TikTok failed, trying the backup:', (e.response && e.response.status) || e.message); }
    const r = await axios.post('https://www.tikwm.com/api/', new URLSearchParams({ url: link }).toString(), { timeout: 30000, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    const d = (r.data && r.data.data) || {};
    return { title: String(d.title || '').trim(), author: (d.author && d.author.nickname) || '', duration: d.duration || 0, likes: d.digg_count, views: d.play_count, video: d.hdplay || d.play || '', audio: d.music || '', images: d.images || [] };
}
async function tiktokRun({ from, msg, reply, q, args, session }, audioOnly) {
    const link = linkFrom(msg, q, TT_RE);
    if (!link) return reply(card('TikTok', 'how to use', ['Send a TikTok link.', kv('video', '.tiktok https://vm.tiktok.com/xxxx'), kv('sound only', '.ttmp3 https://vm.tiktok.com/xxxx')], `↳ ${sc('you can also reply to a message that has the link')}`));
    const wantAudio = audioOnly || args.some((a) => /^(audio|mp3|sound)$/i.test(a));
    let t;
    try { t = await ttFetch(link); } catch (e) { return reply(card('TikTok', 'service busy', ['Could not reach the TikTok service. Please try again shortly.'])); }
    const info = [t.title ? kv('title', t.title.slice(0, 80)) : null, t.author ? kv('by', t.author) : null, t.duration ? kv('length', t.duration + 's') : null, t.likes ? kv('likes', fmtNum(t.likes)) : null].filter(Boolean);
    try {
        if (wantAudio) {
            if (!t.audio) return reply(card('TikTok', 'no sound', ['This post has no separate sound file.']));
            await reply(card('TikTok', 'sound', info));
            return void await sendMediaSmart(session, from, 'audio', t.audio, {}, { quoted: msg }, 'https://www.tiktok.com/');
        }
        if (t.video) return void await sendMediaSmart(session, from, 'video', t.video, { caption: card('TikTok', 'ready', info) + `\n_${sc('delivered by')} ${sc(BOT_NAME)}_` }, { quoted: msg }, 'https://www.tiktok.com/');
        if (t.images.length) { // photo slideshow post
            let n = 0;
            for (const u of t.images.slice(0, 8)) { await sendMediaSmart(session, from, 'image', u, n++ === 0 ? { caption: card('TikTok', 'photos', info) } : {}, { quoted: msg }, 'https://www.tiktok.com/'); }
            return;
        }
        await reply(card('TikTok', 'not available', ['Could not read that post. It may be private or removed.']));
    } catch (e) { await reply(card('TikTok', 'could not send', [mediaErrorText(e)], `↳ ${sc('try again, or use')} .ttmp3 ${sc('for the sound only')}`)); }
}
reg('tiktok', { category: 'Media', desc: '.tiktok [video link] — no-watermark video (add "audio" for the sound)', aliases: ['tt', 'ttdl', 'tiktokdl'], run: (ctx) => tiktokRun(ctx, false) });
reg('ttmp3', { category: 'Media', desc: '.ttmp3 [tiktok link] — the sound as MP3', aliases: ['tta', 'tiktokaudio', 'ttaudio'], run: (ctx) => tiktokRun(ctx, true) });

// ---- Instagram ----
reg('ig', { category: 'Media', desc: '.ig [instagram link] — reels, videos and photo posts', aliases: ['instagram', 'igdl', 'insta', 'reel'], run: async ({ from, msg, reply, q, session }) => {
    const link = linkFrom(msg, q, IG_RE);
    if (!link) return reply(card('Instagram', 'how to use', ['Send a public Instagram link.', kv('example', '.ig https://www.instagram.com/reel/xxxx/')], `↳ ${sc('you can also reply to a message that has the link')}`));
    const data = await chamaCall(reply, 'Instagram', '/api/v1/media/instagram', { url: link });
    if (!data) return;
    const d = data.data || {};
    const items = d.status === 'inaccessible_or_private' ? [] : collectMedia(d);
    if (!items.length) return reply(card('Instagram', 'not available', ['Could not get that post. It must be public, and the link must be a post or reel.'], `↳ ${sc('private accounts cannot be downloaded')}`));
    const title = String(d.title || d.caption || '').replace(/\s+/g, ' ').trim().slice(0, 150);
    try {
        let n = 0;
        for (const it of items) {
            const cap = n++ === 0 ? card('Instagram', items.length > 1 ? items.length + ' items' : 'ready', title ? [kv('post', title)] : []) + `\n_${sc('delivered by')} ${sc(BOT_NAME)}_` : '';
            await sendMediaSmart(session, from, it.type, it.url, { caption: cap || undefined }, { quoted: msg }, 'https://www.instagram.com/');
        }
    } catch (e) { await reply(card('Instagram', 'could not send', [mediaErrorText(e)])); }
}});

// ---- Google Drive ----
reg('gdrive', { category: 'Media', desc: '.gdrive [google drive link] — download a shared file (up to 40 MB)', aliases: ['gd', 'drive', 'gdl'], run: async ({ from, msg, reply, q, session }) => {
    const link = linkFrom(msg, q, GD_RE);
    if (!link) return reply(card('Google Drive', 'how to use', ['Send a public Google Drive file link.', kv('example', '.gdrive https://drive.google.com/file/d/xxxx/view')], `↳ ${sc('the file must be shared as "anyone with the link"')}`));
    const data = await chamaCall(reply, 'Google Drive', '/api/v1/download/gdrive', { url: link });
    if (!data) return;
    if (data.status === false || (!data.direct_download && !data.proxy_download)) return reply(card('Google Drive', 'not available', ['Could not open that file. Check that it is shared with "anyone with the link".']));
    const name = String(data.file_name || 'file').replace(/[\\/:*?"<>|]/g, '').slice(0, 120) || 'file';
    const ext = (name.split('.').pop() || '').toLowerCase();
    const size = parseSize(data.file_size);
    const rows = [kv('file', name.slice(0, 70)), kv('size', data.file_size && data.file_size !== 'Unknown' ? data.file_size : 'unknown')];
    if (data.quota_exceeded) return reply(card('Google Drive', 'limit reached', [...rows, 'Google has temporarily blocked downloads of this file (too many downloads).'], `↳ ${sc('try again later')}\n${data.view_url || ''}`));
    const open = data.view_url || link;
    if (size > MEDIA_LIMIT_MB.document * 1048576) return reply(card('Google Drive', 'too big for chat', [...rows, `WhatsApp can take up to ${MEDIA_LIMIT_MB.document} MB here.`], `↳ ${sc('open it here')}\n${open}`));
    await reply(card('Google Drive', 'sending', rows, `↳ ${sc('please wait')}`));
    try {
        await sendMediaSmart(session, from, 'document', data.direct_download || data.proxy_download, { fileName: name, mimetype: DOC_MIME[ext] || undefined }, { quoted: msg });
    } catch (e) { await reply(card('Google Drive', e && e.mediaCode === 'TOO_BIG' ? 'too big for chat' : 'could not send', [...rows, mediaErrorText(e)], `↳ ${sc('open it here')}\n${open}`)); }
}});

// ---- Lyrics search (title + link; the full lyrics are read on the source page) ----
reg('lyrics', { category: 'Tools', desc: '.lyrics [song name] — find the lyrics page (Sinhala songs too)', aliases: ['lyric', 'gee', 'sinhalalyrics'], run: async ({ reply, q }) => {
    if (!q.trim()) return reply(card('Lyrics', 'how to use', ['Type a song name.', kv('example', '.lyrics mage adara landu')], `↳ ${sc('you get the link to the lyrics page')}`));
    const data = await chamaCall(reply, 'Lyrics', '/api/v1/lyrics/sinhalahitsongs/search', { q: q.trim() });
    if (!data) return;
    const items = (data.results || data.data || []).filter((r) => r && r.title && r.url).slice(0, 6);
    if (!items.length) return reply(card('Lyrics', 'no results', [`Nothing found for "${trunc(q, 40)}".`], `↳ ${sc('try the song name in English letters or Sinhala')}`));
    const rows = items.map((r, i) => `${tag(i + 1)}  *${trunc(r.title, 70)}*\n      ${r.published ? r.published + '  ·  ' : ''}${r.url}`);
    await reply(card('Lyrics', trunc(q, 24), ['', ...rows, ''], `↳ ${sc('open a link to read the full lyrics')}`));
}});

reg('ytcheck', { category: 'Owner', desc: '.ytcheck — test which YouTube search methods work', ownerOnly: true, run: async ({ reply }) => {
    const rows = [];
    for (const m of ytMethods()) {
        const t0 = Date.now();
        try { const r = await m.fn('kasun kalhara'); rows.push(`${r.length ? '🟢' : '🟡'} ${m.name} — ${r.length} result(s), ${Date.now() - t0} ms`); }
        catch (e) { rows.push(`🔴 ${m.name} — ${(e.response && 'HTTP ' + e.response.status) || String(e.message).slice(0, 40)}`); }
    }
    await reply(card('YT search', 'self check', rows, `↳ ${sc('one green line is enough for name search to work')}`));
}});
reg('yt', { category: 'Media', desc: '.yt [song or video name] — search, then pick audio or any quality', aliases: ['play', 'ytsearch', 'yts', 'ytdl'], run: async ({ from, msg, reply, q, session, sender }) => {
    const ctx = { session, from, msg, reply, sender };
    const link = linkFrom(msg, q, YT_RE);
    if (link) { const v = await ytInfoFromLink(link); if (v) return void await ytShowQuality(session, from, msg, sender, v, 'both'); }
    const query = ytQueryFrom(msg, q);
    if (!query) return reply(card('YouTube', 'how to use', ['Type any song or video name.', kv('example', '.yt ruwan tharaka'), kv('or a link', '.yt https://youtu.be/xxxx')], `↳ ${sc('you choose the result, then audio or the video quality')}`));
    await ytStartSearch(ctx, query, 'both');
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
        await sock.sendMessage(from, { image: buffer, mimetype: 'image/png', caption: `📷 QR Code for: ${q}` }, { quoted: msg });
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
// =========================================================================
// 🧰 FILE TOOLS (v7.19): image <-> PDF, PDF -> text, OCR, compress, AI helpers
// =========================================================================
function gfUnwrap(message) {
    let m = message || {};
    for (let i = 0; i < 4; i++) {
        if (m.documentWithCaptionMessage) m = m.documentWithCaptionMessage.message || {};
        else if (m.ephemeralMessage) m = m.ephemeralMessage.message || {};
        else if (m.viewOnceMessage) m = m.viewOnceMessage.message || {};
        else if (m.viewOnceMessageV2) m = m.viewOnceMessageV2.message || {};
        else break;
    }
    return m;
}
// Finds an image / PDF / document in the message itself or in the message it replies to.
function findFileMedia(msg, from) {
    const ci = (gfUnwrap(msg.message).extendedTextMessage || {}).contextInfo || (gfUnwrap(msg.message).imageMessage || {}).contextInfo || (gfUnwrap(msg.message).documentMessage || {}).contextInfo;
    const cands = [{ message: msg.message, key: msg.key }];
    if (ci && ci.quotedMessage) cands.push({ message: ci.quotedMessage, key: { remoteJid: from, id: ci.stanzaId, participant: ci.participant } });
    for (const c of cands) {
        const m = gfUnwrap(c.message);
        const fake = { key: c.key, message: m };
        if (m.imageMessage) return { kind: 'image', mime: m.imageMessage.mimetype || 'image/jpeg', name: 'image', fake };
        if (m.documentMessage) {
            const mime = m.documentMessage.mimetype || '', name = m.documentMessage.fileName || 'file';
            if (/pdf/i.test(mime) || /\.pdf$/i.test(name)) return { kind: 'pdf', mime: 'application/pdf', name, fake };
            if (/^image\//i.test(mime)) return { kind: 'image', mime, name, fake };
            return { kind: 'doc', mime, name, fake };
        }
    }
    return null;
}
const dlMedia = (sock, fake) => downloadMediaMessage(fake, 'buffer', {}, { logger: pino({ level: 'silent' }), reuploadRequest: sock.updateMediaMessage });
const fmtSize = (n) => n > 1048576 ? (n / 1048576).toFixed(2) + ' MB' : (n / 1024).toFixed(1) + ' KB';
const cleanFileName = (n, fallback) => (String(n || '').replace(/\.pdf$/i, '').replace(/[^\w\u0D80-\u0DFF\- ]+/g, '').trim().slice(0, 50) || fallback);

// Image buffer -> normalized JPEG/PNG (fixes rotation, shrinks huge photos)
async function normalizeImage(buf, mime) {
    const sharp = tryRequire('sharp');
    if (sharp) {
        const keepPng = /png/i.test(mime);
        const pipe = sharp(buf, { failOn: 'none' }).rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true });
        return keepPng ? { buf: await pipe.png().toBuffer(), png: true } : { buf: await pipe.flatten({ background: '#ffffff' }).jpeg({ quality: 88 }).toBuffer(), png: false };
    }
    if (/png/i.test(mime)) return { buf, png: true };
    if (/jpe?g/i.test(mime)) return { buf, png: false };
    throw new Error('This image type needs the sharp package (not installed).');
}
// items: [{kind:'image', buf, mime} | {kind:'pdf', buf}] -> one PDF buffer
async function buildPdf(items) {
    const { PDFDocument } = require('pdf-lib');
    const doc = await PDFDocument.create();
    for (const it of items) {
        if (it.kind === 'pdf') {
            const src = await PDFDocument.load(it.buf, { ignoreEncryption: true });
            const pages = await doc.copyPages(src, src.getPageIndices());
            pages.forEach((pg) => doc.addPage(pg));
        } else {
            const n = await normalizeImage(it.buf, it.mime);
            const img = n.png ? await doc.embedPng(n.buf) : await doc.embedJpg(n.buf);
            const landscape = img.width > img.height;
            const W = landscape ? 841.89 : 595.28, H = landscape ? 595.28 : 841.89, M = 20;
            const k = Math.min((W - 2 * M) / img.width, (H - 2 * M) / img.height);
            const w = img.width * k, h = img.height * k;
            doc.addPage([W, H]).drawImage(img, { x: (W - w) / 2, y: (H - h) / 2, width: w, height: h });
        }
    }
    doc.setCreator(BOT_NAME); doc.setProducer(BOT_NAME);
    return Buffer.from(await doc.save());
}
const pdfQueue = new Map(); // sender -> { items:[], ts }
const PDFQ_MAX_ITEMS = 20, PDFQ_MAX_BYTES = 20 * 1024 * 1024, PDFQ_TTL = 15 * 60 * 1000;
function getPdfQ(sender) {
    const q = pdfQueue.get(sender);
    if (q && Date.now() - q.ts > PDFQ_TTL) pdfQueue.delete(sender);
    return pdfQueue.get(sender) || null;
}
const pdfLibsOk = () => !!tryRequire('pdf-lib');

reg('img2pdf', { category: 'Tools', desc: '.img2pdf — reply to an image: make a PDF', aliases: ['topdf', 'imgtopdf', 'image2pdf', 'pdfmaker'], run: async ({ sock, from, msg, reply, q }) => {
    if (!pdfLibsOk()) return reply('❌ PDF engine (pdf-lib) is not installed. Run: npm install');
    const f = findFileMedia(msg, from);
    if (!f || f.kind !== 'image') return reply('❌ Reply to an *image* with `.img2pdf`\n\n💡 Many images → one PDF: reply to each image with `.pdfadd`, then send `.pdfmake`');
    await reply('⏳ Making your PDF...');
    try {
        const buf = await dlMedia(sock, f.fake);
        const pdf = await buildPdf([{ kind: 'image', buf, mime: f.mime }]);
        await sock.sendMessage(from, { document: pdf, mimetype: 'application/pdf', fileName: cleanFileName(q, 'Image-' + Date.now().toString().slice(-6)) + '.pdf', caption: `📄 PDF ready • ${fmtSize(pdf.length)}\n_${sc('made by')} ${sc(BOT_NAME)}_` }, { quoted: msg });
    } catch (e) { console.log('img2pdf:', e.message); await reply('❌ Could not make the PDF: ' + String(e.message).slice(0, 120)); }
}});
reg('pdfadd', { category: 'Tools', desc: '.pdfadd — reply to an image or PDF to add it to your PDF (many pages)', aliases: ['addpdf', 'pdfa'], run: async ({ sock, from, msg, reply, sender }) => {
    if (!pdfLibsOk()) return reply('❌ PDF engine (pdf-lib) is not installed. Run: npm install');
    const f = findFileMedia(msg, from);
    if (!f || (f.kind !== 'image' && f.kind !== 'pdf')) return reply('❌ Reply to an image or a PDF with `.pdfadd`');
    let qd = getPdfQ(sender);
    if (!qd) { qd = { items: [], ts: Date.now() }; pdfQueue.set(sender, qd); }
    const total = qd.items.reduce((a, b) => a + b.buf.length, 0);
    if (qd.items.length >= PDFQ_MAX_ITEMS) return reply('❌ Maximum ' + PDFQ_MAX_ITEMS + ' files. Send `.pdfmake` now.');
    try {
        const buf = await dlMedia(sock, f.fake);
        if (total + buf.length > PDFQ_MAX_BYTES) return reply('❌ Too big. Send `.pdfmake` for what you have first.');
        qd.items.push({ kind: f.kind, buf, mime: f.mime }); qd.ts = Date.now();
        await reply(`✅ Added (${qd.items.length} file${qd.items.length > 1 ? 's' : ''} • ${fmtSize(total + buf.length)})\n\n➕ Add more with \`.pdfadd\`\n📄 Build with \`.pdfmake [name]\`\n🗑 Clear with \`.pdfclear\``);
    } catch (e) { await reply('❌ Could not read that file.'); }
}});
reg('pdfmake', { category: 'Tools', desc: '.pdfmake [name] — build one PDF from everything you added', aliases: ['pdfdone', 'pdfbuild', 'makepdf'], run: async ({ sock, from, msg, reply, q, sender }) => {
    const qd = getPdfQ(sender);
    if (!qd || !qd.items.length) return reply('❌ Nothing added yet. Reply to images/PDFs with `.pdfadd` first.');
    await reply('⏳ Building your PDF from ' + qd.items.length + ' file(s)...');
    try {
        const pdf = await buildPdf(qd.items);
        await sock.sendMessage(from, { document: pdf, mimetype: 'application/pdf', fileName: cleanFileName(q, 'Nimah-PDF-' + Date.now().toString().slice(-6)) + '.pdf', caption: `📄 PDF ready • ${qd.items.length} file(s) • ${fmtSize(pdf.length)}\n_${sc('made by')} ${sc(BOT_NAME)}_` }, { quoted: msg });
        pdfQueue.delete(sender);
    } catch (e) { console.log('pdfmake:', e.message); await reply('❌ Could not build the PDF: ' + String(e.message).slice(0, 120)); }
}});
reg('pdfclear', { category: 'Tools', desc: '.pdfclear — empty your PDF list', aliases: ['clearpdf', 'pdfreset'], run: async ({ reply, sender }) => { pdfQueue.delete(sender); await reply('🗑 Your PDF list is cleared.'); }});
reg('pdflist', { category: 'Tools', desc: '.pdflist — see what is in your PDF list', run: async ({ reply, sender }) => {
    const qd = getPdfQ(sender);
    if (!qd || !qd.items.length) return reply('📭 Your PDF list is empty.');
    await reply('📚 *Your PDF list*\n' + qd.items.map((x, i) => `${i + 1}. ${x.kind === 'pdf' ? '📄 PDF' : '🖼 Image'} • ${fmtSize(x.buf.length)}`).join('\n') + '\n\n`.pdfmake` to build • `.pdfclear` to empty');
}});

// pdf.js loader (ESM) + canvas
let _pdfjs = null;
async function loadPdfJs() { if (!_pdfjs) _pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs'); return _pdfjs; }
async function openPdf(buf) { const pdfjs = await loadPdfJs(); return pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise; }
function parsePageRange(arg, total, defMax) {
    const a = String(arg || '').trim().toLowerCase();
    if (!a) return Array.from({ length: Math.min(total, defMax) }, (_, i) => i + 1);
    if (a === 'all') return Array.from({ length: Math.min(total, 15) }, (_, i) => i + 1);
    const set = new Set();
    for (const part of a.split(/[,\s]+/).filter(Boolean)) {
        const m = part.match(/^(\d+)(?:-(\d+))?$/);
        if (!m) continue;
        const lo = Math.max(1, +m[1]), hi = Math.min(total, +(m[2] || m[1]));
        for (let i = lo; i <= hi && set.size < 15; i++) set.add(i);
    }
    return [...set].sort((x, y) => x - y);
}
reg('pdf2img', { category: 'Tools', desc: '.pdf2img [pages] — reply to a PDF: get pages as images (e.g. 2 | 1-3 | all)', aliases: ['pdftoimg', 'pdf2image', 'pdf2jpg', 'pdf2png'], run: async ({ sock, from, msg, reply, q }) => {
    const canvasLib = tryRequire('@napi-rs/canvas');
    if (!canvasLib || !tryRequire('pdf-lib')) return reply('❌ PDF image engine is not installed. Run: npm install');
    const f = findFileMedia(msg, from);
    if (!f || f.kind !== 'pdf') return reply('❌ Reply to a *PDF file* with `.pdf2img`\n\nExamples:\n`.pdf2img` → first 5 pages\n`.pdf2img 3` → page 3\n`.pdf2img 2-6` → pages 2 to 6\n`.pdf2img all` → up to 15 pages');
    try {
        const buf = await dlMedia(sock, f.fake);
        if (buf.length > 40 * 1024 * 1024) return reply('❌ That PDF is too large (max 40 MB).');
        await reply('⏳ Converting PDF pages to images...');
        const pdf = await openPdf(buf);
        const pages = parsePageRange(q, pdf.numPages, 5);
        if (!pages.length) return reply(`❌ That PDF has ${pdf.numPages} page(s). Example: \`.pdf2img 2-3\``);
        let sent = 0;
        for (const n of pages) {
            const page = await pdf.getPage(n);
            const base = page.getViewport({ scale: 1 });
            const scale = Math.min(2.5, Math.max(1, 1800 / Math.max(base.width, base.height)));
            const vp = page.getViewport({ scale });
            const cv = canvasLib.createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
            const ctx = cv.getContext('2d');
            ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cv.width, cv.height);
            await page.render({ canvasContext: ctx, viewport: vp }).promise;
            const png = cv.toBuffer('image/png');
            await sock.sendMessage(from, { image: png, mimetype: 'image/png', caption: `📄 Page ${n} / ${pdf.numPages}` }, { quoted: msg });
            sent++; if (sent < pages.length) await wait(700);
            page.cleanup();
        }
        await pdf.destroy();
        if (pdf.numPages > pages.length) await reply(`ℹ️ Sent ${sent} of ${pdf.numPages} pages. Use \`.pdf2img 6-10\` for more.`);
    } catch (e) { console.log('pdf2img:', e.message); await reply('❌ Could not convert that PDF' + (/password/i.test(e.message) ? ' (it is password protected).' : '.')); }
}});
reg('pdf2text', { category: 'Tools', desc: '.pdf2text — reply to a PDF: extract its text', aliases: ['pdftotext', 'pdftxt', 'readpdf'], run: async ({ sock, from, msg, reply }) => {
    if (!tryRequire('pdf-lib')) return reply('❌ PDF engine is not installed. Run: npm install');
    const f = findFileMedia(msg, from);
    if (!f || f.kind !== 'pdf') return reply('❌ Reply to a *PDF file* with `.pdf2text`');
    try {
        const buf = await dlMedia(sock, f.fake);
        const pdf = await openPdf(buf);
        let out = '';
        for (let i = 1; i <= Math.min(pdf.numPages, 60); i++) {
            const page = await pdf.getPage(i);
            const tc = await page.getTextContent();
            let line = '', last = null;
            for (const it of tc.items) { const y = it.transform && it.transform[5]; if (last !== null && Math.abs(y - last) > 2) line += '\n'; line += it.str + (it.hasEOL ? '\n' : ''); last = y; }
            out += `\n\n--- Page ${i} ---\n` + line.trim();
            page.cleanup();
        }
        out = out.trim();
        if (out.replace(/--- Page \d+ ---/g, '').trim().length < 5) return reply('⚠️ No selectable text found (it looks like a scanned PDF). Use `.pdf2img` then reply to the image with `.ocr`.');
        if (out.length <= 3500) return reply('📝 *PDF text*\n\n' + out);
        await sock.sendMessage(from, { document: Buffer.from(out, 'utf8'), mimetype: 'text/plain', fileName: cleanFileName(f.name, 'pdf-text') + '.txt', caption: `📝 Text from ${pdf.numPages} page(s) • ${out.length.toLocaleString()} characters` }, { quoted: msg });
    } catch (e) { console.log('pdf2text:', e.message); await reply('❌ Could not read that PDF.'); }
}});

async function aiVision(prompt, buf, mime) {
    const content = [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: 'data:' + (mime || 'image/jpeg') + ';base64,' + buf.toString('base64') } }];
    for (const model of ['google/gemini-2.5-flash', 'google/gemini-2.5-pro']) {
        try {
            const res = await axios.post('https://openrouter.ai/api/v1/chat/completions', { model, messages: [{ role: 'user', content }], max_tokens: 3000, temperature: 0.1 }, { headers: { 'Authorization': 'Bearer ' + OPENROUTER_API_KEY, 'Content-Type': 'application/json', 'X-Title': BOT_NAME }, timeout: 60000 });
            const c = res.data && res.data.choices && res.data.choices[0] && res.data.choices[0].message && res.data.choices[0].message.content;
            if (c && String(c).trim()) return String(c).trim();
        } catch (e) { console.log('vision ' + model + ':', (e.response && e.response.status) || e.message); }
    }
    return null;
}
reg('ocr', { category: 'Tools', desc: '.ocr — reply to an image: read the text in it (Sinhala + English)', aliases: ['imgtext', 'img2text', 'readimg', 'scantext'], run: async ({ sock, from, msg, reply }) => {
    if (!OPENROUTER_API_KEY) return reply('❌ OCR needs OPENROUTER_API_KEY.');
    const f = findFileMedia(msg, from);
    if (!f || f.kind !== 'image') return reply('❌ Reply to an *image* (photo of a page, board, bill, screenshot) with `.ocr`');
    await reply('🔎 Reading the text...');
    try {
        let buf = await dlMedia(sock, f.fake);
        const sharp = tryRequire('sharp');
        if (sharp) buf = await sharp(buf, { failOn: 'none' }).rotate().resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
        const text = await aiVision('Extract ALL text from this image exactly as written, in the original language (Sinhala, English or Tamil). Keep the line breaks and order. Do not translate, do not explain, do not add anything. If there is no text, reply exactly: NO_TEXT', buf, 'image/jpeg');
        if (!text || /^NO_TEXT$/i.test(text.trim())) return reply('⚠️ I could not find any readable text in that image.');
        if (text.length <= 3500) return reply('📝 *Text from image*\n\n' + text);
        await sock.sendMessage(from, { document: Buffer.from(text, 'utf8'), mimetype: 'text/plain', fileName: 'ocr-text.txt', caption: '📝 Text from image' }, { quoted: msg });
    } catch (e) { console.log('ocr:', e.message); await reply('❌ OCR failed. Try a clearer photo.'); }
}});
reg('imgcompress', { category: 'Tools', desc: '.imgcompress [10-95] — reply to an image: make the file smaller', aliases: ['compress', 'compressimg', 'shrink'], run: async ({ sock, from, msg, reply, args }) => {
    const sharp = tryRequire('sharp');
    if (!sharp) return reply('❌ Image engine (sharp) is not installed. Run: npm install');
    const f = findFileMedia(msg, from);
    if (!f || f.kind !== 'image') return reply('❌ Reply to an *image* with `.imgcompress` (optional quality 10-95, e.g. `.imgcompress 60`)');
    try {
        const buf = await dlMedia(sock, f.fake);
        const quality = Math.min(95, Math.max(10, parseInt(args[0], 10) || 65));
        const out = await sharp(buf, { failOn: 'none' }).rotate().resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true }).toBuffer();
        await sock.sendMessage(from, { document: out, mimetype: 'image/jpeg', fileName: 'compressed-' + Date.now().toString().slice(-5) + '.jpg', caption: `🗜 ${fmtSize(buf.length)} → *${fmtSize(out.length)}* (quality ${quality})` }, { quoted: msg });
    } catch (e) { await reply('❌ Could not compress that image.'); }
}});
async function aiText(system, user, maxTokens) {
    for (const model of [...new Set([process.env.GF_MODEL || 'google/gemini-2.5-flash', AI_FALLBACK_MODEL])]) {
        try {
            const res = await axios.post('https://openrouter.ai/api/v1/chat/completions', { model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: maxTokens || 900, temperature: 0.3 }, { headers: { 'Authorization': 'Bearer ' + OPENROUTER_API_KEY, 'Content-Type': 'application/json', 'X-Title': BOT_NAME }, timeout: 45000 });
            const c = res.data && res.data.choices && res.data.choices[0] && res.data.choices[0].message && res.data.choices[0].message.content;
            if (c && String(c).trim()) return String(c).trim();
        } catch (e) { console.log('aiText ' + model + ':', (e.response && e.response.status) || e.message); }
    }
    return null;
}
const quotedText = (msg) => { const m = gfUnwrap(msg.message); const ci = (m.extendedTextMessage || {}).contextInfo; const qm = ci && ci.quotedMessage ? gfUnwrap(ci.quotedMessage) : null; return qm ? (qm.conversation || (qm.extendedTextMessage && qm.extendedTextMessage.text) || (qm.imageMessage && qm.imageMessage.caption) || '') : ''; };
reg('summarize', { category: 'Tools', desc: '.summarize [text] — or reply to a long message', aliases: ['summary', 'tldr', 'sum'], run: async ({ msg, reply, q }) => {
    if (!OPENROUTER_API_KEY) return reply('❌ This needs OPENROUTER_API_KEY.');
    const text = (q || quotedText(msg) || '').trim();
    if (text.length < 80) return reply('❌ Send a longer text after `.summarize`, or reply to a long message with `.summarize`.');
    const out = await aiText('Summarize the text into short clear bullet points (max 6) in the SAME language as the text (Sinhala stays Sinhala, English stays English). Keep names, numbers and dates exact. No intro.', text.slice(0, 12000));
    await reply(out ? '📌 *Summary*\n\n' + out : '❌ Could not summarize right now. Try again.');
}});
reg('grammar', { category: 'Tools', desc: '.grammar [text] — fix spelling and grammar (English + Sinhala)', aliases: ['fixgrammar', 'proofread', 'correct'], run: async ({ msg, reply, q }) => {
    if (!OPENROUTER_API_KEY) return reply('❌ This needs OPENROUTER_API_KEY.');
    const text = (q || quotedText(msg) || '').trim();
    if (!text) return reply('❌ Send text after `.grammar`, or reply to a message with `.grammar`.');
    const out = await aiText('Correct the spelling and grammar of the text. Keep the same language, meaning and tone. Output ONLY the corrected text, then on a new line "✏️ " followed by a very short note of what you fixed (same language).', text.slice(0, 4000));
    await reply(out ? '✅ *Corrected*\n\n' + out : '❌ Could not check that right now.');
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
reg('ai', { category: 'Tools', desc: '.ai [prompt]', aliases: ['gpt'], run: async ({ reply, q, from, msg }) => {
    if (!q) return reply('❌ *Please provide a prompt!* \n📌 *Example:* `.ai Who is Albert Einstein?`');
    try {
        const answer = await callNimahAI(from, q, msg.pushName || null);
        if (!answer) return reply('⚠️ *AI service is currently busy. Please try again later!*');
        pushHistory(from, 'user', q);
        pushHistory(from, 'assistant', answer);
        await reply(answer + AI_WATERMARK());
    } catch (e) { await reply('⚠️ *AI service is currently busy. Please try again later!*'); }
}});

// ---- AI IMAGE GENERATION ----
// Uses Pollinations.ai — free, no API key required. Prompt goes straight in
// the URL; Baileys fetches and sends it as an image.
reg('imagine', { category: 'Tools', desc: '.imagine [prompt] — AI image generation', aliases: ['img'], run: async ({ from, msg, reply, q, session }) => {
    if (!q) return reply('❌ Describe what you want to see.\n📌 Example: `.imagine a dragon made of golden light`');
    try {
        const seed = randInt(1, 999999);
        const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(q)}?width=1024&height=1024&seed=${seed}&nologo=true`;
        await sendMedia(session, from, 'image', url, { caption: `🎨 *${q}*\n\n> Generated by ${BOT_NAME} AI` }, { quoted: msg });
    } catch (e) { await reply('❌ Image generation failed — try a different prompt or try again shortly.'); }
}});

// ---- TEXT TO SPEECH ----
reg('tts', { category: 'Tools', desc: '.tts [text] — text to speech voice note', run: async ({ from, msg, reply, q, session }) => {
    if (!q) return reply('❌ Provide text to speak.\n📌 Example: `.tts Hello, how are you?`');
    if (q.length > 200) return reply('❌ Keep it under 200 characters for a voice note.');
    try {
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&q=${encodeURIComponent(q)}&tl=auto`;
        await sendMedia(session, from, 'voice', url, {}, { quoted: msg });
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
// The ONE owner is OWNER_NUMBER (default +94 74 4136085). Owner commands work only
// from that number, whichever number the bot itself is connected with.
// (Set PAIRED_OWNER_COMMANDS=on to also let each paired number control its own bot.)
const digitsOf = (j) => String(j || '').split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
function isSuperOwner(sender) {
    const d = digitsOf(sender);
    return !!OWNER_NUMBER && !!d && d === OWNER_NUMBER;
}
function isOwner(sender, session) {
    if (isSuperOwner(sender)) return true;
    if (String(process.env.PAIRED_OWNER_COMMANDS || 'off').toLowerCase() !== 'on') return false;
    const own = session && session.ownerNumber;
    return !!own && digitsOf(sender) === own;
}
reg('gf', { category: 'Owner', desc: '.gf here | add 947XXXXXXXX | remove 947XXXXXXXX | on | off | list | nick a,b,c | style text', ownerOnly: true, run: async ({ reply, q, from, isGroup }) => {
    await gfLoad();
    const [sub, ...rest] = String(q || '').trim().split(/\s+/);
    const arg = rest.join(' ').trim();
    const act = (sub || '').toLowerCase();
    if (act === 'here') {
        if (isGroup) return reply('❌ Use this inside HER private chat.');
        if (!gfCfg.jids.includes(from)) gfCfg.jids.push(from);
        await gfSave();
        return reply('❤️ Done! This chat is now in GF mode. She will get loving replies from the bot.');
    }
    if (act === 'add') {
        const n = arg.replace(/[^0-9]/g, '');
        if (n.length < 9) return reply('❌ Example: `.gf add 94771234567`');
        if (!gfCfg.numbers.includes(n)) gfCfg.numbers.push(n);
        await gfSave();
        return reply('❤️ Added ' + n + '. Tip: if replies do not start, send `.gf here` inside her chat once.');
    }
    if (act === 'remove' || act === 'del') {
        const n = arg.replace(/[^0-9]/g, '');
        gfCfg.numbers = gfCfg.numbers.filter((x) => x !== n);
        gfCfg.jids = gfCfg.jids.filter((j) => !n || !j.includes(n));
        if (!n && !isGroup) gfCfg.jids = gfCfg.jids.filter((j) => j !== from);
        await gfSave();
        return reply('✅ Removed.');
    }
    if (act === 'on' || act === 'off') { gfCfg.enabled = act === 'on'; await gfSave(); return reply(act === 'on' ? '❤️ GF mode ON' : '💤 GF mode OFF'); }
    if (act === 'nick') {
        const list = arg.split(/[,،]/).map((x) => x.trim()).filter(Boolean).slice(0, 15);
        if (!list.length) return reply('❌ Example: `.gf nick සුදූ, මැනික, පැටියෝ`');
        gfCfg.nicks = list; await gfSave();
        return reply('✅ Pet names: ' + list.join(', '));
    }
    if (act === 'style') { gfCfg.style = arg.slice(0, 400); await gfSave(); return reply(arg ? '✅ Style saved.' : '✅ Style cleared.'); }
    const all = GF_DEFAULT_NUMBERS.concat(gfCfg.numbers, gfEnvNumbers());
    return reply(`❤️ *GF mode:* ${gfCfg.enabled ? 'ON' : 'OFF'}\n📱 Numbers: ${all.join(', ') || '-'}\n💬 Chats linked: ${gfCfg.jids.length}\n🏷️ Pet names: ${gfCfg.nicks.join(', ')}\n\n*.gf here* · *.gf add 947…* · *.gf remove 947…* · *.gf on/off* · *.gf nick a,b* · *.gf style text*`);
}});

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
        await sock.sendMessage(from, { image: buffer, mimetype: 'image/png', caption: `📱 QR code for: ${q}` }, { quoted: msg });
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
reg('grouppic', { category: 'Group', desc: '.grouppic', groupOnly: true, run: async ({ sock, from, reply, session, msg }) => {
    try {
        const url = await sock.profilePictureUrl(from, 'image');
        await sendMedia(session, from, 'image', url, { caption: '🖼️ Group Picture' }, { quoted: msg });
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
    try {
        await sendMedia(session, from, 'image', url, { caption: card('Profile pic', 'downloaded', [kv('for', label)]), mentions: target.endsWith('@s.whatsapp.net') ? [target] : undefined }, { quoted: msg });
    } catch (e) { await session.queueSend(from, buildOut(card('Profile pic', 'could not send', [mediaErrorText(e)])), { quoted: msg }); }
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
reg('getimg', { category: 'Media', desc: '.getimg [image url]', run: async ({ from, msg, reply, q, session }) => {
    if (!isHttpUrl(q)) return reply('❌ Send a direct image link. Example: .getimg https://site.com/photo.jpg');
    try { await sendMedia(session, from, 'image', q, { caption: `_${sc('delivered by')} ${sc(BOT_NAME)}_` }, { quoted: msg }); }
    catch (e) { await reply('❌ ' + mediaErrorText(e)); }
}});
reg('getvid', { category: 'Media', desc: '.getvid [video url]', run: async ({ from, msg, reply, q, session }) => {
    if (!isHttpUrl(q)) return reply('❌ Send a direct video link (.mp4). Example: .getvid https://site.com/clip.mp4');
    try { await sendMedia(session, from, 'video', q, { caption: `_${sc('delivered by')} ${sc(BOT_NAME)}_` }, { quoted: msg }); }
    catch (e) { await reply('❌ ' + mediaErrorText(e)); }
}});
reg('getaudio', { category: 'Media', desc: '.getaudio [audio url]', run: async ({ from, msg, reply, q, session }) => {
    if (!isHttpUrl(q)) return reply('❌ Send a direct audio link (.mp3). Example: .getaudio https://site.com/song.mp3');
    try { await sendMedia(session, from, 'audio', q, {}, { quoted: msg }); }
    catch (e) { await reply('❌ ' + mediaErrorText(e)); }
}});
reg('getfile', { category: 'Media', desc: '.getfile [file url]', run: async ({ from, msg, reply, q, session }) => {
    if (!isHttpUrl(q)) return reply('❌ Send a direct file link. Example: .getfile https://site.com/book.pdf');
    try {
        const name = decodeURIComponent((q.split('?')[0].split('/').pop() || 'file')).slice(0, 80) || 'file';
        await sendMedia(session, from, 'document', q, { fileName: name }, { quoted: msg });
    } catch (e) { await reply('❌ ' + mediaErrorText(e)); }
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
            soundOn: true, anticall: false, antidelete: false, adMode: 'chat',
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
            if (saved && saved.adModeUser && (saved.adMode === 'chat' || saved.adMode === 'inbox')) { s.adMode = saved.adMode; s.adModeUser = true; }
            if (saved && saved.userPassword) s.userPassword = saved.userPassword;
            if (saved && saved.ownerNumber) s.ownerNumber = saved.ownerNumber;
        });
    }
    s.currentQR = null;
    s.startedAt = Date.now();
    repairCreds(s.sessionDir);
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
        trackCommand(canonicalName(def) || command);
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
                    // One 401 can be a hiccup. Try once more before treating it as a real logout.
                    s.logoutStrikes = (Date.now() - (s.lastLogoutAt || 0) < 3 * 60 * 1000 ? (s.logoutStrikes || 0) : 0) + 1; s.lastLogoutAt = Date.now();
                    if (s.logoutStrikes < 2) {
                        console.log(`🔌 [${sessionId}] WhatsApp said logged out (strike 1). Retrying once in 20s before clearing anything.`);
                        clearTimeout(s.reconnectTimer);
                        s.reconnectTimer = setTimeout(() => { s.reconnectTimer = null; startBotSession(sessionId); }, 20000);
                        return;
                    }
                    console.log(`🔌 [${sessionId}] Logged out from a previously linked session. Clearing session and restarting pairing.`);
                    notifyOwner(`Bot +${s.ownerNumber || '?'} was logged out of WhatsApp (removed from Linked Devices). It must be paired again.`, 'logout:' + sessionId);
                }
                s.reconnectAttempts = 0;
                s.createdAt = Date.now(); // restart the 20-min pairing window
                s.ownerNumber = null; s.userPassword = null;
                dropBackup(sessionId);
                fs.rm(s.sessionDir, { recursive: true, force: true }, () => startBotSession(sessionId));
                return;
            }

            if (statusCode === DisconnectReason.badSession) {
                // A bad session is usually a half-written file, not a real logout: repair and retry first.
                s.badStrikes = (Date.now() - (s.lastBadAt || 0) < 5 * 60 * 1000 ? (s.badStrikes || 0) : 0) + 1; s.lastBadAt = Date.now();
                if (s.badStrikes < 4) {
                    console.log(`⚠️ [${sessionId}] Bad session (strike ${s.badStrikes}/3). Repairing from the local backup and retrying — nothing is deleted.`);
                    repairCreds(s.sessionDir);
                    clearTimeout(s.reconnectTimer);
                    s.reconnectTimer = setTimeout(() => { s.reconnectTimer = null; startBotSession(sessionId); }, 6000 * s.badStrikes);
                    return;
                }
                console.log(`⚠️ [${sessionId}] Bad session keeps failing. Clearing session and restarting pairing.`);
                notifyOwner(`Bot +${s.ownerNumber || '?'} had a damaged session that could not be repaired. It must be paired again.`, 'bad:' + sessionId);
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
    sock.ev.on('creds.update', () => { scheduleBackup(sessionId, 30000); clearTimeout(s.snapTimer); s.snapTimer = setTimeout(() => snapshotCreds(s.sessionDir), 15000); });

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
            if (!body) { await gfHandleMedia(msg, s); return; }
            if (!msg.key.fromMe && msg.key.remoteJid !== 'status@broadcast') trackMessage(msg.key.participant || msg.key.remoteJid);

            const args = body.trim().split(/ +/);
            const rawCommand = args[0].toLowerCase();
            const isCommandMsg = rawCommand.startsWith('.') || rawCommand.startsWith('/');
            if (msg.key.fromMe && !isCommandMsg) return;
            const from = msg.key.remoteJid;
            let sender = msg.key.fromMe ? (sock.user.id.split(':')[0] + '@s.whatsapp.net') : (msg.key.participant || msg.key.remoteJid);
            if (String(sender).endsWith('@lid')) { const alt = msg.key.participantPn || msg.key.senderPn || msg.key.participantAlt || msg.key.remoteJidAlt; if (alt) sender = alt; }
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
    if (String(process.env.BOOT_ALERT || 'on').toLowerCase() !== 'off') setTimeout(() => { const n = activeBotCount(); if (n) notifyOwner(`Server started (v${BOT_VERSION}). ${n} bot(s) are online.`, 'boot'); }, 150 * 1000);
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
        notifyOwner(`Bot +${s.ownerNumber || '?'} was offline for 3+ minutes. Restarting its connection.`, 'off:' + id);
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
    || process.env.RENDER_EXTERNAL_URL || '';
if (SELF_URL) {
    setInterval(() => { axios.get(SELF_URL.replace(/\/$/, '') + '/ping', { timeout: 15000 }).catch(() => {}); }, 4 * 60 * 1000);
    console.log('🔔 Self-ping enabled for', SELF_URL);
}

// 4) Memory guard: if the process bloats past the limit, exit cleanly so the
//    host (Railway restartPolicy ALWAYS) starts a fresh one in seconds.
const MAX_RSS_MB = parseInt(process.env.MAX_RSS_MB || String(Math.round(memLimitMb() * 0.92)), 10);
let ramFullStreak = 0;
setInterval(() => {
    let snap = ramSnapshot();
    if (snap.rssMb > MAX_RSS_MB || snap.heapPct >= 92) {
        cleanRam('deep'); snap = ramSnapshot();                 // try to recover first
        if (snap.rssMb > MAX_RSS_MB || snap.heapPct >= 92) ramFullStreak++; else ramFullStreak = 0;
        if (ramFullStreak >= 2) {                                // still full after two deep cleans
            console.log(`♻️ Memory ${snap.rssMb} MB (heap ${snap.heapPct}%) still too high after cleaning. Restarting for a clean slate.`);
            notifyOwner(`Memory stayed at ${snap.rssMb} MB after cleaning, restarting the server for a clean start.`, 'mem');
            setTimeout(() => process.exit(1), 2500);
        }
    } else ramFullStreak = 0;
}, 60 * 1000);

// Clean shutdown on host stop/redeploy.
// Graceful stop: save every session (disk copy first, then the cloud copy) so a redeploy never costs a login.
let shuttingDown = false;
['SIGTERM', 'SIGINT'].forEach((sig) => process.on(sig, async () => {
    if (shuttingDown) return; shuttingDown = true;
    console.log(`Received ${sig}, saving sessions and shutting down.`);
    try {
        for (const x of sessions.values()) if (isPaired(x)) snapshotCreds(x.sessionDir);
        await flushActivity();
        await Promise.race([Promise.all([...sessions.keys()].map((id) => { bkLastAt.delete(id); return backupSession(id); })), new Promise((r) => setTimeout(r, 2500))]);
        for (const x of sessions.values()) { try { x.sock.ev.removeAllListeners(); x.sock.end(undefined); } catch (e) { /* ignore */ } }
    } catch (e) { /* best effort */ }
    process.exit(0);
}));
