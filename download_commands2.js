'use strict';
// =========================================================================
// NIMAH MD — download commands pack 2 (v7.29)
// 50 MORE download commands, all in the Media category.
// Every command runs on a PUBLISHED, FREE, KEY-LESS public API (or the
// built-in yt-dlp engine). Nothing here needs an API key.
// Owner tool:  .dlcheck  — pings every API of this pack and tells you which
// ones are alive right now (public APIs sometimes go down; this tells you).
// Loaded from index.js:  require('./download_commands2')(deps)
// =========================================================================
const nodeCrypto = require('crypto');

module.exports = function installDownloadCommands2(D) {
    const { reg, commands, card, kv, sc, axios, sendMedia } = D;
    const botName = () => (D.getBotName ? D.getBotName() : D.BOT_NAME) || 'NIMAH MD';
    const UA = D.MEDIA_UA || 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
    const API_UA = 'NimahMD/7 (WhatsApp bot; +https://wa.me/' + (process.env.OWNER_NUMBER || '94744136085') + ')';
    const added = [];
    const probes = []; // [command, url] used by .dlcheck

    // ---------------------------------------------------------------- helpers
    const enc = encodeURIComponent;
    const trunc = (s, n) => { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
    const rnd = (a) => a[Math.floor(Math.random() * a.length)];
    const cap1 = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    const mb = (n) => (Number(n) / 1048576).toFixed(1) + ' MB';
    const get = async (url, o) => (await axios.get(url, Object.assign({ timeout: 20000, headers: { 'User-Agent': API_UA, 'Accept': 'application/json' } }, o || {}))).data;
    const getText = async (url, o) => String((await axios.get(url, Object.assign({ timeout: 20000, responseType: 'text', transformResponse: (x) => x, headers: { 'User-Agent': API_UA, 'Accept': '*/*' } }, o || {}))).data || '');
    const use = (title, text, example) => card(title, 'how to use', [text, example ? kv('example', example) : null].filter(Boolean));
    const busy = (title, st) => card(title, st === 404 ? 'not found' : 'service busy', [st === 404 ? 'Nothing was found for that.' : 'The service did not answer. Please try again shortly.']);
    const nothing = (title, what) => card(title, 'not found', [what || 'Nothing was found for that.']);
    const credit = () => `\n_${sc('delivered by')} ${sc(botName())}_`;
    const miss = (msg) => Object.assign(new Error(msg || 'not found'), { notFound: true });
    const abs = (u) => { u = String(u || ''); return u.startsWith('//') ? 'https:' + u : u; };
    const MIME = {
        pdf: 'application/pdf', zip: 'application/zip', txt: 'text/plain', epub: 'application/epub+zip', svg: 'image/svg+xml',
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', mp3: 'audio/mpeg', mp4: 'video/mp4'
    };
    const mimeOf = (name) => MIME[(String(name).split('.').pop() || '').toLowerCase()] || 'application/octet-stream';
    const safeName = (s, fallback) => (String(s || '').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 90)) || fallback || 'file';

    // senders
    const sendImg = (ctx, src, caption) => sendMedia(ctx.session, ctx.from, 'image', src, caption ? { caption } : {}, { quoted: ctx.msg });
    const sendAud = (ctx, src) => sendMedia(ctx.session, ctx.from, 'audio', src, {}, { quoted: ctx.msg });
    const sendDoc = (ctx, src, fileName, mimetype) => sendMedia(ctx.session, ctx.from, 'document', src, { fileName, mimetype: mimetype || mimeOf(fileName) }, { quoted: ctx.msg });

    // too big for WhatsApp -> give the direct link instead of a bare error
    async function guarded(ctx, title, directUrl, fn) {
        try { return await fn(); }
        catch (e) {
            if (e && e.mediaCode === 'TOO_BIG' && directUrl) return ctx.reply(card(title, 'too large for WhatsApp', [kv('direct link', directUrl)]));
            throw e;
        }
    }
    async function firstOk(items, fn, max) {
        let last;
        for (const it of items.slice(0, max || 3)) {
            try { return await fn(it); } catch (e) { last = e; }
        }
        throw last || miss();
    }

    function def(name, desc, aliases, fn, probe) {
        if (commands[name]) { console.log('download_commands2: ".' + name + '" already exists, skipped'); return; }
        const als = (aliases || []).filter((a) => !commands[a]);
        reg(name, {
            category: 'Media', desc, aliases: als,
            run: async (ctx) => {
                try { await fn(ctx); }
                catch (e) {
                    const st = e && e.response && e.response.status;
                    console.log('.' + name + ' failed:', (e && e.mediaCode) || st || (e && e.message));
                    const title = cap1(name);
                    if (e && e.mediaCode) return ctx.reply(card(title, 'could not send', [D.mediaErrorText ? D.mediaErrorText(e) : 'The file could not be sent.']));
                    if (e && e.notFound) return ctx.reply(nothing(title, e.message && e.message !== 'not found' ? e.message : undefined));
                    return ctx.reply(busy(title, st));
                }
            }
        });
        added.push(name);
        if (probe) probes.push([name, probe]);
    }

    // a picture command: getter(ctx) -> { url, alts?, rows?, tag? } | null (= show usage)
    const pic = (name, title, desc, aliases, probe, getter) => def(name, desc, aliases, async (ctx) => {
        const r = await getter(ctx);
        if (r === null) return ctx.reply(card(title, 'how to use', [desc]));
        if (!r || !r.url) throw miss();
        const cap = card(title, r.tag || 'download', r.rows || []) + credit();
        let last;
        for (const u of [r.url].concat(r.alts || []).slice(0, 4)) {
            try { await sendImg(ctx, u, cap); return; } catch (e) { last = e; }
        }
        throw last || miss();
    }, probe);

    // ======================================================================
    //  1. VIDEO / AUDIO FROM MORE SITES  (built-in yt-dlp engine)
    // ======================================================================
    if (D.downloadWithYtDlp && D.pickUrl) {
        const ytCmd = (name, label, re, kind, aliases, example) => def(name, `.${name} [${label} link] — download ${kind === 'audio' ? 'the audio' : 'the video'} from ${label}`, aliases, async (ctx) => {
            const url = D.pickUrl(ctx.q, ctx.msg);
            if (!url) return ctx.reply(use(label, `Send a ${label} link.`, example));
            if (!re.test(url)) return ctx.reply(card(label, 'wrong link', [`That is not a ${label} link.`]));
            const hq = parseInt((String(ctx.q).replace(url, '').match(/\b(144|240|360|480|720|1080)\b/) || [])[1], 10) || null;
            await D.downloadWithYtDlp(ctx.session, ctx.from, ctx.msg, ctx.reply, url, kind, hq);
        });
    }

    // ======================================================================
    //  2. DOCUMENTS & BOOKS  (PDF / EPUB / TXT)
    // ======================================================================







    // ======================================================================
    //  3. PICTURES, ICONS & AVATARS  (generated or found on free services)
    // ======================================================================


    // ======================================================================
    //  4. ANIME, MANGA & CARTOON CHARACTERS  (all safe for work)
    // ======================================================================
    const jikan = async (kind, q) => {
        const p = new URLSearchParams({ q, limit: '1' });
        if (kind !== 'characters') p.set('sfw', 'true');
        const d = await get(`https://api.jikan.moe/v4/${kind}?${p.toString()}`);
        const r = d && d.data && d.data[0];
        if (!r) throw miss('Nothing was found for that name.');
        return r;
    };
    const WAIFU_TAGS = ['maid', 'waifu', 'marin-kitagawa', 'mori-calliope', 'raiden-shogun', 'selfies', 'uniform', 'kamisato-ayaka'];

    // ======================================================================
    //  5. MUSIC ARTISTS, FOOD & DRINKS, SPACE, HISTORY
    // ======================================================================
    const audiodb = async (q) => {
        const d = await get('https://www.theaudiodb.com/api/v1/json/2/search.php?s=' + enc(q));
        const a = d && d.artists && d.artists[0];
        if (!a) throw miss('Artist not found.');
        return a;
    };

    // ======================================================================
    //  6. VOICE  (free text-to-speech, Sinhala included)
    // ======================================================================
    def('sinhalatts', '.sinhalatts [text] — a Sinhala voice message (start with ta: / en: / hi: for another language)', ['sitts', 'sinhalavoice', 'sivoice'], async (ctx) => {
        let t = ctx.q.trim();
        if (!t) return ctx.reply(use('Voice', 'Send the text to speak (up to 190 characters).', '.sinhalatts ආයුබෝවන්, ඔයාට කොහොමද?'));
        let lang = 'si';
        const m = t.match(/^([a-z]{2}):\s*([\s\S]+)/i);
        if (m) { lang = m[1].toLowerCase(); t = m[2].trim(); }
        t = t.slice(0, 190);
        const r = await axios.get(`https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${enc(lang)}&q=${enc(t)}`, { responseType: 'arraybuffer', timeout: 25000, headers: { 'User-Agent': UA, 'Referer': 'https://translate.google.com/' } });
        const buf = Buffer.from(r.data);
        if (buf.length < 800) throw miss('That language is not supported.');
        await sendAud(ctx, buf);
    }, 'https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=en&q=hi');


    // ======================================================================
    //  OWNER TOOL — .dlcheck : which download APIs are alive right now?
    // ======================================================================

    console.log(`✅ Download commands pack 2 loaded: ${added.length} new download commands`);
    return added;
};
