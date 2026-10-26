'use strict';
// =========================================================================
// NIMAH MD — SCHEDULED MESSAGES (v7.32)
//   .schedule 12:00am 94771234567 Happy birthday! 🎂     (next 12:00 AM)
//   .schedule 00:00 05/11 94771234567 message            (on 5 November)
//   .schedule 7:30pm here Take your medicine daily       (repeats daily)
//   .bday 94771234567 05/11 [message]                    (every year at 12:00 AM)
//   .schedule list | .schedule cancel <id> | .schedule clear
// Times are Sri Lanka time (BOT_TIMEZONE). Saved to disk (and Firestore), so a restart does not lose them.
// If the bot is offline at the time, it sends as soon as it is back (up to 6 hours late).
// =========================================================================
const path = require('path');

module.exports = function installSchedule(D) {
    const { reg, commands, card, kv, sc, fs, sessions, fsGet, fsSet, SESSION_ROOT, quotedTextOf } = D;
    const TZ = process.env.BOT_TIMEZONE || 'Asia/Colombo';
    const FILE = path.join(SESSION_ROOT, 'scheduled_messages.json');
    const MAX_PER_BOT = 50, MAX_LATE_MS = 6 * 3600 * 1000;
    let items = [];
    let loaded = false;

    // ---------------------------------------------------------------- time helpers (zone aware)
    const dtf = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    function tzParts(ms) {
        const o = {};
        for (const p of dtf.formatToParts(new Date(ms))) o[p.type] = parseInt(p.value, 10);
        return { y: o.year, m: o.month, d: o.day, h: o.hour % 24, mi: o.minute, s: o.second };
    }
    function zonedToMs(y, m, d, h, mi) {
        const guess = Date.UTC(y, m - 1, d, h, mi);
        const p = tzParts(guess);
        return guess - (Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) - guess);
    }
    const fmtWhen = (ms) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(ms)).replace(/\b(am|pm)\b/i, (x) => x.toUpperCase());
    function fmtIn(ms) {
        let s = Math.max(0, Math.round(ms / 1000));
        const d = Math.floor(s / 86400); s -= d * 86400;
        const h = Math.floor(s / 3600); s -= h * 3600;
        const m = Math.floor(s / 60);
        return (d ? d + 'd ' : '') + (h || d ? h + 'h ' : '') + m + 'm';
    }
    function nextRepeat(it) {
        const p = tzParts(it.at);
        if (it.repeat === 'yearly') return zonedToMs(p.y + 1, p.m, p.d, p.h, p.mi);
        if (it.repeat === 'weekly') return it.at + 7 * 86400000;
        return it.at + 86400000; // daily
    }

    // ---------------------------------------------------------------- storage
    function readFile() { try { const j = JSON.parse(fs.readFileSync(FILE, 'utf8')); return Array.isArray(j) ? j : []; } catch (e) { return []; } }
    let saveTimer = null;
    function save() {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            const json = JSON.stringify(items, (k, v) => (k === 'sending' ? undefined : v));
            fs.writeFile(FILE, json, () => {});
            try { fsSet('studio', 'scheduledMessages', { json }); } catch (e) { /* offline is fine */ }
        }, 300);
    }
    async function load() {
        if (loaded) return; loaded = true;
        items = readFile();
        try {
            const d = await fsGet('studio', 'scheduledMessages', null);
            if (d && d.json) {
                const remote = JSON.parse(d.json);
                const have = new Set(items.map((x) => x.id));
                for (const r of remote) if (r && r.id && !have.has(r.id)) items.push(r);
            }
        } catch (e) { /* keep local copy */ }
    }
    load();

    // ---------------------------------------------------------------- parsing
    const TIME_RE = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i;
    function parseTime(tok, next) {
        const t = String(tok || '').toLowerCase();
        if (t === 'midnight') return { h: 0, mi: 0, used: 1 };
        if (t === 'noon') return { h: 12, mi: 0, used: 1 };
        let m = TIME_RE.exec(t), used = 1;
        if (!m) return null;
        let [, hh, mm, ap] = m;
        if (!ap && next && /^(am|pm)$/i.test(next)) { ap = next; used = 2; }
        if (!ap && !mm && String(tok).length > 2) return null; // plain long numbers are phone numbers, not times
        let h = parseInt(hh, 10), mi = mm ? parseInt(mm, 10) : 0;
        if (mi > 59 || h > 24) return null;
        if (ap) { ap = ap.toLowerCase(); if (h < 1 || h > 12) return null; if (ap === 'am') h = h === 12 ? 0 : h; else h = h === 12 ? 12 : h + 12; }
        if (h === 24) h = 0;
        return { h, mi, used };
    }
    function parseDate(tok, nowP) {
        const t = String(tok || '').toLowerCase();
        if (t === 'today') return { y: nowP.y, m: nowP.m, d: nowP.d, explicit: 'today' };
        if (t === 'tomorrow' || t === 'heta' || t === 'හෙට') { const x = tzParts(zonedToMs(nowP.y, nowP.m, nowP.d, 12, 0) + 86400000); return { y: x.y, m: x.m, d: x.d, explicit: 'date' }; }
        let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
        if (m) return { y: +m[1], m: +m[2], d: +m[3], explicit: 'date' };
        m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/.exec(t); // DD/MM or DD/MM/YYYY
        if (m) return { y: m[3] ? +m[3] : null, m: +m[2], d: +m[1], explicit: 'date' };
        return null;
    }
    function parseTarget(tok) {
        const t = String(tok || '');
        if (/^here$/i.test(t)) return { here: true };
        if (/@(s\.whatsapp\.net|g\.us)$/.test(t)) return { jid: t };
        const digits = t.replace(/[^0-9]/g, '');
        if (/^\+?[\d\s-]{9,16}$/.test(t) && digits.length >= 9) {
            let n = digits;
            if (n.startsWith('0') && n.length === 10) n = '94' + n.slice(1); // 07XXXXXXXX -> 947XXXXXXXX
            return { jid: n + '@s.whatsapp.net' };
        }
        return null;
    }

    function plan(args, defaults) {
        const nowMs = Date.now(), nowP = tzParts(nowMs);
        const o = { time: defaults && defaults.time || null, date: null, repeat: defaults && defaults.repeat || null, target: null };
        let i = 0;
        for (; i < args.length; i++) {
            const tok = args[i];
            if (!o.time) { const t = parseTime(tok, args[i + 1]); if (t) { o.time = t; i += t.used - 1; continue; } }
            if (!o.date) { const d = parseDate(tok, nowP); if (d) { o.date = d; continue; } }
            if (!o.repeat && /^(daily|weekly|yearly|everyday)$/i.test(tok)) { o.repeat = /^(daily|everyday)$/i.test(tok) ? 'daily' : tok.toLowerCase(); continue; }
            if (!o.target) { const t = parseTarget(tok); if (t) { o.target = t; continue; } }
            break;
        }
        o.text = args.slice(i).join(' ').trim();
        if (!o.time) return { error: 'I could not find a time. Example: 12:00am or 7:30pm' };
        let y, m, d;
        if (o.date) {
            m = o.date.m; d = o.date.d;
            y = o.date.y || nowP.y;
            let at = zonedToMs(y, m, d, o.time.h, o.time.mi);
            if (!o.date.y && at <= nowMs + 5000) { y += 1; at = zonedToMs(y, m, d, o.time.h, o.time.mi); } // DD/MM without a year: next one
            o.at = at;
        } else {
            let at = zonedToMs(nowP.y, nowP.m, nowP.d, o.time.h, o.time.mi);
            if (at <= nowMs + 5000) at += 86400000; // already passed today -> tomorrow
            o.at = at;
        }
        if (o.at <= nowMs) return { error: 'That time is already in the past.' };
        if (o.at - nowMs > 400 * 86400000) return { error: 'Please pick a time within the next 13 months.' };
        return o;
    }

    // ---------------------------------------------------------------- create / list / cancel
    const newId = () => { let id; do { id = Math.random().toString(36).slice(2, 6); } while (items.some((x) => x.id === id)); return id; };
    const label = (jid) => (jid.endsWith('@g.us') ? 'group' : '+' + jid.split('@')[0]);
    const mine = (session) => items.filter((x) => x.sid === session.id).sort((a, b) => a.at - b.at);

    async function create(ctx, parsed) {
        const { session, from, msg } = ctx;
        await load();
        if (mine(session).length >= MAX_PER_BOT) return ctx.reply(`❌ You already have ${MAX_PER_BOT} scheduled messages. Cancel one first.`);
        let text = parsed.text || (quotedTextOf ? quotedTextOf(msg) : '');
        if (!text) return ctx.reply('❌ What should I send? Add the message after the time and number.');
        if (text.length > 1500) return ctx.reply('❌ Keep the message under 1500 characters.');
        let jid = parsed.target && parsed.target.jid ? parsed.target.jid : from;
        if (/@s\.whatsapp\.net$/.test(jid) && parsed.target && parsed.target.jid && session.sock && session.sock.onWhatsApp) {
            try {
                const r = await session.sock.onWhatsApp(jid);
                if (r && r[0] && r[0].exists === false) return ctx.reply('❌ That number is not on WhatsApp. Use the country code, e.g. 94771234567');
                if (r && r[0] && r[0].jid) jid = r[0].jid;
            } catch (e) { /* cannot verify, schedule anyway */ }
        }
        const it = { id: newId(), sid: session.id, jid, text, at: parsed.at, repeat: parsed.repeat || null, notify: from, created: Date.now() };
        items.push(it); save();
        const rows = [
            kv('🆔 id', it.id), kv('👤 to', jid === from ? 'this chat' : label(jid)),
            kv('🕛 when', fmtWhen(it.at)), kv('⏳ in', fmtIn(it.at - Date.now())),
            it.repeat ? kv('🔁 repeats', it.repeat) : null, kv('💬 message', (() => { const t = text.replace(/\s+/g, ' '); return t.length > 70 ? t.slice(0, 69) + '…' : t; })())
        ].filter(Boolean);
        return ctx.reply(card('Scheduled', 'sri lanka time', rows, `↳ .schedule list   ·   .schedule cancel ${it.id}`));
    }

    const HELP = () => card('Schedule', 'send a message later', [
        kv('time', '12:00am · 7:30pm · 00:00'),
        kv('date', 'optional: 05/11 · 05/11/2026 · tomorrow'),
        kv('to', 'a number (94771234567) or here'),
        kv('repeat', 'optional: daily · weekly · yearly'),
        '',
        kv('example', '.schedule 12:00am 94771234567 Happy birthday! 🎂'),
        kv('example', '.schedule 7:30am daily here Good morning ☀️'),
        kv('birthday', '.bday 94771234567 05/11 Happy birthday!'),
        kv('manage', '.schedule list · cancel <id> · clear')
    ]);

    reg('schedule', { category: 'Tools', desc: '.schedule [time] [number] [message] — send a message later', ownerOnly: true, aliases: ['sch', 'later', 'sendlater'], run: async (ctx) => {
        const args = ctx.args || [];
        const sub = String(args[0] || '').toLowerCase();
        await load();
        if (!args.length || sub === 'help') return ctx.reply(HELP());
        if (sub === 'list' || sub === 'ls') {
            const list = mine(ctx.session);
            if (!list.length) return ctx.reply(card('Schedule', 'empty', ['Nothing is scheduled.'], '↳ .schedule 12:00am 94771234567 Happy birthday!'));
            const rows = list.slice(0, 15).map((x, i) => `${i + 1}️⃣ *${x.id}*  ·  ${label(x.jid)}\n┃      ╰ ${fmtWhen(x.at)}${x.repeat ? ' · 🔁 ' + x.repeat : ''}\n┃      ╰ ${x.text.replace(/\s+/g, ' ').length > 40 ? x.text.replace(/\s+/g, ' ').slice(0, 39) + '…' : x.text.replace(/\s+/g, ' ')}`);
            return ctx.reply(card('Schedule', list.length + ' waiting', rows, '↳ .schedule cancel <id>'));
        }
        if (sub === 'cancel' || sub === 'del' || sub === 'delete' || sub === 'remove') {
            const id = String(args[1] || '').toLowerCase();
            const n = items.length;
            items = items.filter((x) => !(x.sid === ctx.session.id && x.id === id));
            if (items.length === n) return ctx.reply('❌ No scheduled message with that id. See .schedule list');
            save(); return ctx.reply('✅ Cancelled.');
        }
        if (sub === 'clear') {
            const n = items.length;
            items = items.filter((x) => x.sid !== ctx.session.id);
            save(); return ctx.reply(`✅ Cleared ${n - items.length} scheduled message(s).`);
        }
        const p = plan(args);
        if (p.error) return ctx.reply('❌ ' + p.error + '\n\n' + HELP());
        return create(ctx, p);
    } });

    reg('bday', { category: 'Tools', desc: '.bday [number] [DD/MM] [message] — birthday wish at 12:00 AM every year', ownerOnly: true, aliases: ['birthday', 'bdaywish'], run: async (ctx) => {
        const args = ctx.args || [];
        if (!args.length) return ctx.reply(card('Birthday wish', 'sent at midnight, every year', [kv('example', '.bday 94771234567 05/11 Happy birthday Nimal! 🎂'), kv('no message?', 'a sweet default wish is sent')]));
        const p = plan(args, { time: { h: 0, mi: 0 }, repeat: 'yearly' });
        if (p.error) return ctx.reply('❌ ' + p.error);
        if (!p.date) return ctx.reply('❌ Add the birthday date as DD/MM, e.g. .bday 94771234567 05/11');
        if (!p.text) p.text = '🎂🎉 සුබ උපන්දිනයක් වේවා! 🎉🎂\nHappy Birthday! සතුටින්, සෙනෙහසින්, සුවයෙන් පිරුණු අලුත් වසරක් වේවා ✨🥳';
        return create(ctx, p);
    } });

    // ---------------------------------------------------------------- the clock
    let busy = false;
    async function tick() {
        if (busy || !loaded || !items.length) return;
        busy = true;
        try {
            const now = Date.now();
            for (const it of items.slice()) {
                if (it.at > now || it.sending) continue;
                const s = sessions.get(it.sid);
                if (!s || !s.isConnected || !s.queueSend) {
                    if (now - it.at > MAX_LATE_MS) { // too late: skip it (repeating ones move on)
                        if (it.repeat) { while (it.at <= now) it.at = nextRepeat(it); } else items = items.filter((x) => x !== it);
                        save();
                    }
                    continue;
                }
                it.sending = true;
                try {
                    await s.queueSend(it.jid, { text: it.text });
                    console.log(`⏰ scheduled message ${it.id} sent to ${label(it.jid)}`);
                    if (it.notify && it.notify !== it.jid) {
                        try { await s.queueSend(it.notify, { text: `✅ Scheduled message *${it.id}* was delivered to ${label(it.jid)}.` }); } catch (e) { /* ignore */ }
                    }
                    if (it.repeat) { while (it.at <= now) it.at = nextRepeat(it); it.sending = false; } else items = items.filter((x) => x !== it);
                    save();
                } catch (e) {
                    it.sending = false;
                    it.fails = (it.fails || 0) + 1;
                    console.log(`⏰ scheduled message ${it.id} failed (${it.fails}):`, e && e.message);
                    if (it.fails >= 5) { items = items.filter((x) => x !== it); save(); } else it.at = now + 30000; // try again in 30s
                }
            }
        } finally { busy = false; }
    }
    setInterval(() => { tick().catch(() => {}); }, 1000).unref();

    console.log('schedule_commands: ready (' + TZ + ')');
    return { plan, tzParts, zonedToMs, getItems: () => items };
};
