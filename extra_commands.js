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
    def('reddit', 'Media', '.reddit [post link] — download a Reddit video, picture or gallery', ['rdl', 'redditdl', 'rvid'], async (ctx) => {
        const link = D.linkFrom(ctx.msg, ctx.q, RD_RE);
        if (!link) return ctx.reply(use('Reddit', 'Send a Reddit post link.', '.reddit https://www.reddit.com/r/funny/comments/xxxx/title/'));
        const p = await redditPost(link);
        const rv = (p.secure_media && p.secure_media.reddit_video) || (p.media && p.media.reddit_video) || (p.preview && p.preview.reddit_video_preview);
        const head = [kv('post', trunc(p.title, 120)), kv('sub', 'r/' + p.subreddit), kv('upvotes', num(p.ups || 0))];
        const cap = card('Reddit', 'ready', head) + credit();
        if (rv && rv.fallback_url) return void await redditVideoWithSound(ctx, rv, cap);
        if (p.gallery_data && p.media_metadata) {
            let n = 0;
            for (const it of p.gallery_data.items.slice(0, 8)) {
                const mm = p.media_metadata[it.media_id];
                const u = mm && mm.s && (mm.s.u || mm.s.gif);
                if (u) await img(ctx, u, n++ === 0 ? cap : undefined);
            }
            return;
        }
        const u = p.url_overridden_by_dest || p.url;
        if (u && /\.(jpe?g|png|webp)(\?|$)/i.test(u)) return void await img(ctx, u, cap);
        if (u && /\.gif(\?|$)/i.test(u)) return void await anim(ctx, u, cap);
        if (p.preview && p.preview.images && p.preview.images[0]) return void await img(ctx, p.preview.images[0].source.url, cap);
        await ctx.reply(card('Reddit', 'text post', [kv('post', trunc(p.title, 160)), trunc(p.selftext || '', 600)].filter(Boolean)));
    });

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
    def('gitclone', 'Media', '.gitclone [github repo link] — download a repository as a ZIP', ['repozip', 'ghzip', 'gitzip'], async (ctx) => {
        const m = /github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/tree\/([^\s?#]+))?(?:[/?#\s]|$)/i.exec(ctx.q + ' ');
        if (!m) return ctx.reply(use('Git Clone', 'Send a GitHub repository link.', '.gitclone https://github.com/user/repo'));
        const [, user, repo, branch] = m;
        const url = branch ? `https://github.com/${user}/${repo}/archive/refs/heads/${branch}.zip` : `https://github.com/${user}/${repo}/archive/HEAD.zip`;
        await ctx.reply(card('Git Clone', 'sending', [kv('repo', user + '/' + repo), branch ? kv('branch', branch) : null].filter(Boolean), `↳ ${sc('please wait')}`));
        await docu(ctx, url, `${repo}${branch ? '-' + branch.replace(/\W+/g, '-') : ''}.zip`, 'application/zip');
    });

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
    def('ogdl', 'Media', '.ogdl [any page link] — grab the main picture / video of a web page', ['webmedia', 'pagepic', 'linkpic'], async (ctx) => {
        const link = D.linkFrom(ctx.msg, ctx.q, /https?:\/\/\S+/i);
        if (!link) return ctx.reply(use('Page Media', 'Send any web page link.', '.ogdl https://example.com/article'));
        await sendOg(ctx, 'Page Media', link);
    });

    // ---- YouTube thumbnail ----
    def('ytthumb', 'Media', '.ytthumb [youtube link] — full-size thumbnail of a video', ['ythumb', 'thumbnail', 'ytcover'], async (ctx) => {
        const m = /(?:v=|youtu\.be\/|shorts\/|live\/|embed\/)([\w-]{11})/.exec(ctx.q + ' ' + (D.quotedText ? D.quotedText(ctx.msg) : ''));
        if (!m) return ctx.reply(use('YT Thumbnail', 'Send a YouTube link.', '.ytthumb https://youtu.be/dQw4w9WgXcQ'));
        let title = '';
        try { const o = await get('https://www.youtube.com/oembed?format=json&url=' + enc('https://www.youtube.com/watch?v=' + m[1])); title = o.title; } catch (e) { /* title is optional */ }
        let sent = false;
        for (const q of ['maxresdefault', 'sddefault', 'hqdefault']) {
            try { await img(ctx, `https://i.ytimg.com/vi/${m[1]}/${q}.jpg`, card('YT Thumbnail', q === 'maxresdefault' ? 'hd' : 'ready', title ? [kv('video', trunc(title, 80))] : []) + credit()); sent = true; break; } catch (e) { /* try smaller */ }
        }
        if (!sent) await ctx.reply(nothing('YT Thumbnail', 'No thumbnail found for that video.'));
    });

    // ---- TikTok extras (TikWM public API) ----
    const tikwm = async (path, form) => (await postForm('https://www.tikwm.com' + path, form)).data;
    const tikUrl = (u) => (u && u.startsWith('/') ? 'https://www.tikwm.com' + u : u);
    def('ttsearch', 'Media', '.ttsearch [words] — search TikTok and send the top video', ['tiktoksearch', 'ttfind'], async (ctx) => {
        if (!ctx.q.trim()) return ctx.reply(use('TikTok Search', 'Type what to search for.', '.ttsearch sri lanka funny'));
        const d = await tikwm('/api/feed/search', { keywords: ctx.q.trim(), count: '5', cursor: '0', hd: '1' });
        const v = d && d.videos && d.videos[0];
        if (!v) return ctx.reply(nothing('TikTok Search'));
        await vid(ctx, tikUrl(v.hdplay || v.play), card('TikTok Search', 'top result', [kv('title', trunc(v.title, 100)), kv('by', (v.author && v.author.nickname) || '—'), kv('likes', num(v.digg_count || 0))]) + credit());
    });
    def('ttuser', 'Media', '.ttuser [username] — latest video of a TikTok account', ['tiktokuser', 'ttlatest'], async (ctx) => {
        const u = ctx.q.trim().replace(/^@/, '');
        if (!u) return ctx.reply(use('TikTok User', 'Type a TikTok username.', '.ttuser khaby.lame'));
        const d = await tikwm('/api/user/posts', { unique_id: u, count: '5', cursor: '0' });
        const v = d && d.videos && d.videos[0];
        if (!v) return ctx.reply(nothing('TikTok User', 'That account has no public videos.'));
        await vid(ctx, tikUrl(v.hdplay || v.play), card('TikTok User', '@' + u, [kv('title', trunc(v.title, 100)), kv('likes', num(v.digg_count || 0))]) + credit());
    });
    def('ttpfp', 'Media', '.ttpfp [username] — TikTok profile picture + stats', ['tiktokpfp', 'ttprofile'], async (ctx) => {
        const u = ctx.q.trim().replace(/^@/, '');
        if (!u) return ctx.reply(use('TikTok Profile', 'Type a TikTok username.', '.ttpfp khaby.lame'));
        const d = await tikwm('/api/user/info', { unique_id: u });
        if (!d || !d.user) return ctx.reply(nothing('TikTok Profile', 'That account was not found.'));
        const s = d.stats || {};
        await img(ctx, d.user.avatarLarger || d.user.avatarMedium, card('TikTok Profile', '@' + d.user.uniqueId, [kv('name', d.user.nickname), kv('followers', num(s.followerCount || 0)), kv('following', num(s.followingCount || 0)), kv('likes', num(s.heartCount || 0)), kv('videos', num(s.videoCount || 0)), kv('bio', trunc(d.user.signature || '—', 100))]));
    });

    // ---- Music previews (Deezer + iTunes public search APIs) ----
    def('deezer', 'Media', '.deezer [song] — song info + 30-second preview', ['dz', 'preview', 'songprev'], async (ctx) => {
        if (!ctx.q.trim()) return ctx.reply(use('Deezer', 'Type a song name.', '.deezer shape of you'));
        const d = await get('https://api.deezer.com/search?limit=1&q=' + enc(ctx.q.trim()));
        const t = d && d.data && d.data[0];
        if (!t) return ctx.reply(nothing('Deezer', 'No song found.'));
        const rows = [kv('song', t.title), kv('artist', t.artist.name), kv('album', t.album.title), kv('length', Math.floor(t.duration / 60) + ':' + String(t.duration % 60).padStart(2, '0')), kv('link', t.link)];
        try { await img(ctx, t.album.cover_big || t.album.cover_medium, card('Deezer', '30s preview', rows)); } catch (e) { await ctx.reply(card('Deezer', '30s preview', rows)); }
        if (t.preview) await aud(ctx, t.preview);
    });
    def('itunes', 'Media', '.itunes [song] — Apple Music info + 30-second preview', ['applemusic', 'itunesprev'], async (ctx) => {
        if (!ctx.q.trim()) return ctx.reply(use('iTunes', 'Type a song name.', '.itunes perfect ed sheeran'));
        const d = await get('https://itunes.apple.com/search?media=music&entity=song&limit=1&term=' + enc(ctx.q.trim()));
        const t = d && d.results && d.results[0];
        if (!t) return ctx.reply(nothing('iTunes', 'No song found.'));
        const rows = [kv('song', t.trackName), kv('artist', t.artistName), kv('album', t.collectionName), kv('genre', t.primaryGenreName), kv('released', (t.releaseDate || '').slice(0, 10)), kv('link', t.trackViewUrl)];
        try { await img(ctx, (t.artworkUrl100 || '').replace('100x100', '600x600'), card('iTunes', '30s preview', rows)); } catch (e) { await ctx.reply(card('iTunes', '30s preview', rows)); }
        if (t.previewUrl) await aud(ctx, t.previewUrl);
    });

    // ---- Free books: Internet Archive (PDF) + Project Gutenberg (EPUB) ----
    def('ebook', 'Media', '.ebook [title] — free PDF book from the Internet Archive', ['pdfbook', 'iabook', 'getbook'], async (ctx) => {
        if (!ctx.q.trim()) return ctx.reply(use('eBook', 'Type a book title.', '.ebook alice in wonderland'));
        const query = `(${ctx.q.trim()}) AND mediatype:texts AND -access-restricted-item:true`;
        const s = await get('https://archive.org/advancedsearch.php?output=json&rows=6&fl[]=identifier&fl[]=title&fl[]=creator&q=' + enc(query));
        const docs = (s && s.response && s.response.docs) || [];
        if (!docs.length) return ctx.reply(nothing('eBook', 'No free book found with that title.'));
        for (const dd of docs) {
            let meta;
            try { meta = await get('https://archive.org/metadata/' + enc(dd.identifier)); } catch (e) { continue; }
            const f = ((meta && meta.files) || []).filter((x) => /\.pdf$/i.test(x.name) && !/_text\.pdf$/i.test(x.name) && parseInt(x.size || '0', 10) > 0 && parseInt(x.size, 10) <= 40 * 1048576).sort((a, b) => parseInt(b.size, 10) - parseInt(a.size, 10))[0];
            if (!f) continue;
            await ctx.reply(card('eBook', 'sending', [kv('title', trunc(dd.title, 70)), dd.creator ? kv('author', trunc(Array.isArray(dd.creator) ? dd.creator[0] : dd.creator, 40)) : null, kv('size', (parseInt(f.size, 10) / 1048576).toFixed(1) + ' MB')].filter(Boolean), `↳ ${sc('please wait')}`));
            return void await docu(ctx, `https://archive.org/download/${enc(dd.identifier)}/${f.name.split('/').map(enc).join('/')}`, trunc(dd.title, 60).replace(/[\\/:*?"<>|]/g, '') + '.pdf', 'application/pdf');
        }
        await ctx.reply(nothing('eBook', 'Books were found but none has a free PDF small enough for chat.'));
    });
    def('gutenberg', 'Media', '.gutenberg [title or author] — free classic book (EPUB)', ['classicbook', 'epub', 'freebook'], async (ctx) => {
        if (!ctx.q.trim()) return ctx.reply(use('Gutenberg', 'Type a classic book title or author.', '.gutenberg pride and prejudice'));
        const d = await get('https://gutendex.com/books/?search=' + enc(ctx.q.trim()), { timeout: 30000 });
        const b = d && d.results && d.results[0];
        if (!b) return ctx.reply(nothing('Gutenberg', 'No book found.'));
        const f = b.formats || {};
        const url = f['application/epub+zip'];
        if (!url) return ctx.reply(nothing('Gutenberg', 'That book has no EPUB file.'));
        await ctx.reply(card('Gutenberg', 'sending', [kv('title', trunc(b.title, 70)), kv('author', trunc((b.authors || []).map((a) => a.name).join(', ') || '—', 50)), kv('downloads', num(b.download_count || 0))], `↳ ${sc('please wait')}`));
        await docu(ctx, url, trunc(b.title, 60).replace(/[\\/:*?"<>|]/g, '') + '.epub', 'application/epub+zip');
    });

    // ---- Wikipedia / Wikimedia Commons pictures ----
    def('wikipic', 'Media', '.wikipic [topic] — the main Wikipedia picture of a topic', ['wikiimg', 'wikiimage'], async (ctx) => {
        if (!ctx.q.trim()) return ctx.reply(use('Wiki Picture', 'Type a topic.', '.wikipic Sigiriya'));
        const d = await get('https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrlimit=1&prop=pageimages&piprop=original&gsrsearch=' + enc(ctx.q.trim()));
        const p = d && d.query && d.query.pages && Object.values(d.query.pages)[0];
        if (!p || !p.original) return ctx.reply(nothing('Wiki Picture', 'No picture found for that topic.'));
        await img(ctx, p.original.source, card('Wiki Picture', 'wikipedia', [kv('page', p.title)]) + credit());
    });
    def('commons', 'Media', '.commons [words] — free-licence photo from Wikimedia Commons', ['wikimedia', 'freephoto'], async (ctx) => {
        if (!ctx.q.trim()) return ctx.reply(use('Commons', 'Type what photo you want.', '.commons ella rock'));
        const d = await get('https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrnamespace=6&gsrlimit=8&prop=imageinfo&iiprop=url|mime&iiurlwidth=1280&gsrsearch=' + enc(ctx.q.trim()));
        const pages = Object.values((d && d.query && d.query.pages) || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
        const p = pages.find((x) => x.imageinfo && /^image\/(jpeg|png)/.test(x.imageinfo[0].mime));
        if (!p) return ctx.reply(nothing('Commons', 'No photo found.'));
        await img(ctx, p.imageinfo[0].thumburl || p.imageinfo[0].url, card('Commons', 'free licence', [kv('file', trunc(p.title.replace(/^File:/, ''), 70))]) + credit());
    });

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
    def('picsum', 'Media', '.picsum [width] [height] — a random beautiful photo', ['randompic', 'randomphoto'], async (ctx) => {
        const w = Math.min(2000, Math.max(200, parseInt(ctx.args[0], 10) || 1080)), h = Math.min(2000, Math.max(200, parseInt(ctx.args[1], 10) || 720));
        await img(ctx, `https://picsum.photos/${w}/${h}.jpg?random=${Date.now()}`, card('Random Photo', w + 'x' + h, []) + credit());
    });
    def('gif', 'Media', '.gif [words] — search and send an animated GIF', ['gifsearch', 'tenor', 'giphy'], async (ctx) => {
        if (!ctx.q.trim()) return ctx.reply(use('GIF', 'Type what GIF you want.', '.gif happy dance'));
        let url = null;
        try { // Tenor's public demo key
            const d = await get(`https://g.tenor.com/v1/search?key=LIVDSRZULELA&limit=10&media_filter=minimal&q=${enc(ctx.q.trim())}`);
            const r = pick((d && d.results) || [{}]); url = r.media && r.media[0] && (r.media[0].mp4 || r.media[0].gif || {}).url;
        } catch (e) { /* use Giphy below */ }
        if (!url) { // Giphy's public beta key
            const d = await get(`https://api.giphy.com/v1/gifs/search?api_key=dc6zaTOxFJmzC&limit=10&rating=g&q=${enc(ctx.q.trim())}`);
            const r = pick((d && d.data) || [{}]); url = r.images && r.images.original_mp4 && r.images.original_mp4.mp4;
        }
        if (!url) return ctx.reply(nothing('GIF', 'No GIF found.'));
        await anim(ctx, url, `_${sc('gif')} · ${trunc(ctx.q, 30)}_`);
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
    def('barcode', 'Media', '.barcode [type] [text] — make a barcode picture (code128, ean13, upca, qrcode …)', ['bar', 'makebarcode'], async (ctx) => {
        let type = 'code128', text = ctx.q.trim();
        if (ctx.args[0] && BARCODES.includes(ctx.args[0].toLowerCase())) { type = ctx.args[0].toLowerCase(); text = ctx.args.slice(1).join(' '); }
        if (!text) return ctx.reply(use('Barcode', 'Type the text / number. Types: ' + BARCODES.join(', '), '.barcode ean13 5901234123457'));
        await img(ctx, `https://bwipjs-api.metafloor.com/?bcid=${type}&scale=4&includetext&backgroundcolor=ffffff&text=${enc(text)}`, card('Barcode', type, [kv('text', trunc(text, 60))]));
    });
    const DICE = ['adventurer', 'avataaars', 'big-smile', 'bottts', 'croodles', 'fun-emoji', 'lorelei', 'micah', 'miniavs', 'notionists', 'personas', 'pixel-art', 'thumbs'];
    def('avatar', 'Media', '.avatar [style] [name] — make a cartoon avatar from any name', ['dicebear', 'cartoonavatar'], async (ctx) => {
        let style = pick(DICE), seed = ctx.q.trim();
        if (ctx.args[0] && DICE.includes(ctx.args[0].toLowerCase())) { style = ctx.args[0].toLowerCase(); seed = ctx.args.slice(1).join(' '); }
        if (!seed) seed = String(Date.now());
        await img(ctx, `https://api.dicebear.com/9.x/${style}/png?size=512&seed=${enc(seed)}`, card('Avatar', style, [kv('name', trunc(seed, 40)), kv('styles', DICE.slice(0, 6).join(', ') + '…')]));
    });
    def('robohash', 'Media', '.robohash [name] — a unique robot (or monster) for any name', ['robot', 'monsterpic'], async (ctx) => {
        const seed = ctx.q.trim() || String(Date.now());
        const set = /monster/i.test(ctx.q) ? 'set2' : /cat/i.test(ctx.q) ? 'set4' : 'set1';
        await img(ctx, `https://robohash.org/${enc(seed.replace(/\b(monster|cat)\b/gi, '').trim() || seed)}.png?size=512x512&set=${set}`, card('Robohash', set, [kv('name', trunc(seed, 40))]));
    });
    const memeText = (t) => String(t || '_').trim().replace(/~/g, '~~').replace(/_/g, '__').replace(/-/g, '--').replace(/ /g, '_').replace(/\?/g, '~q').replace(/&/g, '~a').replace(/%/g, '~p').replace(/#/g, '~h').replace(/\//g, '~s').replace(/\\/g, '~b').replace(/</g, '~l').replace(/>/g, '~g').replace(/"/g, "''").replace(/\n/g, '~n') || '_';
    def('memegen', 'Media', '.memegen [template] | [top text] | [bottom text] — make a meme (".memegen list" for templates)', ['makememe', 'memetext'], async (ctx) => {
        if (/^list\b/i.test(ctx.q.trim())) {
            const t = await get('https://api.memegen.link/templates');
            return ctx.reply(card('Meme Templates', 'memegen', [Array.isArray(t) ? t.slice(0, 60).map((x) => x.id).join(', ') : '—'], `↳ ${sc('use')} .memegen drake | top | bottom`));
        }
        const parts = ctx.q.split('|').map((s) => s.trim());
        if (parts.length < 2 || !parts[0]) return ctx.reply(use('Meme Maker', 'Template | top text | bottom text', '.memegen drake | no homework | homework tomorrow'));
        await img(ctx, `https://api.memegen.link/images/${enc(parts[0].toLowerCase().replace(/\s+/g, '-'))}/${memeText(parts[1])}/${memeText(parts[2])}.png?width=800`, undefined);
    });
    def('memeimg', 'Media', '.memeimg [subreddit] — a fresh meme picture from Reddit', ['gimme', 'redditmeme', 'memepic'], async (ctx) => {
        const sub = ctx.q.trim().replace(/^r\//i, '').replace(/[^\w]/g, '');
        const d = await get('https://meme-api.com/gimme' + (sub ? '/' + sub : ''));
        if (!d || !d.url) return ctx.reply(nothing('Meme', 'No meme found.'));
        const cap = card('Meme', 'r/' + d.subreddit, [kv('title', trunc(d.title, 100)), kv('upvotes', num(d.ups || 0))]);
        if (/\.gif(\?|$)/i.test(d.url)) await anim(ctx, d.url, cap); else await img(ctx, d.url, cap);
    });
    def('carbon', 'Media', '.carbon [code] — turn code into a pretty image (or reply to code)', ['codeimg', 'code2img'], async (ctx) => {
        const code = ctx.q.trim() || (D.quotedText ? D.quotedText(ctx.msg) : '');
        if (!code) return ctx.reply(use('Carbon', 'Type or reply to some code.', '.carbon console.log("hello")'));
        const r = await axios.post('https://carbonara.solopov.dev/api/cook', { code: code.slice(0, 3000), backgroundColor: '#1a2233', theme: 'seti', language: 'auto', paddingVertical: '30px', paddingHorizontal: '30px', exportSize: '2x', fontFamily: 'Fira Code' }, { responseType: 'arraybuffer', timeout: 40000, headers: { 'User-Agent': API_UA } });
        await img(ctx, Buffer.from(r.data), card('Carbon', 'code image', []) + credit());
    });
    def('chart', 'Media', '.chart [bar|line|pie|doughnut|radar] [labels] | [values] | [title]', ['makechart', 'graph'], async (ctx) => {
        const m = /^(bar|line|pie|doughnut|radar)\s+(.*)$/i.exec(ctx.q.trim());
        const type = m ? m[1].toLowerCase() : 'bar', rest = m ? m[2] : ctx.q.trim();
        const [labelsS, valuesS, title] = rest.split('|').map((s) => s.trim());
        const labels = (labelsS || '').split(',').map((s) => s.trim()).filter(Boolean), values = (valuesS || '').split(',').map((s) => parseFloat(s)).filter((n) => !Number.isNaN(n));
        if (!labels.length || labels.length !== values.length) return ctx.reply(use('Chart', 'Labels | values | optional title — same count of each. Types: bar, line, pie, doughnut, radar.', '.chart bar Jan,Feb,Mar | 10,25,18 | Sales'));
        const palette = ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac'];
        const cfg = { type, data: { labels, datasets: [{ label: title || 'Values', data: values, backgroundColor: type === 'line' || type === 'radar' ? 'rgba(78,121,167,0.25)' : labels.map((_, i) => palette[i % palette.length]), borderColor: '#4e79a7', fill: type === 'radar' }] }, options: { plugins: { title: { display: !!title, text: title || '' }, legend: { display: type === 'pie' || type === 'doughnut' } } } };
        const r = await axios.post('https://quickchart.io/chart', { chart: cfg, width: 800, height: 500, backgroundColor: 'white', format: 'png' }, { responseType: 'arraybuffer', timeout: 30000, headers: { 'User-Agent': API_UA } });
        await img(ctx, Buffer.from(r.data), card('Chart', type, title ? [kv('title', trunc(title, 40))] : []));
    });
    def('latex', 'Media', '.latex [formula] — draw a maths formula as a picture', ['tex', 'formula', 'mathimg'], async (ctx) => {
        if (!ctx.q.trim()) return ctx.reply(use('LaTeX', 'Type a LaTeX formula.', '.latex \\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}'));
        await img(ctx, 'https://latex.codecogs.com/png.image?' + enc('\\dpi{300}\\bg{white}\\large ') + enc(ctx.q.trim()), undefined);
    });
    def('textimg', 'Media', '.textimg [text] — turn text into a coloured picture', ['text2img', 'bannertext', 'quoteimg'], async (ctx) => {
        if (!ctx.q.trim()) return ctx.reply(use('Text Picture', 'Type the text.', '.textimg Good morning!'));
        const pal = [['0f172a', 'f8fafc'], ['1e3a8a', 'fde68a'], ['064e3b', 'ecfdf5'], ['7c2d12', 'ffedd5'], ['3b0764', 'f3e8ff'], ['111827', '34d399']];
        const [bg, fg] = pick(pal);
        await img(ctx, `https://placehold.co/900x500/${bg}/${fg}/png?font=montserrat&text=${enc(ctx.q.trim().slice(0, 120).replace(/(.{1,22})(\s|$)/g, '$1\n').trim())}`, undefined);
    });
    def('httpcat', 'Media', '.httpcat [status code] — the HTTP status code, explained by a cat', ['httpstatus', 'statuscat'], async (ctx) => {
        const c = parseInt(ctx.args[0], 10) || pick([200, 201, 301, 400, 401, 403, 404, 418, 429, 500, 502, 503]);
        await img(ctx, `https://http.cat/${c}.jpg`, card('HTTP Cat', String(c), []));
    });
    def('mcskin', 'Media', '.mcskin [minecraft name] — player skin + UUID', ['minecraftskin', 'mcplayer'], async (ctx) => {
        const n = ctx.q.trim();
        if (!/^\w{2,16}$/.test(n)) return ctx.reply(use('Minecraft Skin', 'Type a Minecraft Java username.', '.mcskin Notch'));
        const p = await get('https://api.mojang.com/users/profiles/minecraft/' + enc(n));
        if (!p || !p.id) return ctx.reply(nothing('Minecraft Skin', 'No such player.'));
        await img(ctx, `https://mc-heads.net/body/${p.id}/400.png`, card('Minecraft Skin', p.name, [kv('uuid', p.id)]));
    });
    def('apod', 'Media', '.apod [YYYY-MM-DD] — NASA Astronomy Picture of the Day', ['nasa', 'spacepic'], async (ctx) => {
        const date = /^\d{4}-\d{2}-\d{2}$/.test(ctx.args[0] || '') ? ctx.args[0] : '';
        const d = await get('https://api.nasa.gov/planetary/apod?api_key=' + (process.env.NASA_API_KEY || 'DEMO_KEY') + (date ? '&date=' + date : ''));
        const rows = [kv('title', d.title), kv('date', d.date), d.copyright ? kv('credit', trunc(d.copyright, 40)) : null, trunc(d.explanation, 600)].filter(Boolean);
        if (d.media_type !== 'image') return ctx.reply(card('NASA APOD', 'video of the day', [...rows, kv('watch', d.url)]));
        await img(ctx, d.hdurl || d.url, card('NASA APOD', d.date, rows));
    });
    def('flag', 'Media', '.flag [country] — flag picture and quick facts', ['flagpic', 'countryflag'], async (ctx) => {
        if (!ctx.q.trim()) return ctx.reply(use('Flag', 'Type a country name.', '.flag sri lanka'));
        const d = await get('https://restcountries.com/v3.1/name/' + enc(ctx.q.trim()) + '?fields=name,cca2,capital,flags');
        const c = d && d[0];
        if (!c) return ctx.reply(nothing('Flag', 'Country not found.'));
        await img(ctx, `https://flagcdn.com/w1280/${c.cca2.toLowerCase()}.png`, card('Flag', c.cca2, [kv('country', c.name.common), kv('capital', (c.capital || ['—'])[0]), c.flags && c.flags.alt ? trunc(c.flags.alt, 140) : null].filter(Boolean)));
    });

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
    animal('catpic', 'cat', ['randomcat', 'kitty'], async () => ({ url: (await get('https://api.thecatapi.com/v1/images/search'))[0].url }), '🐱');
    animal('dogpic', 'dog', ['randomdog', 'puppy'], async () => ({ url: (await get('https://dog.ceo/api/breeds/image/random')).message }), '🐶');
    animal('foxpic', 'fox', ['randomfox', 'floof'], async () => ({ url: (await get('https://randomfox.ca/floof/')).image }), '🦊');
    animal('duckpic', 'duck', ['randomduck', 'quack'], async () => ({ url: (await get('https://random-d.uk/api/v2/random')).url }), '🦆');
    animal('pandapic', 'panda', ['randompanda'], async () => { const d = await sra('panda'); return { url: d.image, fact: d.fact }; }, '🐼');

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
    animeCmd('waifu', 'waifu', 'random anime waifu picture', ['animegirl'], false);
    animeCmd('neko', 'neko', 'random anime cat-girl picture', ['catgirl'], false);
    animeCmd('pat', 'pat', 'anime head-pat GIF', ['headpat'], true);
    animeCmd('dance', 'dance', 'anime dance GIF', ['animedance'], true);

    // ---- Text to speech in any language (Google Translate voice) ----
    def('speak', 'Media', '.speak [lang] [text] — voice note in any language (si, ta, en, hi, ja, ar …)', ['ttsl', 'saylang', 'voice'], async (ctx) => {
        let lang = 'en', text = ctx.q.trim();
        if (/^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(ctx.args[0] || '')) { lang = ctx.args[0]; text = ctx.args.slice(1).join(' '); }
        if (!text) return ctx.reply(use('Speak', 'Language code + text. Codes: si Sinhala, ta Tamil, en English, hi Hindi, ja, ko, ar, fr, de, es…', '.speak si ආයුබෝවන්'));
        await aud(ctx, `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${enc(lang)}&q=${enc(text.slice(0, 200))}`, true);
    });

    // ---- Quran recitation (audio) ----
    def('quranaudio', 'Islamic', '.quranaudio [surah:ayah] — recitation of an ayah (Mishary Alafasy)', ['ayahaudio', 'recite'], async (ctx) => {
        const ref = ctx.args[0] || '';
        if (!/^\d{1,3}:\d{1,3}$/.test(ref)) return ctx.reply(use('Quran Audio', 'Send surah:ayah.', '.quranaudio 1:1'));
        const d = (await get(`https://api.alquran.cloud/v1/ayah/${ref}/ar.alafasy`)).data;
        if (!d || !d.audio) return ctx.reply(nothing('Quran Audio', 'That ayah was not found.'));
        await ctx.reply(card('Quran Audio', d.surah.englishName + ' ' + ref, [d.text]));
        await aud(ctx, d.audio);
    });

    // ======================================================================
    //  LOOK-UP / INFO COMMANDS
    // ======================================================================
    def('lyricsfull', 'Search', '.lyricsfull [song] — full song lyrics text', ['fulllyrics', 'lrc'], async (ctx) => {
        if (!ctx.q.trim()) return ctx.reply(use('Lyrics', 'Type the song (and artist).', '.lyricsfull perfect ed sheeran'));
        const d = await get('https://lrclib.net/api/search?q=' + enc(ctx.q.trim()));
        const t = (d || []).find((x) => hasText(x.plainLyrics));
        if (!t) return ctx.reply(nothing('Lyrics', 'No lyrics found for that song.'));
        await ctx.reply(card(t.trackName, trunc(t.artistName, 24), [t.plainLyrics.length > 3200 ? t.plainLyrics.slice(0, 3200).trim() + '\n…' : t.plainLyrics.trim()]));
    });
    def('urban', 'Search', '.urban [word] — Urban Dictionary meaning', ['ud', 'slang'], async (ctx) => {
        if (!ctx.q.trim()) return ctx.reply(use('Urban', 'Type a word or slang.', '.urban rizz'));
        const d = await get('https://api.urbandictionary.com/v0/define?term=' + enc(ctx.q.trim()));
        const w = d && d.list && d.list[0];
        if (!w) return ctx.reply(nothing('Urban', 'No definition found.'));
        await ctx.reply(card(w.word, 'urban dictionary', [trunc(w.definition.replace(/[[\]]/g, ''), 500), '', kv('example', trunc(w.example.replace(/[[\]]/g, ''), 250)), kv('👍 / 👎', w.thumbs_up + ' / ' + w.thumbs_down)]));
    });
    const dm = (name, rel, label, aliases) => def(name, 'Search', `.${name} [word] — ${label}`, aliases, async (ctx) => {
        const w = ctx.q.trim().split(/\s+/)[0];
        if (!w) return ctx.reply(use(name, 'Type one word.', `.${name} happy`));
        const d = await get(`https://api.datamuse.com/words?max=30&${rel}=${enc(w)}`);
        if (!d || !d.length) return ctx.reply(nothing(name, 'No words found.'));
        await ctx.reply(card(name, w, [d.map((x) => x.word).join(', ')]));
    });
    dm('rhyme', 'rel_rhy', 'words that rhyme', ['rhymes']);
    dm('synonym', 'rel_syn', 'words with the same meaning', ['syn', 'thesaurus']);
    dm('antonym', 'rel_ant', 'words with the opposite meaning', ['ant', 'opposite']);
    def('spellcheck', 'Search', '.spellcheck [text] — fix spelling & grammar (LanguageTool)', ['spell', 'fixtext'], async (ctx) => {
        const text = ctx.q.trim() || (D.quotedText ? D.quotedText(ctx.msg) : '');
        if (!text) return ctx.reply(use('Spell Check', 'Type or reply to some text.', '.spellcheck i has a apple'));
        const d = await postForm('https://api.languagetool.org/v2/check', { text: text.slice(0, 1500), language: 'auto' });
        const ms = (d.matches || []).filter((m) => m.replacements && m.replacements.length).sort((a, b) => b.offset - a.offset);
        let fixed = text.slice(0, 1500);
        for (const m of ms) fixed = fixed.slice(0, m.offset) + m.replacements[0].value + fixed.slice(m.offset + m.length);
        await ctx.reply(card('Spell Check', ms.length ? ms.length + ' fixes' : 'looks good', [fixed, '', ...(d.matches || []).slice(0, 4).map((m) => '• ' + trunc(m.message, 90))]));
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
    def('aqi', 'Search', '.aqi [city] — air quality now', ['airquality', 'pollution'], async (ctx) => {
        const place = await geocode(ctx.q.trim() || 'Colombo');
        if (!place) return ctx.reply(nothing('Air Quality', 'City not found.'));
        const d = await get(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${place.latitude}&longitude=${place.longitude}&timezone=auto&current=us_aqi,pm10,pm2_5,ozone,nitrogen_dioxide`);
        const c = d.current || {};
        const a = c.us_aqi, lvl = a == null ? '—' : a <= 50 ? 'Good 🟢' : a <= 100 ? 'Moderate 🟡' : a <= 150 ? 'Unhealthy for sensitive 🟠' : a <= 200 ? 'Unhealthy 🔴' : a <= 300 ? 'Very unhealthy 🟣' : 'Hazardous ⚫';
        await ctx.reply(card('Air Quality', place.name, [kv('AQI (US)', a == null ? '—' : a), kv('level', lvl), kv('PM2.5', c.pm2_5 + ' µg/m³'), kv('PM10', c.pm10 + ' µg/m³'), kv('ozone', c.ozone + ' µg/m³'), kv('NO₂', c.nitrogen_dioxide + ' µg/m³')]));
    });
    def('sunrise', 'Search', '.sunrise [city] — sunrise, sunset and UV today', ['sunset', 'suntimes'], async (ctx) => {
        const place = await geocode(ctx.q.trim() || 'Colombo');
        if (!place) return ctx.reply(nothing('Sun Times', 'City not found.'));
        const d = await get(`https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&timezone=auto&forecast_days=1&daily=sunrise,sunset,uv_index_max,daylight_duration`);
        const x = d.daily, hm = (s) => String(s).split('T')[1];
        await ctx.reply(card('Sun Times', place.name, [kv('sunrise', hm(x.sunrise[0])), kv('sunset', hm(x.sunset[0])), kv('daylight', (x.daylight_duration[0] / 3600).toFixed(1) + ' h'), kv('max UV', x.uv_index_max[0])]));
    });
    def('worldtime', 'Search', '.worldtime [city] — current time in any city', ['citytime', 'timein', 'clock'], async (ctx) => {
        if (!ctx.q.trim()) return ctx.reply(use('World Time', 'Type a city.', '.worldtime tokyo'));
        const place = await geocode(ctx.q.trim());
        if (!place || !place.timezone) return ctx.reply(nothing('World Time', 'City not found.'));
        const now = new Date();
        const f = (o) => new Intl.DateTimeFormat('en-GB', Object.assign({ timeZone: place.timezone }, o)).format(now);
        await ctx.reply(card('World Time', place.name + ', ' + (place.country_code || ''), [kv('time', f({ hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })), kv('date', f({ weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })), kv('zone', place.timezone)]));
    });
    def('holidays', 'Search', '.holidays [country code or name] — upcoming public holidays', ['publicholidays', 'holiday'], async (ctx) => {
        let cc = (ctx.q.trim() || 'LK');
        if (!/^[A-Za-z]{2}$/.test(cc)) { const c = await get('https://restcountries.com/v3.1/name/' + enc(cc) + '?fields=cca2'); cc = c && c[0] && c[0].cca2; }
        if (!cc) return ctx.reply(nothing('Holidays', 'Country not found.'));
        const today = sriLankaYmd(), year = today.slice(0, 4);
        let list = await get(`https://date.nager.at/api/v3/PublicHolidays/${year}/${cc.toUpperCase()}`);
        if (list.filter((h) => h.date >= today).length < 6) list = list.concat(await get(`https://date.nager.at/api/v3/PublicHolidays/${+year + 1}/${cc.toUpperCase()}`));
        const up = list.filter((h) => h.date >= today).slice(0, 8);
        if (!up.length) return ctx.reply(nothing('Holidays'));
        await ctx.reply(card('Holidays', cc.toUpperCase(), up.map((h) => `${h.date} · ${trunc(h.name, 40)}`)));
    });
    def('prayer', 'Islamic', '.prayer [city] — today\'s prayer times', ['salah', 'namaz', 'prayertimes'], async (ctx) => {
        const place = await geocode(ctx.q.trim() || 'Colombo');
        if (!place) return ctx.reply(nothing('Prayer Times', 'City not found.'));
        const d = (await get(`https://api.aladhan.com/v1/timings?latitude=${place.latitude}&longitude=${place.longitude}&method=${process.env.PRAYER_METHOD || 3}&timezonestring=${enc(place.timezone || 'UTC')}`)).data;
        const t = d.timings, h = d.date.hijri;
        await ctx.reply(card('Prayer Times', place.name, ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'].map((k) => kv(k, t[k])).concat([kv('hijri', `${h.day} ${h.month.en} ${h.year}`)])));
    });
    def('hijri', 'Islamic', '.hijri [DD-MM-YYYY] — today\'s Islamic (Hijri) date', ['islamicdate', 'hijridate'], async (ctx) => {
        const t = sriLankaYmd().split('-');
        const date = /^\d{2}-\d{2}-\d{4}$/.test(ctx.args[0] || '') ? ctx.args[0] : `${t[2]}-${t[1]}-${t[0]}`;
        const h = (await get('https://api.aladhan.com/v1/gToH/' + date)).data.hijri;
        await ctx.reply(card('Hijri Date', date, [kv('hijri', `${h.day} ${h.month.en} ${h.year} AH`), kv('arabic', `${h.day} ${h.month.ar}`), kv('weekday', h.weekday.en)]));
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
    def('bible', 'Islamic', '.bible [verse] — Bible verse (KJV), e.g. john 3:16', ['verse', 'scripture'], async (ctx) => {
        if (!ctx.q.trim()) return ctx.reply(use('Bible', 'Type a verse.', '.bible john 3:16'));
        const d = await get('https://bible-api.com/' + enc(ctx.q.trim()) + '?translation=kjv');
        if (!d || !d.text) return ctx.reply(nothing('Bible', 'Verse not found.'));
        await ctx.reply(card(d.reference, d.translation_name || 'kjv', [trunc(d.text, 1500)]));
    });

    // ---- quotes, jokes, fun facts, advice ----
    def('advice', 'Fun', '.advice — a random piece of advice', ['adviceslip', 'tip'], async (ctx) => {
        const d = await get('https://api.adviceslip.com/advice', { responseType: 'text', transformResponse: [(x) => JSON.parse(x)] });
        await ctx.reply(`💡 *Advice:*\n\n${d.slip.advice}`);
    });
    def('jokeapi', 'Fun', '.jokeapi [programming|misc|pun|dark] — a joke from JokeAPI', ['jokes', 'progjoke', 'techjoke'], async (ctx) => {
        const cat = { programming: 'Programming', misc: 'Misc', pun: 'Pun', dark: 'Dark', christmas: 'Christmas' }[(ctx.args[0] || '').toLowerCase()] || 'Any';
        const d = await get(`https://v2.jokeapi.dev/joke/${cat}?blacklistFlags=nsfw,religious,political,racist,sexist,explicit${cat === 'Dark' ? '' : '&safe-mode'}`);
        if (d.error) return ctx.reply(nothing('Joke'));
        await ctx.reply(`🎭 *${d.category} joke:*\n\n${d.type === 'single' ? d.joke : d.setup + '\n\n||' + d.delivery + '||'}`);
    });
    def('chucknorris', 'Fun', '.chucknorris — a Chuck Norris fact', ['chuck', 'norris'], async (ctx) => ctx.reply(`💪 *Chuck Norris:*\n\n${(await get('https://api.chucknorris.io/jokes/random')).value}`));
    def('uselessfact', 'Fun', '.uselessfact — a random useless (but true) fact', ['useless', 'randomfact'], async (ctx) => ctx.reply(`🤯 *Useless fact:*\n\n${(await get('https://uselessfacts.jsph.pl/api/v2/facts/random?language=en')).text}`));
    def('quiz', 'Fun', '.quiz [easy|medium|hard] — a multiple-choice question', ['opentdb', 'question', 'mcq'], async (ctx) => {
        const diff = ['easy', 'medium', 'hard'].includes((ctx.args[0] || '').toLowerCase()) ? '&difficulty=' + ctx.args[0].toLowerCase() : '';
        const d = await get('https://opentdb.com/api.php?amount=1&type=multiple&encode=url3986' + diff);
        const r = d.results && d.results[0];
        if (!r) return ctx.reply(busy('Quiz'));
        const dec = decodeURIComponent;
        const opts = [r.correct_answer, ...r.incorrect_answers].map(dec).sort(() => Math.random() - 0.5);
        await ctx.reply(card('Quiz', dec(r.category).slice(0, 24), [dec(r.question), '', ...opts.map((o, i) => `${'ABCD'[i]}. ${o}`), '', kv('level', dec(r.difficulty))], `↳ ${sc('answer')}: ||${dec(r.correct_answer)}||`));
    });
    def('kanye', 'Fun', '.kanye — a random Kanye West quote', ['kanyequote', 'ye'], async (ctx) => ctx.reply(`🎤 *Kanye says:*\n\n"${(await get('https://api.kanye.rest/')).quote}"`));
    def('zenquote', 'Fun', '.zenquote — an inspiring quote (ZenQuotes)', ['zen', 'inspire'], async (ctx) => {
        const d = await get('https://zenquotes.io/api/random');
        await ctx.reply(`🌿 *Zen quote:*\n\n"${d[0].q}"\n— _${d[0].a}_`);
    });

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
    def('manga', 'Anime', '.manga [title] — manga info with cover (MyAnimeList)', ['mangainfo'], async (ctx) => {
        if (!ctx.q.trim()) return ctx.reply(use('Manga', 'Type a manga title.', '.manga berserk'));
        const d = await get('https://api.jikan.moe/v4/manga?limit=1&sfw=true&q=' + enc(ctx.q.trim()));
        const a = d.data && d.data[0];
        if (!a) return ctx.reply(nothing('Manga', 'Manga not found.'));
        const rows = [kv('title', a.title_english || a.title), kv('chapters', a.chapters || 'ongoing'), kv('volumes', a.volumes || '—'), kv('status', a.status), kv('score', a.score || '—'), kv('author', (a.authors || []).map((x) => x.name).join(', ') || '—'), '', trunc(a.synopsis || '', 450)];
        try { await img(ctx, a.images.jpg.large_image_url, card('Manga', 'myanimelist', rows)); } catch (e) { await ctx.reply(card('Manga', 'myanimelist', rows)); }
    });
    def('animequote', 'Anime', '.animequote — a famous anime quote', ['aq', 'animechan'], async (ctx) => {
        let q, who, show;
        try { const d = (await get('https://api.animechan.io/v1/quotes/random')).data; q = d.content; who = d.character.name; show = d.anime.name; }
        catch (e) { const d = await get('https://animechan.vercel.app/api/random'); q = d.quote; who = d.character; show = d.anime; }
        await ctx.reply(`🎌 *Anime quote:*\n\n"${q}"\n— _${who}_ (${show})`);
    });
    def('tvshow', 'Search', '.tvshow [name] — TV series info with poster (TVMaze)', ['series', 'tvmaze', 'show'], async (ctx) => {
        if (!ctx.q.trim()) return ctx.reply(use('TV Show', 'Type a show name.', '.tvshow breaking bad'));
        const s = await get('https://api.tvmaze.com/singlesearch/shows?q=' + enc(ctx.q.trim()));
        const rows = [kv('title', s.name), kv('genres', (s.genres || []).join(', ') || '—'), kv('status', s.status), kv('premiered', s.premiered || '—'), kv('rating', (s.rating && s.rating.average) || '—'), kv('network', (s.network && s.network.name) || (s.webChannel && s.webChannel.name) || '—'), '', trunc(strip(s.summary), 450)];
        try { await img(ctx, (s.image && (s.image.original || s.image.medium)), card('TV Show', 'tvmaze', rows)); } catch (e) { await ctx.reply(card('TV Show', 'tvmaze', rows)); }
    });
    def('book', 'Search', '.book [title] — book info + cover (Open Library)', ['bookinfo', 'openlibrary'], async (ctx) => {
        if (!ctx.q.trim()) return ctx.reply(use('Book', 'Type a book title.', '.book the alchemist'));
        const d = await get('https://openlibrary.org/search.json?limit=1&fields=title,author_name,first_publish_year,number_of_pages_median,subject,cover_i,key,ratings_average&q=' + enc(ctx.q.trim()));
        const b = d.docs && d.docs[0];
        if (!b) return ctx.reply(nothing('Book', 'Book not found.'));
        const rows = [kv('title', b.title), kv('author', (b.author_name || ['—']).slice(0, 2).join(', ')), kv('first published', b.first_publish_year || '—'), kv('pages', b.number_of_pages_median || '—'), kv('rating', b.ratings_average ? b.ratings_average.toFixed(1) + ' / 5' : '—'), kv('topics', (b.subject || []).slice(0, 4).join(', ') || '—'), kv('link', 'openlibrary.org' + b.key)];
        if (b.cover_i) { try { return void await img(ctx, `https://covers.openlibrary.org/b/id/${b.cover_i}-L.jpg`, card('Book', 'open library', rows)); } catch (e) { /* text only */ } }
        await ctx.reply(card('Book', 'open library', rows));
    });
    def('poem', 'Fun', '.poem [title] — a poem from PoetryDB (random if no title)', ['poetry', 'randompoem'], async (ctx) => {
        const d = ctx.q.trim() ? await get('https://poetrydb.org/title/' + enc(ctx.q.trim()) + '/title,author,lines') : await get('https://poetrydb.org/random');
        const p = Array.isArray(d) ? d[0] : null;
        if (!p) return ctx.reply(nothing('Poem', 'No poem found with that title.'));
        await ctx.reply(card(p.title, trunc(p.author, 28), [trunc(p.lines.join('\n'), 2600).replace(/ ?… ?/g, '…')]));
    });

    // ---- food & drink ----
    def('recipe', 'Search', '.recipe [dish] — recipe with ingredients and steps (random if empty)', ['meal', 'mealdb', 'cook'], async (ctx) => {
        const d = await get(ctx.q.trim() ? 'https://www.themealdb.com/api/json/v1/1/search.php?s=' + enc(ctx.q.trim()) : 'https://www.themealdb.com/api/json/v1/1/random.php');
        const m = d.meals && d.meals[0];
        if (!m) return ctx.reply(nothing('Recipe', 'No recipe found.'));
        const ing = []; for (let i = 1; i <= 20; i++) if (m['strIngredient' + i] && m['strIngredient' + i].trim()) ing.push(`• ${(m['strMeasure' + i] || '').trim()} ${m['strIngredient' + i].trim()}`.replace('•  ', '• '));
        const rows = [kv('dish', m.strMeal), kv('type', `${m.strCategory} · ${m.strArea}`), '', '*Ingredients*', ing.join('\n'), '', '*Method*', trunc(m.strInstructions, 1400), m.strYoutube ? '\n' + kv('video', m.strYoutube) : null].filter((x) => x !== null);
        try { await img(ctx, m.strMealThumb, card('Recipe', 'themealdb', rows)); } catch (e) { await ctx.reply(card('Recipe', 'themealdb', rows)); }
    });
    def('cocktail', 'Search', '.cocktail [name] — cocktail recipe (random if empty)', ['drink', 'cocktaildb'], async (ctx) => {
        const d = await get(ctx.q.trim() ? 'https://www.thecocktaildb.com/api/json/v1/1/search.php?s=' + enc(ctx.q.trim()) : 'https://www.thecocktaildb.com/api/json/v1/1/random.php');
        const m = d.drinks && d.drinks[0];
        if (!m) return ctx.reply(nothing('Cocktail', 'No cocktail found.'));
        const ing = []; for (let i = 1; i <= 15; i++) if (m['strIngredient' + i]) ing.push(`• ${(m['strMeasure' + i] || '').trim()} ${m['strIngredient' + i].trim()}`.replace('•  ', '• '));
        const rows = [kv('drink', m.strDrink), kv('type', `${m.strCategory} · ${m.strAlcoholic}`), kv('glass', m.strGlass), '', ing.join('\n'), '', trunc(m.strInstructions, 700)];
        try { await img(ctx, m.strDrinkThumb, card('Cocktail', 'cocktaildb', rows)); } catch (e) { await ctx.reply(card('Cocktail', 'cocktaildb', rows)); }
    });

    // ---- games & characters ----
    def('pokemon', 'Anime', '.pokemon [name or number] — Pokédex card with artwork', ['pokedex', 'poke'], async (ctx) => {
        const q = (ctx.q.trim() || String(1 + Math.floor(Math.random() * 1010))).toLowerCase().replace(/\s+/g, '-');
        const p = await get('https://pokeapi.co/api/v2/pokemon/' + enc(q));
        const st = Object.fromEntries(p.stats.map((s) => [s.stat.name, s.base_stat]));
        const rows = [kv('name', `${p.name} #${p.id}`), kv('type', p.types.map((t) => t.type.name).join(' / ')), kv('height', (p.height / 10) + ' m'), kv('weight', (p.weight / 10) + ' kg'), kv('abilities', p.abilities.map((a) => a.ability.name).join(', ')), kv('HP / ATK / DEF', `${st.hp} / ${st.attack} / ${st.defense}`), kv('SPA / SPD / SPE', `${st['special-attack']} / ${st['special-defense']} / ${st.speed}`)];
        const art = p.sprites.other && p.sprites.other['official-artwork'] && p.sprites.other['official-artwork'].front_default || p.sprites.front_default;
        try { await img(ctx, art, card('Pokédex', 'pokeapi', rows)); } catch (e) { await ctx.reply(card('Pokédex', 'pokeapi', rows)); }
    });
    def('mcserver', 'Gaming', '.mcserver [ip] — Minecraft server status', ['minecraftserver', 'mcstatus'], async (ctx) => {
        const h = ctx.args[0]; if (!h) return ctx.reply(use('Minecraft Server', 'Type the server address.', '.mcserver hypixel.net'));
        const d = await get('https://api.mcsrvstat.us/3/' + enc(h));
        if (!d.online) return ctx.reply(card('Minecraft Server', 'offline', [kv('address', h), 'The server is offline or the address is wrong.']));
        await ctx.reply(card('Minecraft Server', 'online', [kv('address', h), kv('version', d.version || '—'), kv('players', `${(d.players && d.players.online) || 0} / ${(d.players && d.players.max) || 0}`), kv('motd', trunc(((d.motd && d.motd.clean) || []).join(' '), 90))]));
    });
    def('lichess', 'Gaming', '.lichess [username] — Lichess chess profile', ['chessprofile', 'li'], async (ctx) => {
        const u = ctx.args[0]; if (!u) return ctx.reply(use('Lichess', 'Type a Lichess username.', '.lichess DrNykterstein'));
        const d = await get('https://lichess.org/api/user/' + enc(u));
        const p = d.perfs || {}, r = (k) => (p[k] ? `${p[k].rating} (${p[k].games} games)` : '—');
        await ctx.reply(card(d.username, 'lichess', [kv('bullet', r('bullet')), kv('blitz', r('blitz')), kv('rapid', r('rapid')), kv('classical', r('classical')), kv('games', `${num(d.count.all)} · W${d.count.win} L${d.count.loss} D${d.count.draw}`), kv('joined', new Date(d.createdAt).toISOString().slice(0, 10)), kv('profile', d.url)]));
    });
    def('chesscom', 'Gaming', '.chesscom [username] — Chess.com ratings', ['chess', 'chesscomprofile'], async (ctx) => {
        const u = ctx.args[0]; if (!u) return ctx.reply(use('Chess.com', 'Type a Chess.com username.', '.chesscom hikaru'));
        const [pl, st] = await Promise.all([get('https://api.chess.com/pub/player/' + enc(u.toLowerCase())), get('https://api.chess.com/pub/player/' + enc(u.toLowerCase()) + '/stats')]);
        const r = (k) => (st[k] && st[k].last ? String(st[k].last.rating) : '—');
        await ctx.reply(card(pl.username, 'chess.com', [kv('rapid', r('chess_rapid')), kv('blitz', r('chess_blitz')), kv('bullet', r('chess_bullet')), kv('daily', r('chess_daily')), kv('followers', num(pl.followers || 0)), kv('profile', pl.url)]));
    });

    // ---- news & community ----
    def('hn', 'Search', '.hn — top stories on Hacker News', ['hackernews', 'ycombinator'], async (ctx) => {
        const ids = (await get('https://hacker-news.firebaseio.com/v0/topstories.json')).slice(0, 8);
        const items = await Promise.all(ids.map((id) => get(`https://hacker-news.firebaseio.com/v0/item/${id}.json`)));
        await ctx.reply(card('Hacker News', 'top stories', items.filter(Boolean).map((i, n) => `${n + 1}. ${trunc(i.title, 80)}\n   ▲${i.score} · 💬${i.descendants || 0}\n   ${i.url || 'news.ycombinator.com/item?id=' + i.id}`)));
    });
    def('devto', 'Search', '.devto [tag] — top developer articles from DEV.to', ['devarticles', 'devnews'], async (ctx) => {
        const tag = ctx.args[0] ? '&tag=' + enc(ctx.args[0].toLowerCase()) : '';
        const d = await get('https://dev.to/api/articles?per_page=8&top=7' + tag);
        if (!d.length) return ctx.reply(nothing('DEV.to', 'No articles for that tag.'));
        await ctx.reply(card('DEV.to', ctx.args[0] || 'top this week', d.map((a, n) => `${n + 1}. ${trunc(a.title, 80)}\n   ❤${a.positive_reactions_count} · ${a.user.name}\n   ${a.url}`)));
    });
    def('subreddit', 'Search', '.subreddit [name] — top posts of a subreddit today', ['sub', 'rtop', 'redditsub'], async (ctx) => {
        const s = (ctx.args[0] || '').replace(/^r\//i, '').replace(/[^\w]/g, '');
        if (!s) return ctx.reply(use('Subreddit', 'Type a subreddit name.', '.subreddit worldnews'));
        const d = await get(`https://www.reddit.com/r/${s}/top.json?limit=8&t=day&raw_json=1`, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NimahMD/7)' } });
        const posts = ((d.data && d.data.children) || []).map((c) => c.data).filter((p) => !p.over_18);
        if (!posts.length) return ctx.reply(nothing('Subreddit', 'No posts found.'));
        await ctx.reply(card('r/' + s, 'top today', posts.slice(0, 7).map((p, n) => `${n + 1}. ${trunc(p.title, 90)}\n   ▲${num(p.ups)} · 💬${num(p.num_comments)}\n   redd.it/${p.id}`)));
    });

    // ---- money, health, places, space ----
    def('topcoins', 'Search', '.topcoins — top 10 cryptocurrencies by market cap', ['top10crypto', 'cryptotop', 'coins'], async (ctx) => {
        const d = await get('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10&page=1');
        await ctx.reply(card('Top Crypto', 'coingecko', d.map((c) => `${c.market_cap_rank}. ${c.name} (${c.symbol.toUpperCase()}) · $${num(c.current_price)} · ${c.price_change_percentage_24h >= 0 ? '🟢 +' : '🔴 '}${(c.price_change_percentage_24h || 0).toFixed(1)}%`)));
    });
    def('covid', 'Search', '.covid [country] — COVID-19 statistics (world if empty)', ['corona', 'covid19'], async (ctx) => {
        const q = ctx.q.trim();
        const d = await get('https://disease.sh/v3/covid-19/' + (q ? 'countries/' + enc(q) : 'all'));
        await ctx.reply(card('COVID-19', d.country || 'world', [kv('cases', num(d.cases)), kv('today', '+' + num(d.todayCases)), kv('deaths', num(d.deaths)), kv('recovered', num(d.recovered)), kv('active', num(d.active)), kv('tests', num(d.tests))]));
    });
    def('zipcode', 'Search', '.zipcode [country code] [postcode] — place from a postal code', ['postcode', 'zip', 'postal'], async (ctx) => {
        const [cc, ...zp] = ctx.args;
        if (!cc || !zp.length) return ctx.reply(use('Postal Code', 'Country code + postcode.', '.zipcode us 90210'));
        const d = await get(`https://api.zippopotam.us/${enc(cc.toLowerCase())}/${enc(zp.join(' '))}`);
        await ctx.reply(card('Postal Code', `${d['country abbreviation']} ${d['post code']}`, (d.places || []).slice(0, 5).map((p) => kv(p['place name'], `${p.state || ''} (${p.latitude}, ${p.longitude})`))));
    });
    def('iss', 'Search', '.iss — where the International Space Station is right now', ['spacestation', 'isspos'], async (ctx) => {
        const d = await get('https://api.wheretheiss.at/v1/satellites/25544');
        await ctx.reply(card('ISS', 'live position', [kv('latitude', d.latitude.toFixed(3)), kv('longitude', d.longitude.toFixed(3)), kv('altitude', Math.round(d.altitude) + ' km'), kv('speed', Math.round(d.velocity).toLocaleString('en-US') + ' km/h'), kv('over', d.visibility), kv('map', `https://maps.google.com/?q=${d.latitude},${d.longitude}`)]));
    });
    def('launches', 'Search', '.launches — next rocket launches', ['rocket', 'spacelaunch', 'nextlaunch'], async (ctx) => {
        const d = await get('https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=5&mode=list');
        if (!d.results || !d.results.length) return ctx.reply(nothing('Launches'));
        await ctx.reply(card('Rocket Launches', 'upcoming', d.results.map((l, n) => `${n + 1}. ${trunc(l.name, 60)}\n   ${new Date(l.net).toISOString().replace('T', ' ').slice(0, 16)} UTC · ${(l.status && l.status.abbrev) || ''}\n   ${(l.pad && l.pad.location && l.pad.location.name) || ''}`)));
    });
    def('earthquake', 'Search', '.earthquake — biggest earthquakes in the last 24 hours (M4.5+)', ['quake', 'quakes', 'eq'], async (ctx) => {
        const d = await get('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson');
        const f = (d.features || []).sort((a, b) => b.properties.mag - a.properties.mag).slice(0, 8);
        if (!f.length) return ctx.reply(card('Earthquakes', 'last 24h', ['No M4.5+ earthquakes in the last 24 hours.']));
        await ctx.reply(card('Earthquakes', 'last 24h · usgs', f.map((x) => `M${x.properties.mag} · ${trunc(x.properties.place, 55)}\n   ${new Date(x.properties.time).toISOString().replace('T', ' ').slice(0, 16)} UTC`)));
    });
    def('onthisday', 'Search', '.onthisday [MM-DD] — what happened on this day in history', ['today', 'history', 'thisday'], async (ctx) => {
        const t = sriLankaYmd().split('-');
        const m = /^(\d{1,2})[-/](\d{1,2})$/.exec(ctx.args[0] || '');
        const mm = m ? m[1].padStart(2, '0') : t[1], dd = m ? m[2].padStart(2, '0') : t[2];
        const d = await get(`https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/${mm}/${dd}`);
        const ev = (d.events || []).sort((a, b) => 0.5 - Math.random()).slice(0, 6).sort((a, b) => a.year - b.year);
        if (!ev.length) return ctx.reply(nothing('On This Day'));
        await ctx.reply(card('On This Day', `${mm}/${dd}`, ev.map((e) => `*${e.year}* — ${trunc(e.text, 150)}`)));
    });
    def('randomwiki', 'Search', '.randomwiki — a random Wikipedia article', ['wikirandom', 'randomarticle'], async (ctx) => {
        const d = await get('https://en.wikipedia.org/api/rest_v1/page/random/summary');
        const rows = [trunc(d.extract, 600), '', kv('read more', d.content_urls && d.content_urls.desktop && d.content_urls.desktop.page)];
        if (d.thumbnail && d.thumbnail.source) { try { return void await img(ctx, d.originalimage ? d.originalimage.source : d.thumbnail.source, card(d.title, 'random wikipedia', rows)); } catch (e) { /* text only */ } }
        await ctx.reply(card(d.title, 'random wikipedia', rows));
    });

    // ---- developer tools ----
    def('pypi', 'Search', '.pypi [package] — Python package info', ['pip', 'pythonpackage'], async (ctx) => {
        const n = ctx.args[0]; if (!n) return ctx.reply(use('PyPI', 'Type a package name.', '.pypi requests'));
        const i = (await get('https://pypi.org/pypi/' + enc(n) + '/json')).info;
        await ctx.reply(card(i.name, 'pypi', [kv('version', i.version), kv('about', trunc(i.summary, 140)), kv('python', i.requires_python || '—'), kv('license', trunc(i.license || '—', 30)), kv('install', 'pip install ' + i.name), kv('page', i.package_url)]));
    });
    def('repo', 'Search', '.repo [owner/name] — GitHub repository stats', ['ghrepo', 'repoinfo'], async (ctx) => {
        const m = /([\w.-]+)\/([\w.-]+)/.exec(ctx.q.replace(/https?:\/\/github\.com\//i, ''));
        if (!m) return ctx.reply(use('Repo', 'Type owner/name.', '.repo torvalds/linux'));
        const d = await get(`https://api.github.com/repos/${m[1]}/${m[2].replace(/\.git$/, '')}`, { headers: { 'User-Agent': API_UA, Accept: 'application/vnd.github+json' } });
        await ctx.reply(card(d.full_name, 'github repo', [kv('about', trunc(d.description || '—', 140)), kv('⭐ stars', num(d.stargazers_count)), kv('forks', num(d.forks_count)), kv('issues', num(d.open_issues_count)), kv('language', d.language || '—'), kv('license', (d.license && d.license.spdx_id) || '—'), kv('updated', (d.pushed_at || '').slice(0, 10)), kv('link', d.html_url)], `↳ ${sc('get the code with')} .gitclone ${d.html_url}`));
    });
    def('dns', 'Search', '.dns [domain] [A|AAAA|MX|TXT|NS|CNAME] — DNS records', ['dnslookup', 'nslookup'], async (ctx) => {
        const dom = (ctx.args[0] || '').replace(/^https?:\/\//i, '').split('/')[0];
        if (!dom) return ctx.reply(use('DNS', 'Type a domain and optional record type.', '.dns google.com MX'));
        const type = ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME', 'SOA'].includes((ctx.args[1] || '').toUpperCase()) ? ctx.args[1].toUpperCase() : 'A';
        const d = await get(`https://dns.google/resolve?name=${enc(dom)}&type=${type}`);
        if (!d.Answer || !d.Answer.length) return ctx.reply(nothing('DNS', `No ${type} records for ${dom}.`));
        await ctx.reply(card('DNS', `${dom} · ${type}`, d.Answer.slice(0, 10).map((a) => `${trunc(a.data, 90)}  (TTL ${a.TTL})`)));
    });
    const shortener = (name, label, build, aliases) => def(name, 'Tools', `.${name} [link] — shorten a link with ${label}`, aliases, async (ctx) => {
        const link = D.linkFrom(ctx.msg, ctx.q, /https?:\/\/\S+/i);
        if (!link) return ctx.reply(use(label, 'Send the long link.', `.${name} https://example.com/very/long/link`));
        const out = String(await get(build(link), { responseType: 'text', transformResponse: [(x) => x], headers: { 'User-Agent': API_UA } })).trim();
        if (!/^https?:\/\//.test(out)) return ctx.reply(card(label, 'failed', [trunc(out, 120)]));
        await ctx.reply(card(label, 'short link', [out]));
    });
    shortener('tinyurl', 'TinyURL', (l) => 'https://tinyurl.com/api-create.php?url=' + enc(l), ['tiny']);
    shortener('isgd', 'is.gd', (l) => 'https://is.gd/create.php?format=simple&url=' + enc(l), ['isgdshort']);
    def('wayback', 'Search', '.wayback [link] — oldest/closest saved copy of a page (Internet Archive)', ['archiveorg', 'oldsite'], async (ctx) => {
        const link = D.linkFrom(ctx.msg, ctx.q, /(?:https?:\/\/)?(?:[\w-]+\.)+[a-z]{2,}\S*/i);
        if (!link) return ctx.reply(use('Wayback', 'Send a link.', '.wayback https://example.com'));
        const d = await get('https://archive.org/wayback/available?url=' + enc(link));
        const s = d.archived_snapshots && d.archived_snapshots.closest;
        if (!s) return ctx.reply(nothing('Wayback', 'No saved copy of that page.'));
        const t = s.timestamp;
        await ctx.reply(card('Wayback', 'saved copy', [kv('page', trunc(link, 60)), kv('saved', `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`), kv('open', s.url)]));
    });
    def('metatags', 'Search', '.metatags [link] — title, description and preview image of a page', ['pageinfo', 'seo'], async (ctx) => {
        const link = D.linkFrom(ctx.msg, ctx.q, /https?:\/\/\S+/i);
        if (!link) return ctx.reply(use('Meta Tags', 'Send a web page link.', '.metatags https://example.com'));
        const html = await getHtml(link);
        const meta = (p) => { const r = new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]*content=["']([^"']*)["']`, 'i').exec(html); return r ? strip(r[1]) : ''; };
        const title = strip((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || '');
        await ctx.reply(card('Meta Tags', trunc(link.replace(/^https?:\/\//, ''), 26), [kv('title', trunc(meta('og:title') || title || '—', 90)), kv('description', trunc(meta('description') || meta('og:description') || '—', 160)), kv('image', meta('og:image') || '—'), kv('site', meta('og:site_name') || '—'), kv('generator', meta('generator') || '—')]));
    });
    def('hash', 'Tools', '.hash [md5|sha1|sha256|sha512] [text] — hash any text', ['checksum', 'sha256', 'md5'], async (ctx) => {
        let algo = null, text = ctx.q;
        if (['md5', 'sha1', 'sha256', 'sha512'].includes((ctx.args[0] || '').toLowerCase())) { algo = ctx.args[0].toLowerCase(); text = ctx.args.slice(1).join(' '); }
        if (!text.trim()) return ctx.reply(use('Hash', 'Type the text (optionally an algorithm first).', '.hash sha256 hello'));
        const h = (a) => nodeCrypto.createHash(a).update(text).digest('hex');
        await ctx.reply(card('Hash', algo || 'md5 · sha1 · sha256', (algo ? [algo] : ['md5', 'sha1', 'sha256']).map((a) => kv(a, h(a)))));
    });
    def('math', 'Tools', '.math [expression] — advanced maths, units & functions (mathjs)', ['mathjs', 'solve', 'evaluate'], async (ctx) => {
        if (!ctx.q.trim()) return ctx.reply(use('Math', 'Type an expression. Supports sqrt(), sin(), 5 km to miles, 12 degC to degF, det([[1,2],[3,4]]) …', '.math 12.7 kg to lbs'));
        const r = await get('https://api.mathjs.org/v4/?expr=' + enc(ctx.q.trim()), { responseType: 'text', transformResponse: [(x) => x] });
        await ctx.reply(card('Math', 'mathjs', [kv('expression', trunc(ctx.q, 60)), kv('result', trunc(String(r), 200))]));
    });
    def('color', 'Tools', '.color [#hex] — colour name, RGB/HSL values and a swatch (random if empty)', ['colour', 'hexcolor', 'swatch'], async (ctx) => {
        const hex = ((ctx.args[0] || '').replace('#', '').match(/^[0-9a-f]{6}$/i) || [nodeCrypto.randomBytes(3).toString('hex')])[0].toLowerCase();
        const d = await get('https://www.thecolorapi.com/id?hex=' + hex);
        const rows = [kv('name', d.name.value), kv('hex', d.hex.value), kv('rgb', d.rgb.value), kv('hsl', d.hsl.value), kv('cmyk', d.cmyk.value)];
        try { await img(ctx, `https://singlecolorimage.com/get/${hex}/400x400`, card('Colour', d.hex.value, rows)); } catch (e) { await ctx.reply(card('Colour', d.hex.value, rows)); }
    });

    // ----------------------------------------------------------------------
    console.log(`✅ Extra commands pack loaded: ${added.length} new commands`);
    return added;
};
