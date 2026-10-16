'use strict';
// =========================================================================
// NIMAH MD — download commands pack (v7.28)
// 100+ DOWNLOAD commands only, all in the Media category.
// Every command runs on a PUBLISHED, FREE, KEY-LESS public API (or the built-in
// yt-dlp engine). Nothing here needs an API key.
// Loaded from index.js:  require('./download_commands')(deps)
// =========================================================================

module.exports = function installDownloadCommands(D) {
    const { reg, commands, card, kv, sc, axios, sendMedia } = D;
    const botName = () => (D.getBotName ? D.getBotName() : D.BOT_NAME) || 'NIMAH MD';
    const UA = D.MEDIA_UA || 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';
    const API_UA = 'NimahMD/7 (WhatsApp bot; +https://wa.me/' + (process.env.OWNER_NUMBER || '94744136085') + ')';
    const added = [];

    // ---------------------------------------------------------------- helpers
    const enc = encodeURIComponent;
    const trunc = (s, n) => { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
    const strip = (h) => String(h == null ? '' : h).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
    const rnd = (a) => a[Math.floor(Math.random() * a.length)];
    const shuffle = (a) => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = b[i]; b[i] = b[j]; b[j] = t; } return b; };
    const cap1 = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    const mb = (n) => (Number(n) / 1048576).toFixed(1) + ' MB';
    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
    const get = async (url, o) => (await axios.get(url, Object.assign({ timeout: 20000, headers: { 'User-Agent': API_UA, 'Accept': 'application/json' } }, o || {}))).data;
    const use = (title, text, example) => card(title, 'how to use', [text, example ? kv('example', example) : null].filter(Boolean));
    const busy = (title, st) => card(title, st === 404 ? 'not found' : 'service busy', [st === 404 ? 'Nothing was found for that.' : 'The service did not answer. Please try again shortly.']);
    const nothing = (title, what) => card(title, 'not found', [what || 'Nothing was found for that.']);
    const credit = () => `\n_${sc('delivered by')} ${sc(botName())}_`;
    const miss = (msg) => Object.assign(new Error(msg || 'not found'), { notFound: true });
    const MIME = {
        pdf: 'application/pdf', zip: 'application/zip', txt: 'text/plain', md: 'text/markdown', json: 'application/json', js: 'text/javascript',
        css: 'text/css', html: 'text/html', apk: 'application/vnd.android.package-archive', mp3: 'audio/mpeg', mp4: 'video/mp4', png: 'image/png',
        jpg: 'image/jpeg', jpeg: 'image/jpeg', gz: 'application/gzip', tgz: 'application/gzip', crate: 'application/gzip', gem: 'application/octet-stream',
        nupkg: 'application/zip', whl: 'application/zip', epub: 'application/epub+zip', csv: 'text/csv', xml: 'application/xml', py: 'text/x-python',
        svg: 'image/svg+xml', exe: 'application/octet-stream', deb: 'application/octet-stream', tar: 'application/x-tar', xz: 'application/x-xz', '7z': 'application/x-7z-compressed'
    };
    const mimeOf = (name) => MIME[(String(name).split('.').pop() || '').toLowerCase()] || 'application/octet-stream';
    const safeName = (s, fallback) => (String(s || '').replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, 90)) || fallback || 'file';

    // senders
    const sendImg = (ctx, src, caption) => sendMedia(ctx.session, ctx.from, 'image', src, caption ? { caption } : {}, { quoted: ctx.msg });
    const sendVid = (ctx, src, caption) => sendMedia(ctx.session, ctx.from, 'video', src, caption ? { caption } : {}, { quoted: ctx.msg });
    const sendAud = (ctx, src) => sendMedia(ctx.session, ctx.from, 'audio', src, {}, { quoted: ctx.msg });
    const sendDoc = (ctx, src, fileName, mimetype) => sendMedia(ctx.session, ctx.from, 'document', src, { fileName, mimetype: mimetype || mimeOf(fileName) }, { quoted: ctx.msg });

    // GIF -> looping WhatsApp animation (needs ffmpeg); falls back to a picture
    async function sendGif(ctx, url, caption) {
        const ff = D.ffmpegPath && D.ffmpegPath();
        if (ff && D.runFfmpeg && D.downloadBuffer && D.tmpName && D.fs) {
            let inF, outF;
            try {
                const buf = await D.downloadBuffer(url, 12 * 1048576);
                if (buf.slice(0, 4).toString('latin1') === 'GIF8') {
                    inF = D.tmpName('.gif'); outF = D.tmpName('.mp4');
                    D.fs.writeFileSync(inF, buf);
                    const r = await D.runFfmpeg(['-y', '-i', inF, '-movflags', '+faststart', '-pix_fmt', 'yuv420p', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-an', outF], 90000);
                    if (r.ok && D.fs.existsSync(outF) && D.fs.statSync(outF).size > 1000) {
                        const mp4 = D.fs.readFileSync(outF);
                        return await ctx.session.queueSend(ctx.from, Object.assign({ video: mp4, mimetype: 'video/mp4', gifPlayback: true }, caption ? { caption } : {}), { quoted: ctx.msg });
                    }
                } else {
                    return await sendVid(ctx, buf, caption);
                }
            } catch (e) { /* fall back to a still picture below */ }
            finally { if (D.rmQuiet) D.rmQuiet(inF, outF); }
        }
        return sendImg(ctx, url, caption);
    }

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

    function def(name, desc, aliases, fn) {
        if (commands[name]) { console.log('download_commands: ".' + name + '" already exists, skipped'); return; }
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
    }

    // a picture command: getter(ctx) -> { url, alts?, rows?, tag?, gif? }
    const pic = (name, title, desc, aliases, getter) => def(name, desc, aliases, async (ctx) => {
        const r = await getter(ctx);
        if (r === null) return ctx.reply(card(title, 'how to use', [desc]));
        if (!r || !r.url) throw miss();
        const cap = card(title, r.tag || 'download', r.rows || []) + credit();
        const urls = [r.url].concat(r.alts || []);
        let last;
        for (const u of urls.slice(0, 4)) {
            try { if (r.gif) await sendGif(ctx, u, cap); else await sendImg(ctx, u, cap); return; }
            catch (e) { last = e; }
        }
        throw last || miss();
    });

    // ======================================================================
    //  1. VIDEO / AUDIO FROM OTHER SITES  (built-in yt-dlp engine)
    // ======================================================================
    if (D.downloadWithYtDlp && D.pickUrl) {
        const ytCmd = (name, label, re, kind, aliases, example) => def(name, `.${name} [${label} link] — download ${kind === 'audio' ? 'the audio' : 'the video'} from ${label}`, aliases, async (ctx) => {
            const url = D.pickUrl(ctx.q, ctx.msg);
            if (!url) return ctx.reply(use(label, `Send a ${label} link.`, example));
            if (!re.test(url)) return ctx.reply(card(label, 'wrong link', [`That is not a ${label} link.`]));
            const hq = parseInt((String(ctx.q).replace(url, '').match(/\b(144|240|360|480|720|1080)\b/) || [])[1], 10) || null;
            await D.downloadWithYtDlp(ctx.session, ctx.from, ctx.msg, ctx.reply, url, kind, hq);
        });
        ytCmd('soundcloud', 'SoundCloud', /(soundcloud\.com|snd\.sc)\//i, 'audio', ['scdl', 'soundclouddl'], '.soundcloud https://soundcloud.com/artist/track');
    }

    // ======================================================================
    //  2. ANIMALS  (random picture / GIF / video)
    // ======================================================================
    const sra = async (what) => {
        for (const u of [`https://some-random-api.com/animal/${what}`, `https://some-random-api.com/animals/${what}`]) {
            try { const d = await get(u); if (d && d.image) return d; } catch (e) { /* next */ }
        }
        throw new Error('sra');
    };
    // Wikimedia Commons search (free, no key) — used for pictures, audio and video
    async function commonsFind(q, filetype) {
        const p = new URLSearchParams({ action: 'query', format: 'json', generator: 'search', gsrnamespace: '6', gsrsearch: `${q} filetype:${filetype}`, gsrlimit: '30', prop: 'imageinfo', iiprop: 'url|mime|size', iiurlwidth: '1280' });
        const d = await get('https://commons.wikimedia.org/w/api.php?' + p.toString());
        const pages = Object.values((d && d.query && d.query.pages) || {});
        return pages.map((pg) => ({ title: String(pg.title || '').replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, ''), info: (pg.imageinfo || [])[0] })).filter((x) => x.info);
    }
    const commonsImages = async (q) => {
        const l = (await commonsFind(q, 'bitmap')).filter((x) => /image\/(jpeg|png)/.test(x.info.mime || '') && (x.info.thumburl || x.info.url));
        if (!l.length) throw miss();
        return shuffle(l).slice(0, 4).map((x) => ({ url: x.info.thumburl || x.info.url, title: x.title }));
    };
    const animal = (name, title, aliases, fetchers, commonsQ) => pic(name, title, `.${name} — a random ${title.toLowerCase()} picture`, aliases, async () => {
        for (const f of fetchers) {
            try { const r = await f(); if (r && r.url) return { url: r.url, rows: r.fact ? [trunc(r.fact, 200)] : [], tag: 'picture' }; } catch (e) { /* next source */ }
        }
        const l = await commonsImages(commonsQ);
        return { url: l[0].url, alts: l.slice(1).map((x) => x.url), rows: [kv('title', trunc(l[0].title, 60))], tag: 'picture' };
    });


    // ======================================================================
    //  3. ANIME GIFs & PICTURES  (safe-for-work only)
    // ======================================================================
    const waifuPics = async (kind) => ({ url: (await get('https://api.waifu.pics/sfw/' + kind)).url });
    const nekos = async (kind) => {
        const d = await get('https://nekos.best/api/v2/' + kind);
        const r = d && d.results && d.results[0];
        if (!r) throw miss();
        return { url: r.url, who: r.anime_name || r.artist_name || '' };
    };
    const animeDl = (name, label, primary, fallback) => def(name, `.${name} — ${label}`, [], async (ctx) => {
        let r;
        try { r = await primary(); } catch (e) { if (!fallback) throw e; r = await fallback(); }
        if (!r || !r.url) throw miss();
        const cap = card(cap1(name), 'anime', r.who ? [kv('from', trunc(r.who, 40))] : []) + credit();
        if (/\.gif(\?|$)/i.test(r.url)) await sendGif(ctx, r.url, cap); else await sendImg(ctx, r.url, cap);
    });
    // ======================================================================
    //  5. REDDIT PICTURES, MEMES & COMICS
    // ======================================================================
    async function redditList(sub) {
        let list = [];
        const isImg = (u) => /\.(jpe?g|png|gif|webp)(\?|$)/i.test(u || '');
        try {
            const d = await get(`https://meme-api.com/gimme/${sub}/10`);
            list = ((d && d.memes) || []).filter((m) => m && !m.nsfw && !m.spoiler && isImg(m.url)).map((m) => ({ url: m.url, title: m.title, sub: m.subreddit, ups: m.ups, link: m.postLink }));
        } catch (e) { /* try Reddit directly */ }
        if (!list.length) {
            try {
                const d = await get(`https://www.reddit.com/r/${sub}/hot.json?limit=40&raw_json=1`, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NimahMD/7)' } });
                list = (((d && d.data && d.data.children) || []).map((c) => c.data)).filter((p) => p && !p.over_18 && !p.spoiler && isImg(p.url_overridden_by_dest || p.url))
                    .map((p) => ({ url: p.url_overridden_by_dest || p.url, title: p.title, sub: p.subreddit, ups: p.ups, link: 'https://reddit.com' + p.permalink }));
            } catch (e) { /* nothing */ }
        }
        if (!list.length) throw miss('No pictures found right now. Try again in a minute.');
        return shuffle(list);
    }
    const redditPic = (name, title, sub, aliases) => def(name, `.${name} — a random picture from r/${sub}`, aliases, async (ctx) => {
        const list = await redditList(sub);
        await firstOk(list, async (m) => {
            const cap = card(title, 'r/' + (m.sub || sub), [kv('post', trunc(m.title, 110)), m.ups != null ? kv('upvotes', Number(m.ups).toLocaleString('en-US')) : null].filter(Boolean)) + credit();
            if (/\.gif(\?|$)/i.test(m.url)) await sendGif(ctx, m.url, cap); else await sendImg(ctx, m.url, cap);
        }, 4);
    });


    // ======================================================================
    //  6. ART MUSEUMS  (public-domain artworks)
    // ======================================================================

    // ======================================================================
    //  7. NASA  (image & video library, Earth from space)
    // ======================================================================
    async function nasaSearch(q, type) {
        const d = await get(`https://images-api.nasa.gov/search?q=${enc(q)}&media_type=${type}`);
        const items = (d && d.collection && d.collection.items) || [];
        if (!items.length) throw miss('Nothing found in the NASA library for that.');
        return shuffle(items.slice(0, 40));
    }
    async function nasaAssets(nasaId) {
        const d = await get('https://images-api.nasa.gov/asset/' + enc(nasaId));
        return ((d && d.collection && d.collection.items) || []).map((x) => String(x.href).replace(/^http:\/\//, 'https://')).map((u) => u.replace(/ /g, '%20'));
    }
    const nasaRows = (it) => { const m = (it.data || [])[0] || {}; return [kv('title', trunc(m.title, 90)), m.date_created ? kv('date', String(m.date_created).slice(0, 10)) : null, m.description ? trunc(strip(m.description), 220) : null].filter(Boolean); };

    // ======================================================================
    //  8. WIKIMEDIA COMMONS & OPENVERSE  (free pictures, audio, video)
    // ======================================================================
    const licenseOf = (r) => [r.license ? String(r.license).toUpperCase() : '', r.license_version || ''].filter(Boolean).join(' ');
    const openAudio = (name, desc, aliases, extra, title) => def(name, desc, aliases, async (ctx) => {
        const q = ctx.q.trim();
        if (!q) return ctx.reply(use(title, 'Type what to search.', `.${name} ${name === 'soundfx' ? 'door' : 'piano'}`));
        const d = await get(`https://api.openverse.org/v1/audio/?q=${enc(q)}&page_size=20${extra}`);
        const list = ((d && d.results) || []).filter((r) => r.url);
        if (!list.length) throw miss('No audio found for that.');
        await firstOk(shuffle(list), async (r) => {
            await ctx.reply(card(title, 'openverse', [kv('title', trunc(r.title || q, 70)), r.creator ? kv('by', trunc(r.creator, 40)) : null, licenseOf(r) ? kv('license', licenseOf(r)) : null, r.duration ? kv('length', Math.round(r.duration / 1000) + ' s') : null].filter(Boolean)));
            await guarded(ctx, title, r.url, () => sendAud(ctx, r.url));
        }, 4);
    });

    // ======================================================================
    //  9. INTERNET ARCHIVE  (audio, video, books)
    // ======================================================================
    async function archiveFind(q, mediatype) {
        const url = `https://archive.org/advancedsearch.php?q=${enc(`(${q}) AND mediatype:${mediatype}`)}&fl%5B%5D=identifier&fl%5B%5D=title&sort%5B%5D=downloads+desc&rows=10&page=1&output=json`;
        const d = await get(url);
        const docs = (d && d.response && d.response.docs) || [];
        if (!docs.length) throw miss('Nothing found in the Internet Archive for that.');
        return docs;
    }
    async function archivePick(docs, test, maxBytes) {
        for (const doc of docs.slice(0, 6)) {
            try {
                const m = await get('https://archive.org/metadata/' + enc(doc.identifier), { timeout: 25000 });
                const files = ((m && m.files) || []).filter((f) => f && f.name && test(f) && Number(f.size) > 0 && Number(f.size) <= maxBytes);
                files.sort((a, b) => Number(b.size) - Number(a.size));
                if (files.length) {
                    const f = files[0];
                    return { doc, file: f, url: `https://archive.org/download/${enc(doc.identifier)}/${f.name.split('/').map(enc).join('/')}` };
                }
            } catch (e) { /* next item */ }
        }
        throw miss('No file small enough for WhatsApp was found. Try other words.');
    }
    const archiveRows = (r) => [kv('title', trunc(r.doc.title || r.doc.identifier, 80)), kv('file', trunc(r.file.name.split('/').pop(), 50)), kv('size', mb(r.file.size))];

    // ======================================================================
    //  10. BOOKS & COVERS
    // ======================================================================

    // ======================================================================
    //  11. QURAN AUDIO & PICTURES
    // ======================================================================
    let surahCache = null, reciterCache = null;
    async function surahList() {
        if (surahCache) return surahCache;
        const d = await get('https://api.alquran.cloud/v1/surah');
        surahCache = (d && d.data) || [];
        return surahCache;
    }
    async function reciters() {
        if (reciterCache && Date.now() - reciterCache.at < 6 * 3600e3) return reciterCache.list;
        const d = await get('https://www.mp3quran.net/api/v3/reciters?language=eng', { timeout: 30000 });
        const list = ((d && d.reciters) || []).map((r) => ({ name: r.name, key: norm(r.name), moshaf: (r.moshaf || []).map((m) => ({ server: m.server, list: new Set(String(m.surah_list || '').split(',').map((x) => parseInt(x, 10))) })) }));
        reciterCache = { at: Date.now(), list };
        return list;
    }

    // ======================================================================
    //  12. POKEMON  (official artwork & cries)
    // ======================================================================
    async function pokemon(q) {
        const k = String(q || '').trim().toLowerCase().replace(/\s+/g, '-');
        return get('https://pokeapi.co/api/v2/pokemon/' + enc(k));
    }
    const pokeRows = (p) => [kv('no.', '#' + p.id), kv('type', (p.types || []).map((t) => t.type.name).join(' / ')), kv('height', (p.height / 10) + ' m'), kv('weight', (p.weight / 10) + ' kg')];
    const pokeArt = (name, title, desc, aliases, pickUrl) => pic(name, title, desc, aliases, async (ctx) => {
        const q = ctx.q.trim();
        if (!q && name !== 'pokerandom') return null;
        const p = name === 'pokerandom' ? await pokemon(String(1 + Math.floor(Math.random() * 1000))) : await pokemon(q);
        const u = pickUrl(p);
        if (!u) throw miss('No picture for that Pokémon.');
        return { url: u, alts: [p.sprites && p.sprites.front_default].filter(Boolean), rows: [kv('name', cap1(p.name))].concat(pokeRows(p)), tag: 'pokemon' };
    });
    const art = (p) => p.sprites && p.sprites.other && p.sprites.other['official-artwork'];

    // ======================================================================
    //  13. EMOJI  (picture & animated)
    // ======================================================================
    const firstEmoji = (s) => {
        s = String(s || '').trim();
        if (!s) return null;
        try { const seg = [...new Intl.Segmenter().segment(s)][0]; return seg && seg.segment; } catch (e) { return Array.from(s)[0]; }
    };

    // ======================================================================
    //  14. GITHUB DOWNLOADS
    // ======================================================================
    const ghGet = (url) => get(url, { headers: Object.assign({ 'User-Agent': API_UA, 'Accept': 'application/vnd.github+json' }, process.env.GITHUB_TOKEN ? { Authorization: 'Bearer ' + process.env.GITHUB_TOKEN } : {}) });
    const parseRepo = (s) => {
        const m = /(?:github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/?#\s]|$)/i.exec(String(s || '').trim() + ' ');
        return m ? { owner: m[1], repo: m[2] } : null;
    };

    // ======================================================================
    //  15. PACKAGES, PLUGINS & LIBRARIES
    // ======================================================================
    const wpDl = (name, kind, desc, aliases) => def(name, desc, aliases, async (ctx) => {
        const q = ctx.q.trim();
        if (!q) return ctx.reply(use('WordPress ' + kind, `Type a ${kind} name.`, `.${name} ${kind === 'plugin' ? 'contact form 7' : 'astra'}`));
        const url = `https://api.wordpress.org/${kind}s/info/1.2/?action=query_${kind}s&request[search]=${enc(q)}&request[per_page]=1`;
        const d = await get(url);
        const it = ((d && d[kind + 's']) || [])[0];
        if (!it || !it.download_link) throw miss(`No ${kind} found for that.`);
        await ctx.reply(card(strip(it.name), 'wordpress ' + kind, [kv('version', it.version), it.rating ? kv('rating', (it.rating / 20).toFixed(1) + ' / 5') : null].filter(Boolean)));
        await guarded(ctx, strip(it.name), it.download_link, () => sendDoc(ctx, it.download_link, `${it.slug}.zip`, 'application/zip'));
    });

    // ======================================================================
    //  16. POSTERS, ALBUM ART, APP ICONS & GAME COVERS
    // ======================================================================
    const itunes = async (term, entity, media) => {
        const d = await get(`https://itunes.apple.com/search?term=${enc(term)}&entity=${entity}${media ? '&media=' + media : ''}&limit=5`);
        const r = ((d && d.results) || [])[0];
        if (!r) throw miss('Nothing found for that.');
        return r;
    };
    const big = (u, from, to) => String(u).replace(from, to);

    // ----------------------------------------------------------------------
    console.log(`✅ Download commands pack loaded: ${added.length} new download commands`);
    return added;
};
