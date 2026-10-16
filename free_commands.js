'use strict';
// =========================================================================
// NIMAH MD — free API commands pack (v7.30)
// Brings the bot to 1000 commands. Every command here runs on a PUBLISHED,
// FREE, KEY-LESS public API (or on plain local logic). No API key needed.
// Loaded from index.js:  require('./free_commands')(deps)
// =========================================================================
module.exports = function installFreeCommands(D) {
    const { reg, commands, card, kv, sc, axios, sendMedia } = D;
    const botName = () => (D.getBotName ? D.getBotName() : D.BOT_NAME) || 'NIMAH MD';
    const API_UA = 'NimahMD/7 (WhatsApp bot; +https://wa.me/' + (process.env.OWNER_NUMBER || '94744136085') + ')';
    const added = [];

    // ---------------------------------------------------------------- helpers
    const enc = encodeURIComponent;
    const cap1 = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
    const trunc = (s, n) => { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
    const num = (n) => (isFinite(Number(n)) ? Number(n).toLocaleString('en-US', { maximumFractionDigits: 6 }) : String(n));
    const rnd = (a) => a[Math.floor(Math.random() * a.length)];
    const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
    const strip = (h) => String(h == null ? '' : h).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
    const ln = (t) => '┃ ' + t;
    const lines = (t, max) => String(t == null ? '' : t).split('\n').map((x) => x.trimEnd()).filter((x, i, a) => x.trim() || (a[i - 1] && a[i - 1].trim())).map(ln).slice(0, max || 60);
    const get = async (url, o) => (await axios.get(url, Object.assign({ timeout: 20000, headers: { 'User-Agent': API_UA, 'Accept': 'application/json' } }, o || {}))).data;
    const getText = async (url, o) => String((await axios.get(url, Object.assign({ timeout: 25000, responseType: 'text', transformResponse: (x) => x, headers: { 'User-Agent': API_UA, 'Accept': '*/*' } }, o || {}))).data || '');
    const post = async (url, body, o) => (await axios.post(url, body, Object.assign({ timeout: 25000, headers: { 'User-Agent': API_UA } }, o || {}))).data;
    const use = (title, text, example) => card(title, 'how to use', [ln(text), example ? kv('example', example) : null].filter(Boolean));
    const busy = (title, st) => card(title, st === 404 ? 'not found' : 'service busy', [ln(st === 404 ? 'Nothing was found for that.' : 'The service did not answer. Please try again shortly.')]);
    const nothing = (title, what) => card(title, 'not found', [ln(what || 'Nothing was found for that.')]);
    const credit = () => `\n_${sc('delivered by')} ${sc(botName())}_`;
    const miss = (msg) => Object.assign(new Error(msg || 'not found'), { notFound: true });
    const input = (ctx) => (ctx.q || '').trim() || ((D.quotedText ? D.quotedText(ctx.msg) : '') || '').trim();
    const sendImg = (ctx, src, caption) => sendMedia(ctx.session, ctx.from, 'image', src, caption ? { caption } : {}, { quoted: ctx.msg });
    const sendVid = (ctx, src, caption) => sendMedia(ctx.session, ctx.from, 'video', src, caption ? { caption } : {}, { quoted: ctx.msg });
    const sendAud = (ctx, src) => sendMedia(ctx.session, ctx.from, 'audio', src, {}, { quoted: ctx.msg });
    const sendAnim = async (ctx, src, caption) => { try { return await sendVid(ctx, src, caption); } catch (e) { return await sendImg(ctx, src, caption); } };
    const seed = () => Math.floor(Math.random() * 1e9);
    const fmtDate = (d) => { try { return new Date(d).toISOString().slice(0, 10); } catch (e) { return String(d); } };
    const ago = (d) => { const s = (Date.now() - new Date(d).getTime()) / 1000; if (!(s > 0)) return fmtDate(d); const u = [[31536000, 'y'], [2592000, 'mo'], [86400, 'd'], [3600, 'h'], [60, 'm']]; for (const [n, l] of u) if (s >= n) return Math.floor(s / n) + l + ' ago'; return 'just now'; };
    const kvs = (pairs) => pairs.filter((p) => p && p[1] != null && String(p[1]).trim() !== '' && String(p[1]) !== 'undefined' && String(p[1]) !== 'null').map((p) => kv(p[0], trunc(p[1], 220)));
    const numberList = (arr, n) => arr.slice(0, n || 10).map((x, i) => ln(`${i + 1}. ${x}`));
    const nums = (q) => (String(q).match(/-?\d+(?:\.\d+)?/g) || []).map(Number);

    // normalise whatever a renderer gives back
    function shape(r) {
        if (r == null || r === false) return null;
        if (typeof r === 'string') return { rows: lines(r) };
        if (Array.isArray(r)) return { rows: r };
        if (r.text != null && !r.rows) r.rows = lines(r.text);
        return r;
    }
    async function deliver(ctx, title, r) {
        r = shape(r);
        if (!r || (!r.img && !r.audio && !(r.rows && r.rows.length))) throw miss();
        const text = card(title, r.sub || 'result', r.rows || [], r.note) ;
        if (r.img) {
            const urls = [r.img].concat(r.alts || []).slice(0, 4); let last;
            for (const u of urls) { try { await (r.anim ? sendAnim : sendImg)(ctx, u, text); return; } catch (e) { last = e; } }
            if (r.rows && r.rows.length) return ctx.reply(text);
            throw last || miss();
        }
        if (r.audio) { await ctx.reply(text); return sendAud(ctx, r.audio); }
        return ctx.reply(text);
    }

    function def(name, cat, desc, aliases, fn) {
        if (commands[name]) { console.log('free_commands: ".' + name + '" already exists, skipped'); return; }
        const als = (aliases || []).filter((a) => !commands[a]);
        reg(name, {
            category: cat, desc, aliases: als,
            run: async (ctx) => {
                try { await fn(ctx); }
                catch (e) {
                    const st = e && e.response && e.response.status;
                    console.log('.' + name + ' failed:', (e && e.mediaCode) || st || (e && e.message));
                    const title = cap1(name);
                    if (e && e.mediaCode) return ctx.reply(card(title, 'could not send', [ln(D.mediaErrorText ? D.mediaErrorText(e) : 'The file could not be sent.')]));
                    if (e && e.notFound) return ctx.reply(nothing(title, e.message && e.message !== 'not found' ? e.message : undefined));
                    return ctx.reply(busy(title, st));
                }
            }
        });
        added.push(name);
    }

    // API command: build(q, ctx) -> url | {url, method, data, headers, text} | null (= usage);  render(data, q, ctx)
    function A(name, cat, usage, example, aliases, build, render, opt) {
        opt = opt || {};
        def(name, cat, `.${name}${opt.need === false ? '' : ' [input]'} — ${usage}`, aliases, async (ctx) => {
            const q = input(ctx);
            const title = opt.title || cap1(name);
            if (opt.need !== false && !q) return ctx.reply(use(title, usage, example));
            let req = await build(q, ctx);
            if (!req) return ctx.reply(use(title, usage, example));
            if (typeof req === 'string') req = { url: req };
            let data;
            if (req.method === 'POST') data = await post(req.url, req.data, { headers: Object.assign({ 'User-Agent': API_UA }, req.headers || {}) });
            else if (req.text) data = await getText(req.url, req.headers ? { headers: Object.assign({ 'User-Agent': API_UA }, req.headers) } : undefined);
            else data = await get(req.url, req.headers ? { headers: Object.assign({ 'User-Agent': API_UA, 'Accept': 'application/json' }, req.headers) } : undefined);
            return deliver(ctx, title, await render(data, q, ctx));
        });
    }
    // local command: fn(q, ctx) -> string | rows | {rows,img} | null (= usage)
    function L(name, cat, usage, example, aliases, fn, opt) {
        opt = opt || {};
        def(name, cat, `.${name}${opt.need === false ? '' : ' [input]'} — ${usage}`, aliases, async (ctx) => {
            const q = input(ctx);
            const title = opt.title || cap1(name);
            if (opt.need !== false && !q) return ctx.reply(use(title, usage, example));
            const r = await fn(q, ctx);
            if (r == null) return ctx.reply(use(title, usage, example));
            return deliver(ctx, title, r);
        });
    }
    // ======================================================================
    //  2. AI IMAGES  (Pollinations image — free, key-less)
    // ======================================================================
    const AI_IMG = [['imganime', 'AI picture in anime style', 'anime style illustration, vibrant, detailed, ', 'flux', 1024, 1024]];
    for (const [name, desc, prefix, model, w, h] of AI_IMG) {
        def(name, 'Media', `.${name} [idea] — ${desc}`, [], async (ctx) => {
            const q = input(ctx);
            if (!q) return ctx.reply(use(cap1(name), desc + '.', `.${name} a lion in a library`));
            const url = `https://image.pollinations.ai/prompt/${enc(prefix + q.slice(0, 400))}?width=${w}&height=${h}&model=${model}&nologo=true&seed=${seed()}`;
            await sendImg(ctx, url, card(cap1(name), 'ai picture', [kv('idea', trunc(q, 100))]) + credit());
        });
    }

    // ======================================================================
    //  3. TRANSLATE  (MyMemory — free, key-less)
    // ======================================================================
    const LANGS = [['sinhala', 'si'], ['english', 'en']];
    for (const [lang, code] of LANGS) {
        const name = 'to' + lang;
        def(name, 'Tools', `.${name} [text] — translate any text into ${cap1(lang)}`, [], async (ctx) => {
            const q = input(ctx);
            if (!q) return ctx.reply(use('To ' + cap1(lang), `Send text, or reply to a message, to translate it into ${cap1(lang)}.`, `.${name} good morning`));
            const d = await get(`https://api.mymemory.translated.net/get?q=${enc(q.slice(0, 450))}&langpair=${enc('Autodetect|' + code)}`);
            const t = d && d.responseData && d.responseData.translatedText;
            if (!t || /MYMEMORY WARNING|INVALID/i.test(t)) throw miss('Could not translate that.');
            return deliver(ctx, 'To ' + cap1(lang), { sub: 'translated', rows: [kv('from', trunc(q, 120))].concat(lines(strip(t))) });
        });
    }

    // ======================================================================
    //  4. REACTIONS  (nekos.best / waifu.pics — free, key-less gifs)
    // ======================================================================
    const NB = [];
    for (const [name, what] of NB) {
        def(name, 'Anime', `.${name} — anime reaction gif: ${what}`, [], async (ctx) => {
            const d = await get('https://nekos.best/api/v2/' + name);
            const r = d && d.results && d.results[0];
            if (!r || !r.url) throw miss();
            await sendAnim(ctx, r.url, card(cap1(name), 'reaction', [kv('anime', r.anime_name || 'unknown')]) + credit());
        });
    }
    const WP = [];
    for (const [name, what] of WP) {
        def(name, 'Anime', `.${name} — anime reaction gif: ${what}`, [], async (ctx) => {
            const d = await get('https://api.waifu.pics/sfw/' + name);
            if (!d || !d.url) throw miss();
            await sendAnim(ctx, d.url, card(cap1(name), 'reaction', [ln(what)]) + credit());
        });
    }

    // ======================================================================
    //  5. DEVELOPER TOOLS  (GitHub, package registries, HN, StackOverflow)
    // ======================================================================
    const repoOf = (q) => { const m = String(q).match(/(?:github\.com\/)?([\w.-]+)\/([\w.-]+)/); return m ? [m[1], m[2].replace(/\.git$/, '')] : null; };
    const GH = 'https://api.github.com';


    const hnItems = async (ids) => (await Promise.all(ids.slice(0, 8).map((id) => get(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).catch(() => null)))).filter(Boolean);

    // ======================================================================
    //  7. WEATHER, MAPS & PLACES  (Open-Meteo, Nominatim — free, key-less)
    // ======================================================================
    const geo1 = async (name) => { const r = await get('https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&name=' + enc(name)); return r && r.results && r.results[0] ? r.results[0] : null; };
    const place = (g) => g.name + (g.admin1 ? ', ' + g.admin1 : '') + (g.country ? ', ' + g.country : '');
    // weather-style command: params appended to the forecast API after geocoding the place
    function W(name, usage, example, aliases, api, params, render, title) {
        def(name, 'Search', `.${name} [city] — ${usage}`, aliases, async (ctx) => {
            const q = input(ctx); if (!q) return ctx.reply(use(title || cap1(name), usage + '.', example));
            const g = await geo1(q); if (!g) throw miss('That place was not found.');
            const base = { forecast: 'https://api.open-meteo.com/v1/forecast', marine: 'https://marine-api.open-meteo.com/v1/marine', flood: 'https://flood-api.open-meteo.com/v1/flood', air: 'https://air-quality-api.open-meteo.com/v1/air-quality' }[api];
            const d = await get(`${base}?latitude=${g.latitude}&longitude=${g.longitude}&timezone=auto&${params}`);
            return deliver(ctx, title || cap1(name), { sub: place(g), rows: render(d, g) });
        });
    }
    const cur = (d, pairs) => kvs(pairs.map(([l, k, u]) => [l, d.current && d.current[k] != null ? d.current[k] + (u || '') : null]));
    const dailyRows = (d, key, label, unit, n) => (d.daily.time || []).slice(0, n || 5).map((t, i) => kv(t.slice(5), d.daily[key][i] + (unit || '')));
    const phase = (date) => { const syn = 29.530588853; const ref = Date.UTC(2000, 0, 6, 18, 14); const age = (((date.getTime() - ref) / 86400000) % syn + syn) % syn; const names = ['New Moon 🌑', 'Waxing Crescent 🌒', 'First Quarter 🌓', 'Waxing Gibbous 🌔', 'Full Moon 🌕', 'Waning Gibbous 🌖', 'Last Quarter 🌗', 'Waning Crescent 🌘']; return { age, name: names[Math.floor((age / syn) * 8 + 0.5) % 8], lit: Math.round((1 - Math.cos(2 * Math.PI * age / syn)) / 2 * 100) }; };

    // ======================================================================
    //  8. COUNTRIES, HOLIDAYS & WORLD BANK DATA  (restcountries, Nager.Date, World Bank)
    // ======================================================================
    const rcCache = new Map();
    async function country1(q) {
        const key = q.trim().toLowerCase();
        if (rcCache.has(key)) return rcCache.get(key);
        let list;
        if (/^[a-z]{2,3}$/i.test(key)) { try { list = await get('https://restcountries.com/v3.1/alpha/' + enc(key)); list = Array.isArray(list) ? list : [list]; } catch (e) { list = null; } }
        if (!list) list = await get('https://restcountries.com/v3.1/name/' + enc(key));
        const c = (list || []).find((x) => x.name.common.toLowerCase() === key || x.name.official.toLowerCase() === key) || (list || [])[0];
        if (!c) throw miss('That country was not found.');
        rcCache.set(key, c);
        return c;
    }
    function C(name, usage, example, aliases, render) {
        def(name, 'Search', `.${name} [country] — ${usage}`, aliases, async (ctx) => {
            const q = input(ctx); if (!q) return ctx.reply(use(cap1(name), usage + '.', example));
            const c = await country1(q);
            return deliver(ctx, cap1(name), { sub: c.name.common, img: undefined, rows: render(c) });
        });
    }
    const ccOf = async (q) => { q = (q || '').trim(); if (!q) return { cc: 'LK', name: 'Sri Lanka' }; if (/^[a-z]{2}$/i.test(q)) return { cc: q.toUpperCase(), name: q.toUpperCase() }; const c = await country1(q); return { cc: c.cca2, name: c.name.common }; };
    const WB = [];
    for (const [name, ind, label, aliases, f] of WB) {
        def(name, 'Search', `.${name} [country] — ${label}, last years (default Sri Lanka)`, aliases, async (ctx) => {
            const { cc, name: cn } = await ccOf(input(ctx));
            const d = await get(`https://api.worldbank.org/v2/country/${cc}/indicator/${ind}?format=json&per_page=14`);
            const rows = ((d && d[1]) || []).filter((r) => r.value != null).slice(0, 6).map((r) => kv(r.date, f(r.value)));
            if (!rows.length) throw miss('No data for that country.');
            return deliver(ctx, cap1(label.split(' (')[0]), { sub: cn + ' · world bank', rows });
        });
    }

    // ======================================================================
    //  9. DATE, TIME & CALENDAR TOOLS  (local)
    // ======================================================================
    const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    const f4 = (x) => (Number.isInteger(x) ? String(x) : String(+x.toFixed(6)));
    // ======================================================================
    // 12. MONEY & FINANCE CALCULATORS  (local)
    // ======================================================================
    const urlOf = (q) => { q = String(q).trim().split(/\s/)[0]; return /^https?:\/\//i.test(q) ? q : 'https://' + q; };
    // ======================================================================
    // 14. COLORS, QR CODES, BARCODES, CHARTS & AVATARS
    // ======================================================================
    const hexOf = (q) => { q = q.trim().replace(/^#/, ''); if (/^[0-9a-f]{3}$/i.test(q)) q = q.split('').map((c) => c + c).join(''); return /^[0-9a-f]{6}$/i.test(q) ? q.toLowerCase() : null; };
    const QR = (data, extra) => `https://api.qrserver.com/v1/create-qr-code/?size=500x500&margin=10&data=${enc(data)}${extra || ''}`;
    const QRS = [];
    for (const [name, desc, example, mk] of QRS) {
        def(name, 'Tools', `.${name} [data] — ${desc}`, [], async (ctx) => {
            const q = input(ctx); const data = q && mk(q);
            if (!data) return ctx.reply(use(cap1(name), desc + '.', example));
            await sendImg(ctx, QR(data), card(cap1(name), 'qr code', [kv('data', trunc(data.replace(/\n/g, ' '), 80))]) + credit());
        });
    }
    const BC = [];
    for (const [name, desc, id, example] of BC) {
        def(name, 'Tools', `.${name} [text] — ${desc}`, [], async (ctx) => {
            const q = input(ctx); if (!q) return ctx.reply(use(cap1(name), desc + '.', `.${name} ${example}`));
            await sendImg(ctx, `https://bwip-js.metafloor.com/?bcid=${id}&text=${enc(q)}&scale=3&includetext`, card(cap1(name), 'barcode', [kv('data', trunc(q, 60))]) + credit());
        });
    }
    const QC = (cfg, w, h) => `https://quickchart.io/chart?bkg=white&w=${w || 700}&h=${h || 450}&c=${enc(JSON.stringify(cfg))}`;
    const chartData = (q) => { const p = q.split(/[,\n]+/).map((x) => x.trim()).filter(Boolean).map((x) => { const m = x.match(/^(.*?)[\s:=]+(-?[\d.]+)$/); return m ? [m[1].trim(), +m[2]] : null; }).filter(Boolean); return p.length >= 2 ? p : null; };

    // ======================================================================
    // 15. WORD TOOLS  (Datamuse — free, key-less)
    // ======================================================================
    const DM = [];
    for (const [name, desc, key, sub] of DM) {
        A(name, 'Text', desc, `.${name} ocean`, [], (q) => `https://api.datamuse.com/words?max=15&${key}=${enc(q.trim())}`, (d) => (d || []).length && ({ sub, rows: lines(d.map((w) => w.word).join(', ')) }));
    }

    // ======================================================================
    // 16. QUOTES, JOKES & FUN  (public joke / quote APIs + local)
    // ======================================================================
    // ---- local fun ----

    // ======================================================================
    // 17. SPACE & SCIENCE
    // ======================================================================
    const SX = 'https://api.spacexdata.com/v4';
    const spx = (l) => kvs([['mission', l.name], ['date', fmtDate(l.date_utc)], ['flight', '#' + l.flight_number], ['success', l.success == null ? 'pending' : l.success ? 'yes' : 'no'], ['details', trunc(l.details || '', 200)]]);
    let PT = null;
    const periodic = async () => PT || (PT = (await get('https://raw.githubusercontent.com/Bowserinator/Periodic-Table-JSON/master/PeriodicTableJSON.json', { timeout: 30000 })).elements);
    // the periodic table is read from one cached file, so register it directly:

    // ======================================================================
    // 18. MOVIES, TV, MUSIC, BOOKS & ANIME  (TVmaze, iTunes, Deezer, Jikan ...)
    // ======================================================================
    const IT = (name, media, desc, example) => A(name, 'Search', desc, example, [], (q) => `https://itunes.apple.com/search?limit=6&media=${media}&term=${enc(q)}`, (d) => d && d.results && d.results.length && ({ img: (d.results[0].artworkUrl100 || '').replace('100x100', '600x600'), rows: numberList(d.results.map((r) => `${trunc(r.trackName || r.collectionName || r.artistName, 55)} — ${trunc(r.artistName || '', 30)}${r.trackPrice > 0 ? ' · $' + r.trackPrice : ''}`), 6) }));
    IT('itmovie', 'movie', 'search movies on iTunes', '.itmovie inception');    const JK = 'https://api.jikan.moe/v4';
    const animeRow = (a) => `${a.title} ⭐${a.score || '?'} (${a.type || ''}${a.episodes ? ', ' + a.episodes + ' eps' : ''})`;
    const TRIV = [];
    for (const [name, id, label] of TRIV) {
        A(name, 'Fun', `a ${label} trivia question`, '', [], () => `https://opentdb.com/api.php?amount=1&category=${id}&encode=url3986`, (d) => { const x = d && d.results && d.results[0]; if (!x) return null; const dec = (s) => decodeURIComponent(s); const opts = x.incorrect_answers.map(dec).concat(dec(x.correct_answer)).sort(() => Math.random() - 0.5); return kvs([['question', dec(x.question)], ['difficulty', x.difficulty], ['options', opts.join('  |  ')], ['answer', '||' + dec(x.correct_answer) + '||']]); }, { need: false, title: 'Trivia · ' + label });
    }

    // ======================================================================
    // 19. GAMES  (CheapShark, FreeToGame, GamerPower, Steam, Scryfall, YGOPro, Valorant ...)
    // ======================================================================
    const mtg = (c) => ({ img: c.image_uris && c.image_uris.normal || (c.card_faces && c.card_faces[0].image_uris && c.card_faces[0].image_uris.normal), rows: kvs([['card', c.name], ['type', c.type_line], ['cost', c.mana_cost], ['set', c.set_name], ['rarity', c.rarity], ['price', c.prices && c.prices.usd && '$' + c.prices.usd], ['text', trunc((c.oracle_text || '').replace(/\n/g, ' '), 200)]]) });
    const VAL = 'https://valorant-api.com/v1';
    const DND = 'https://www.dnd5eapi.co/api';
    // PokeAPI extras
    const PK = 'https://pokeapi.co/api/v2';
    const pkn = (q) => enc(q.trim().toLowerCase().replace(/\s+/g, '-'));
    const eng = (arr, k) => ((arr || []).find((x) => x.language.name === 'en') || {})[k || 'effect'];

    // ======================================================================
    // 20. FOOD & DRINK  (TheMealDB, TheCocktailDB)
    // ======================================================================
    const MEAL = 'https://www.themealdb.com/api/json/v1/1';
    const mealList = (d) => d && d.meals && d.meals.length && ({ img: d.meals[0].strMealThumb, rows: numberList(d.meals.slice(0, 10).map((m) => m.strMeal), 10) });
    const CK = 'https://www.thecocktaildb.com/api/json/v1/1';
    const drinkList = (d) => d && d.drinks && d.drinks.length && ({ img: d.drinks[0].strDrinkThumb, rows: numberList(d.drinks.slice(0, 10).map((m) => m.strDrink), 10) });

    // ======================================================================
    // 21. FAITH & WISDOM  (Aladhan, AlQuran Cloud, Bible API, Sefaria, Vedic Scriptures)
    // ======================================================================
    A('asmaulhusna', 'Islamic', 'the 99 names of Allah (or one by number)', '.asmaulhusna 1', ['99names'], (q) => 'https://api.aladhan.com/v1/asmaAlHusna' + (parseInt(q, 10) >= 1 && parseInt(q, 10) <= 99 ? '/' + parseInt(q, 10) : ''), (d) => { const a = d && d.data; if (!a) return null; if (a.length === 1) return kvs([['no.', a[0].number], ['name', a[0].name], ['transliteration', a[0].transliteration], ['meaning', a[0].en.meaning]]); return numberList(a.slice(0, 99).map((x) => `${x.transliteration} — ${x.en.meaning}`), 99).slice(0, 40); }, { need: false });
    A('qibla', 'Islamic', 'qibla direction from a city', '.qibla Colombo', ['qiblah'], async (q) => { const g = await geo1(q); return g && `https://api.aladhan.com/v1/qibla/${g.latitude}/${g.longitude}`; }, (d, q) => d && d.data && kvs([['place', q], ['qibla bearing', d.data.direction.toFixed(2) + '° from north (clockwise)']]));

    console.log('free_commands: ' + added.length + ' commands added');
};
