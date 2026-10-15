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
        ytCmd('dumpert', 'Dumpert', /dumpert\.nl\//i, 'video', ['dumpertdl'], '.dumpert https://www.dumpert.nl/item/1234567_abcdef');
        ytCmd('niconico', 'Niconico', /(nicovideo\.jp|nico\.ms)\//i, 'video', ['nicodl', 'nicovideo'], '.niconico https://www.nicovideo.jp/watch/sm9');
        ytCmd('rutube', 'Rutube', /rutube\.ru\//i, 'video', ['rutubedl'], '.rutube https://rutube.ru/video/xxxx/');
        ytCmd('weibo', 'Weibo', /(weibo\.com|weibo\.cn|video\.weibo)/i, 'video', ['weibodl'], '.weibo https://weibo.com/tv/show/xxxx');
        ytCmd('bbcvid', 'BBC', /(bbc\.co\.uk|bbc\.com)\//i, 'video', ['bbcdl', 'bbcnews'], '.bbcvid https://www.bbc.com/news/videos/xxxx');
        ytCmd('cnnvid', 'CNN', /cnn\.com\//i, 'video', ['cnndl'], '.cnnvid https://edition.cnn.com/videos/xxxx');
        ytCmd('espnvid', 'ESPN', /espn\.com\//i, 'video', ['espndl'], '.espnvid https://www.espn.com/video/clip/_/id/12345');
        ytCmd('flickrvid', 'Flickr', /flickr\.com\//i, 'video', ['flickrdl'], '.flickrvid https://www.flickr.com/photos/user/12345/');
        ytCmd('spreaker', 'Spreaker', /spreaker\.com\//i, 'audio', ['spreakerdl'], '.spreaker https://www.spreaker.com/episode/xxxx');
        ytCmd('podbean', 'Podbean', /podbean\.com\//i, 'audio', ['podbeandl'], '.podbean https://xxxx.podbean.com/e/episode-name/');
        ytCmd('applepodcast', 'Apple Podcasts', /podcasts\.apple\.com\//i, 'audio', ['applepod', 'podcastdl'], '.applepodcast https://podcasts.apple.com/us/podcast/xxxx/id123?i=456');
        ytCmd('hearthis', 'HearThis', /hearthis\.at\//i, 'audio', ['hearthisdl'], '.hearthis https://hearthis.at/artist/track/');
        ytCmd('reverbnation', 'ReverbNation', /reverbnation\.com\//i, 'audio', ['reverbdl'], '.reverbnation https://www.reverbnation.com/artist/song/123');
        ytCmd('twitcasting', 'TwitCasting', /twitcasting\.tv\//i, 'video', ['twicas', 'twitcastdl'], '.twitcasting https://twitcasting.tv/user/movie/123');
    }

    // ======================================================================
    //  2. DOCUMENTS & BOOKS  (PDF / EPUB / TXT)
    // ======================================================================
    def('wikipdf', '.wikipdf [topic] — a Wikipedia article as a PDF file', ['wikitopdf', 'articlepdf'], async (ctx) => {
        const q = ctx.q.trim();
        if (!q) return ctx.reply(use('Wikipedia PDF', 'Send a topic.', '.wikipdf Sri Lanka'));
        const s = await get(`https://en.wikipedia.org/w/api.php?action=opensearch&search=${enc(q)}&limit=1&format=json`);
        const title = s && s[1] && s[1][0];
        if (!title) throw miss('No Wikipedia article found for that.');
        const url = `https://en.wikipedia.org/api/rest_v1/page/pdf/${enc(title.replace(/ /g, '_'))}`;
        await guarded(ctx, 'Wikipedia PDF', url, () => sendDoc(ctx, url, safeName(title) + '.pdf', 'application/pdf'));
    }, 'https://en.wikipedia.org/w/api.php?action=opensearch&search=test&limit=1&format=json');

    def('bookepub', '.bookepub [title or author] — a free public-domain eBook (EPUB) from Project Gutenberg', ['gutenepub', 'freeepub'], async (ctx) => {
        const q = ctx.q.trim();
        if (!q) return ctx.reply(use('Free eBook', 'Send a book title or author.', '.bookepub pride and prejudice'));
        const d = await get(`https://gutendex.com/books/?search=${enc(q)}`);
        const b = (d && d.results || []).find((x) => x.formats && (x.formats['application/epub+zip'] || x.formats['application/epub']));
        if (!b) throw miss('No free eBook found for that.');
        const url = b.formats['application/epub+zip'] || b.formats['application/epub'];
        const by = (b.authors && b.authors[0] && b.authors[0].name) || 'unknown';
        await ctx.reply(card('Free eBook', 'gutenberg', [kv('title', trunc(b.title, 60)), kv('author', trunc(by, 40)), kv('downloads', Number(b.download_count || 0).toLocaleString('en-US'))]));
        await guarded(ctx, 'Free eBook', url, () => sendDoc(ctx, url, safeName(b.title) + '.epub', 'application/epub+zip'));
    }, 'https://gutendex.com/books/?search=dickens');

    def('arxivpdf', '.arxivpdf [topic or arXiv id] — a research paper PDF from arXiv', ['arxiv', 'paperpdf'], async (ctx) => {
        const q = ctx.q.trim();
        if (!q) return ctx.reply(use('arXiv paper', 'Send a topic or an arXiv id.', '.arxivpdf attention is all you need'));
        const idm = q.match(/(\d{4}\.\d{4,5}(v\d+)?)/);
        const qs = idm ? `id_list=${enc(idm[1])}` : `search_query=all:${enc(q)}&max_results=1`;
        const xml = await getText(`https://export.arxiv.org/api/query?${qs}`);
        const ent = (xml.match(/<entry>([\s\S]*?)<\/entry>/) || [])[1];
        if (!ent) throw miss('No paper found for that.');
        const id = (ent.match(/<id>https?:\/\/arxiv\.org\/abs\/([^<]+)<\/id>/) || [])[1];
        const title = ((ent.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || 'paper').replace(/\s+/g, ' ').trim();
        const au = ((ent.match(/<name>([^<]+)<\/name>/) || [])[1] || '').trim();
        if (!id) throw miss();
        const url = `https://arxiv.org/pdf/${id}.pdf`;
        await ctx.reply(card('arXiv paper', id, [kv('title', trunc(title, 80)), au ? kv('first author', trunc(au, 40)) : null].filter(Boolean)));
        await guarded(ctx, 'arXiv paper', url, () => sendDoc(ctx, url, safeName(title) + '.pdf', 'application/pdf'));
    }, 'https://export.arxiv.org/api/query?search_query=all:test&max_results=1');

    def('doipdf', '.doipdf [DOI] — the free (open-access) PDF of a research paper', ['doi', 'unpaywall'], async (ctx) => {
        const doi = ctx.q.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
        if (!/^10\.\d{4,9}\/\S+$/.test(doi)) return ctx.reply(use('Paper by DOI', 'Send a DOI (it starts with 10.).', '.doipdf 10.1038/nature12373'));
        const d = await get(`https://api.unpaywall.org/v2/${doi}?email=nimahmd.bot@gmail.com`);
        if (!d || d.error) throw miss('That DOI was not found.');
        const loc = d.best_oa_location;
        const rows = [kv('title', trunc(d.title, 80)), d.journal_name ? kv('journal', trunc(d.journal_name, 40)) : null, d.year ? kv('year', d.year) : null].filter(Boolean);
        if (!loc || !(loc.url_for_pdf || loc.url)) return ctx.reply(card('Paper by DOI', 'not open access', rows.concat([kv('note', 'No free copy exists')])));
        if (!loc.url_for_pdf) return ctx.reply(card('Paper by DOI', 'free page', rows.concat([kv('read here', loc.url)])));
        await ctx.reply(card('Paper by DOI', 'open access', rows));
        await guarded(ctx, 'Paper by DOI', loc.url_for_pdf, () => sendDoc(ctx, loc.url_for_pdf, safeName(d.title, 'paper') + '.pdf', 'application/pdf'));
    }, 'https://api.unpaywall.org/v2/10.1038/nature12373?email=nimahmd.bot@gmail.com');

    def('rfcdl', '.rfcdl [number] — an internet RFC document as a text file', ['rfc'], async (ctx) => {
        const n = parseInt(ctx.args[0], 10);
        if (!n || n < 1 || n > 99999) return ctx.reply(use('RFC document', 'Send an RFC number.', '.rfcdl 2616'));
        const url = `https://www.rfc-editor.org/rfc/rfc${n}.txt`;
        await guarded(ctx, 'RFC document', url, () => sendDoc(ctx, url, `rfc${n}.txt`, 'text/plain'));
    }, 'https://www.rfc-editor.org/rfc/rfc2616.txt');

    def('pastedl', '.pastedl [pastebin / dpaste / paste.rs link] — save a paste as a text file', ['pasteraw', 'pastefile'], async (ctx) => {
        const u = (D.pickUrl && D.pickUrl(ctx.q, ctx.msg)) || ctx.q.trim();
        let raw = null, id;
        if ((id = (u.match(/pastebin\.com\/(?:raw\/)?([A-Za-z0-9]{6,10})/i) || [])[1])) raw = `https://pastebin.com/raw/${id}`;
        else if ((id = (u.match(/dpaste\.(?:org|com)\/([A-Za-z0-9]{3,12})/i) || [])[1])) raw = `https://dpaste.org/${id}/raw`;
        else if ((id = (u.match(/paste\.rs\/([A-Za-z0-9]{2,12})/i) || [])[1])) raw = `https://paste.rs/${id}`;
        if (!raw) return ctx.reply(use('Paste file', 'Send a pastebin.com, dpaste.org or paste.rs link.', '.pastedl https://pastebin.com/AbCdEf12'));
        await sendDoc(ctx, raw, `paste-${id}.txt`, 'text/plain');
    });

    def('pixeldrain', '.pixeldrain [pixeldrain link] — download a file shared on Pixeldrain', ['pdrain', 'pixeldl'], async (ctx) => {
        const u = (D.pickUrl && D.pickUrl(ctx.q, ctx.msg)) || ctx.q.trim();
        const id = (u.match(/pixeldrain\.(?:com|net)\/(?:u|l|api\/file)\/([A-Za-z0-9_-]{4,16})/i) || [])[1];
        if (!id) return ctx.reply(use('Pixeldrain', 'Send a Pixeldrain file link.', '.pixeldrain https://pixeldrain.com/u/AbCd1234'));
        const direct = `https://pixeldrain.com/api/file/${id}`;
        let info = null;
        try { info = await get(`https://pixeldrain.com/api/file/${id}/info`); } catch (e) { /* send without details */ }
        if (info && info.success === false) throw miss('That file was not found (it may have expired).');
        if (info && info.size) {
            const cap = Number(process.env.DL_MAX_MB || 40);
            if (info.size > cap * 1048576) return ctx.reply(card('Pixeldrain', 'too large for WhatsApp', [kv('file', trunc(info.name, 50)), kv('size', mb(info.size)), kv('direct link', direct)]));
        }
        const name = safeName(info && info.name, `pixeldrain-${id}`);
        await guarded(ctx, 'Pixeldrain', direct, () => sendDoc(ctx, direct, name, (info && info.mime_type) || mimeOf(name)));
    });

    // ======================================================================
    //  3. PICTURES, ICONS & AVATARS  (generated or found on free services)
    // ======================================================================
    def('iconsvg', '.iconsvg [name] — an icon as PNG + SVG (e.g. home, heart, mdi:rocket)', ['icon', 'iconify'], async (ctx) => {
        const q = ctx.q.trim();
        if (!q) return ctx.reply(use('Icon', 'Send an icon name — or a set:name pair.', '.iconsvg rocket'));
        let id = /^[a-z0-9-]+:[a-z0-9-]+$/i.test(q) ? q.toLowerCase() : null;
        if (!id) {
            const s = await get(`https://api.iconify.design/search?query=${enc(q)}&limit=1`);
            id = s && s.icons && s.icons[0];
            if (!id) throw miss('No icon found for that.');
        }
        const [setName, icon] = id.split(':');
        const svgUrl = `https://api.iconify.design/${setName}/${icon}.svg?height=512&color=%23111111`;
        const svg = Buffer.from((await axios.get(svgUrl, { responseType: 'arraybuffer', timeout: 20000, headers: { 'User-Agent': API_UA } })).data);
        if (!/<svg/i.test(svg.toString('utf8', 0, 400))) throw miss('That icon was not found.');
        const cap = card('Icon', 'iconify', [kv('icon', id)]) + credit();
        let sentPng = false;
        try {
            const { createCanvas, loadImage } = require('@napi-rs/canvas');
            const im = await loadImage(svg);
            const cv = createCanvas(768, 768), g = cv.getContext('2d');
            g.fillStyle = '#ffffff'; g.fillRect(0, 0, 768, 768);
            const k = Math.min(640 / im.width, 640 / im.height);
            g.drawImage(im, (768 - im.width * k) / 2, (768 - im.height * k) / 2, im.width * k, im.height * k);
            await sendImg(ctx, cv.toBuffer('image/png'), cap); sentPng = true;
        } catch (e) { /* the SVG file below is still sent */ }
        await sendDoc(ctx, svg, `${setName}-${icon}.svg`, 'image/svg+xml');
        if (!sentPng) await ctx.reply(cap);
    }, 'https://api.iconify.design/search?query=home&limit=1');

    pic('placeholder', 'Placeholder image', '.placeholder [WxH] [text] — a blank placeholder picture (e.g. .placeholder 800x600 Hello)', ['placehold', 'dummyimg'], 'https://placehold.co/200x100/png', async (ctx) => {
        const a = ctx.args.slice();
        let w = 800, h = 600;
        const si = a.findIndex((x) => /^\d{2,4}x\d{2,4}$/i.test(x));
        if (si > -1) { const [ww, hh] = a.splice(si, 1)[0].toLowerCase().split('x').map(Number); w = Math.min(2000, Math.max(16, ww)); h = Math.min(2000, Math.max(16, hh)); }
        const text = a.join(' ').trim() || `${w}x${h}`;
        return { url: `https://placehold.co/${w}x${h}/1f2937/ffffff/png?text=${enc(text.slice(0, 60))}`, rows: [kv('size', `${w}x${h}`), kv('text', trunc(text, 40))], tag: 'placehold.co' };
    });
    pic('colorimg', 'Colour swatch', '.colorimg [hex] — a solid colour picture (e.g. .colorimg ff5733)', ['colorpic', 'swatchimg'], 'https://singlecolorimage.com/get/b3121c/200x200', async (ctx) => {
        const h = ctx.q.trim().replace(/^#/, '').toLowerCase();
        if (!/^([0-9a-f]{3}|[0-9a-f]{6})$/.test(h)) return null;
        const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
        return { url: `https://singlecolorimage.com/get/${full}/800x800`, rows: [kv('colour', '#' + full.toUpperCase())], tag: 'swatch' };
    });
    pic('gravatar', 'Gravatar', '.gravatar [email] — the Gravatar profile picture of an email address', ['gravatarpic'], null, async (ctx) => {
        const e = ctx.q.trim().toLowerCase();
        if (!/^\S+@\S+\.\S+$/.test(e)) return null;
        const h = nodeCrypto.createHash('md5').update(e).digest('hex');
        return { url: `https://www.gravatar.com/avatar/${h}?s=800&d=identicon`, rows: [kv('email', trunc(e, 40))], tag: 'gravatar' };
    });
    pic('favicon', 'Site icon', '.favicon [website] — the icon (favicon) of a website', ['siteicon', 'faviconpic'], 'https://www.google.com/s2/favicons?domain=wikipedia.org&sz=64', async (ctx) => {
        const u = ctx.q.trim().replace(/^https?:\/\//i, '').split(/[/?#\s]/)[0].toLowerCase();
        if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(u)) return null;
        return { url: `https://www.google.com/s2/favicons?domain=${enc(u)}&sz=256`, rows: [kv('site', u)], tag: 'favicon' };
    });
    pic('flagdl', 'Flag', '.flagdl [country] — a large picture of a country flag', ['flagimg', 'flaghd'], 'https://restcountries.com/v3.1/name/sri%20lanka?fields=cca2', async (ctx) => {
        const q = ctx.q.trim();
        if (!q) return null;
        const d = await get(`https://restcountries.com/v3.1/name/${enc(q)}?fields=name,cca2,flags,capital`);
        const c = Array.isArray(d) && d[0];
        if (!c) throw miss('That country was not found.');
        return { url: `https://flagcdn.com/w2560/${String(c.cca2).toLowerCase()}.png`, alts: [c.flags && c.flags.png].filter(Boolean), rows: [kv('country', c.name && c.name.common), c.capital && c.capital[0] ? kv('capital', c.capital[0]) : null].filter(Boolean), tag: 'flagcdn' };
    });
    pic('wttrpic', 'Weather picture', '.wttrpic [city] — a weather forecast picture of a city', ['weatherpic', 'forecastpic'], 'https://wttr.in/Colombo_0pq.png?m', async (ctx) => {
        const c = ctx.q.trim();
        if (!c) return null;
        return { url: `https://wttr.in/${enc(c)}_0pq.png?m`, rows: [kv('city', trunc(c, 40))], tag: 'wttr.in' };
    });
    pic('mchead', 'Minecraft skin', '.mchead [player] [head|body|skin] — a Minecraft player picture', ['mcbody', 'mcavatar'], 'https://mc-heads.net/avatar/Notch/64', async (ctx) => {
        const n = (ctx.args[0] || '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 16);
        if (!n) return null;
        const kind = (ctx.args[1] || 'body').toLowerCase();
        const url = kind === 'head' ? `https://mc-heads.net/avatar/${n}/512` : kind === 'skin' ? `https://mc-heads.net/skin/${n}` : `https://mc-heads.net/body/${n}/600`;
        return { url, rows: [kv('player', n), kv('view', ['head', 'skin'].includes(kind) ? kind : 'body')], tag: 'mc-heads' };
    });
    pic('cattag', 'Cat', '.cattag [tag] — a cat picture with a tag (cute, orange, black, sleep …)', ['cattagpic'], 'https://cataas.com/cat/cute?width=200', async (ctx) => {
        const t = ctx.args[0] ? ctx.args[0].replace(/[^A-Za-z0-9]/g, '').slice(0, 20) : 'cute';
        return { url: `https://cataas.com/cat/${enc(t)}?width=900&t=${Date.now()}`, rows: [kv('tag', t)], tag: 'cataas' };
    });

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
    pic('animeposter', 'Anime poster', '.animeposter [anime name] — the poster of an anime (MyAnimeList)', ['animecover', 'animepic2'], 'https://api.jikan.moe/v4/anime?q=naruto&limit=1&sfw=true', async (ctx) => {
        const q = ctx.q.trim();
        if (!q) return null;
        const r = await jikan('anime', q);
        const im = r.images && r.images.jpg;
        return { url: im.large_image_url || im.image_url, alts: [im.image_url], rows: [kv('title', trunc(r.title, 50)), r.score ? kv('score', r.score + ' / 10') : null, r.episodes ? kv('episodes', r.episodes) : null, r.year ? kv('year', r.year) : null].filter(Boolean), tag: 'myanimelist' };
    });
    pic('mangacover', 'Manga cover', '.mangacover [manga name] — the cover of a manga (MyAnimeList)', ['mangaposter'], 'https://api.jikan.moe/v4/manga?q=naruto&limit=1&sfw=true', async (ctx) => {
        const q = ctx.q.trim();
        if (!q) return null;
        const r = await jikan('manga', q);
        const im = r.images && r.images.jpg;
        return { url: im.large_image_url || im.image_url, alts: [im.image_url], rows: [kv('title', trunc(r.title, 50)), r.score ? kv('score', r.score + ' / 10') : null, r.chapters ? kv('chapters', r.chapters) : null].filter(Boolean), tag: 'myanimelist' };
    });
    pic('animechar', 'Anime character', '.animechar [character name] — a picture of an anime character', ['charpic', 'animecharpic'], 'https://api.jikan.moe/v4/characters?q=luffy&limit=1', async (ctx) => {
        const q = ctx.q.trim();
        if (!q) return null;
        const r = await jikan('characters', q);
        const im = r.images && r.images.jpg;
        return { url: im.image_url, rows: [kv('name', trunc(r.name, 40)), r.favorites != null ? kv('favourites', Number(r.favorites).toLocaleString('en-US')) : null].filter(Boolean), tag: 'myanimelist' };
    });
    const WAIFU_TAGS = ['maid', 'waifu', 'marin-kitagawa', 'mori-calliope', 'raiden-shogun', 'selfies', 'uniform', 'kamisato-ayaka'];
    pic('waifuim', 'Anime picture', `.waifuim [${WAIFU_TAGS.join('|')}] — a safe anime picture by tag`, ['waifutag', 'animetag'], 'https://api.waifu.im/search?included_tags=maid&is_nsfw=false&limit=1', async (ctx) => {
        const t = (ctx.args[0] || '').toLowerCase();
        const tag = WAIFU_TAGS.includes(t) ? t : rnd(WAIFU_TAGS);
        const d = await get(`https://api.waifu.im/search?included_tags=${enc(tag)}&is_nsfw=false&limit=1`);
        const im = d && d.images && d.images[0];
        if (!im || im.is_nsfw) throw miss();
        return { url: im.url, rows: [kv('tag', tag), im.artist && im.artist.name ? kv('artist', trunc(im.artist.name, 30)) : null].filter(Boolean), tag: 'waifu.im' };
    });
    pic('nekopic', 'Anime picture', '.nekopic [neko|waifu|husbando|kitsune] — an anime picture with the artist credit', ['nekoimg', 'nekosbest'], 'https://nekos.best/api/v2/neko', async (ctx) => {
        const c = (ctx.args[0] || '').toLowerCase();
        const kind = ['neko', 'waifu', 'husbando', 'kitsune'].includes(c) ? c : rnd(['neko', 'waifu', 'kitsune']);
        const d = await get('https://nekos.best/api/v2/' + kind);
        const r = d && d.results && d.results[0];
        if (!r) throw miss();
        return { url: r.url, rows: [kv('type', kind), r.artist_name ? kv('artist', trunc(r.artist_name, 30)) : null].filter(Boolean), tag: 'nekos.best' };
    });
    pic('rickmorty', 'Rick and Morty', '.rickmorty [character] — a Rick and Morty character (or a random one)', ['rmchar', 'rickandmorty'], 'https://rickandmortyapi.com/api/character/1', async (ctx) => {
        const q = ctx.q.trim();
        let c;
        if (q) { const d = await get(`https://rickandmortyapi.com/api/character/?name=${enc(q)}`); c = d && d.results && d.results[0]; }
        else c = await get(`https://rickandmortyapi.com/api/character/${1 + Math.floor(Math.random() * 826)}`);
        if (!c || !c.image) throw miss('That character was not found.');
        return { url: c.image, rows: [kv('name', c.name), kv('status', c.status), kv('species', c.species), c.origin && c.origin.name ? kv('origin', trunc(c.origin.name, 30)) : null].filter(Boolean), tag: 'rickandmorty' };
    });
    pic('ghibliposter', 'Studio Ghibli', '.ghibliposter [film] — a Studio Ghibli film poster (or a random one)', ['ghibli', 'ghiblifilm'], 'https://ghibliapi.vercel.app/films?limit=1', async (ctx) => {
        const list = await get('https://ghibliapi.vercel.app/films');
        const q = ctx.q.trim().toLowerCase();
        const f = q ? list.find((x) => String(x.title).toLowerCase().includes(q)) : rnd(list);
        if (!f) throw miss('No Ghibli film matches that title.');
        return { url: f.image || f.movie_banner, alts: [f.movie_banner].filter(Boolean), rows: [kv('film', trunc(f.title, 40)), kv('director', trunc(f.director, 30)), kv('year', f.release_date), f.rt_score ? kv('rotten tomatoes', f.rt_score + '%') : null].filter(Boolean), tag: 'ghibli' };
    });
    pic('hpchar', 'Harry Potter', '.hpchar [character] — a Harry Potter character picture', ['harrypotter', 'hpwiki'], 'https://potterapi-fedeperin.vercel.app/en/characters/random', async (ctx) => {
        const q = ctx.q.trim().toLowerCase();
        let c = null;
        try {
            const list = (await get('https://hp-api.onrender.com/api/characters', { timeout: 30000 })).filter((x) => x.image);
            const f = q ? list.find((x) => String(x.name).toLowerCase().includes(q)) : rnd(list);
            if (f) c = { name: f.name, house: f.house, actor: f.actor, image: f.image };
        } catch (e) { /* second source below */ }
        if (!c) {
            const l2 = await get('https://potterapi-fedeperin.vercel.app/en/characters');
            const f = q ? l2.find((x) => String(x.fullName).toLowerCase().includes(q)) : rnd(l2);
            if (f) c = { name: f.fullName, house: f.hogwartsHouse, actor: f.interpretedBy, image: f.image };
        }
        if (!c || !c.image) throw miss('That character was not found.');
        return { url: c.image, rows: [kv('name', trunc(c.name, 40)), c.house ? kv('house', c.house) : null, c.actor ? kv('actor', trunc(c.actor, 30)) : null].filter(Boolean), tag: 'potter' };
    });
    pic('digimon', 'Digimon', '.digimon [name] — a Digimon picture (or a random one)', ['digi', 'digimonpic'], 'https://digi-api.com/api/v1/digimon/1', async (ctx) => {
        const q = ctx.q.trim().toLowerCase().replace(/\s+/g, '-');
        const d = await get(`https://digi-api.com/api/v1/digimon/${enc(q || String(1 + Math.floor(Math.random() * 1000)))}`);
        const im = d && d.images && d.images[0] && d.images[0].href;
        if (!im) throw miss('That Digimon was not found.');
        const lv = d.levels && d.levels[0] && d.levels[0].level;
        return { url: im, rows: [kv('name', d.name), lv ? kv('level', lv) : null, d.types && d.types[0] ? kv('type', d.types[0].type) : null].filter(Boolean), tag: 'digi-api' };
    });
    pic('swchar', 'Star Wars', '.swchar [character] — a Star Wars character picture (or a random one)', ['starwars', 'swpic'], 'https://akabab.github.io/starwars-api/api/id/1.json', async (ctx) => {
        const list = await get('https://akabab.github.io/starwars-api/api/all.json');
        const q = ctx.q.trim().toLowerCase();
        const c = q ? list.find((x) => String(x.name).toLowerCase().includes(q)) : rnd(list);
        if (!c || !c.image) throw miss('That character was not found.');
        return { url: c.image, rows: [kv('name', c.name), c.species ? kv('species', c.species) : null, c.homeworld ? kv('homeworld', trunc(c.homeworld, 30)) : null].filter(Boolean), tag: 'star wars' };
    });
    pic('dndmonster', 'D&D monster', '.dndmonster [monster] — a Dungeons & Dragons monster picture', ['dnd', 'monsterimg'], 'https://www.dnd5eapi.co/api/monsters/goblin', async (ctx) => {
        const q = ctx.q.trim();
        if (!q) return null;
        let idx = q.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        let m;
        try { m = await get(`https://www.dnd5eapi.co/api/monsters/${idx}`); }
        catch (e) {
            const s = await get(`https://www.dnd5eapi.co/api/monsters?name=${enc(q)}`);
            if (!s || !s.results || !s.results[0]) throw miss('That monster was not found.');
            m = await get(`https://www.dnd5eapi.co/api/monsters/${s.results[0].index}`);
        }
        if (!m || !m.image) throw miss('That monster has no picture.');
        return { url: 'https://www.dnd5eapi.co' + m.image, rows: [kv('monster', m.name), kv('type', `${m.size} ${m.type}`), kv('challenge', m.challenge_rating), kv('hit points', m.hit_points)], tag: 'dnd5e' };
    });

    // ======================================================================
    //  5. MUSIC ARTISTS, FOOD & DRINKS, SPACE, HISTORY
    // ======================================================================
    const audiodb = async (q) => {
        const d = await get('https://www.theaudiodb.com/api/v1/json/2/search.php?s=' + enc(q));
        const a = d && d.artists && d.artists[0];
        if (!a) throw miss('Artist not found.');
        return a;
    };
    pic('artistbanner', 'Artist banner', '.artistbanner [artist] — the banner picture of a music artist', ['bandbanner'], 'https://www.theaudiodb.com/api/v1/json/2/search.php?s=coldplay', async (ctx) => {
        const q = ctx.q.trim();
        if (!q) return null;
        const a = await audiodb(q);
        const u = a.strArtistBanner || a.strArtistWideThumb || a.strArtistThumb;
        if (!u) throw miss('That artist has no banner picture.');
        return { url: u, alts: [a.strArtistThumb].filter(Boolean), rows: [kv('artist', a.strArtist), a.strGenre ? kv('genre', a.strGenre) : null, a.intFormedYear ? kv('since', a.intFormedYear) : null].filter(Boolean), tag: 'theaudiodb' };
    });
    pic('artistfanart', 'Artist fan art', '.artistfanart [artist] — a large fan-art wallpaper of a music artist', ['bandwall'], null, async (ctx) => {
        const q = ctx.q.trim();
        if (!q) return null;
        const a = await audiodb(q);
        const l = [a.strArtistFanart, a.strArtistFanart2, a.strArtistFanart3, a.strArtistFanart4].filter(Boolean);
        if (!l.length) throw miss('That artist has no fan art.');
        const u = rnd(l);
        return { url: u, alts: l.filter((x) => x !== u), rows: [kv('artist', a.strArtist)], tag: 'theaudiodb' };
    });
    pic('mealpic', 'Meal', '.mealpic [dish] — a photo and details of a dish (or a random one)', ['dishpic', 'foodimg'], 'https://www.themealdb.com/api/json/v1/1/random.php', async (ctx) => {
        const q = ctx.q.trim();
        const d = await get(q ? `https://www.themealdb.com/api/json/v1/1/search.php?s=${enc(q)}` : 'https://www.themealdb.com/api/json/v1/1/random.php');
        const m = d && d.meals && d.meals[0];
        if (!m) throw miss('That dish was not found.');
        return { url: m.strMealThumb, rows: [kv('dish', trunc(m.strMeal, 50)), kv('type', m.strCategory), kv('cuisine', m.strArea), m.strYoutube ? kv('video', m.strYoutube) : null].filter(Boolean), tag: 'themealdb' };
    });
    pic('cocktailpic', 'Drink', '.cocktailpic [drink] — a photo and details of a drink (or a random one)', ['drinkpic', 'drinkimg'], 'https://www.thecocktaildb.com/api/json/v1/1/random.php', async (ctx) => {
        const q = ctx.q.trim();
        const d = await get(q ? `https://www.thecocktaildb.com/api/json/v1/1/search.php?s=${enc(q)}` : 'https://www.thecocktaildb.com/api/json/v1/1/random.php');
        const m = d && d.drinks && d.drinks[0];
        if (!m) throw miss('That drink was not found.');
        return { url: m.strDrinkThumb, rows: [kv('drink', trunc(m.strDrink, 50)), kv('type', m.strCategory), kv('serve in', m.strGlass)].filter(Boolean), tag: 'thecocktaildb' };
    });
    pic('locphoto', 'Historic photo', '.locphoto [topic] — an old historic photograph (US Library of Congress)', ['historyphoto', 'oldphoto'], 'https://www.loc.gov/photos/?q=lighthouse&fo=json&c=1', async (ctx) => {
        const q = ctx.q.trim();
        if (!q) return null;
        const d = await get(`https://www.loc.gov/photos/?q=${enc(q)}&fo=json&c=30`);
        const l = ((d && d.results) || []).filter((r) => Array.isArray(r.image_url) && r.image_url.length);
        if (!l.length) throw miss('No historic photo found for that.');
        const r = rnd(l);
        const urls = r.image_url.map(abs).filter((u) => /\.(jpe?g|png|gif)(\?|$)/i.test(u));
        if (!urls.length) throw miss();
        const best = urls[urls.length - 1];
        return { url: best, alts: urls.slice(0, -1).reverse(), rows: [kv('title', trunc(r.title, 70)), r.date ? kv('date', r.date) : null].filter(Boolean), tag: 'library of congress' };
    });
    pic('iaimage', 'Archive picture', '.iaimage [topic] — a free picture from the Internet Archive', ['archiveimg', 'archivepic'], 'https://archive.org/advancedsearch.php?q=mediatype:image&fl[]=identifier&rows=1&output=json', async (ctx) => {
        const q = ctx.q.trim();
        if (!q) return null;
        const s = await get(`https://archive.org/advancedsearch.php?q=${enc(q + ' AND mediatype:image')}&fl[]=identifier&fl[]=title&rows=15&output=json`);
        const docs = (s && s.response && s.response.docs) || [];
        if (!docs.length) throw miss('No picture found for that.');
        const shuffled = docs.slice().sort(() => Math.random() - 0.5);
        return await firstOk(shuffled, async (doc) => {
            const m = await get(`https://archive.org/metadata/${enc(doc.identifier)}`);
            const f = ((m && m.files) || []).find((x) => /\.(jpe?g|png)$/i.test(x.name) && x.source === 'original' && Number(x.size) < 14 * 1048576)
                || ((m && m.files) || []).find((x) => /\.(jpe?g|png)$/i.test(x.name) && Number(x.size) < 14 * 1048576);
            if (!f) throw miss();
            return { url: `https://archive.org/download/${enc(doc.identifier)}/${f.name.split('/').map(enc).join('/')}`, rows: [kv('title', trunc(doc.title, 70)), kv('size', mb(f.size))], tag: 'internet archive' };
        }, 4);
    });
    pic('isbncover', 'Book cover', '.isbncover [ISBN] — the cover of a book by its ISBN number', ['isbnpic', 'bookisbn'], 'https://covers.openlibrary.org/b/isbn/9780140328721-S.jpg?default=false', async (ctx) => {
        const i = ctx.q.replace(/[^0-9Xx]/g, '');
        if (i.length !== 10 && i.length !== 13) return null;
        return { url: `https://covers.openlibrary.org/b/isbn/${i}-L.jpg?default=false`, rows: [kv('isbn', i)], tag: 'open library' };
    });

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

    def('ayahmp3', '.ayahmp3 [surah:ayah] [reciter] — the audio of one Quran verse (e.g. .ayahmp3 2:255)', ['ayahsound', 'versemp3'], async (ctx) => {
        const ref = (ctx.args[0] || '').match(/^(\d{1,3}):(\d{1,3})$/);
        if (!ref) return ctx.reply(use('Quran verse', 'Send surah:ayah. Add a reciter name if you like (afasy, sudais, husary, minshawi).', '.ayahmp3 2:255 sudais'));
        const R = { afasy: 'ar.alafasy', alafasy: 'ar.alafasy', sudais: 'ar.abdurrahmaansudais', husary: 'ar.husary', minshawi: 'ar.minshawi', ghamdi: 'ar.saoodshuraym', shuraim: 'ar.saoodshuraym' };
        const ed = R[(ctx.args[1] || 'afasy').toLowerCase()] || 'ar.alafasy';
        const d = await get(`https://api.alquran.cloud/v1/ayah/${ref[1]}:${ref[2]}/${ed}`);
        const a = d && d.data;
        if (!a || !a.audio) throw miss('That verse was not found.');
        await ctx.reply(card('Quran verse', `${a.surah.englishName} ${ref[1]}:${ref[2]}`, [kv('reciter', trunc((a.edition && a.edition.englishName) || ed, 40)), a.text ? trunc(a.text, 200) : null].filter(Boolean)));
        await sendAud(ctx, a.audio);
    }, 'https://api.alquran.cloud/v1/ayah/1:1/ar.alafasy');

    // ======================================================================
    //  OWNER TOOL — .dlcheck : which download APIs are alive right now?
    // ======================================================================
    reg('dlcheck', {
        category: 'Owner', ownerOnly: true, desc: '.dlcheck — test every download API of the new pack and show which ones are alive', aliases: ['dltest', 'apicheck'],
        run: async (ctx) => {
            await ctx.reply(card('API check', 'testing', [kv('services', probes.length), 'Please wait about 30 seconds…']));
            const res = [];
            for (let i = 0; i < probes.length; i += 6) {
                const part = probes.slice(i, i + 6);
                const out = await Promise.all(part.map(async ([name, url]) => {
                    const t0 = Date.now();
                    try {
                        const r = await axios.get(url, { timeout: 12000, headers: { 'User-Agent': API_UA }, responseType: 'arraybuffer', maxContentLength: 3 * 1048576, validateStatus: (s) => s < 500 });
                        return [name, r.status < 400, Date.now() - t0, r.status];
                    } catch (e) { return [name, false, Date.now() - t0, (e && e.response && e.response.status) || (e && e.code) || 'err']; }
                }));
                res.push(...out);
            }
            const ok = res.filter((r) => r[1]), bad = res.filter((r) => !r[1]);
            const rows = [kv('alive', `${ok.length} / ${res.length}`), kv('engine', D.downloadWithYtDlp ? 'yt-dlp ready' : 'yt-dlp missing')];
            if (bad.length) rows.push('', sc('not answering now'), ...bad.map((r) => `◈ .${r[0]}  (${r[3]})`));
            else rows.push('', sc('every service answered'));
            await ctx.reply(card('API check', 'done', rows, `↳ ${sc('a service that is down usually comes back by itself — try again later')}`));
        }
    });

    console.log(`✅ Download commands pack 2 loaded: ${added.length} new download commands`);
    return added;
};
