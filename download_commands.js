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
        ytCmd('vimeo', 'Vimeo', /vimeo\.com\//i, 'video', ['vimeodl'], '.vimeo https://vimeo.com/123456789');
        ytCmd('dailymotion', 'Dailymotion', /(dailymotion\.com|dai\.ly)\//i, 'video', ['dmdl', 'dailymotiondl'], '.dailymotion https://www.dailymotion.com/video/x8abc');
        ytCmd('soundcloud', 'SoundCloud', /(soundcloud\.com|snd\.sc)\//i, 'audio', ['scdl', 'soundclouddl'], '.soundcloud https://soundcloud.com/artist/track');
        ytCmd('bandcamp', 'Bandcamp', /bandcamp\.com/i, 'audio', ['bcdl'], '.bandcamp https://artist.bandcamp.com/track/name');
        ytCmd('mixcloud', 'Mixcloud', /mixcloud\.com\//i, 'audio', ['mixclouddl'], '.mixcloud https://www.mixcloud.com/user/show/');
        ytCmd('audiomack', 'Audiomack', /audiomack\.com\//i, 'audio', ['amdl'], '.audiomack https://audiomack.com/artist/song/name');
        ytCmd('twitch', 'Twitch clip', /(twitch\.tv|clips\.twitch\.tv)\//i, 'video', ['twitchclip', 'twitchdl'], '.twitch https://clips.twitch.tv/ClipName');
        ytCmd('kickclip', 'Kick clip', /kick\.com\//i, 'video', ['kickdl'], '.kickclip https://kick.com/streamer?clip=clip_xxx');
        ytCmd('streamable', 'Streamable', /streamable\.com\//i, 'video', ['streamabledl'], '.streamable https://streamable.com/abc12');
        ytCmd('imgur', 'Imgur', /imgur\.com\//i, 'video', ['imgurdl', 'gifv'], '.imgur https://imgur.com/gallery/abc123');
        ytCmd('ninegag', '9GAG', /9gag\.com\//i, 'video', ['9gag', '9gagdl'], '.ninegag https://9gag.com/gag/abc123');
        ytCmd('rumble', 'Rumble', /rumble\.com\//i, 'video', ['rumbledl'], '.rumble https://rumble.com/v1abc-title.html');
        ytCmd('odysee', 'Odysee', /(odysee\.com|lbry\.tv)\//i, 'video', ['odyseedl'], '.odysee https://odysee.com/@channel/video');
        ytCmd('bitchute', 'BitChute', /bitchute\.com\//i, 'video', ['bitchutedl'], '.bitchute https://www.bitchute.com/video/abc123/');
        ytCmd('bilibili', 'Bilibili', /(bilibili\.com|b23\.tv|bilibili\.tv)\//i, 'video', ['bilidl'], '.bilibili https://www.bilibili.com/video/BV1xx');
        ytCmd('likee', 'Likee', /(likee\.video|likee\.com)\//i, 'video', ['likeedl'], '.likee https://likee.video/@user/video/123');
        ytCmd('snapchat', 'Snapchat', /snapchat\.com\//i, 'video', ['snapdl', 'spotlight'], '.snapchat https://www.snapchat.com/spotlight/xxxx');
        ytCmd('threads', 'Threads', /threads\.(net|com)\//i, 'video', ['threadsdl'], '.threads https://www.threads.net/@user/post/xxxx');
        ytCmd('tumblr', 'Tumblr', /tumblr\.com\//i, 'video', ['tumblrdl'], '.tumblr https://user.tumblr.com/post/123');
        ytCmd('vk', 'VK', /(vk\.com|vkvideo\.ru)\//i, 'video', ['vkdl'], '.vk https://vk.com/video-123_456');
        ytCmd('okru', 'OK.ru', /ok\.ru\//i, 'video', ['okdl'], '.okru https://ok.ru/video/123456');
        ytCmd('linkedin', 'LinkedIn', /linkedin\.com\//i, 'video', ['linkedindl', 'lidl'], '.linkedin https://www.linkedin.com/posts/xxxx');
        ytCmd('ytshorts', 'YouTube Shorts', /(youtube\.com\/shorts\/|youtu\.be\/)/i, 'video', ['shorts', 'shortsdl'], '.ytshorts https://youtube.com/shorts/xxxx');
        ytCmd('bsky', 'Bluesky', /bsky\.app\//i, 'video', ['bluesky', 'bskydl'], '.bsky https://bsky.app/profile/user/post/xxxx');
        ytCmd('tedtalk', 'TED', /ted\.com\/talks\//i, 'video', ['teddl'], '.tedtalk https://www.ted.com/talks/speaker_title');
        ytCmd('loom', 'Loom', /loom\.com\/share\//i, 'video', ['loomdl'], '.loom https://www.loom.com/share/xxxx');
        ytCmd('coub', 'Coub', /coub\.com\//i, 'video', ['coubdl'], '.coub https://coub.com/view/xxxx');
        ytCmd('ifunny', 'iFunny', /ifunny\.co\//i, 'video', ['ifunnydl'], '.ifunny https://ifunny.co/video/xxxx');
        ytCmd('giphydl', 'Giphy', /giphy\.com\//i, 'video', ['gipdl'], '.giphydl https://giphy.com/gifs/xxxx');
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
    animal('shibe', 'Shiba', ['shiba', 'shibapic'], [async () => ({ url: (await get('https://shibe.online/api/shibes?count=1&urls=true&httpsUrls=true'))[0] }), async () => ({ url: (await get('https://dog.ceo/api/breed/shiba/images/random')).message })], 'shiba inu');
    animal('birdpic', 'Bird', ['randombird'], [async () => ({ url: (await get('https://shibe.online/api/birds?count=1&urls=true&httpsUrls=true'))[0] }), async () => { const d = await sra('bird'); return { url: d.image, fact: d.fact }; }], 'bird');
    animal('redpanda', 'Red panda', ['redpandapic'], [async () => { const d = await sra('red_panda'); return { url: d.image, fact: d.fact }; }], 'red panda');
    animal('koala', 'Koala', ['koalapic'], [async () => { const d = await sra('koala'); return { url: d.image, fact: d.fact }; }], 'koala');
    animal('kangaroo', 'Kangaroo', ['kangaroopic'], [async () => { const d = await sra('kangaroo'); return { url: d.image, fact: d.fact }; }], 'kangaroo');
    animal('raccoon', 'Raccoon', ['raccoonpic'], [async () => { const d = await sra('raccoon'); return { url: d.image, fact: d.fact }; }], 'raccoon');
    animal('whale', 'Whale', ['whalepic'], [async () => { const d = await sra('whale'); return { url: d.image, fact: d.fact }; }], 'whale');

    pic('catgif', 'Cat GIF', '.catgif — a random cat GIF', ['catanim'], async () => ({ url: 'https://cataas.com/cat/gif?t=' + Date.now(), gif: true, tag: 'cataas' }));
    pic('catsay', 'Cat says', '.catsay [text] — a cat picture with your text on it', ['catsays'], async (ctx) => {
        const t = ctx.q.trim();
        if (!t) return null;
        return { url: `https://cataas.com/cat/says/${enc(t.slice(0, 80))}?fontSize=48&fontColor=white&t=${Date.now()}`, rows: [kv('text', trunc(t, 80))], tag: 'cataas' };
    });
    pic('dogbreed', 'Dog breed', '.dogbreed [breed] — picture of a dog breed (e.g. husky, bulldog french)', ['breedpic'], async (ctx) => {
        const a = ctx.args.map((x) => x.toLowerCase().replace(/[^a-z]/g, '')).filter(Boolean);
        if (!a.length) return null;
        const tries = [a.join('/'), a.slice().reverse().join('/'), a[a.length - 1], a[0]];
        for (const t of tries) {
            try { const d = await get(`https://dog.ceo/api/breed/${t}/images/random`); if (d && d.status === 'success') return { url: d.message, rows: [kv('breed', a.join(' '))], tag: 'dog.ceo' }; } catch (e) { /* next */ }
        }
        throw miss('That breed was not found. Try a simple name like husky, beagle, pug, poodle.');
    });
    pic('catbreed', 'Cat breed', '.catbreed [breed] — picture and facts of a cat breed', ['catbreedpic'], async (ctx) => {
        const q = ctx.q.trim();
        if (!q) return null;
        const br = (await get('https://api.thecatapi.com/v1/breeds/search?q=' + enc(q)))[0];
        if (!br) throw miss('That cat breed was not found.');
        let url = null;
        try { const im = await get(`https://api.thecatapi.com/v1/images/search?breed_ids=${br.id}&limit=1`); url = im && im[0] && im[0].url; } catch (e) { /* use the reference image */ }
        if (!url && br.reference_image_id) url = `https://cdn2.thecatapi.com/images/${br.reference_image_id}.jpg`;
        return { url, rows: [kv('breed', br.name), br.origin ? kv('origin', br.origin) : null, br.temperament ? kv('nature', trunc(br.temperament, 80)) : null].filter(Boolean), tag: 'cat' };
    });
    def('dogvideo', '.dogvideo — a random dog video / animation', ['woof', 'dogvid'], async (ctx) => {
        const d = await get('https://random.dog/woof.json?filter=mp4,webm');
        if (!d || !d.url) throw miss();
        await sendVid(ctx, d.url, card('Dog video', 'random.dog', []) + credit());
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
    // waifu.pics first, nekos.best as the backup
    [['shinobu', 'anime Shinobu picture'], ['megumin', 'anime Megumin picture'], ['cuddle', 'anime cuddle GIF'], ['cry', 'anime crying GIF'], ['awoo', 'anime awoo picture'],
        ['lick', 'anime lick GIF'], ['smug', 'anime smug GIF'], ['bonk', 'anime bonk GIF'], ['yeet', 'anime yeet GIF'], ['blush', 'anime blush GIF'], ['smile', 'anime smile GIF'],
        ['wave', 'anime wave GIF'], ['highfive', 'anime high-five GIF'], ['handhold', 'anime hand-hold GIF'], ['nom', 'anime nom GIF'], ['bite', 'anime bite GIF'],
        ['glomp', 'anime glomp GIF'], ['happy', 'anime happy GIF'], ['wink', 'anime wink GIF'], ['cringe', 'anime cringe GIF']
    ].forEach(([n, label]) => animeDl(n, label, () => waifuPics(n), () => nekos(n)));
    // nekos.best only
    [['baka', 'anime baka GIF'], ['bored', 'anime bored GIF'], ['facepalm', 'anime facepalm GIF'], ['feed', 'anime feeding GIF'], ['laugh', 'anime laughing GIF'],
        ['nod', 'anime nod GIF'], ['nope', 'anime nope GIF'], ['pout', 'anime pout GIF'], ['run', 'anime running GIF'], ['shrug', 'anime shrug GIF'], ['sleep', 'anime sleeping GIF'],
        ['stare', 'anime stare GIF'], ['think', 'anime thinking GIF'], ['thumbsup', 'anime thumbs-up GIF'], ['tickle', 'anime tickle GIF'], ['yawn', 'anime yawn GIF'],
        ['kitsune', 'anime fox-girl picture'], ['husbando', 'anime husbando picture']
    ].forEach(([n, label]) => animeDl(n, label, () => nekos(n)));

    // ======================================================================
    //  4. WALLPAPERS & PHOTOS  (Wallhaven SFW, Bing, Picsum, LoremFlickr)
    // ======================================================================
    async function wallhaven(params) {
        const qs = new URLSearchParams(Object.assign({ categories: '111', purity: '100', sorting: 'random', atleast: '1280x720' }, params, { seed: Math.random().toString(36).slice(2, 8).padEnd(6, 'a') }));
        for (const k of [...qs.keys()]) if (qs.get(k) === '') qs.delete(k);
        const d = await get('https://wallhaven.cc/api/v1/search?' + qs.toString());
        const list = (d && d.data) || [];
        if (!list.length) throw miss('No wallpaper found for that.');
        return list;
    }
    const wall = (name, label, base) => def(name, `.${name} [extra words] [hd] — ${label} wallpaper (add "hd" for the full-quality file)`, [], async (ctx) => {
        const hd = ctx.args.some((a) => a.toLowerCase() === 'hd');
        const extra = ctx.args.filter((a) => a.toLowerCase() !== 'hd').join(' ');
        const p = Object.assign({}, base);
        p.q = [base.q || '', extra].filter(Boolean).join(' ');
        const list = shuffle(await wallhaven(p));
        const w = list[0];
        const rows = [kv('size', w.resolution), w.file_size ? kv('file', mb(w.file_size)) : null, kv('page', w.url)].filter(Boolean);
        const cap = card(cap1(label) + ' wallpaper', 'wallhaven', rows) + credit();
        const ext = String(w.path || '').split('.').pop() || 'jpg';
        if (hd) return await guarded(ctx, 'Wallpaper', w.path, () => sendDoc(ctx, w.path, `wallpaper-${w.id}.${ext}`, mimeOf('x.' + ext)));
        try { await sendImg(ctx, w.path, cap); }
        catch (e) {
            const alt = w.thumbs && (w.thumbs.original || w.thumbs.large);
            if (!alt) throw e;
            await sendImg(ctx, alt, cap);
        }
    });
    [['wallnature', 'nature', { q: 'nature' }], ['wallanime', 'anime', { categories: '010', q: '' }], ['wallcar', 'car', { q: 'car' }], ['wallspace', 'space', { q: 'space' }],
        ['wallcity', 'city', { q: 'city' }], ['wallabstract', 'abstract', { q: 'abstract' }], ['wallgame', 'gaming', { q: 'video game' }], ['wallminimal', 'minimal', { q: 'minimalism' }],
        ['wallmobile', 'phone', { ratios: '9x16', atleast: '1080x1920', q: '' }], ['walldark', 'dark', { q: 'dark' }], ['wallanimal', 'animal', { q: 'animals' }],
        ['wallflower', 'flower', { q: 'flowers' }], ['wallsunset', 'sunset', { q: 'sunset' }], ['wallocean', 'ocean', { q: 'ocean' }], ['wallmountain', 'mountain', { q: 'mountains' }],
        ['wallforest', 'forest', { q: 'forest' }], ['wallneon', 'neon', { q: 'neon' }], ['wallmusic', 'music', { q: 'music' }], ['wallsport', 'sport', { q: 'sports' }],
        ['wallbike', 'motorcycle', { q: 'motorcycle' }], ['wallplane', 'aircraft', { q: 'aircraft' }], ['walltech', 'technology', { q: 'technology' }], ['wallsl', 'Sri Lanka', { q: 'Sri Lanka' }]
    ].forEach(([n, label, base]) => wall(n, label, base));

    def('bingwall', '.bingwall [0-7 days ago] [market] — Bing picture of the day (e.g. .bingwall 2 ja-JP)', ['bingpic', 'bingday'], async (ctx) => {
        const idx = Math.min(7, Math.max(0, parseInt(ctx.args.find((a) => /^\d$/.test(a)) || '0', 10)));
        const mkt = ctx.args.find((a) => /^[a-z]{2}-[A-Za-z]{2}$/.test(a)) || 'en-US';
        const d = await get(`https://www.bing.com/HPImageArchive.aspx?format=js&idx=${idx}&n=1&mkt=${mkt}`);
        const im = d && d.images && d.images[0];
        if (!im) throw miss();
        const base = 'https://www.bing.com' + im.urlbase;
        const cap = card('Bing wallpaper', im.startdate || 'daily', [kv('title', trunc(im.title, 80)), kv('about', trunc(im.copyright, 120))]) + credit();
        try { await sendImg(ctx, base + '_1920x1080.jpg', cap); } catch (e) { await sendImg(ctx, 'https://www.bing.com' + im.url, cap); }
    });
    pic('picgray', 'Grayscale photo', '.picgray — a random black & white photo', ['bwphoto'], async () => ({ url: `https://picsum.photos/1080/720?grayscale&random=${Date.now()}`, tag: 'picsum' }));
    pic('picblur', 'Blurred photo', '.picblur — a random blurred photo (nice phone background)', ['blurphoto'], async () => ({ url: `https://picsum.photos/1080/1620?blur=4&random=${Date.now()}`, tag: 'picsum' }));
    pic('picseed', 'Seeded photo', '.picseed [word] — the same photo every time for a word', ['seedphoto'], async (ctx) => {
        const s = ctx.q.trim();
        if (!s) return null;
        return { url: `https://picsum.photos/seed/${enc(s)}/1080/720`, rows: [kv('seed', trunc(s, 40))], tag: 'picsum' };
    });
    pic('flickrpic', 'Photo', '.flickrpic [keyword] — a photo of a keyword (cat, beach, tokyo …)', ['kwphoto', 'keywordpic'], async (ctx) => {
        const k = ctx.args.join(',').replace(/[^\w,]+/g, '').slice(0, 60);
        if (!k) return null;
        return { url: `https://loremflickr.com/1080/720/${enc(k)}?random=${Date.now() % 100000}`, rows: [kv('keyword', k.replace(/,/g, ', '))], tag: 'flickr' };
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
    redditPic('dankmeme', 'Dank meme', 'dankmemes', ['dank']);
    redditPic('wholesome', 'Wholesome', 'wholesomememes', ['wholesomememe']);
    redditPic('codememe', 'Coding meme', 'ProgrammerHumor', ['devmeme', 'progmeme']);
    redditPic('animememe', 'Anime meme', 'Animemes', ['animemes']);
    redditPic('historymeme', 'History meme', 'HistoryMemes', ['histmeme']);
    redditPic('sciencememe', 'Science meme', 'sciencememes', ['scimeme']);
    redditPic('gamememe', 'Gaming meme', 'gamingmemes', ['gamermeme']);
    redditPic('awwpic', 'Aww', 'aww', ['aww', 'cutepic']);
    redditPic('landscapepic', 'Landscape', 'EarthPorn', ['earthpic', 'scenery']);
    redditPic('cityscape', 'Cityscape', 'CityPorn', ['citypic']);
    redditPic('foodshot', 'Food', 'food', ['foodpic']);
    redditPic('artpic', 'Art', 'Art', ['redditart']);
    redditPic('carpic', 'Car', 'carporn', ['carshot']);
    redditPic('cutecat', 'Cat', 'cats', ['catreddit']);
    redditPic('cutedog', 'Dog', 'dogpictures', ['dogreddit']);

    def('xkcd', '.xkcd [number | latest] — download an xkcd comic (random if empty)', ['xkcdcomic', 'comic'], async (ctx) => {
        const latestInfo = await get('https://xkcd.com/info.0.json');
        const latest = latestInfo.num;
        let n = parseInt(ctx.args[0], 10);
        if (/^l/i.test(ctx.args[0] || '')) n = latest;
        else if (!n || n < 1 || n > latest) n = 1 + Math.floor(Math.random() * latest);
        if (n === 404) n = 405;
        const c = n === latest ? latestInfo : await get(`https://xkcd.com/${n}/info.0.json`);
        await sendImg(ctx, c.img, card('xkcd #' + c.num, c.year || 'comic', [kv('title', c.title), kv('alt text', trunc(c.alt, 300))]) + credit());
    });

    // ======================================================================
    //  6. ART MUSEUMS  (public-domain artworks)
    // ======================================================================
    pic('artwork', 'Artwork', '.artwork [search] — public-domain painting from the Art Institute of Chicago', ['artic', 'painting'], async (ctx) => {
        const q = ctx.q.trim() || rnd(['landscape', 'portrait', 'flowers', 'sea', 'night', 'garden', 'mountain', 'river']);
        const d = await get(`https://api.artic.edu/api/v1/artworks/search?q=${enc(q)}&query[term][is_public_domain]=true&limit=20&fields=id,title,artist_display,date_display,image_id`);
        const list = ((d && d.data) || []).filter((a) => a.image_id);
        if (!list.length) throw miss('No artwork found for that.');
        const a = rnd(list);
        const iiif = (d.config && d.config.iiif_url) || 'https://www.artic.edu/iiif/2';
        return { url: `${iiif}/${a.image_id}/full/1200,/0/default.jpg`, alts: [`${iiif}/${a.image_id}/full/843,/0/default.jpg`], rows: [kv('title', trunc(a.title, 80)), kv('artist', trunc(String(a.artist_display || '').split('\n')[0], 70)), kv('date', a.date_display || '—')], tag: 'art institute of chicago' };
    });
    pic('metart', 'Met artwork', '.metart [search] — public-domain artwork from The Met Museum', ['metmuseum', 'metpic'], async (ctx) => {
        const q = ctx.q.trim() || rnd(['landscape', 'portrait', 'vase', 'armor', 'garden', 'sculpture', 'sea']);
        const s = await get(`https://collectionapi.metmuseum.org/public/collection/v1/search?hasImages=true&isPublicDomain=true&q=${enc(q)}`);
        const ids = shuffle((s && s.objectIDs) || []).slice(0, 8);
        if (!ids.length) throw miss('No artwork found for that.');
        for (const id of ids) {
            try {
                const o = await get(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`);
                const u = o && (o.primaryImage || o.primaryImageSmall);
                if (u) return { url: u, alts: o.primaryImageSmall && o.primaryImageSmall !== u ? [o.primaryImageSmall] : [], rows: [kv('title', trunc(o.title, 80)), o.artistDisplayName ? kv('artist', trunc(o.artistDisplayName, 60)) : null, o.objectDate ? kv('date', o.objectDate) : null].filter(Boolean), tag: 'the met' };
            } catch (e) { /* next object */ }
        }
        throw miss('No artwork with a picture was found.');
    });
    pic('clevelandart', 'Cleveland art', '.clevelandart [search] — open-access artwork from the Cleveland Museum of Art', ['cleveland', 'cmaart'], async (ctx) => {
        const q = ctx.q.trim() || rnd(['landscape', 'portrait', 'flowers', 'river', 'bird', 'mask']);
        const d = await get(`https://openaccess-api.clevelandart.org/api/artworks/?q=${enc(q)}&has_image=1&cc0=1&limit=20`);
        const list = ((d && d.data) || []).filter((a) => a.images && a.images.web && a.images.web.url);
        if (!list.length) throw miss('No artwork found for that.');
        const a = rnd(list);
        return { url: a.images.web.url, alts: a.images.print && a.images.print.url ? [a.images.print.url] : [], rows: [kv('title', trunc(a.title, 80)), a.creators && a.creators[0] ? kv('artist', trunc(a.creators[0].description, 70)) : null, a.creation_date ? kv('date', a.creation_date) : null].filter(Boolean), tag: 'cleveland museum' };
    });

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
    pic('nasaimg', 'NASA image', '.nasaimg [search] — a picture from the NASA image library (mars, nebula, apollo …)', ['nasapic', 'nasaphoto'], async (ctx) => {
        const items = await nasaSearch(ctx.q.trim() || rnd(['nebula', 'galaxy', 'mars', 'earth', 'moon', 'saturn', 'apollo']), 'image');
        for (const it of items.slice(0, 5)) {
            const id = ((it.data || [])[0] || {}).nasa_id;
            const thumb = it.links && it.links[0] && it.links[0].href;
            let url = thumb;
            try {
                const a = await nasaAssets(id);
                url = a.find((u) => /~large\.(jpg|png)$/i.test(u)) || a.find((u) => /~medium\.(jpg|png)$/i.test(u)) || a.find((u) => /\.(jpg|jpeg|png)$/i.test(u) && !/~thumb|~small/i.test(u)) || thumb;
            } catch (e) { /* use the thumbnail */ }
            if (url) return { url, alts: thumb && thumb !== url ? [thumb] : [], rows: nasaRows(it), tag: 'nasa' };
        }
        throw miss();
    });
    def('nasavideo', '.nasavideo [search] — a short video from the NASA library (rocket, mars, earth …)', ['nasaclip', 'nasavid'], async (ctx) => {
        const items = await nasaSearch(ctx.q.trim() || rnd(['rocket launch', 'mars', 'earth', 'astronaut', 'moon']), 'video');
        await firstOk(items, async (it) => {
            const id = ((it.data || [])[0] || {}).nasa_id;
            const a = await nasaAssets(id);
            const urls = [a.find((u) => /~mobile\.mp4$/i.test(u)), a.find((u) => /~small\.mp4$/i.test(u)), a.find((u) => /~medium\.mp4$/i.test(u))].filter(Boolean);
            if (!urls.length) throw miss();
            await guarded(ctx, 'NASA video', urls[urls.length - 1], async () => { await sendVid(ctx, urls[0], card('NASA video', 'nasa', nasaRows(it)) + credit()); });
        }, 4);
    });
    def('nasaaudio', '.nasaaudio [search] — NASA sound recordings (apollo, launch, planets …)', ['nasasound'], async (ctx) => {
        const items = await nasaSearch(ctx.q.trim() || rnd(['apollo', 'launch', 'saturn', 'jupiter', 'sun']), 'audio');
        await firstOk(items, async (it) => {
            const id = ((it.data || [])[0] || {}).nasa_id;
            const a = await nasaAssets(id);
            const u = a.find((x) => /\.mp3$/i.test(x)) || a.find((x) => /\.(m4a|wav)$/i.test(x));
            if (!u) throw miss();
            await ctx.reply(card('NASA audio', 'nasa', nasaRows(it)));
            await guarded(ctx, 'NASA audio', u, () => sendAud(ctx, u));
        }, 4);
    });
    pic('earthnow', 'Earth from space', '.earthnow — latest picture of the whole Earth (NASA EPIC camera)', ['epic', 'earthpic'], async () => {
        const d = await get('https://epic.gsfc.nasa.gov/api/natural');
        const e = rnd(d || []);
        if (!e) throw miss();
        const ymd = String(e.date).slice(0, 10).split('-');
        return { url: `https://epic.gsfc.nasa.gov/archive/natural/${ymd[0]}/${ymd[1]}/${ymd[2]}/jpg/${e.image}.jpg`, rows: [kv('taken', String(e.date).slice(0, 16) + ' UTC'), e.caption ? trunc(e.caption, 120) : null].filter(Boolean), tag: 'nasa epic' };
    });

    // ======================================================================
    //  8. WIKIMEDIA COMMONS & OPENVERSE  (free pictures, audio, video)
    // ======================================================================
    def('commonsaudio', '.commonsaudio [search] — free audio from Wikimedia Commons (birds, music, speech …)', ['wikiaudio', 'wikisound'], async (ctx) => {
        const q = ctx.q.trim();
        if (!q) return ctx.reply(use('Commons audio', 'Type what to search.', '.commonsaudio rain'));
        const l = (await commonsFind(q, 'audio')).filter((x) => x.info.url && (x.info.size || 0) < 24 * 1048576);
        if (!l.length) throw miss('No audio found for that.');
        await firstOk(shuffle(l), async (x) => { await ctx.reply(card('Commons audio', 'wikimedia', [kv('title', trunc(x.title, 80)), kv('size', mb(x.info.size || 0))])); await sendAud(ctx, x.info.url); }, 3);
    });
    def('commonsvideo', '.commonsvideo [search] — free video from Wikimedia Commons', ['wikivideo', 'wikivid'], async (ctx) => {
        const q = ctx.q.trim();
        if (!q) return ctx.reply(use('Commons video', 'Type what to search.', '.commonsvideo volcano'));
        const l = (await commonsFind(q, 'video')).filter((x) => x.info.url && (x.info.size || 0) < 36 * 1048576);
        if (!l.length) throw miss('No video found for that.');
        await firstOk(shuffle(l), async (x) => { await sendVid(ctx, x.info.url, card('Commons video', 'wikimedia', [kv('title', trunc(x.title, 80)), kv('size', mb(x.info.size || 0))]) + credit()); }, 3);
    });
    const licenseOf = (r) => [r.license ? String(r.license).toUpperCase() : '', r.license_version || ''].filter(Boolean).join(' ');
    def('openimg', '.openimg [search] — free (Creative Commons) picture from Openverse', ['openverse', 'ccimage', 'freeimg'], async (ctx) => {
        const q = ctx.q.trim();
        if (!q) return ctx.reply(use('Openverse', 'Type what to search.', '.openimg elephant'));
        const d = await get(`https://api.openverse.org/v1/images/?q=${enc(q)}&page_size=20&mature=false`);
        const list = ((d && d.results) || []).filter((r) => r.url || r.thumbnail);
        if (!list.length) throw miss('No pictures found for that.');
        await firstOk(shuffle(list), async (r) => {
            const rows = [kv('title', trunc(r.title || q, 70)), r.creator ? kv('by', trunc(r.creator, 40)) : null, licenseOf(r) ? kv('license', licenseOf(r)) : null].filter(Boolean);
            try { await sendImg(ctx, r.url, card('Openverse', 'free picture', rows) + credit()); }
            catch (e) { if (!r.thumbnail) throw e; await sendImg(ctx, r.thumbnail, card('Openverse', 'free picture', rows) + credit()); }
        }, 4);
    });
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
    openAudio('openaudio', '.openaudio [search] — free (Creative Commons) audio from Openverse', ['ccaudio', 'freeaudio'], '', 'Openverse audio');
    openAudio('soundfx', '.soundfx [search] — free sound effects (door, rain, bell …)', ['sfx', 'soundeffect'], '&category=sound_effect', 'Sound effect');
    openAudio('freemusic', '.freemusic [search] — free music you can use anywhere', ['ccmusic2', 'royaltyfree'], '&category=music', 'Free music');
    def('ccmusic', '.ccmusic [tag] — free Creative Commons music (chill, rock, piano, ambient …)', ['ccmixter', 'remix'], async (ctx) => {
        const tag = (ctx.args[0] || rnd(['chill', 'ambient', 'piano', 'rock', 'electronic', 'acoustic'])).replace(/[^\w-]/g, '');
        const d = await get(`https://ccmixter.org/api/query?f=json&limit=15&sort=rank&tags=${enc(tag)}`);
        const list = (Array.isArray(d) ? d : []).map((u) => ({ u, f: (u.files || []).find((f) => /mp3/i.test((f.file_format_info && f.file_format_info['default-ext']) || f.file_nicname || '') && f.download_url) })).filter((x) => x.f);
        if (!list.length) throw miss('No tracks found for that tag.');
        await firstOk(shuffle(list), async (x) => {
            await ctx.reply(card('CC music', 'ccmixter', [kv('track', trunc(x.u.upload_name, 70)), kv('artist', trunc(x.u.user_real_name || x.u.user_name, 40)), x.u.license_name ? kv('license', x.u.license_name) : null].filter(Boolean)));
            await guarded(ctx, 'CC music', x.f.download_url, () => sendAud(ctx, x.f.download_url));
        }, 3);
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
    def('archiveaudio', '.archiveaudio [search] — an audio file from the Internet Archive (old radio, music, speeches)', ['iaaudio', 'archivemp3'], async (ctx) => {
        const q = ctx.q.trim();
        if (!q) return ctx.reply(use('Archive audio', 'Type what to search.', '.archiveaudio jazz'));
        const r = await archivePick(await archiveFind(q, 'audio'), (f) => /\.mp3$/i.test(f.name), 24 * 1048576);
        await ctx.reply(card('Archive audio', 'internet archive', archiveRows(r)));
        await guarded(ctx, 'Archive audio', r.url, () => sendAud(ctx, r.url));
    });
    def('archivevideo', '.archivevideo [search] — a video from the Internet Archive (old films, cartoons, news)', ['iavideo', 'archivefilm'], async (ctx) => {
        const q = ctx.q.trim();
        if (!q) return ctx.reply(use('Archive video', 'Type what to search.', '.archivevideo trailer'));
        const r = await archivePick(await archiveFind(q, 'movies'), (f) => /\.mp4$/i.test(f.name), 38 * 1048576);
        await guarded(ctx, 'Archive video', r.url, () => sendVid(ctx, r.url, card('Archive video', 'internet archive', archiveRows(r)) + credit()));
    });
    def('archivebook', '.archivebook [search] — a free PDF book from the Internet Archive', ['iabook2', 'archivepdf'], async (ctx) => {
        const q = ctx.q.trim();
        if (!q) return ctx.reply(use('Archive book', 'Type a book title or topic.', '.archivebook history of ceylon'));
        const r = await archivePick(await archiveFind(q, 'texts'), (f) => /\.pdf$/i.test(f.name), 38 * 1048576);
        await ctx.reply(card('Archive book', 'internet archive', archiveRows(r).concat([`↳ ${sc('sending')}`])));
        await guarded(ctx, 'Archive book', r.url, () => sendDoc(ctx, r.url, safeName(r.doc.title, r.doc.identifier) + '.pdf', 'application/pdf'));
    });

    // ======================================================================
    //  10. BOOKS & COVERS
    // ======================================================================
    def('booktxt', '.booktxt [title] — a free classic book as a text file (Project Gutenberg)', ['gutentxt', 'classictxt'], async (ctx) => {
        const q = ctx.q.trim();
        if (!q) return ctx.reply(use('Book text', 'Type the book title or author.', '.booktxt pride and prejudice'));
        const d = await get('https://gutendex.com/books/?search=' + enc(q));
        const b = ((d && d.results) || []).find((x) => x.formats && Object.keys(x.formats).some((k) => /^text\/plain/.test(k)));
        if (!b) throw miss('No free text version of that book was found.');
        const key = Object.keys(b.formats).find((k) => /^text\/plain; charset=utf-8/i.test(k)) || Object.keys(b.formats).find((k) => /^text\/plain/.test(k));
        const url = b.formats[key];
        await ctx.reply(card('Book text', 'project gutenberg', [kv('title', trunc(b.title, 80)), kv('author', trunc((b.authors[0] || {}).name || '—', 50)), `↳ ${sc('sending')}`]));
        await guarded(ctx, 'Book text', url, () => sendDoc(ctx, url, safeName(b.title) + '.txt', 'text/plain'));
    });
    pic('bookcover', 'Book cover', '.bookcover [title] — the cover picture of a book', ['cover', 'bookpic'], async (ctx) => {
        const q = ctx.q.trim();
        if (!q) return null;
        const d = await get(`https://openlibrary.org/search.json?q=${enc(q)}&limit=8&fields=title,author_name,cover_i,first_publish_year`);
        const b = ((d && d.docs) || []).find((x) => x.cover_i);
        if (!b) throw miss('No cover found for that book.');
        return { url: `https://covers.openlibrary.org/b/id/${b.cover_i}-L.jpg`, alts: [`https://covers.openlibrary.org/b/id/${b.cover_i}-M.jpg`], rows: [kv('book', trunc(b.title, 80)), b.author_name ? kv('author', trunc(b.author_name[0], 50)) : null, b.first_publish_year ? kv('first published', b.first_publish_year) : null].filter(Boolean), tag: 'open library' };
    });
    def('wikitxt', '.wikitxt [lang] [topic] — a Wikipedia article as a text file (e.g. .wikitxt si ශ්‍රී ලංකාව)', ['wikitext', 'wikiarticle'], async (ctx) => {
        let lang = 'en', q = ctx.q.trim();
        if (/^[a-z]{2,3}$/.test(ctx.args[0] || '') && ctx.args.length > 1) { lang = ctx.args[0]; q = ctx.args.slice(1).join(' '); }
        if (!q) return ctx.reply(use('Wiki text', 'Type a topic (optionally a language code first).', '.wikitxt si ශ්‍රී ලංකාව'));
        const s = await get(`https://${lang}.wikipedia.org/w/api.php?action=opensearch&limit=1&format=json&search=${enc(q)}`);
        const title = s && s[1] && s[1][0];
        if (!title) throw miss('No Wikipedia article found for that.');
        const d = await get(`https://${lang}.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&titles=${enc(title)}`);
        const pg = Object.values((d && d.query && d.query.pages) || {})[0];
        if (!pg || !pg.extract) throw miss('That article is empty.');
        const text = `${pg.title}\nhttps://${lang}.wikipedia.org/wiki/${enc(String(pg.title).replace(/ /g, '_'))}\n\n${pg.extract}`;
        await sendDoc(ctx, Buffer.from(text, 'utf8'), safeName(pg.title) + '.txt', 'text/plain');
    });

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
    def('surahmp3', '.surahmp3 [number or name] [reciter] — a full surah recitation as MP3 (e.g. .surahmp3 36 sudais)', ['surahaudio', 'quranmp3', 'recitesurah'], async (ctx) => {
        const first = (ctx.args[0] || '').toLowerCase();
        if (!first) return ctx.reply(use('Surah MP3', 'Surah number or name, then (optional) a reciter name.', '.surahmp3 yasin alafasy'));
        const all = await surahList();
        let s = /^\d{1,3}$/.test(first) ? all.find((x) => x.number === parseInt(first, 10)) : null;
        if (!s) { const k = norm(first); s = all.find((x) => norm(x.englishName) === k || norm(x.englishName).includes(k) && k.length > 2); }
        if (!s) throw miss('Surah not found. Use its number (1-114) or name.');
        const RALIAS = { sudais: ['sudais', 'sudaes', 'sudays'], shuraim: ['shuraim', 'shuraym', 'shuriam'], ghamdi: ['ghamdi', 'ghamadi', 'ghamidi'], maher: ['maher', 'muaiqly', 'muaiqaly'], husary: ['husary', 'hussary', 'husari'], minshawi: ['minshawi', 'minshawy'], alafasy: ['afasy'], mishary: ['afasy'], dosari: ['dosari', 'dossari', 'dawsari'] };
        const wantedRaw = norm(ctx.args.slice(1).join(' ')) || 'afasy';
        const wantedList = RALIAS[wantedRaw] || [wantedRaw];
        let url = null, who = 'Mishary Alafasy';
        try {
            const r = (await reciters()).find((x) => wantedList.some((w) => x.key.includes(w)) && x.moshaf.some((m) => m.list.has(s.number)));
            if (r) { const m = r.moshaf.find((mm) => mm.list.has(s.number)); url = m.server + String(s.number).padStart(3, '0') + '.mp3'; who = r.name; }
        } catch (e) { /* use the backup source below */ }
        if (!url && ctx.args.length > 1) throw miss('That reciter was not found. Try: alafasy, sudais, shuraim, husary, minshawi, ghamdi, maher.');
        if (!url) url = `https://cdn.islamic.network/quran/audio-surah/128/ar.alafasy/${s.number}.mp3`;
        await ctx.reply(card('Surah MP3', s.englishName, [kv('surah', `${s.number}. ${s.name}`), kv('verses', s.numberOfAyahs), kv('reciter', who), `↳ ${sc('sending')}`]));
        await guarded(ctx, 'Surah MP3', url, () => sendAud(ctx, url));
    });
    pic('ayahpic', 'Ayah picture', '.ayahpic [surah:ayah] — the ayah as a clear picture', ['ayahimg', 'quranpic'], async (ctx) => {
        const m = /^(\d{1,3})[:\s](\d{1,3})$/.exec(ctx.args.join(' ').trim());
        if (!m) return null;
        const [, s, a] = m;
        return { url: `https://cdn.islamic.network/quran/images/high-resolution/${s}_${a}.png`, alts: [`https://cdn.islamic.network/quran/images/${s}_${a}.png`], rows: [kv('ayah', `${s}:${a}`)], tag: 'quran' };
    });

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
    pokeArt('pokeart', 'Pokémon', '.pokeart [name or number] — official artwork of a Pokémon', ['pokepic', 'pokeimg'], (p) => art(p) && art(p).front_default);
    pokeArt('pokeshiny', 'Shiny Pokémon', '.pokeshiny [name or number] — the shiny version artwork', ['shinypoke'], (p) => (art(p) && art(p).front_shiny) || (p.sprites && p.sprites.front_shiny));
    pokeArt('pokerandom', 'Random Pokémon', '.pokerandom — a random Pokémon artwork', ['randompoke'], (p) => art(p) && art(p).front_default);
    def('pokecry', '.pokecry [name or number] — the sound a Pokémon makes', ['pokesound'], async (ctx) => {
        const q = ctx.q.trim();
        if (!q) return ctx.reply(use('Pokémon cry', 'Type a Pokémon name or number.', '.pokecry pikachu'));
        const p = await pokemon(q);
        const u = p.cries && (p.cries.latest || p.cries.legacy);
        if (!u) throw miss('No cry recorded for that Pokémon.');
        await ctx.reply(card('Pokémon cry', cap1(p.name), pokeRows(p)));
        await sendAud(ctx, u);
    });

    // ======================================================================
    //  13. EMOJI  (picture & animated)
    // ======================================================================
    const firstEmoji = (s) => {
        s = String(s || '').trim();
        if (!s) return null;
        try { const seg = [...new Intl.Segmenter().segment(s)][0]; return seg && seg.segment; } catch (e) { return Array.from(s)[0]; }
    };
    pic('emojipng', 'Emoji', '.emojipng [emoji] — a big emoji picture (512 px)', ['emojiimg', 'bigemoji'], async (ctx) => {
        const e = firstEmoji(ctx.q);
        if (!e) return null;
        const cps = Array.from(e).map((c) => c.codePointAt(0).toString(16)).filter((c) => c !== 'fe0f');
        return { url: `https://raw.githubusercontent.com/googlefonts/noto-emoji/main/png/512/emoji_u${cps.join('_')}.png`, alts: [`https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/${cps.join('-')}.png`], rows: [kv('emoji', e)], tag: 'noto emoji' };
    });
    pic('emojigif', 'Animated emoji', '.emojigif [emoji] — the animated version of an emoji', ['animemoji', 'emojianim'], async (ctx) => {
        const e = firstEmoji(ctx.q);
        if (!e) return null;
        const cps = Array.from(e).map((c) => c.codePointAt(0).toString(16));
        return { url: `https://fonts.gstatic.com/s/e/notoemoji/latest/${cps.join('_')}/512.gif`, gif: true, rows: [kv('emoji', e)], tag: 'noto emoji' };
    });

    // ======================================================================
    //  14. GITHUB DOWNLOADS
    // ======================================================================
    const ghGet = (url) => get(url, { headers: Object.assign({ 'User-Agent': API_UA, 'Accept': 'application/vnd.github+json' }, process.env.GITHUB_TOKEN ? { Authorization: 'Bearer ' + process.env.GITHUB_TOKEN } : {}) });
    const parseRepo = (s) => {
        const m = /(?:github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/?#\s]|$)/i.exec(String(s || '').trim() + ' ');
        return m ? { owner: m[1], repo: m[2] } : null;
    };
    def('ghrelease', '.ghrelease [owner/repo or link] [file filter] — download the latest release file', ['release', 'latestrelease'], async (ctx) => {
        const r = parseRepo(ctx.args[0] || '');
        if (!r) return ctx.reply(use('GitHub release', 'Send owner/repo or a repo link. Add a word to pick a file (apk, windows, linux …).', '.ghrelease termux/termux-app apk'));
        const d = await ghGet(`https://api.github.com/repos/${r.owner}/${r.repo}/releases/latest`);
        const assets = (d && d.assets) || [];
        const filter = ctx.args.slice(1).join(' ').toLowerCase();
        let list = filter ? assets.filter((a) => a.name.toLowerCase().includes(filter)) : assets;
        if (!assets.length) {
            await ctx.reply(card(r.repo, d.tag_name || 'release', [kv('release', trunc(d.name || d.tag_name, 60)), 'No files attached — sending the source code.']));
            return await guarded(ctx, 'Source', d.zipball_url, () => sendDoc(ctx, d.zipball_url, `${r.repo}-${d.tag_name || 'latest'}.zip`, 'application/zip'));
        }
        if (!list.length) throw miss('No file matches that word. Files: ' + assets.slice(0, 8).map((a) => a.name).join(', '));
        if (list.length > 1) {
            return await ctx.reply(card(`${r.repo} ${d.tag_name || ''}`.trim(), 'choose a file', list.slice(0, 15).map((a) => kv(trunc(a.name, 44), mb(a.size))).concat([`↳ ${sc('add part of the file name, e.g.')} .ghrelease ${r.owner}/${r.repo} ${(list[0].name.split(/[-_.]/)[1] || 'zip').toLowerCase()}`])));
        }
        const a = list[0];
        await ctx.reply(card(r.repo, d.tag_name || 'release', [kv('file', trunc(a.name, 50)), kv('size', mb(a.size)), `↳ ${sc('sending')}`]));
        await guarded(ctx, a.name, a.browser_download_url, () => sendDoc(ctx, a.browser_download_url, a.name, mimeOf(a.name)));
    });
    def('ghfile', '.ghfile [github file link] — download a single file from GitHub', ['rawfile', 'githubfile'], async (ctx) => {
        const q = ctx.q.trim();
        let raw = null;
        let m = /github\.com\/([\w.-]+)\/([\w.-]+)\/blob\/([^/\s]+)\/(\S+)/i.exec(q);
        if (m) raw = `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}/${m[4].split('?')[0]}`;
        else if (/raw\.githubusercontent\.com\/\S+/i.test(q)) raw = (q.match(/https?:\/\/raw\.githubusercontent\.com\/\S+/i) || [])[0];
        else if ((m = /^([\w.-]+)\/([\w.-]+)\s+(\S+)$/.exec(q))) raw = `https://raw.githubusercontent.com/${m[1]}/${m[2]}/HEAD/${m[3]}`;
        if (!raw) return ctx.reply(use('GitHub file', 'Send a link to a file on GitHub, or: owner/repo path/to/file', '.ghfile https://github.com/user/repo/blob/main/src/index.js'));
        const name = decodeURIComponent(raw.split('?')[0].split('/').pop() || 'file');
        await guarded(ctx, name, raw, () => sendDoc(ctx, raw, name, mimeOf(name) === 'application/octet-stream' ? 'text/plain' : mimeOf(name)));
    });
    def('ghreadme', '.ghreadme [owner/repo or link] — download the README of a repository', ['readme'], async (ctx) => {
        const r = parseRepo(ctx.q);
        if (!r) return ctx.reply(use('README', 'Send owner/repo or a repo link.', '.ghreadme expressjs/express'));
        const d = await ghGet(`https://api.github.com/repos/${r.owner}/${r.repo}/readme`);
        if (!d || !d.download_url) throw miss('That repository has no README.');
        await sendDoc(ctx, d.download_url, `${r.repo}-${d.name || 'README.md'}`, 'text/markdown');
    });
    pic('ghavatar', 'GitHub avatar', '.ghavatar [username] — the profile picture of a GitHub user', ['githubdp', 'ghdp'], async (ctx) => {
        const u = (ctx.args[0] || '').replace(/^@/, '').replace(/[^\w-]/g, '');
        if (!u) return null;
        const d = await ghGet('https://api.github.com/users/' + enc(u));
        return { url: (d && d.avatar_url ? d.avatar_url.split('?')[0] : `https://github.com/${u}.png`) + '?size=800', rows: [kv('user', '@' + d.login), d.name ? kv('name', trunc(d.name, 40)) : null, kv('repos', d.public_repos), kv('followers', d.followers)].filter(Boolean), tag: 'github' };
    });
    def('gistdl', '.gistdl [gist link] — download the files of a GitHub gist', ['gistfile', 'gist'], async (ctx) => {
        const m = /gist\.github\.com\/(?:[\w-]+\/)?([0-9a-f]{8,})/i.exec(ctx.q) || /^([0-9a-f]{20,})$/i.exec(ctx.q.trim());
        if (!m) return ctx.reply(use('Gist', 'Send a gist link.', '.gistdl https://gist.github.com/user/0123456789abcdef'));
        const d = await ghGet('https://api.github.com/gists/' + m[1]);
        const files = Object.values((d && d.files) || {}).filter((f) => f.raw_url && f.size <= 30 * 1048576).slice(0, 5);
        if (!files.length) throw miss('That gist has no downloadable files.');
        await ctx.reply(card('Gist', 'github', [kv('files', files.length), d.description ? kv('about', trunc(d.description, 80)) : null].filter(Boolean)));
        for (const f of files) await sendDoc(ctx, f.raw_url, f.filename, f.type && f.type.startsWith('text/') ? f.type : mimeOf(f.filename) === 'application/octet-stream' ? 'text/plain' : mimeOf(f.filename));
    });

    // ======================================================================
    //  15. PACKAGES, PLUGINS & LIBRARIES
    // ======================================================================
    def('npmdl', '.npmdl [package] [version] — download an npm package (.tgz)', ['npmpack', 'npmget'], async (ctx) => {
        const name = ctx.args[0];
        if (!name) return ctx.reply(use('npm download', 'Package name, then (optional) a version.', '.npmdl express 4.19.2'));
        const key = name.startsWith('@') ? '@' + enc(name.slice(1)) : enc(name);
        const d = await get(`https://registry.npmjs.org/${key}/${enc(ctx.args[1] || 'latest')}`);
        const url = d && d.dist && d.dist.tarball;
        if (!url) throw miss('Package or version not found.');
        await ctx.reply(card(d.name, 'npm ' + d.version, [d.description ? trunc(d.description, 140) : null, d.dist.unpackedSize ? kv('unpacked', mb(d.dist.unpackedSize)) : null].filter(Boolean)));
        await guarded(ctx, d.name, url, () => sendDoc(ctx, url, `${safeName(d.name.replace('@', '').replace('/', '-'))}-${d.version}.tgz`, 'application/gzip'));
    });
    def('pypidl', '.pypidl [package] — download a Python package file from PyPI', ['pipdl', 'pythondl'], async (ctx) => {
        const name = ctx.args[0];
        if (!name) return ctx.reply(use('PyPI download', 'Package name, then (optional) a version.', '.pypidl requests'));
        const d = await get(`https://pypi.org/pypi/${enc(name)}/${ctx.args[1] ? enc(ctx.args[1]) + '/' : ''}json`);
        const files = (d && d.urls) || [];
        const f = files.find((x) => x.packagetype === 'bdist_wheel' && /py3-none-any/.test(x.filename)) || files.find((x) => x.packagetype === 'sdist') || files[0];
        if (!f) throw miss('No files for that package.');
        await ctx.reply(card(d.info.name, 'pypi ' + d.info.version, [d.info.summary ? trunc(d.info.summary, 140) : null, kv('file', trunc(f.filename, 50)), kv('size', mb(f.size))].filter(Boolean)));
        await guarded(ctx, d.info.name, f.url, () => sendDoc(ctx, f.url, f.filename, mimeOf(f.filename)));
    });
    def('cratedl', '.cratedl [crate] — download a Rust crate (.crate)', ['crates', 'rustdl'], async (ctx) => {
        const name = ctx.args[0];
        if (!name) return ctx.reply(use('Crate download', 'Crate name.', '.cratedl serde'));
        const d = await get('https://crates.io/api/v1/crates/' + enc(name));
        const c = d && d.crate;
        if (!c) throw miss('Crate not found.');
        const ver = ctx.args[1] || c.max_stable_version || c.newest_version;
        await ctx.reply(card(c.name, 'crate ' + ver, [c.description ? trunc(c.description, 140) : null].filter(Boolean)));
        const url = `https://crates.io/api/v1/crates/${enc(c.name)}/${enc(ver)}/download`;
        await guarded(ctx, c.name, url, () => sendDoc(ctx, url, `${c.name}-${ver}.crate`, 'application/gzip'));
    });
    def('gemdl', '.gemdl [gem] — download a Ruby gem (.gem)', ['rubygem', 'rubydl'], async (ctx) => {
        const name = ctx.args[0];
        if (!name) return ctx.reply(use('Gem download', 'Gem name.', '.gemdl rails'));
        const d = await get(`https://rubygems.org/api/v1/gems/${enc(name)}.json`);
        if (!d || !d.version) throw miss('Gem not found.');
        const url = `https://rubygems.org/downloads/${d.name}-${d.version}.gem`;
        await ctx.reply(card(d.name, 'gem ' + d.version, [d.info ? trunc(d.info, 140) : null].filter(Boolean)));
        await guarded(ctx, d.name, url, () => sendDoc(ctx, url, `${d.name}-${d.version}.gem`, 'application/octet-stream'));
    });
    def('nugetdl', '.nugetdl [package] — download a NuGet (.NET) package', ['nuget', 'dotnetdl'], async (ctx) => {
        const id = (ctx.args[0] || '').toLowerCase();
        if (!id) return ctx.reply(use('NuGet download', 'Package id.', '.nugetdl newtonsoft.json'));
        const d = await get(`https://api.nuget.org/v3-flatcontainer/${enc(id)}/index.json`);
        const vers = (d && d.versions) || [];
        const ver = ctx.args[1] || vers.filter((v) => !v.includes('-')).pop() || vers.pop();
        if (!ver) throw miss('Package not found.');
        const url = `https://api.nuget.org/v3-flatcontainer/${enc(id)}/${enc(ver)}/${enc(id)}.${enc(ver)}.nupkg`;
        await ctx.reply(card(id, 'nuget ' + ver, []));
        await guarded(ctx, id, url, () => sendDoc(ctx, url, `${id}.${ver}.nupkg`, 'application/zip'));
    });
    def('fdroid', '.fdroid [package id] — download an open-source Android app from F-Droid', ['fdroidapk', 'fdroiddl'], async (ctx) => {
        const id = (ctx.args[0] || '').trim();
        if (!/^[\w.]+$/.test(id)) return ctx.reply(use('F-Droid', 'Send the app package id (it is in the F-Droid page link).', '.fdroid org.mozilla.fennec_fdroid'));
        const d = await get('https://f-droid.org/api/v1/packages/' + enc(id));
        const code = d && (d.suggestedVersionCode || ((d.packages || [])[0] || {}).versionCode);
        if (!code) throw miss('App not found on F-Droid.');
        const v = (d.packages || []).find((p) => p.versionCode === code) || {};
        const url = `https://f-droid.org/repo/${id}_${code}.apk`;
        await ctx.reply(card(id, 'f-droid', [v.versionName ? kv('version', v.versionName) : null, `↳ ${sc('sending')}`].filter(Boolean)));
        await guarded(ctx, id, url, () => sendDoc(ctx, url, `${id}_${v.versionName || code}.apk`, 'application/vnd.android.package-archive'));
    });
    def('cdnjs', '.cdnjs [library] — download a JavaScript library file (jquery, vue, chart.js …)', ['jslib', 'jsdl'], async (ctx) => {
        const lib = (ctx.args[0] || '').trim();
        if (!lib) return ctx.reply(use('cdnjs', 'Library name.', '.cdnjs jquery'));
        let d = await get(`https://api.cdnjs.com/libraries/${enc(lib)}?fields=name,version,latest,description`);
        if (!d || !d.latest) {
            const s = await get(`https://api.cdnjs.com/libraries?search=${enc(lib)}&fields=name,version,latest&limit=1`);
            d = s && s.results && s.results[0];
        }
        if (!d || !d.latest) throw miss('Library not found.');
        const name = d.latest.split('/').pop();
        await ctx.reply(card(d.name, 'v' + d.version, [d.description ? trunc(d.description, 120) : null, kv('file', name)].filter(Boolean)));
        await sendDoc(ctx, d.latest, name, /\.css$/i.test(name) ? 'text/css' : 'text/javascript');
    });
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
    wpDl('wpplugin', 'plugin', '.wpplugin [name] — download a WordPress plugin (ZIP)', ['wordpressplugin']);
    wpDl('wptheme', 'theme', '.wptheme [name] — download a WordPress theme (ZIP)', ['wordpresstheme']);
    def('dropbox', '.dropbox [link] — download a file from a public Dropbox link', ['dbx', 'dropboxdl'], async (ctx) => {
        const link = (ctx.q.match(/https?:\/\/(?:www\.)?dropbox\.com\/\S+/i) || [])[0];
        if (!link) return ctx.reply(use('Dropbox', 'Send a public Dropbox file link.', '.dropbox https://www.dropbox.com/s/abc/file.pdf?dl=0'));
        const u = new URL(link);
        u.searchParams.delete('dl'); u.searchParams.delete('raw'); u.searchParams.set('dl', '1');
        const name = safeName(decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || 'file'));
        await guarded(ctx, name, u.toString(), () => sendMedia(ctx.session, ctx.from, 'document', u.toString(), { fileName: name, mimetype: mimeOf(name) }, { quoted: ctx.msg }));
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
    pic('movieposter', 'Movie poster', '.movieposter [movie] — high-quality movie poster', ['poster', 'filmposter'], async (ctx) => {
        const q = ctx.q.trim();
        if (!q) return null;
        const r = await itunes(q, 'movie', 'movie');
        const u = r.artworkUrl100;
        return { url: big(u, /\d+x\d+bb/, '1200x1200bb'), alts: [big(u, /\d+x\d+bb/, '600x600bb'), u], rows: [kv('movie', trunc(r.trackName, 70)), r.artistName ? kv('director', trunc(r.artistName, 40)) : null, r.releaseDate ? kv('year', String(r.releaseDate).slice(0, 4)) : null, r.primaryGenreName ? kv('genre', r.primaryGenreName) : null].filter(Boolean), tag: 'itunes' };
    });
    pic('tvposter', 'TV poster', '.tvposter [series] — poster of a TV series', ['seriesposter', 'showposter'], async (ctx) => {
        const q = ctx.q.trim();
        if (!q) return null;
        const d = await get('https://api.tvmaze.com/search/shows?q=' + enc(q));
        const s = (d || []).map((x) => x.show).find((x) => x && x.image && (x.image.original || x.image.medium));
        if (!s) throw miss('No poster found for that series.');
        return { url: s.image.original || s.image.medium, alts: s.image.medium ? [s.image.medium] : [], rows: [kv('series', trunc(s.name, 60)), s.premiered ? kv('premiered', String(s.premiered).slice(0, 4)) : null, s.rating && s.rating.average ? kv('rating', s.rating.average + ' / 10') : null, (s.genres || []).length ? kv('genre', s.genres.slice(0, 3).join(', ')) : null].filter(Boolean), tag: 'tvmaze' };
    });
    pic('albumart', 'Album cover', '.albumart [album or song] — high-quality album cover', ['albumcover', 'musiccover'], async (ctx) => {
        const q = ctx.q.trim();
        if (!q) return null;
        const r = await itunes(q, 'album', 'music');
        const u = r.artworkUrl100;
        return { url: big(u, /\d+x\d+bb/, '1400x1400bb'), alts: [big(u, /\d+x\d+bb/, '600x600bb'), u], rows: [kv('album', trunc(r.collectionName, 60)), kv('artist', trunc(r.artistName, 40)), r.releaseDate ? kv('year', String(r.releaseDate).slice(0, 4)) : null].filter(Boolean), tag: 'itunes' };
    });
    pic('appicon', 'App icon', '.appicon [app name] — the big icon of a mobile app', ['appicons', 'iconpic'], async (ctx) => {
        const q = ctx.q.trim();
        if (!q) return null;
        const r = await itunes(q, 'software');
        const u = r.artworkUrl512 || r.artworkUrl100;
        return { url: big(u, /\d+x\d+bb/, '1024x1024bb'), alts: [u], rows: [kv('app', trunc(r.trackName, 50)), kv('by', trunc(r.artistName, 40)), r.averageUserRating ? kv('rating', Number(r.averageUserRating).toFixed(1) + ' / 5') : null].filter(Boolean), tag: 'app store' };
    });
    pic('podcastart', 'Podcast cover', '.podcastart [podcast name] — cover picture of a podcast', ['podcastcover'], async (ctx) => {
        const q = ctx.q.trim();
        if (!q) return null;
        const r = await itunes(q, 'podcast', 'podcast');
        const u = r.artworkUrl600 || r.artworkUrl100;
        return { url: big(u, /\d+x\d+bb/, '1400x1400bb'), alts: [u], rows: [kv('podcast', trunc(r.collectionName, 60)), kv('by', trunc(r.artistName, 40))], tag: 'itunes' };
    });
    pic('artistpic', 'Artist photo', '.artistpic [artist] — a high-quality photo of a music artist', ['singerpic', 'artistphoto'], async (ctx) => {
        const q = ctx.q.trim();
        if (!q) return null;
        const d = await get('https://api.deezer.com/search/artist?limit=1&q=' + enc(q));
        const a = d && d.data && d.data[0];
        if (!a) throw miss('Artist not found.');
        return { url: a.picture_xl || a.picture_big, alts: [a.picture_big, a.picture_medium].filter(Boolean), rows: [kv('artist', a.name), a.nb_fan != null ? kv('fans', Number(a.nb_fan).toLocaleString('en-US')) : null].filter(Boolean), tag: 'deezer' };
    });
    pic('gamecover', 'Game cover', '.gamecover [game name] — cover art of a PC game (Steam)', ['steamcover', 'gameposter'], async (ctx) => {
        const q = ctx.q.trim();
        if (!q) return null;
        const d = await get(`https://store.steampowered.com/api/storesearch/?term=${enc(q)}&l=english&cc=us`);
        const g = d && d.items && d.items[0];
        if (!g) throw miss('Game not found on Steam.');
        const base = `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.id}`;
        return { url: `${base}/library_600x900_2x.jpg`, alts: [`${base}/library_600x900.jpg`, `${base}/header.jpg`], rows: [kv('game', trunc(g.name, 60)), g.price ? kv('price', (g.price.final / 100).toFixed(2) + ' ' + g.price.currency) : null].filter(Boolean), tag: 'steam' };
    });

    // ----------------------------------------------------------------------
    console.log(`✅ Download commands pack loaded: ${added.length} new download commands`);
    return added;
};
