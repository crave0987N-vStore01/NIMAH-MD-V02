'use strict';
// =========================================================================
// NIMAH MD — extra commands pack (v7.27)
// 100 commands that run on PUBLISHED, FREE, KEY-LESS public APIs.
// Nothing here needs an API key. Loaded from index.js:  require('./extra_commands')(deps)
// =========================================================================
const nodeCrypto = require('crypto');

module.exports = function installExtraCommands(D) {
    const { reg, commands, card, kv, sc, axios, sendMedia, mediaErrorText, pick } = D;
    const botName = () => (D.getBotName ? D.getBotName() : D.BOT_NAME) || 'NIMAH MD';
    const UA = D.MEDIA_UA || 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
    const API_UA = 'NimahMD/7 (WhatsApp bot; +https://wa.me/' + (process.env.OWNER_NUMBER || '94744136085') + ')';
    const added = [];

    // ---------------------------------------------------------------- helpers
    const trunc = (s, n) => { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
    const enc = encodeURIComponent;
    const strip = (h) => String(h == null ? '' : h).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
    const num = (n) => Number(n).toLocaleString('en-US');
    const get = async (url, o) => (await axios.get(url, Object.assign({ timeout: 20000, headers: { 'User-Agent': API_UA, 'Accept': 'application/json' } }, o || {}))).data;
    const getHtml = async (url, o) => (await axios.get(url, Object.assign({ timeout: 20000, maxRedirects: 6, responseType: 'text', headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,*/*', 'Accept-Language': 'en-US,en;q=0.9' } }, o || {}))).data;
    const postForm = async (url, obj, o) => (await axios.post(url, new URLSearchParams(obj).toString(), Object.assign({ timeout: 25000, headers: { 'User-Agent': API_UA, 'Content-Type': 'application/x-www-form-urlencoded' } }, o || {}))).data;
    const use = (title, text, example) => card(title, 'how to use', [text, example ? kv('example', example) : null].filter(Boolean));
    const busy = (title, st) => card(title, st === 404 ? 'not found' : 'service busy', [st === 404 ? 'Nothing was found for that.' : 'The service did not answer. Please try again shortly.']);
    const nothing = (title, what) => card(title, 'not found', [what || 'Nothing was found for that.']);
    const credit = () => `\n_${sc('delivered by')} ${sc(botName())}_`;
    const hasText = (v) => typeof v === 'string' && v.trim().length > 0;

    const img = (ctx, src, caption, opts) => sendMedia(ctx.session, ctx.from, 'image', src, Object.assign(caption ? { caption } : {}, opts || {}), { quoted: ctx.msg });
    const vid = (ctx, src, caption) => sendMedia(ctx.session, ctx.from, 'video', src, caption ? { caption } : {}, { quoted: ctx.msg });
    const aud = (ctx, src, voice) => sendMedia(ctx.session, ctx.from, voice ? 'voice' : 'audio', src, {}, { quoted: ctx.msg });
    const docu = (ctx, src, fileName, mimetype, maxMb) => sendMedia(ctx.session, ctx.from, 'document', src, { fileName, mimetype, maxMb }, { quoted: ctx.msg });
    // GIFs play best as short videos; fall back to a still picture when conversion is not possible.
    const anim = async (ctx, src, caption) => { try { return await vid(ctx, src, caption); } catch (e) { return await img(ctx, src, caption); } };
    const bufOf = async (url, o) => Buffer.from((await axios.get(url, Object.assign({ responseType: 'arraybuffer', timeout: 30000, headers: { 'User-Agent': UA } }, o || {}))).data);

    function def(name, category, desc, aliases, fn) {
        if (commands[name]) { console.log('extra_commands: ".' + name + '" already exists, skipped'); return; }
        const als = (aliases || []).filter((a) => !commands[a]);
        reg(name, {
            category, desc, aliases: als,
            run: async (ctx) => {
                try { await fn(ctx); }
                catch (e) {
                    const st = e && e.response && e.response.status;
                    console.log('.' + name + ' failed:', (e && e.mediaCode) || st || (e && e.message));
                    const title = name.charAt(0).toUpperCase() + name.slice(1);
                    if (e && e.mediaCode) return ctx.reply(card(title, 'could not send', [mediaErrorText(e)]));
                    return ctx.reply(busy(title, st));
                }
            }
        });
        added.push(name);
    }
    const geocode = async (name) => {
        const r = await get('https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&name=' + enc(name));
        return r && r.results && r.results[0] ? r.results[0] : null;
    };
    const sriLankaYmd = () => new Intl.DateTimeFormat('en-CA', { timeZone: process.env.BOT_TIMEZONE || 'Asia/Colombo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

    // ======================================================================
    //  DOWNLOADERS  (real files, no API key)
    // ======================================================================

    // ---- X / Twitter (FxTwitter public API) ----
    const TW_RE = /https?:\/\/(?:www\.|mobile\.)?(?:twitter|x|fxtwitter|vxtwitter)\.com\/(?:[\w]+)\/status(?:es)?\/(\d+)/i;
    def('twitter', 'Media', '.twitter [tweet link] — download the video / photos of a tweet', ['x', 'tw', 'twdl', 'xdl'], async (ctx) => {
        const link = D.linkFrom(ctx.msg, ctx.q, TW_RE);
        const m = link && link.match(TW_RE);
        if (!m) return ctx.reply(use('Twitter / X', 'Send a public tweet link.', '.twitter https://x.com/user/status/123456'));
        const d = await get('https://api.fxtwitter.com/i/status/' + m[1]);
        const t = d && d.tweet;
        if (!t) return ctx.reply(nothing('Twitter / X', 'That tweet was not found or is private.'));
        const items = (t.media && t.media.all) || [];
        const who = t.author ? '@' + t.author.screen_name : '';
        const head = [who ? kv('by', who) : null, t.text ? kv('tweet', trunc(t.text, 160)) : null, t.likes != null ? kv('likes', num(t.likes)) : null].filter(Boolean);
        if (!items.length) return ctx.reply(card('Twitter / X', 'text only', head, `↳ ${sc('this tweet has no video or photo')}`));
        let n = 0;
        for (const it of items.slice(0, 6)) {
            const cap = n++ === 0 ? card('Twitter / X', 'ready', head) + credit() : undefined;
            if (it.type === 'photo') await img(ctx, it.url, cap);
            else await vid(ctx, it.url, cap);
        }
    });

    // ---- Reddit (post JSON; video + audio are joined when ffmpeg is available) ----
    const RD_RE = /https?:\/\/(?:www\.|old\.|new\.|np\.)?reddit\.com\/r\/[\w]+\/(?:comments|s)\/[^\s]+/i;
    async function redditPost(link) {
        const clean = link.split('?')[0].replace(/\/$/, '');
        let lastErr;
        for (const host of ['https://www.reddit.com', 'https://old.reddit.com']) {
            try {
                const path = clean.replace(/^https?:\/\/[^/]+/, '');
                const j = await get(host + path + '.json?raw_json=1', { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NimahMD/7)' } });
                const p = j && j[0] && j[0].data && j[0].data.children && j[0].data.children[0] && j[0].data.children[0].data;
                if (p) return p.crosspost_parent_list && p.crosspost_parent_list[0] ? p.crosspost_parent_list[0] : p;
            } catch (e) { lastErr = e; }
        }
        throw lastErr || new Error('reddit');
    }
    async function redditVideoWithSound(ctx, rv, cap) {
        const vurl = rv.fallback_url.split('?')[0];
        const base = vurl.replace(/\/[^/]+$/, '');
        if (D.ffmpegPath && D.ffmpegPath()) {
            for (const a of ['/DASH_AUDIO_128.mp4', '/DASH_audio.mp4', '/DASH_AUDIO_64.mp4']) {
                let inV, inA, out;
                try {
                    const [vb, ab] = await Promise.all([D.downloadBuffer(vurl, 40 * 1048576), D.downloadBuffer(base + a, 20 * 1048576)]);
                    inV = D.tmpName('.mp4'); inA = D.tmpName('.mp4'); out = D.tmpName('.mp4');
                    D.fs.writeFileSync(inV, vb); D.fs.writeFileSync(inA, ab);
                    const r = await D.runFfmpeg(['-y', '-i', inV, '-i', inA, '-c', 'copy', '-movflags', '+faststart', out], 120000);
                    if (r.ok && D.fs.existsSync(out)) { await vid(ctx, D.fs.readFileSync(out), cap); return true; }
                } catch (e) { /* try the next audio name */ }
                finally { D.rmQuiet(inV, inA, out); }
            }
        }
        await vid(ctx, vurl, cap);
        return true;
    }

    // ---- MediaFire (reads the public download link from the page) ----
    def('mediafire', 'Media', '.mediafire [link] — download a MediaFire file (up to 40 MB)', ['mf', 'mfdl'], async (ctx) => {
        const link = D.linkFrom(ctx.msg, ctx.q, /https?:\/\/(?:www\.)?mediafire\.com\/\S+/i);
        if (!link) return ctx.reply(use('MediaFire', 'Send a MediaFire file link.', '.mediafire https://www.mediafire.com/file/xxxx/name.zip/file'));
        const html = await getHtml(link);
        let url = null;
        const sc1 = /data-scrambled-url="([^"]+)"/.exec(html);
        if (sc1) { try { url = Buffer.from(sc1[1], 'base64').toString('utf8'); } catch (e) { /* ignore */ } }
        if (!url) { const m = /href="(https?:\/\/download\d*\.mediafire\.com\/[^"]+)"/i.exec(html) || /(https?:\/\/download\d*\.mediafire\.com\/[^"'\s<]+)/i.exec(html); url = m && m[1]; }
        if (!url) return ctx.reply(nothing('MediaFire', 'Could not find the download link. The file may be removed or protected.'));
        const name = decodeURIComponent((url.split('?')[0].split('/').pop() || 'file')).slice(0, 100) || 'file';
        const size = (/<div class="details">[\s\S]*?<span>([\d.,]+\s*[KMGT]?B)<\/span>/i.exec(html) || [])[1];
        await ctx.reply(card('MediaFire', 'sending', [kv('file', trunc(name, 60)), size ? kv('size', size) : null].filter(Boolean), `↳ ${sc('please wait')}`));
        await docu(ctx, url, name);
    });

    // ---- GitHub repository -> ZIP ----

    // ---- APK (Aptoide public store API) ----
    def('apk', 'Media', '.apk [app name] — download an Android app (APK, up to 40 MB)', ['apkdl', 'aptoide', 'app'], async (ctx) => {
        if (!ctx.q.trim()) return ctx.reply(use('APK', 'Type an app name.', '.apk telegram'));
        const d = await get('https://ws75.aptoide.com/api/7/apps/search?limit=1&query=' + enc(ctx.q.trim()));
        const a = d && d.datalist && d.datalist.list && d.datalist.list[0];
        if (!a || !a.file || !a.file.path) return ctx.reply(nothing('APK', 'No app found with that name.'));
        const sizeMb = (a.file.filesize || a.size || 0) / 1048576;
        const rows = [kv('app', a.name), kv('package', a.package), kv('version', (a.file.vername || '—')), kv('size', sizeMb ? sizeMb.toFixed(1) + ' MB' : '—'), kv('downloads', num((a.stats && a.stats.downloads) || 0))];
        if (sizeMb > 40) return ctx.reply(card('APK', 'too big for chat', rows, `↳ ${sc('download it here')}\n${a.file.path}`));
        await ctx.reply(card('APK', 'sending', rows, `↳ ${sc('please wait')}`));
        await docu(ctx, a.file.path, `${a.name.replace(/[\\/:*?"<>|]/g, '')}.apk`, 'application/vnd.android.package-archive');
    });

    // ---- Open-Graph reader: Pinterest pins and any page with a video / picture ----
    async function ogMedia(link) {
        const html = await getHtml(link);
        const meta = (p) => { const r = new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]*content=["']([^"']+)["']`, 'i').exec(html) || new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${p}["']`, 'i').exec(html); return r ? strip(r[1]) : ''; };
        const title = meta('og:title') || (/<title[^>]*>([^<]+)/i.exec(html) || [])[1] || '';
        let video = meta('og:video:secure_url') || meta('og:video:url') || meta('og:video') || meta('twitter:player:stream');
        let image = meta('og:image') || meta('twitter:image');
        if (image && /pinimg\.com/.test(image)) image = image.replace(/\/(?:\d+x\d*|\d+x)\//, '/originals/');
        return { title: trunc(title, 120), video, image, audio: meta('og:audio') };
    }
    async function sendOg(ctx, label, link) {
        const o = await ogMedia(link);
        const cap = card(label, 'ready', o.title ? [kv('title', o.title)] : []) + credit();
        if (o.video && /\.(mp4|mov|webm|m4v)(\?|$)/i.test(o.video)) return void await vid(ctx, o.video, cap);
        if (o.image) return void await img(ctx, o.image, cap);
        if (o.audio) return void await aud(ctx, o.audio);
        await ctx.reply(nothing(label, 'Could not find a picture or video on that page.'));
    }
    def('pinterest', 'Media', '.pinterest [pin link] — download a Pinterest picture or video', ['pin', 'pindl', 'pinterestdl'], async (ctx) => {
        const link = D.linkFrom(ctx.msg, ctx.q, /https?:\/\/(?:[\w-]+\.)?(?:pinterest\.[a-z.]+|pin\.it)\/\S+/i);
        if (!link) return ctx.reply(use('Pinterest', 'Send a Pinterest pin link.', '.pinterest https://pin.it/xxxx'));
        await sendOg(ctx, 'Pinterest', link);
    });

    // ---- YouTube thumbnail ----

    // ---- TikTok extras (TikWM public API) ----
    const tikwm = async (path, form) => (await postForm('https://www.tikwm.com' + path, form)).data;
    const tikUrl = (u) => (u && u.startsWith('/') ? 'https://www.tikwm.com' + u : u);

    // ---- Music previews (Deezer + iTunes public search APIs) ----

    // ---- Free books: Internet Archive (PDF) + Project Gutenberg (EPUB) ----

    // ---- Wikipedia / Wikimedia Commons pictures ----

    // ---- Wallpapers / random pictures ----
    def('wallpaper', 'Media', '.wallpaper [theme] — HD wallpaper (add "doc" to get the original file)', ['wall', 'wallhaven', 'hdwall'], async (ctx) => {
        const wantDoc = ctx.args.some((a) => /^doc(ument)?$/i.test(a));
        const q = ctx.args.filter((a) => !/^doc(ument)?$/i.test(a)).join(' ').trim() || 'nature';
        const d = await get(`https://wallhaven.cc/api/v1/search?categories=111&purity=100&sorting=random&atleast=1280x720&q=${enc(q)}`);
        const w = d && d.data && d.data[0];
        if (!w) return ctx.reply(nothing('Wallpaper', 'No wallpaper found for that theme.'));
        const cap = card('Wallpaper', q.slice(0, 24), [kv('size', w.resolution), kv('views', num(w.views || 0)), kv('source', w.url)]);
        if (wantDoc) return void await docu(ctx, w.path, 'wallpaper-' + w.id + '.' + (w.file_type || 'image/jpeg').split('/')[1].replace('jpeg', 'jpg'), w.file_type, 40);
        await img(ctx, w.path, cap, { maxMb: 25 });
    });

    // ---- Website screenshot ----
    def('ssweb', 'Media', '.ssweb [link] — screenshot of a website (add "full" or "phone")', ['screenshot', 'ss', 'webshot'], async (ctx) => {
        const link = D.linkFrom(ctx.msg, ctx.q, /(?:https?:\/\/)?(?:[\w-]+\.)+[a-z]{2,}(?:\/\S*)?/i);
        if (!link) return ctx.reply(use('Screenshot', 'Send a website link.', '.ssweb https://example.com   (or: .ssweb example.com phone)'));
        const phone = ctx.args.some((a) => /^(phone|mobile)$/i.test(a)), full = ctx.args.some((a) => /^full(page)?$/i.test(a));
        const sizing = phone ? 'width/480/crop/960' : full ? 'width/1280' : 'width/1280/crop/720';
        let sent = false;
        try { await img(ctx, `https://image.thum.io/get/${sizing}/noanimate/${link}`, card('Screenshot', phone ? 'phone' : full ? 'full page' : 'desktop', [kv('site', trunc(link, 60))]) + credit()); sent = true; } catch (e) { /* try the second service */ }
        if (!sent) await img(ctx, `https://s0.wp.com/mshots/v1/${enc(link)}?w=1280&h=${phone ? 1600 : 720}`, card('Screenshot', 'desktop', [kv('site', trunc(link, 60))]) + credit());
    });

    // ---- Barcodes, avatars, memes, code images, charts, maths pictures ----
    const BARCODES = ['code128', 'code39', 'ean13', 'ean8', 'upca', 'qrcode', 'datamatrix', 'pdf417', 'azteccode', 'itf14'];
    const DICE = ['adventurer', 'avataaars', 'big-smile', 'bottts', 'croodles', 'fun-emoji', 'lorelei', 'micah', 'miniavs', 'notionists', 'personas', 'pixel-art', 'thumbs'];
    const memeText = (t) => String(t || '_').trim().replace(/~/g, '~~').replace(/_/g, '__').replace(/-/g, '--').replace(/ /g, '_').replace(/\?/g, '~q').replace(/&/g, '~a').replace(/%/g, '~p').replace(/#/g, '~h').replace(/\//g, '~s').replace(/\\/g, '~b').replace(/</g, '~l').replace(/>/g, '~g').replace(/"/g, "''").replace(/\n/g, '~n') || '_';

    // ======================================================================
    //  ANIMALS & ANIME PICTURES
    // ======================================================================
    const sra = async (what) => { // Some Random API: current and legacy paths
        for (const u of [`https://some-random-api.com/animal/${what}`, `https://some-random-api.com/animals/${what}`]) { try { const d = await get(u); if (d && d.image) return d; } catch (e) { /* next */ } }
        throw new Error('sra');
    };
    const animal = (name, title, aliases, fetcher, emoji) => def(name, 'Fun', `.${name} — a random ${title} picture`, aliases, async (ctx) => {
        const r = await fetcher();
        await img(ctx, r.url, card(title.charAt(0).toUpperCase() + title.slice(1), emoji, r.fact ? [trunc(r.fact, 200)] : []) + credit());
    });

    const ANIME_BASE = { sfw: 'https://api.waifu.pics/sfw/', best: 'https://nekos.best/api/v2/' };
    async function animeUrl(kind) {
        try { return (await get(ANIME_BASE.sfw + kind)).url; }
        catch (e) { const d = await get(ANIME_BASE.best + kind); return d.results[0].url; }
    }
    const animeCmd = (name, kind, desc, aliases, isGif) => def(name, 'Fun', `.${name} — ${desc}`, aliases, async (ctx) => {
        const u = await animeUrl(kind);
        const cap = card(name.charAt(0).toUpperCase() + name.slice(1), 'anime', []) + credit();
        if (isGif || /\.gif(\?|$)/i.test(u)) await anim(ctx, u, cap); else await img(ctx, u, cap);
    });

    // ---- Text to speech in any language (Google Translate voice) ----

    // ---- Quran recitation (audio) ----

    // ======================================================================
    //  LOOK-UP / INFO COMMANDS
    // ======================================================================
    const dm = (name, rel, label, aliases) => def(name, 'Search', `.${name} [word] — ${label}`, aliases, async (ctx) => {
        const w = ctx.q.trim().split(/\s+/)[0];
        if (!w) return ctx.reply(use(name, 'Type one word.', `.${name} happy`));
        const d = await get(`https://api.datamuse.com/words?max=30&${rel}=${enc(w)}`);
        if (!d || !d.length) return ctx.reply(nothing(name, 'No words found.'));
        await ctx.reply(card(name, w, [d.map((x) => x.word).join(', ')]));
    });

    const WMO = { 0: 'Clear sky ☀️', 1: 'Mostly clear 🌤', 2: 'Partly cloudy ⛅', 3: 'Overcast ☁️', 45: 'Fog 🌫', 48: 'Rime fog 🌫', 51: 'Light drizzle 🌦', 53: 'Drizzle 🌦', 55: 'Heavy drizzle 🌧', 61: 'Light rain 🌦', 63: 'Rain 🌧', 65: 'Heavy rain 🌧', 71: 'Light snow 🌨', 73: 'Snow 🌨', 75: 'Heavy snow ❄️', 80: 'Rain showers 🌦', 81: 'Rain showers 🌧', 82: 'Violent showers ⛈', 95: 'Thunderstorm ⛈', 96: 'Thunderstorm + hail ⛈', 99: 'Severe thunderstorm ⛈' };
    def('forecast', 'Search', '.forecast [city] — 5-day weather forecast', ['fc', 'weather5', 'weekweather'], async (ctx) => {
        const place = await geocode(ctx.q.trim() || 'Colombo');
        if (!place) return ctx.reply(nothing('Forecast', 'City not found.'));
        const d = await get(`https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&timezone=auto&forecast_days=5&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum`);
        const dd = d.daily;
        const rows = dd.time.map((t, i) => `${new Date(t + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' })} · ${Math.round(dd.temperature_2m_min[i])}–${Math.round(dd.temperature_2m_max[i])}°C · 💧${dd.precipitation_probability_max[i] == null ? '–' : dd.precipitation_probability_max[i]}% · ${WMO[dd.weather_code[i]] || ''}`);
        await ctx.reply(card('Forecast', place.name + ', ' + (place.country_code || ''), rows));
    });
    def('prayer', 'Islamic', '.prayer [city] — today\'s prayer times', ['salah', 'namaz', 'prayertimes'], async (ctx) => {
        const place = await geocode(ctx.q.trim() || 'Colombo');
        if (!place) return ctx.reply(nothing('Prayer Times', 'City not found.'));
        const d = (await get(`https://api.aladhan.com/v1/timings?latitude=${place.latitude}&longitude=${place.longitude}&method=${process.env.PRAYER_METHOD || 3}&timezonestring=${enc(place.timezone || 'UTC')}`)).data;
        const t = d.timings, h = d.date.hijri;
        await ctx.reply(card('Prayer Times', place.name, ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'].map((k) => kv(k, t[k])).concat([kv('hijri', `${h.day} ${h.month.en} ${h.year}`)])));
    });
    def('quran', 'Islamic', '.quran [surah] or [surah:ayah] — Arabic + English translation', ['ayah', 'surah'], async (ctx) => {
        const ref = ctx.args[0] || '';
        if (!/^\d{1,3}(:\d{1,3})?$/.test(ref)) return ctx.reply(use('Quran', 'Send a surah number, or surah:ayah.', '.quran 112   or   .quran 2:255'));
        if (ref.includes(':')) {
            const d = (await get(`https://api.alquran.cloud/v1/ayah/${ref}/editions/quran-uthmani,en.asad`)).data;
            if (!d || !d[0]) return ctx.reply(nothing('Quran', 'Not found.'));
            return void await ctx.reply(card(d[0].surah.englishName, 'ayah ' + ref, [d[0].text, '', d[1].text]));
        }
        const d = (await get(`https://api.alquran.cloud/v1/surah/${ref}/editions/quran-uthmani,en.asad`)).data;
        if (!d || !d[0]) return ctx.reply(nothing('Quran', 'Not found.'));
        const lines = d[0].ayahs.map((a, i) => `${a.numberInSurah}. ${a.text}\n   ${d[1].ayahs[i].text}`);
        let out = '', n = 0;
        for (const l of lines) { if ((out + l).length > 3300) break; out += (out ? '\n' : '') + l; n++; }
        await ctx.reply(card(d[0].englishName + ' · ' + d[0].name, `${n}/${d[0].numberOfAyahs} ayahs`, [out], n < lines.length ? `↳ ${sc('use')} .quran ${ref}:${n + 1} ${sc('for the rest')}` : ''));
    });

    // ---- quotes, jokes, fun facts, advice ----

    // ---- anime, TV, books, poems ----
    def('anime', 'Anime', '.anime [title] — anime info with poster (MyAnimeList)', ['animeinfo', 'mal'], async (ctx) => {
        if (!ctx.q.trim()) return ctx.reply(use('Anime', 'Type an anime title.', '.anime one piece'));
        const d = await get('https://api.jikan.moe/v4/anime?limit=1&sfw=true&q=' + enc(ctx.q.trim()));
        const a = d.data && d.data[0];
        if (!a) return ctx.reply(nothing('Anime', 'Anime not found.'));
        const rows = [kv('title', a.title_english || a.title), kv('type', `${a.type || '—'} · ${a.episodes || '?'} eps`), kv('status', a.status), kv('score', a.score || '—'), kv('rank', a.rank ? '#' + a.rank : '—'), kv('year', a.year || (a.aired && a.aired.prop && a.aired.prop.from && a.aired.prop.from.year) || '—'), kv('genres', (a.genres || []).map((g) => g.name).join(', ') || '—'), '', trunc(a.synopsis || '', 450)];
        const poster = a.images && a.images.jpg && a.images.jpg.large_image_url;
        try { await img(ctx, poster, card('Anime', 'myanimelist', rows)); } catch (e) { await ctx.reply(card('Anime', 'myanimelist', rows)); }
    });

    // ---- food & drink ----

    // ---- games & characters ----

    // ---- news & community ----

    // ---- money, health, places, space ----

    // ---- developer tools ----
    const shortener = (name, label, build, aliases) => def(name, 'Tools', `.${name} [link] — shorten a link with ${label}`, aliases, async (ctx) => {
        const link = D.linkFrom(ctx.msg, ctx.q, /https?:\/\/\S+/i);
        if (!link) return ctx.reply(use(label, 'Send the long link.', `.${name} https://example.com/very/long/link`));
        const out = String(await get(build(link), { responseType: 'text', transformResponse: [(x) => x], headers: { 'User-Agent': API_UA } })).trim();
        if (!/^https?:\/\//.test(out)) return ctx.reply(card(label, 'failed', [trunc(out, 120)]));
        await ctx.reply(card(label, 'short link', [out]));
    });

    // ----------------------------------------------------------------------
    console.log(`✅ Extra commands pack loaded: ${added.length} new commands`);
    return added;
};
