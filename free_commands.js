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
    const ln = (t) => '│ ' + t;
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
    const AI_IMG = [
        ['imgflux', 'high quality AI picture (flux)', '', 'flux', 1024, 1024],
        ['imganime', 'AI picture in anime style', 'anime style illustration, vibrant, detailed, ', 'flux', 1024, 1024],
        ['img3d', 'AI picture as a 3D render', '3D render, octane render, soft lighting, ', 'flux', 1024, 1024],
        ['imgpixel', 'AI picture as pixel art', 'pixel art, 16-bit retro game style, ', 'flux', 1024, 1024],
        ['imgcyber', 'AI picture in cyberpunk style', 'cyberpunk, neon city, futuristic, ', 'flux', 1024, 1024],
        ['imglogo', 'AI logo design', 'minimal vector logo design, clean, flat, white background, ', 'flux', 1024, 1024],
        ['imgportrait', 'AI portrait picture', 'studio portrait photo, sharp focus, soft light, ', 'flux', 768, 1024],
        ['imgreal', 'AI photo-realistic picture', 'ultra realistic photograph, 50mm lens, natural light, ', 'flux', 1024, 1024],
        ['imgposter', 'AI poster design', 'poster design, bold typography feel, striking composition, ', 'flux', 768, 1152],
        ['imgwall', 'AI phone wallpaper', 'phone wallpaper, vertical, aesthetic, high detail, ', 'flux', 1080, 1920],
        ['imgwide', 'AI wide picture (16:9)', '', 'flux', 1344, 768],
        ['imgsticker', 'AI sticker design', 'die-cut sticker design, thick white border, cute, vector, ', 'flux', 1024, 1024],
    ];
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
    const LANGS = [
        ['sinhala', 'si'], ['tamil', 'ta'], ['hindi', 'hi'], ['arabic', 'ar'], ['french', 'fr'],   
              
              
              
          ['english', 'en'],  
    ];
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
    const NB = [['handshake', 'a handshake'], ['lurk', 'lurking quietly'], ['peck', 'a quick peck'], ['punch', 'a punch'], ['shoot', 'a finger-gun shot']];
    for (const [name, what] of NB) {
        def(name, 'Anime', `.${name} — anime reaction gif: ${what}`, [], async (ctx) => {
            const d = await get('https://nekos.best/api/v2/' + name);
            const r = d && d.results && d.results[0];
            if (!r || !r.url) throw miss();
            await sendAnim(ctx, r.url, card(cap1(name), 'reaction', [kv('anime', r.anime_name || 'unknown')]) + credit());
        });
    }
    const WP = [['kill', 'a dramatic finish'], ['bully', 'a playful tease']];
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
    A('ghorg', 'Search', 'info about a GitHub organization', '.ghorg microsoft', ['githuborg'], (q) => GH + '/orgs/' + enc(q.split(/\s/)[0]), (d) => ({ img: d.avatar_url, rows: kvs([['org', d.login], ['name', d.name], ['about', d.description], ['repos', num(d.public_repos)], ['followers', num(d.followers)], ['location', d.location], ['site', d.blog], ['created', fmtDate(d.created_at)]]) }));
    A('ghrepos', 'Search', 'top repositories of a GitHub user', '.ghrepos torvalds', ['githubrepos', 'userrepos'], (q) => GH + '/users/' + enc(q.split(/\s/)[0]) + '/repos?sort=updated&per_page=30', (d) => { const a = (d || []).sort((x, y) => y.stargazers_count - x.stargazers_count).slice(0, 8); return a.length && numberList(a.map((r) => `*${r.name}* ⭐${num(r.stargazers_count)} — ${trunc(r.description || r.language || '', 60)}`), 8); });
    A('ghissues', 'Search', 'latest open issues of a repo', '.ghissues facebook/react', ['githubissues'], (q) => { const r = repoOf(q); return r && `${GH}/repos/${r[0]}/${r[1]}/issues?state=open&per_page=8`; }, (d) => { const a = (d || []).filter((i) => !i.pull_request); return a.length && numberList(a.map((i) => `#${i.number} ${trunc(i.title, 70)} (${ago(i.created_at)})`), 8); });
    A('ghpulls', 'Search', 'latest open pull requests of a repo', '.ghpulls facebook/react', ['githubpulls', 'ghprs'], (q) => { const r = repoOf(q); return r && `${GH}/repos/${r[0]}/${r[1]}/pulls?state=open&per_page=8`; }, (d) => (d || []).length && numberList(d.map((i) => `#${i.number} ${trunc(i.title, 70)} — ${i.user && i.user.login}`), 8));
    A('ghcommits', 'Search', 'latest commits of a repo', '.ghcommits torvalds/linux', ['githubcommits'], (q) => { const r = repoOf(q); return r && `${GH}/repos/${r[0]}/${r[1]}/commits?per_page=8`; }, (d) => (d || []).length && numberList(d.map((c) => `${trunc((c.commit.message || '').split('\n')[0], 70)} — ${(c.commit.author || {}).name} (${ago(c.commit.author.date)})`), 8));
    A('ghlangs', 'Search', 'language breakdown of a repo', '.ghlangs facebook/react', ['githublangs'], (q) => { const r = repoOf(q); return r && `${GH}/repos/${r[0]}/${r[1]}/languages`; }, (d) => { const t = Object.values(d || {}).reduce((a, b) => a + b, 0); return t && Object.entries(d).slice(0, 8).map(([k, v]) => kv(k, (v / t * 100).toFixed(1) + '%')); });
    A('ghcontrib', 'Search', 'top contributors of a repo', '.ghcontrib facebook/react', ['githubcontrib'], (q) => { const r = repoOf(q); return r && `${GH}/repos/${r[0]}/${r[1]}/contributors?per_page=8`; }, (d) => (d || []).length && numberList(d.map((c) => `${c.login} — ${num(c.contributions)} commits`), 8));
    A('ghtags', 'Search', 'latest tags of a repo', '.ghtags facebook/react', ['githubtags'], (q) => { const r = repoOf(q); return r && `${GH}/repos/${r[0]}/${r[1]}/tags?per_page=8`; }, (d) => (d || []).length && numberList(d.map((t) => t.name), 8));
    A('ghsearch', 'Search', 'search GitHub repositories', '.ghsearch whatsapp bot', ['githubsearch', 'reposearch'], (q) => `${GH}/search/repositories?q=${enc(q)}&sort=stars&per_page=8`, (d) => d && d.items && d.items.length && numberList(d.items.map((r) => `*${r.full_name}* ⭐${num(r.stargazers_count)} — ${trunc(r.description || '', 55)}`), 8));
    A('ghtopic', 'Search', 'top GitHub repos for a topic', '.ghtopic machine-learning', ['githubtopic'], (q) => `${GH}/search/repositories?q=topic:${enc(q.replace(/\s+/g, '-'))}&sort=stars&per_page=8`, (d) => d && d.items && d.items.length && numberList(d.items.map((r) => `*${r.full_name}* ⭐${num(r.stargazers_count)}`), 8));
    A('ghlicense', 'Search', 'what an open-source license allows', '.ghlicense mit', ['licenseinfo'], (q) => `${GH}/licenses/${enc(q.toLowerCase().replace(/\s+/g, '-'))}`, (d) => ({ rows: kvs([['license', d.name], ['id', d.spdx_id], ['description', d.description], ['permissions', (d.permissions || []).join(', ')], ['conditions', (d.conditions || []).join(', ')], ['limits', (d.limitations || []).join(', ')]]) }));
    A('ghgitignore', 'Tools', 'a .gitignore template (node, python, java ...)', '.ghgitignore node', ['gitignore'], (q) => `${GH}/gitignore/templates/${enc(cap1(q.trim()))}`, (d) => d && d.source && ({ rows: lines('```' + d.source.split('\n').slice(0, 40).join('\n') + '```') }));

    A('npmstats', 'Search', 'download counts of an npm package', '.npmstats express', ['npmdownloads'], (q) => 'https://api.npmjs.org/downloads/point/last-month/' + enc(q.trim()), (d) => d && d.downloads != null && kvs([['package', d.package], ['last month', num(d.downloads)], ['period', d.start + ' → ' + d.end]]));
    A('npmsearch', 'Search', 'search npm packages', '.npmsearch qr code', ['npms'], (q) => 'https://registry.npmjs.org/-/v1/search?size=8&text=' + enc(q), (d) => d && d.objects && d.objects.length && numberList(d.objects.map((o) => `*${o.package.name}* ${o.package.version} — ${trunc(o.package.description || '', 55)}`), 8));
    A('pypistats', 'Search', 'download counts of a PyPI package', '.pypistats requests', ['pipstats'], (q) => `https://pypistats.org/api/packages/${enc(q.trim().toLowerCase())}/recent`, (d) => d && d.data && kvs([['package', d.package], ['yesterday', num(d.data.last_day)], ['last week', num(d.data.last_week)], ['last month', num(d.data.last_month)]]));
    A('cratesearch', 'Search', 'search Rust crates', '.cratesearch serde', ['cratessearch'], (q) => 'https://crates.io/api/v1/crates?per_page=8&q=' + enc(q), (d) => d && d.crates && d.crates.length && numberList(d.crates.map((c) => `*${c.name}* ${c.max_version} — ⬇${num(c.downloads)}`), 8));
    A('gemsearch', 'Search', 'search Ruby gems', '.gemsearch rails', ['rubysearch'], (q) => 'https://rubygems.org/api/v1/search.json?query=' + enc(q), (d) => (d || []).length && numberList(d.slice(0, 8).map((g) => `*${g.name}* ${g.version} — ⬇${num(g.downloads)}`), 8));
    A('packagist', 'Search', 'search PHP packages (Composer)', '.packagist laravel', ['composersearch', 'phpsearch'], (q) => 'https://packagist.org/search.json?per_page=8&q=' + enc(q), (d) => d && d.results && d.results.length && numberList(d.results.map((p) => `*${p.name}* ⬇${num(p.downloads)} — ${trunc(p.description || '', 50)}`), 8));
    A('dockerhub', 'Search', 'search Docker Hub images', '.dockerhub nginx', ['dockersearch'], (q) => 'https://hub.docker.com/v2/search/repositories?page_size=8&query=' + enc(q), (d) => d && d.results && d.results.length && numberList(d.results.map((r) => `*${r.repo_name}* ⭐${num(r.star_count)} ⬇${num(r.pull_count)}`), 8));
    A('brewinfo', 'Search', 'Homebrew formula details', '.brewinfo wget', ['brew', 'homebrew'], (q) => `https://formulae.brew.sh/api/formula/${enc(q.trim())}.json`, (d) => ({ rows: kvs([['formula', d.name], ['about', d.desc], ['version', d.versions && d.versions.stable], ['license', d.license], ['site', d.homepage]]) }));
    A('sosearch', 'Search', 'top StackOverflow answers for a problem', '.sosearch javascript promise all', ['stacksearch', 'stackoverflow'], (q) => 'https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=votes&pagesize=6&site=stackoverflow&q=' + enc(q), (d) => d && d.items && d.items.length && numberList(d.items.map((i) => `${strip(i.title)} — ▲${i.score} 💬${i.answer_count}\n│    ${i.link}`), 6));
    A('sotag', 'Search', 'StackOverflow tag statistics', '.sotag python', ['stacktag'], (q) => `https://api.stackexchange.com/2.3/tags/${enc(q.trim().toLowerCase())}/info?site=stackoverflow`, (d) => { const t = d && d.items && d.items[0]; return t && kvs([['tag', t.name], ['questions', num(t.count)]]); });

    const hnItems = async (ids) => (await Promise.all(ids.slice(0, 8).map((id) => get(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).catch(() => null)))).filter(Boolean);
    for (const [name, kind, desc] of [['hnnew', 'new', 'newest'], ['hnbest', 'best', 'best'], ['hnask', 'ask', 'Ask HN'], ['hnshow', 'show', 'Show HN'], ['hnjobs', 'job', 'job']]) {
        def(name, 'Search', `.${name} — latest ${desc} stories from Hacker News`, [], async (ctx) => {
            const ids = await get(`https://hacker-news.firebaseio.com/v0/${kind}stories.json`);
            const items = await hnItems(ids || []);
            await deliver(ctx, cap1(name), { sub: 'hacker news', rows: numberList(items.map((i) => `${trunc(i.title, 80)}${i.score != null ? ' ▲' + i.score : ''}`), 8) });
        });
    }
    A('hnuser', 'Search', 'Hacker News user profile', '.hnuser pg', ['hackeruser'], (q) => `https://hacker-news.firebaseio.com/v0/user/${enc(q.trim())}.json`, (d) => d && d.id && kvs([['user', d.id], ['karma', num(d.karma)], ['joined', fmtDate(d.created * 1000)], ['about', strip(d.about || '')]]));
    A('lobsters', 'Search', 'hottest stories on Lobsters', '', ['lobste'], () => 'https://lobste.rs/hottest.json', (d) => (d || []).length && numberList(d.slice(0, 8).map((s) => `${trunc(s.title, 70)} ▲${s.score} 💬${s.comment_count}`), 8), { need: false });
    A('devtotag', 'Search', 'latest DEV articles for a tag', '.devtotag javascript', ['devtag'], (q) => `https://dev.to/api/articles?per_page=8&tag=${enc(q.trim().toLowerCase())}`, (d) => (d || []).length && numberList(d.map((a) => `${trunc(a.title, 70)} ❤${a.public_reactions_count}`), 8));

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
    W('uvindex', 'UV index forecast for a city', '.uvindex Colombo', ['uv'], 'forecast', 'daily=uv_index_max&forecast_days=5', (d) => dailyRows(d, 'uv_index_max', 'uv', ''));
    W('windnow', 'current wind speed, gusts and direction', '.windnow Galle', ['wind'], 'forecast', 'current=wind_speed_10m,wind_gusts_10m,wind_direction_10m', (d) => cur(d, [['wind', 'wind_speed_10m', ' km/h'], ['gusts', 'wind_gusts_10m', ' km/h'], ['direction', 'wind_direction_10m', '°']]));
    W('rainchance', 'chance and amount of rain for 5 days', '.rainchance Kandy', ['rainforecast'], 'forecast', 'daily=precipitation_probability_max,precipitation_sum&forecast_days=5', (d) => d.daily.time.map((t, i) => kv(t.slice(5), `${d.daily.precipitation_probability_max[i]}% · ${d.daily.precipitation_sum[i]} mm`)));
    W('hourlyweather', 'temperature and rain chance, next 12 hours', '.hourlyweather Jaffna', ['hourly'], 'forecast', 'hourly=temperature_2m,precipitation_probability&forecast_days=2', (d) => { const now = Date.now(); const out = []; for (let i = 0; i < d.hourly.time.length && out.length < 12; i++) { if (new Date(d.hourly.time[i] + 'Z').getTime() + (d.utc_offset_seconds || 0) * -1000 < now - 3600000) continue; out.push(kv(d.hourly.time[i].slice(11), `${d.hourly.temperature_2m[i]}°C · ${d.hourly.precipitation_probability[i]}% rain`)); } return out; });
    W('feelslike', 'what the temperature really feels like', '.feelslike Colombo', ['apparent'], 'forecast', 'current=temperature_2m,apparent_temperature,relative_humidity_2m', (d) => cur(d, [['actual', 'temperature_2m', '°C'], ['feels like', 'apparent_temperature', '°C'], ['humidity', 'relative_humidity_2m', '%']]));
    W('humidity', 'current humidity and dew point', '.humidity Colombo', ['humid'], 'forecast', 'current=relative_humidity_2m,dew_point_2m', (d) => cur(d, [['humidity', 'relative_humidity_2m', '%'], ['dew point', 'dew_point_2m', '°C']]));
    W('weektemps', 'high and low temperatures for 7 days', '.weektemps Colombo', ['temps7'], 'forecast', 'daily=temperature_2m_max,temperature_2m_min&forecast_days=7', (d) => d.daily.time.map((t, i) => kv(t.slice(5), `${d.daily.temperature_2m_min[i]}° – ${d.daily.temperature_2m_max[i]}°C`)));
    W('waves', 'sea wave height and period', '.waves Galle', ['seawaves', 'swell'], 'marine', 'current=wave_height,wave_period,wave_direction', (d) => cur(d, [['wave height', 'wave_height', ' m'], ['period', 'wave_period', ' s'], ['direction', 'wave_direction', '°']]));
    W('riverflow', 'river discharge forecast near a place', '.riverflow Kelaniya', ['flood'], 'flood', 'daily=river_discharge&forecast_days=5', (d) => dailyRows(d, 'river_discharge', 'flow', ' m³/s'));
    W('pollutants', 'air pollutants: PM2.5, PM10, ozone, NO2', '.pollutants Colombo', ['pm25'], 'air', 'current=pm2_5,pm10,ozone,nitrogen_dioxide,sulphur_dioxide,carbon_monoxide', (d) => cur(d, [['PM2.5', 'pm2_5', ' µg/m³'], ['PM10', 'pm10', ' µg/m³'], ['ozone', 'ozone', ' µg/m³'], ['NO2', 'nitrogen_dioxide', ' µg/m³'], ['SO2', 'sulphur_dioxide', ' µg/m³'], ['CO', 'carbon_monoxide', ' µg/m³']]));
    A('elevation', 'Search', 'height above sea level of a place', '.elevation Nuwara Eliya', ['altitude'], async (q) => { const g = await geo1(q); if (!g) return null; return { url: `https://api.open-meteo.com/v1/elevation?latitude=${g.latitude}&longitude=${g.longitude}`, g }; }, (d, q) => d && d.elevation && kvs([['place', q], ['elevation', d.elevation[0] + ' m'], ['feet', Math.round(d.elevation[0] * 3.28084) + ' ft']]));
    def('pastweather', 'Search', '.pastweather [city] | [yyyy-mm-dd] — what the weather was on a past day', ['historyweather'], async (ctx) => {
        const [c, dt] = input(ctx).split('|').map((x) => x.trim());
        if (!c || !/^\d{4}-\d{2}-\d{2}$/.test(dt || '')) return ctx.reply(use('Past weather', 'City, then a date.', '.pastweather Colombo | 2024-12-25'));
        const g = await geo1(c); if (!g) throw miss('That place was not found.');
        const d = await get(`https://archive-api.open-meteo.com/v1/archive?latitude=${g.latitude}&longitude=${g.longitude}&start_date=${dt}&end_date=${dt}&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max&timezone=auto`);
        const x = d.daily; if (!x || x.temperature_2m_max[0] == null) throw miss('No data for that day.');
        return deliver(ctx, 'Past weather', { sub: place(g), rows: kvs([['date', dt], ['high', x.temperature_2m_max[0] + '°C'], ['low', x.temperature_2m_min[0] + '°C'], ['rain', x.precipitation_sum[0] + ' mm'], ['top wind', x.wind_speed_10m_max[0] + ' km/h']]) });
    });
    A('daylength', 'Search', 'how long the day is in a city', '.daylength Colombo', ['dayhours'], async (q) => { const g = await geo1(q); return g && `https://api.sunrise-sunset.org/json?formatted=0&lat=${g.latitude}&lng=${g.longitude}`; }, (d, q) => { const r = d && d.results; if (!r || !r.day_length) return null; const s = +r.day_length; return kvs([['place', q], ['day length', Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm'], ['solar noon', new Date(r.solar_noon).toUTCString().slice(17, 22) + ' UTC']]); });
    A('geocode', 'Search', 'coordinates and details of a place name', '.geocode Sigiriya', ['coords', 'latlon'], (q) => ({ url: 'https://nominatim.openstreetmap.org/search?format=json&limit=3&q=' + enc(q) }), (d) => (d || []).length && d.map((x) => kv(x.type || 'place', trunc(x.display_name, 70) + ' → ' + (+x.lat).toFixed(4) + ', ' + (+x.lon).toFixed(4))));
    A('reversegeo', 'Search', 'what place is at a latitude, longitude', '.reversegeo 7.9570, 80.7603', ['revgeo', 'whereis'], (q) => { const n = nums(q); return n.length >= 2 && { url: `https://nominatim.openstreetmap.org/reverse?format=json&lat=${n[0]}&lon=${n[1]}` }; }, (d) => d && d.display_name && kvs([['place', d.display_name], ['type', d.type]]));
    def('citydistance', 'Search', '.citydistance [city A] | [city B] — straight-line distance between two places', ['distance2', 'howfar'], async (ctx) => {
        const parts = input(ctx).split(/\||\bto\b/i).map((x) => x.trim()).filter(Boolean);
        if (parts.length < 2) return ctx.reply(use('City distance', 'Two places separated by | or "to".', '.citydistance Colombo | Kandy'));
        const [a, b] = await Promise.all([geo1(parts[0]), geo1(parts[1])]); if (!a || !b) throw miss('One of the places was not found.');
        const R = 6371, rad = (x) => x * Math.PI / 180, dLat = rad(b.latitude - a.latitude), dLon = rad(b.longitude - a.longitude);
        const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
        const km = 2 * R * Math.asin(Math.sqrt(h));
        return deliver(ctx, 'City distance', { sub: 'straight line', rows: kvs([['from', place(a)], ['to', place(b)], ['distance', km.toFixed(1) + ' km'], ['miles', (km * 0.621371).toFixed(1) + ' mi'], ['flight', (km / 800 * 60 + 20).toFixed(0) + ' min approx']]) });
    });
    const phase = (date) => { const syn = 29.530588853; const ref = Date.UTC(2000, 0, 6, 18, 14); const age = (((date.getTime() - ref) / 86400000) % syn + syn) % syn; const names = ['New Moon 🌑', 'Waxing Crescent 🌒', 'First Quarter 🌓', 'Waxing Gibbous 🌔', 'Full Moon 🌕', 'Waning Gibbous 🌖', 'Last Quarter 🌗', 'Waning Crescent 🌘']; return { age, name: names[Math.floor((age / syn) * 8 + 0.5) % 8], lit: Math.round((1 - Math.cos(2 * Math.PI * age / syn)) / 2 * 100) }; };
    L('moonphase', 'Search', 'the moon phase today or on a date', '.moonphase 2026-12-25', ['moon'], (q) => { const d = q && /^\d{4}-\d{2}-\d{2}$/.test(q.trim()) ? new Date(q.trim() + 'T12:00:00Z') : new Date(); const p = phase(d); return kvs([['date', fmtDate(d)], ['phase', p.name], ['lit', p.lit + '%'], ['moon age', p.age.toFixed(1) + ' days']]); }, { need: false });
    L('windchill', 'Tools', 'wind chill from temperature (°C) and wind (km/h)', '.windchill 5 20', ['chill'], (q) => { const [t, v] = nums(q); if (v == null) return null; const w = 13.12 + 0.6215 * t - 11.37 * Math.pow(v, 0.16) + 0.3965 * t * Math.pow(v, 0.16); return kvs([['temperature', t + '°C'], ['wind', v + ' km/h'], ['feels like', w.toFixed(1) + '°C']]); });
    L('heatindex', 'Tools', 'heat index from temperature (°C) and humidity (%)', '.heatindex 33 70', ['hindex'], (q) => { const [c, h] = nums(q); if (h == null) return null; const t = c * 9 / 5 + 32; const hi = -42.379 + 2.04901523 * t + 10.14333127 * h - 0.22475541 * t * h - 0.00683783 * t * t - 0.05481717 * h * h + 0.00122874 * t * t * h + 0.00085282 * t * h * h - 0.00000199 * t * t * h * h; return kvs([['temperature', c + '°C'], ['humidity', h + '%'], ['feels like', ((hi - 32) * 5 / 9).toFixed(1) + '°C']]); });
    L('dewpoint', 'Tools', 'dew point from temperature (°C) and humidity (%)', '.dewpoint 30 75', ['dewp'], (q) => { const [t, h] = nums(q); if (h == null) return null; const a = 17.62, b = 243.12, g = Math.log(h / 100) + a * t / (b + t); return kvs([['temperature', t + '°C'], ['humidity', h + '%'], ['dew point', (b * g / (a - g)).toFixed(1) + '°C']]); });

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
    C('capitalof', 'the capital city', '.capitalof Japan', ['capitalcity'], (c) => kvs([['country', c.name.common], ['capital', (c.capital || []).join(', ')]]));
    C('currencyof', 'the currency used', '.currencyof Sri Lanka', ['moneyof'], (c) => Object.entries(c.currencies || {}).map(([k, v]) => kv(k, `${v.name} (${v.symbol || ''})`)));
    C('languagesof', 'the languages spoken', '.languagesof Switzerland', ['langof'], (c) => kvs([['country', c.name.common], ['languages', Object.values(c.languages || {}).join(', ')]]));
    C('callingcode', 'the phone calling code', '.callingcode Sri Lanka', ['phonecode', 'dialcode'], (c) => kvs([['country', c.name.common], ['dial code', c.idd && c.idd.root ? c.idd.root + ((c.idd.suffixes || []).length === 1 ? c.idd.suffixes[0] : '') : null]]));
    C('populationof', 'the population', '.populationof India', ['popof'], (c) => kvs([['country', c.name.common], ['population', num(c.population)], ['area', num(c.area) + ' km²'], ['density', (c.population / c.area).toFixed(1) + ' / km²']]));
    C('bordersof', 'the neighbouring countries', '.bordersof Germany', ['neighbours', 'neighbors'], (c) => kvs([['country', c.name.common], ['borders', (c.borders || []).join(', ') || 'none (island or no land border)']]));
    C('countrycodes', 'ISO country codes', '.countrycodes Brazil', ['isocode'], (c) => kvs([['country', c.name.common], ['alpha-2', c.cca2], ['alpha-3', c.cca3], ['numeric', c.ccn3], ['olympic', c.cioc]]));
    C('drivingside', 'which side people drive on', '.drivingside Japan', ['driveside'], (c) => kvs([['country', c.name.common], ['drives on the', c.car && c.car.side], ['plate sign', (c.car && c.car.signs || []).join(', ')]]));
    C('timezonesof', 'the time zones', '.timezonesof Russia', ['tzof'], (c) => kvs([['country', c.name.common], ['time zones', (c.timezones || []).join(', ')]]));
    C('continentof', 'the continent and region', '.continentof Egypt', ['regionof'], (c) => kvs([['country', c.name.common], ['continent', (c.continents || []).join(', ')], ['region', c.region], ['subregion', c.subregion], ['landlocked', c.landlocked ? 'yes' : 'no']]));
    A('regioncountries', 'Search', 'all countries in a region (africa, asia, europe, oceania, americas)', '.regioncountries oceania', ['regionlist'], (q) => 'https://restcountries.com/v3.1/region/' + enc(q.trim()) + '?fields=name,flag', (d) => (d || []).length && ({ rows: lines(d.map((c) => c.flag + ' ' + c.name.common).sort().join(', '), 12), sub: d.length + ' countries' }));
    A('langcountries', 'Search', 'countries that speak a language', '.langcountries portuguese', ['speakers'], (q) => 'https://restcountries.com/v3.1/lang/' + enc(q.trim()) + '?fields=name,flag', (d) => (d || []).length && ({ rows: lines(d.map((c) => c.flag + ' ' + c.name.common).sort().join(', '), 12), sub: d.length + ' countries' }));
    A('currcountries', 'Search', 'countries that use a currency (code or name)', '.currcountries euro', ['whouses'], (q) => 'https://restcountries.com/v3.1/currency/' + enc(q.trim()) + '?fields=name,flag', (d) => (d || []).length && ({ rows: lines(d.map((c) => c.flag + ' ' + c.name.common).sort().join(', '), 12), sub: d.length + ' countries' }));
    A('capitalcountry', 'Search', 'which country has this capital', '.capitalcountry Canberra', ['whichcountry'], (q) => 'https://restcountries.com/v3.1/capital/' + enc(q.trim()) + '?fields=name,flag,capital', (d) => (d || []).length && d.map((c) => kv(c.flag + ' ' + c.name.common, (c.capital || []).join(', '))));
    const ccOf = async (q) => { q = (q || '').trim(); if (!q) return { cc: 'LK', name: 'Sri Lanka' }; if (/^[a-z]{2}$/i.test(q)) return { cc: q.toUpperCase(), name: q.toUpperCase() }; const c = await country1(q); return { cc: c.cca2, name: c.name.common }; };
    for (const [name, usage, aliases] of [['nextholiday', 'the next public holidays of a country (default Sri Lanka)', ['upcomingholiday']], ['longweekends', 'long weekends this year for a country', ['longweekend']]]) {
        def(name, 'Tools', `.${name} [country] — ${usage}`, aliases, async (ctx) => {
            const { cc, name: cn } = await ccOf(input(ctx));
            const y = new Date().getFullYear();
            if (name === 'nextholiday') {
                const d = await get('https://date.nager.at/api/v3/NextPublicHolidays/' + cc);
                if (!d || !d.length) throw miss(); return deliver(ctx, 'Next holidays', { sub: cn, rows: numberList(d.slice(0, 6).map((h) => `${h.date} — ${h.localName === h.name ? h.name : h.name + ' (' + h.localName + ')'}`), 6) });
            }
            const d = await get(`https://date.nager.at/api/v3/LongWeekend/${y}/${cc}`);
            if (!d || !d.length) throw miss('No long weekends found.'); return deliver(ctx, 'Long weekends', { sub: cn + ' ' + y, rows: numberList(d.slice(0, 8).map((h) => `${h.startDate} → ${h.endDate} (${h.dayCount} days)`), 8) });
        });
    }
    const WB = [
        ['wbgdp', 'NY.GDP.MKTP.CD', 'GDP (US$)', ['gdp'], (v) => '$' + num(Math.round(v))], ['wbgdppc', 'NY.GDP.PCAP.CD', 'GDP per person (US$)', ['gdppercapita'], (v) => '$' + num(Math.round(v))],
        ['wbpop', 'SP.POP.TOTL', 'population', ['populationhistory'], (v) => num(v)], ['wblife', 'SP.DYN.LE00.IN', 'life expectancy (years)', ['lifeexpectancy'], (v) => v.toFixed(1)],
        ['wbinternet', 'IT.NET.USER.ZS', 'people using the internet (%)', ['internetusers'], (v) => v.toFixed(1) + '%'], ['wbunemp', 'SL.UEM.TOTL.ZS', 'unemployment (%)', ['unemployment'], (v) => v.toFixed(1) + '%'],
        ['wbinflation', 'FP.CPI.TOTL.ZG', 'inflation (%)', ['inflationrate'], (v) => v.toFixed(1) + '%'], ['wbco2', 'EN.ATM.CO2E.PC', 'CO₂ per person (tonnes)', ['co2percap'], (v) => v.toFixed(2)],
        ];
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
    A('numtrivia', 'Fun', 'a fact about a number', '.numtrivia 42', ['numberfact', 'numfact'], (q) => ({ url: 'http://numbersapi.com/' + enc(q.trim() || 'random') + '/trivia', text: true }), (d) => String(d), { need: false });
    A('nummath', 'Fun', 'a maths fact about a number', '.nummath 17', ['mathfact'], (q) => ({ url: 'http://numbersapi.com/' + enc(q.trim() || 'random') + '/math', text: true }), (d) => String(d), { need: false });
    A('numyear', 'Fun', 'a fact about a year', '.numyear 1969', ['yearfact'], (q) => ({ url: 'http://numbersapi.com/' + enc(q.trim() || 'random') + '/year', text: true }), (d) => String(d), { need: false });
    A('numdate', 'Fun', 'a fact about a day (month/day, e.g. 7/4)', '.numdate 12/25', ['datefact'], (q) => ({ url: 'http://numbersapi.com/' + (q.trim() || 'random') + '/date', text: true }), (d) => String(d), { need: false });

    const f4 = (x) => (Number.isInteger(x) ? String(x) : String(+x.toFixed(6)));
    // ======================================================================
    // 12. MONEY & FINANCE CALCULATORS  (local)
    // ======================================================================
    A('fxrates', 'Economy', 'live exchange rates for a base currency (default USD)', '.fxrates LKR', ['rates', 'exchangerates'], (q) => 'https://open.er-api.com/v6/latest/' + enc((q.trim() || 'USD').toUpperCase()), (d) => { if (!d || d.result !== 'success') return null; const w = ['USD', 'EUR', 'GBP', 'LKR', 'INR', 'JPY', 'AUD', 'CAD', 'AED', 'SAR', 'SGD', 'CNY'].filter((c) => c !== d.base_code); return { sub: '1 ' + d.base_code, rows: w.map((c) => kv(c, num(d.rates[c]))), note: '_' + d.time_last_update_utc.slice(0, 16) + '_' }; }, { need: false });
    A('fxhistory', 'Economy', 'a past exchange rate (from to date)', '.fxhistory USD LKR 2024-01-15', ['pastrate'], (q) => { const p = q.trim().split(/\s+/); return p.length >= 3 && `https://api.frankfurter.app/${enc(p[2])}?from=${enc(p[0].toUpperCase())}&to=${enc(p[1].toUpperCase())}`; }, (d) => d && d.rates && kvs([['date', d.date], ['base', d.base], ...Object.entries(d.rates).map(([k, v]) => [k, num(v)])]));
    A('fxtrend', 'Economy', 'exchange rate trend over 30 days (from to)', '.fxtrend USD EUR', ['ratetrend'], (q) => { const p = q.trim().toUpperCase().split(/\s+/); if (p.length < 2) return null; const e = new Date(), s = new Date(e.getTime() - 30 * 86400000); return `https://api.frankfurter.app/${fmtDate(s)}..${fmtDate(e)}?from=${p[0]}&to=${p[1]}`; }, (d, q) => { if (!d || !d.rates) return null; const days = Object.keys(d.rates); const cc = q.trim().toUpperCase().split(/\s+/)[1]; const v = days.map((k) => d.rates[k][cc]); const mn = Math.min(...v), mx = Math.max(...v); return kvs([['pair', d.base + ' → ' + cc], ['start', num(v[0])], ['latest', num(v[v.length - 1])], ['lowest', num(mn)], ['highest', num(mx)], ['change', f4((v[v.length - 1] - v[0]) / v[0] * 100) + '%']]); });
    // quick coin prices (Coinbase public spot API)
    const COINS = [['btc', 'Bitcoin'], ['eth', 'Ethereum'], ['usdt', 'Tether'], ['bnb', 'BNB'], ['sol', 'Solana'], ['xrp', 'XRP'], ['doge', 'Dogecoin'], ['ada', 'Cardano'], ['trx', 'TRON'], ['ton', 'Toncoin'], ['dot', 'Polkadot'], ['shib', 'Shiba Inu'], ['avax', 'Avalanche'], ['ltc', 'Litecoin'], ['link', 'Chainlink'], ['xlm', 'Stellar']];
    for (const [sym, nm] of COINS) {
        def(sym + 'price', 'Economy', `.${sym}price — live ${nm} price in USD, LKR and EUR`, [], async (ctx) => {
            const S = sym.toUpperCase();
            const [usd, fx] = await Promise.all([get(`https://api.coinbase.com/v2/prices/${S}-USD/spot`), get('https://open.er-api.com/v6/latest/USD').catch(() => null)]);
            const p = +usd.data.amount; const r = fx && fx.rates ? fx.rates : {};
            return deliver(ctx, nm, { sub: S + ' price', rows: kvs([['USD', '$' + num(p)], ['LKR', r.LKR ? 'Rs ' + num(+(p * r.LKR).toFixed(2)) : null], ['EUR', r.EUR ? '€' + num(+(p * r.EUR).toFixed(2)) : null]]) });
        });
    }
    A('cgtrending', 'Economy', 'trending coins on CoinGecko right now', '', ['trendingcoins'], () => 'https://api.coingecko.com/api/v3/search/trending', (d) => d && d.coins && numberList(d.coins.slice(0, 8).map((c) => `*${c.item.name}* (${c.item.symbol}) — rank #${c.item.market_cap_rank || '?'}`), 8), { need: false });
    A('cgglobal', 'Economy', 'whole crypto market summary', '', ['cryptomarket'], () => 'https://api.coingecko.com/api/v3/global', (d) => d && d.data && kvs([['coins', num(d.data.active_cryptocurrencies)], ['market cap', '$' + num(Math.round(d.data.total_market_cap.usd))], ['24h volume', '$' + num(Math.round(d.data.total_volume.usd))], ['BTC dominance', d.data.market_cap_percentage.btc.toFixed(1) + '%'], ['ETH dominance', d.data.market_cap_percentage.eth.toFixed(1) + '%'], ['24h change', d.data.market_cap_change_percentage_24h_usd.toFixed(2) + '%']]), { need: false });
    A('cgexchanges', 'Economy', 'biggest crypto exchanges', '', ['topexchanges'], () => 'https://api.coingecko.com/api/v3/exchanges?per_page=8', (d) => (d || []).length && numberList(d.map((e) => `*${e.name}* — trust ${e.trust_score}/10 (${e.country || 'n/a'})`), 8), { need: false });
    A('coinsearch', 'Economy', 'search a coin by name or symbol', '.coinsearch pepe', ['findcoin'], (q) => 'https://api.coingecko.com/api/v3/search?query=' + enc(q), (d) => d && d.coins && d.coins.length && numberList(d.coins.slice(0, 8).map((c) => `*${c.name}* (${c.symbol}) — rank #${c.market_cap_rank || '?'}`), 8));
    A('coininfo', 'Economy', 'price, change and market cap of any coin (CoinGecko id)', '.coininfo bitcoin', ['coindata'], (q) => `https://api.coingecko.com/api/v3/coins/${enc(q.trim().toLowerCase().replace(/\s+/g, '-'))}?localization=false&tickers=false&community_data=false&developer_data=false`, (d) => d && d.market_data && ({ img: d.image && d.image.small, rows: kvs([['coin', d.name + ' (' + d.symbol.toUpperCase() + ')'], ['price', '$' + num(d.market_data.current_price.usd)], ['24h', (d.market_data.price_change_percentage_24h || 0).toFixed(2) + '%'], ['7d', (d.market_data.price_change_percentage_7d || 0).toFixed(2) + '%'], ['market cap', '$' + num(d.market_data.market_cap.usd)], ['rank', '#' + d.market_cap_rank], ['all-time high', '$' + num(d.market_data.ath.usd)]]) }));

    const urlOf = (q) => { q = String(q).trim().split(/\s/)[0]; return /^https?:\/\//i.test(q) ? q : 'https://' + q; };
    // ======================================================================
    // 14. COLORS, QR CODES, BARCODES, CHARTS & AVATARS
    // ======================================================================
    const hexOf = (q) => { q = q.trim().replace(/^#/, ''); if (/^[0-9a-f]{3}$/i.test(q)) q = q.split('').map((c) => c + c).join(''); return /^[0-9a-f]{6}$/i.test(q) ? q.toLowerCase() : null; };
    A('colorname', 'Tools', 'the name of a colour from its HEX', '.colorname #ff8800', ['namecolor'], (q) => { const h = hexOf(q); return h && 'https://api.color.pizza/v1/?values=' + h; }, (d) => { const c = d && d.colors && d.colors[0]; return c && { img: `https://singlecolorimage.com/get/${c.hex.replace('#', '')}/400x200`, rows: kvs([['name', c.name], ['hex', c.requestedHex || c.hex], ['nearest', c.hex], ['rgb', c.rgb && `${c.rgb.r}, ${c.rgb.g}, ${c.rgb.b}`]]) }; });
    A('colorpalette', 'Tools', 'a matching 5-colour palette from one colour', '.colorpalette #ff8800', ['palette2', 'colorscheme'], (q) => { const h = hexOf(q); return h && `https://www.thecolorapi.com/scheme?hex=${h}&mode=analogic&count=5&format=json`; }, (d) => d && d.colors && ({ img: d.image && d.image.bare, rows: d.colors.map((c) => kv(c.name.value, c.hex.value)) }));
    A('colorharmony', 'Tools', 'complementary / triadic colours of a colour', '.colorharmony #3366ff', ['triad'], (q) => { const h = hexOf(q); return h && `https://www.thecolorapi.com/scheme?hex=${h}&mode=triad&count=3&format=json`; }, (d) => d && d.colors && d.colors.map((c) => kv(c.name.value, c.hex.value)));
    const QR = (data, extra) => `https://api.qrserver.com/v1/create-qr-code/?size=500x500&margin=10&data=${enc(data)}${extra || ''}`;
    const QRS = [
        ['qrwifi', 'a QR code that joins a Wi-Fi (name | password | WPA)', '.qrwifi MyWifi | secret123', (q) => { const p = q.split('|').map((x) => x.trim()); return p.length >= 2 ? `WIFI:T:${p[2] || 'WPA'};S:${p[0]};P:${p[1]};;` : null; }],
        ['qrurl', 'a QR code for a link', '.qrurl https://example.com', (q) => urlOf(q)],
        ['qrmail', 'a QR code that starts an email (address | subject | body)', '.qrmail me@x.com | Hi | Hello', (q) => { const p = q.split('|').map((x) => x.trim()); return `mailto:${p[0]}?subject=${enc(p[1] || '')}&body=${enc(p[2] || '')}`; }],
        ['qrsms', 'a QR code that starts an SMS (number | text)', '.qrsms 0771234567 | Hello', (q) => { const p = q.split('|').map((x) => x.trim()); return `SMSTO:${p[0]}:${p[1] || ''}`; }],
        ['qrcall', 'a QR code that dials a number', '.qrcall +94771234567', (q) => 'tel:' + q.replace(/\s/g, '')],
        ['qrgeo', 'a QR code that opens a map point (lat lon)', '.qrgeo 6.9271 79.8612', (q) => { const n = nums(q); return n.length >= 2 ? `geo:${n[0]},${n[1]}` : null; }],
        ['qrvcard', 'a QR contact card (name | phone | email)', '.qrvcard Kasun | +94771234567 | k@x.com', (q) => { const p = q.split('|').map((x) => x.trim()); return `BEGIN:VCARD\nVERSION:3.0\nFN:${p[0]}\nTEL:${p[1] || ''}\nEMAIL:${p[2] || ''}\nEND:VCARD`; }],
        ['qrwhatsapp', 'a QR code that opens a WhatsApp chat (number | message)', '.qrwhatsapp 94771234567 | Hi', (q) => { const p = q.split('|').map((x) => x.trim()); return `https://wa.me/${p[0].replace(/\D/g, '')}${p[1] ? '?text=' + enc(p[1]) : ''}`; }]
    ];
    for (const [name, desc, example, mk] of QRS) {
        def(name, 'Tools', `.${name} [data] — ${desc}`, [], async (ctx) => {
            const q = input(ctx); const data = q && mk(q);
            if (!data) return ctx.reply(use(cap1(name), desc + '.', example));
            await sendImg(ctx, QR(data), card(cap1(name), 'qr code', [kv('data', trunc(data.replace(/\n/g, ' '), 80))]) + credit());
        });
    }
    const BC = [['code39', 'a Code 39 barcode', 'code39', 'ABC-123'], ['ean13', 'an EAN-13 product barcode (12 digits)', 'ean13', '590123412345'], ['upca', 'a UPC-A barcode (11 digits)', 'upca', '01234567890'], ['datamatrix', 'a Data Matrix code', 'datamatrix', 'Hello'], ['pdf417', 'a PDF417 code', 'pdf417', 'Hello world'], ['azteccode', 'an Aztec code', 'azteccode', 'Hello'], ['code128', 'a Code 128 barcode', 'code128', 'NIMAH-2026']];
    for (const [name, desc, id, example] of BC) {
        def(name, 'Tools', `.${name} [text] — ${desc}`, [], async (ctx) => {
            const q = input(ctx); if (!q) return ctx.reply(use(cap1(name), desc + '.', `.${name} ${example}`));
            await sendImg(ctx, `https://bwip-js.metafloor.com/?bcid=${id}&text=${enc(q)}&scale=3&includetext`, card(cap1(name), 'barcode', [kv('data', trunc(q, 60))]) + credit());
        });
    }
    const QC = (cfg, w, h) => `https://quickchart.io/chart?bkg=white&w=${w || 700}&h=${h || 450}&c=${enc(JSON.stringify(cfg))}`;
    const chartData = (q) => { const p = q.split(/[,\n]+/).map((x) => x.trim()).filter(Boolean).map((x) => { const m = x.match(/^(.*?)[\s:=]+(-?[\d.]+)$/); return m ? [m[1].trim(), +m[2]] : null; }).filter(Boolean); return p.length >= 2 ? p : null; };
    for (const [name, type, desc] of [['piechart', 'pie', 'a pie chart'], ['donutchart', 'doughnut', 'a donut chart'], ['linechart', 'line', 'a line chart'], ['barchart', 'bar', 'a bar chart'], ['radarchart', 'radar', 'a radar chart'], ['polarchart', 'polarArea', 'a polar area chart']]) {
        def(name, 'Tools', `.${name} [label value, label value ...] — ${desc}`, [], async (ctx) => {
            const d = chartData(input(ctx)); if (!d) return ctx.reply(use(cap1(name), 'Send labels and numbers separated by commas.', `.${name} Mon 5, Tue 8, Wed 3`));
            const cfg = { type, data: { labels: d.map((x) => x[0]), datasets: [{ label: 'Values', data: d.map((x) => x[1]), fill: false, backgroundColor: ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac'] }] } };
            await sendImg(ctx, QC(cfg), card(cap1(name), 'chart', [kv('points', d.length)]) + credit());
        });
    }
    def('wordcloud', 'Tools', '.wordcloud [text] — a word cloud picture from text', ['cloudwords'], async (ctx) => {
        const q = input(ctx); if (q.length < 10) return ctx.reply(use('Word cloud', 'Send some text (or reply to a message).', '.wordcloud love peace joy peace love happy'));
        await sendImg(ctx, `https://quickchart.io/wordcloud?format=png&width=800&height=500&backgroundColor=white&text=${enc(q.slice(0, 1500))}`, card('Word cloud', 'picture', [kv('words', (q.match(/\S+/g) || []).length)]) + credit());
    });
    const AVS = ['avataaars', 'bottts', 'identicon', 'lorelei', 'pixel-art', 'thumbs'];
    for (const st of AVS) {
        const name = 'av' + st.replace(/-/g, '');
        def(name, 'Media', `.${name} [any text] — a unique ${st} style avatar for any name`, [], async (ctx) => {
            const q = input(ctx) || String(seed());
            await sendImg(ctx, `https://api.dicebear.com/9.x/${st}/png?size=512&seed=${enc(q)}`, card(cap1(name), 'avatar', [kv('seed', trunc(q, 40)), kv('style', st)]) + credit());
        });
    }
    def('uiavatar', 'Media', '.uiavatar [name] — a round letter avatar for a name', ['letteravatar'], async (ctx) => {
        const q = input(ctx); if (!q) return ctx.reply(use('Letter avatar', 'Send a name.', '.uiavatar Nimah Dev'));
        await sendImg(ctx, `https://ui-avatars.com/api/?name=${enc(q)}&size=512&background=random&rounded=true&bold=true&format=png`, card('Letter avatar', 'avatar', [kv('name', q)]) + credit());
    });
    A('fakeperson', 'Fun', 'a made-up person with photo, address and job', '', ['randomuser', 'fakeprofile'], () => 'https://randomuser.me/api/?nat=us,gb,au,ca', (d) => { const u = d && d.results && d.results[0]; return u && { img: u.picture.large, rows: kvs([['name', `${u.name.first} ${u.name.last}`], ['age', u.dob.age], ['email', u.email], ['phone', u.phone], ['city', `${u.location.city}, ${u.location.country}`], ['username', u.login.username]]) }; }, { need: false });
    A('agify', 'Fun', 'guess the age behind a first name', '.agify Nimal', ['guessage'], (q) => 'https://api.agify.io/?name=' + enc(q.trim().split(/\s/)[0]), (d) => d && d.age != null && kvs([['name', d.name], ['guessed age', d.age], ['based on', num(d.count) + ' people']]));
    A('genderize', 'Fun', 'guess the gender behind a first name', '.genderize Sandun', ['guessgender'], (q) => 'https://api.genderize.io/?name=' + enc(q.trim().split(/\s/)[0]), (d) => d && d.gender && kvs([['name', d.name], ['likely', d.gender], ['confidence', Math.round(d.probability * 100) + '%'], ['based on', num(d.count) + ' people']]));
    A('nationalize', 'Fun', 'guess the nationality behind a name', '.nationalize Silva', ['guessnation'], (q) => 'https://api.nationalize.io/?name=' + enc(q.trim().split(/\s/)[0]), (d) => d && d.country && d.country.length && d.country.slice(0, 5).map((c) => kv(c.country_id, Math.round(c.probability * 100) + '%')));
    A('dpaste', 'Tools', 'save text to a share link (dpaste)', '.dpaste some text to share', ['pastetext'], (q) => ({ url: 'https://dpaste.com/api/v2/', method: 'POST', data: new URLSearchParams({ content: q, syntax: 'text', expiry_days: '7' }).toString(), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }), (d) => d && kvs([['link', String(d).trim()], ['expires', 'in 7 days']]));
    A('vgd', 'Tools', 'shorten a link with v.gd', '.vgd https://example.com/long/link', ['shortvgd'], (q) => ({ url: 'https://v.gd/create.php?format=simple&url=' + enc(urlOf(q)), text: true }), (d) => d && /^https?:/.test(d) && kvs([['short link', String(d).trim()]]));

    // ======================================================================
    // 15. WORD TOOLS  (Datamuse — free, key-less)
    // ======================================================================
    const DM = [
        ['rhymenear', 'words that nearly rhyme', 'rel_nry', 'sound'], ['soundslike', 'words that sound like yours', 'sl', 'sound'], ['spelledlike', 'words spelled like yours', 'sp', 'spelling'],
        ['adjfor', 'adjectives often used with a noun', 'rel_jjb', 'describing'], ['nounfor', 'nouns often described by an adjective', 'rel_jja', 'described'], ['triggers', 'words statistically linked to a word', 'rel_trg', 'linked'],
        ['homophones', 'words that sound the same', 'rel_hom', 'sound-alike'], ['kindof', 'broader terms (a dog is a kind of ...)', 'rel_spc', 'broader'], ['typesof', 'narrower terms (kinds of ...)', 'rel_gen', 'narrower'],
        ['meanslike', 'words with a similar meaning to a phrase', 'ml', 'meaning'], ['partof', 'what a thing is part of', 'rel_par', 'whole'], ['partsof', 'what a thing is made of', 'rel_com', 'parts'],
        ];
    for (const [name, desc, key, sub] of DM) {
        A(name, 'Text', desc, `.${name} ocean`, [], (q) => `https://api.datamuse.com/words?max=15&${key}=${enc(q.trim())}`, (d) => (d || []).length && ({ sub, rows: lines(d.map((w) => w.word).join(', ')) }));
    }
    A('wordstarts', 'Text', 'words that start with letters (e.g. "pre")', '.wordstarts pre', ['startswith'], (q) => `https://api.datamuse.com/words?max=20&sp=${enc(q.trim().replace(/\*/g, ''))}*`, (d) => (d || []).length && lines(d.map((w) => w.word).join(', ')));
    A('wordends', 'Text', 'words that end with letters (e.g. "ing")', '.wordends tion', ['endswith'], (q) => `https://api.datamuse.com/words?max=20&sp=*${enc(q.trim().replace(/\*/g, ''))}`, (d) => (d || []).length && lines(d.map((w) => w.word).join(', ')));
    A('wiktdefine', 'Search', 'dictionary meaning from Wiktionary', '.wiktdefine serendipity', ['wiktionary'], (q) => `https://en.wiktionary.org/api/rest_v1/page/definition/${enc(q.trim().toLowerCase())}`, (d) => { const e = d && d.en; return e && e.length && e.slice(0, 3).map((x) => ln(`*${x.partOfSpeech}* — ${trunc(strip(((x.definitions || [])[0] || {}).definition || ''), 160)}`)); });

    // ======================================================================
    // 16. QUOTES, JOKES & FUN  (public joke / quote APIs + local)
    // ======================================================================
    for (const [name, cat, desc] of [['jokeprog', 'Programming', 'a programming joke'], ['jokepun', 'Pun', 'a pun'], ['jokemisc', 'Misc', 'a general joke'], ]) {
        A(name, 'Fun', desc, '', [], () => `https://v2.jokeapi.dev/joke/${cat}?safe-mode&blacklistFlags=nsfw,religious,political,racist,sexist,explicit`, (d) => d && !d.error && lines(d.type === 'twopart' ? `${d.setup}\n\n${d.delivery}` : d.joke), { need: false });
    }
    A('dadjokeq', 'Fun', 'search dad jokes about a topic', '.dadjokeq cat', ['dadsearch'], (q) => ({ url: 'https://icanhazdadjoke.com/search?limit=3&term=' + enc(q), headers: { 'Accept': 'application/json' } }), (d) => d && d.results && d.results.length && d.results.map((j) => ln('• ' + j.joke)));
    A('affirmation', 'Fun', 'a positive affirmation', '', ['affirm', 'positivity'], () => 'https://www.affirmations.dev/', (d) => d && d.affirmation, { need: false });
    A('lifeadvice2', 'Fun', 'advice on a topic', '.lifeadvice2 love', ['adviceabout'], (q) => 'https://api.adviceslip.com/advice/search/' + enc(q.trim()), (d) => d && d.slips && lines(rnd(d.slips).advice));
    A('insultme', 'Fun', 'a silly harmless insult (just for laughs)', '', ['sillyinsult'], () => 'https://evilinsult.com/generate_insult.php?lang=en&type=json', (d) => d && d.insult && lines(strip(d.insult)), { need: false });
    A('meowfact', 'Fun', 'a random cat fact', '', ['catfact2'], () => 'https://meowfacts.herokuapp.com/', (d) => d && d.data && lines(d.data[0]), { need: false });
    A('dquote', 'Fun', 'a random quote with author', '', ['quoteofday2'], () => 'https://dummyjson.com/quotes/random', (d) => d && d.quote && lines(`“${d.quote}”\n— ${d.author}`), { need: false });
    A('ronswanson', 'Fun', 'a Ron Swanson quote', '', ['swansonquote'], () => 'https://ron-swanson-quotes.herokuapp.com/v2/quotes', (d) => d && d[0] && lines('“' + d[0] + '” — Ron Swanson'), { need: false });
    A('thronesquote', 'Fun', 'a random Game of Thrones quote', '', ['gotquote'], () => 'https://api.gameofthronesquotes.xyz/v1/random', (d) => d && d.sentence && lines(`“${d.sentence}”\n— ${d.character && d.character.name}`), { need: false });
    A('wikifeatured', 'Search', 'today\'s featured Wikipedia article', '', ['featuredarticle'], () => { const d = new Date(); return `https://en.wikipedia.org/api/rest_v1/feed/featured/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`; }, (d) => d && d.tfa && ({ img: d.tfa.thumbnail && d.tfa.thumbnail.source, rows: kvs([['article', d.tfa.titles && d.tfa.titles.normalized], ['summary', trunc(d.tfa.extract, 380)], ['link', d.tfa.content_urls && d.tfa.content_urls.desktop.page]]) }), { need: false });
    A('wikidata', 'Search', 'look up anything on Wikidata', '.wikidata Sigiriya', ['wd2'], (q) => 'https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&limit=5&origin=*&search=' + enc(q), (d) => d && d.search && d.search.length && d.search.map((x) => kv(x.id, `${x.label}${x.description ? ' — ' + trunc(x.description, 60) : ''}`)));
    A('crossref', 'Search', 'search scholarly papers (Crossref)', '.crossref machine learning', ['papers'], (q) => 'https://api.crossref.org/works?rows=5&select=title,author,issued,DOI&query=' + enc(q), (d) => d && d.message && d.message.items.length && numberList(d.message.items.map((i) => `${trunc((i.title || [''])[0], 80)} (${(((i.issued || {})['date-parts'] || [[]])[0] || [])[0] || '?'}) doi:${i.DOI}`), 5));
    A('openalex', 'Search', 'search research works (OpenAlex)', '.openalex climate change', ['research'], (q) => 'https://api.openalex.org/works?per-page=6&search=' + enc(q), (d) => d && d.results && d.results.length && numberList(d.results.map((w) => `${trunc(w.title, 80)} (${w.publication_year}) ❝${w.cited_by_count}`), 6));
    A('pubmed', 'Search', 'search medical papers (PubMed)', '.pubmed vitamin d', ['medpapers'], (q) => 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=5&term=' + enc(q), async (d) => { const ids = d && d.esearchresult && d.esearchresult.idlist; if (!ids || !ids.length) return null; const s = await get('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=' + ids.join(',')); return numberList(ids.map((i) => { const x = s.result[i]; return `${trunc(x.title, 85)} (${(x.pubdate || '').slice(0, 4)})`; }), 5); });
    A('semscholar', 'Search', 'search papers (Semantic Scholar)', '.semscholar transformers', ['scholar'], (q) => 'https://api.semanticscholar.org/graph/v1/paper/search?limit=6&fields=title,year,citationCount&query=' + enc(q), (d) => d && d.data && d.data.length && numberList(d.data.map((p) => `${trunc(p.title, 80)} (${p.year || '?'}) ❝${p.citationCount}`), 6));
    A('nobelwinner', 'Search', 'Nobel prize winners by name', '.nobelwinner Marie Curie', ['nobel'], (q) => 'https://api.nobelprize.org/2.1/laureates?limit=3&name=' + enc(q), (d) => d && d.laureates && d.laureates.length && d.laureates.map((l) => kv((l.knownName || l.orgName || {}).en || 'laureate', ((l.nobelPrizes || [])[0] || {}).categoryFullName ? l.nobelPrizes[0].categoryFullName.en + ' ' + l.nobelPrizes[0].awardYear : '')));
    for (const [name, style, desc] of [['yodaspeak', 'yoda', 'Yoda'], ['piratespeak', 'pirate', 'a pirate'], ['shakespeare', 'shakespeare', 'Shakespeare'], ['oldenglish', 'oldenglish', 'Old English']]) {
        A(name, 'Fun', `say anything the way ${desc} would`, `.${name} I love my country`, [], (q) => `https://api.funtranslations.com/translate/${style}.json?text=${enc(q.slice(0, 300))}`, (d) => d && d.contents && lines(d.contents.translated));
    }
    // ---- local fun ----

    // ======================================================================
    // 17. SPACE & SCIENCE
    // ======================================================================
    const SX = 'https://api.spacexdata.com/v4';
    const spx = (l) => kvs([['mission', l.name], ['date', fmtDate(l.date_utc)], ['flight', '#' + l.flight_number], ['success', l.success == null ? 'pending' : l.success ? 'yes' : 'no'], ['details', trunc(l.details || '', 200)]]);
    A('spacexlatest', 'Search', 'the latest SpaceX launch', '', ['spxlatest'], () => SX + '/launches/latest', (d) => ({ img: d.links && d.links.patch && d.links.patch.small, rows: spx(d) }), { need: false });
    A('spacexnext', 'Search', 'the next SpaceX launch', '', ['spxnext'], () => SX + '/launches/next', (d) => ({ img: d.links && d.links.patch && d.links.patch.small, rows: spx(d) }), { need: false });
    A('spacexupcoming', 'Search', 'upcoming SpaceX launches', '', ['spxupcoming'], () => SX + '/launches/upcoming', (d) => (d || []).length && numberList(d.slice(0, 8).map((l) => `${fmtDate(l.date_utc)} — ${l.name}`), 8), { need: false });
    A('spacexpast', 'Search', 'recent past SpaceX launches', '', ['spxpast'], () => SX + '/launches/past', (d) => (d || []).length && numberList(d.slice(-8).reverse().map((l) => `${fmtDate(l.date_utc)} — ${l.name} ${l.success ? '✅' : l.success === false ? '❌' : ''}`), 8), { need: false });
    A('spacexrockets', 'Search', 'SpaceX rockets and their specs', '', ['spxrockets'], () => SX + '/rockets', (d) => (d || []).length && d.map((r) => kv(r.name, `${r.height.meters} m · ${num(r.mass.kg)} kg · ${r.success_rate_pct}% success`)), { need: false });
    A('roadster', 'Search', 'where Elon\'s Tesla Roadster in space is now', '', ['spxroadster'], () => SX + '/roadster', (d) => ({ img: (d.flickr_images || [])[0], rows: kvs([['speed', num(Math.round(d.speed_kph)) + ' km/h'], ['from Earth', num(Math.round(d.earth_distance_km)) + ' km'], ['from Mars', num(Math.round(d.mars_distance_km)) + ' km'], ['orbit period', Math.round(d.period_days) + ' days']]) }), { need: false });
    A('astronauts', 'Search', 'people in space right now', '', ['peopleinspace'], () => 'http://api.open-notify.org/astros.json', (d) => d && d.people && ({ sub: d.number + ' people', rows: d.people.map((p) => kv(p.craft, p.name)) }), { need: false });
    A('planetinfo', 'Search', 'facts about a planet or moon', '.planetinfo mars', ['planet'], (q) => 'https://api.le-systeme-solaire.net/rest/bodies/' + enc(q.trim().toLowerCase()), (d) => d && d.englishName && kvs([['name', d.englishName], ['type', d.bodyType], ['gravity', d.gravity + ' m/s²'], ['radius', num(d.meanRadius) + ' km'], ['day length', d.sideralRotation && (d.sideralRotation + ' h')], ['year length', d.sideralOrbit && (d.sideralOrbit + ' days')], ['moons', (d.moons || []).length], ['avg temp', d.avgTemp && (d.avgTemp - 273.15).toFixed(0) + '°C'], ['distance from sun', d.semimajorAxis && num(d.semimajorAxis) + ' km']]));
    A('naturalevents', 'Search', 'current natural events on Earth (NASA EONET)', '', ['eonet', 'wildfires'], () => 'https://eonet.gsfc.nasa.gov/api/v3/events?limit=8&status=open', (d) => d && d.events && numberList(d.events.map((e) => `${e.title} — ${e.categories[0].title}`), 8), { need: false });
    A('bigquakes', 'Search', 'significant earthquakes this week (USGS)', '', ['sigquakes'], () => 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_week.geojson', (d) => d && d.features && (d.features.length ? numberList(d.features.slice(0, 8).map((f) => `M${f.properties.mag} — ${f.properties.place} (${ago(f.properties.time)})`), 8) : lines('No significant earthquakes this week.')), { need: false });
    let PT = null;
    const periodic = async () => PT || (PT = (await get('https://raw.githubusercontent.com/Bowserinator/Periodic-Table-JSON/master/PeriodicTableJSON.json', { timeout: 30000 })).elements);
    // the periodic table is read from one cached file, so register it directly:
    def('element', 'Search', '.element [name | symbol | number] — chemical element facts', ['periodic', 'chemelement'], async (ctx) => {
        const q = input(ctx).toLowerCase(); if (!q) return ctx.reply(use('Element', 'Send an element name, symbol or number.', '.element gold'));
        const els = await periodic(); const e = els.find((x) => x.name.toLowerCase() === q || x.symbol.toLowerCase() === q || String(x.number) === q);
        if (!e) throw miss('No such element.');
        return deliver(ctx, 'Element', { sub: e.name, img: e.image && e.image.url, rows: kvs([['symbol', e.symbol], ['number', e.number], ['mass', e.atomic_mass && (+e.atomic_mass).toFixed(3)], ['category', e.category], ['phase', e.phase], ['group / period', e.xpos + ' / ' + e.ypos], ['melts', e.melt != null ? e.melt + ' K' : null], ['boils', e.boil != null ? e.boil + ' K' : null], ['density', e.density], ['discovered by', e.discovered_by], ['summary', trunc(e.summary, 220)]]) });
    });
    A('compound', 'Search', 'chemical compound formula and weight (PubChem)', '.compound aspirin', ['chemical', 'molecule'], (q) => `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${enc(q.trim())}/property/MolecularFormula,MolecularWeight,IUPACName,CanonicalSMILES/JSON`, (d) => { const p = d && d.PropertyTable && d.PropertyTable.Properties[0]; return p && { img: `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${p.CID}/PNG`, rows: kvs([['formula', p.MolecularFormula], ['weight', p.MolecularWeight + ' g/mol'], ['IUPAC name', trunc(p.IUPACName, 100)], ['SMILES', trunc(p.CanonicalSMILES || p.ConnectivitySMILES, 100)], ['PubChem id', p.CID]]) }; });
    A('fdadrug', 'Search', 'official drug label info (openFDA)', '.fdadrug ibuprofen', ['druglabel'], (q) => `https://api.fda.gov/drug/label.json?limit=1&search=openfda.generic_name:${enc('"' + q.trim() + '"')}`, (d) => { const r = d && d.results && d.results[0]; return r && kvs([['name', (r.openfda.brand_name || [])[0] || (r.openfda.generic_name || [])[0]], ['purpose', trunc((r.purpose || r.indications_and_usage || [''])[0], 200)], ['warnings', trunc((r.warnings || r.boxed_warning || [''])[0], 220)], ['manufacturer', (r.openfda.manufacturer_name || [])[0]]]); });
    A('foodbarcode', 'Search', 'product details from a barcode (Open Food Facts)', '.foodbarcode 737628064502', ['barcodefood'], (q) => `https://world.openfoodfacts.org/api/v2/product/${enc(q.replace(/\D/g, ''))}.json`, (d) => { const p = d && d.status === 1 && d.product; return p && { img: p.image_front_small_url, rows: kvs([['product', p.product_name], ['brand', p.brands], ['quantity', p.quantity], ['nutri-score', (p.nutriscore_grade || '').toUpperCase()], ['calories /100g', p.nutriments && p.nutriments['energy-kcal_100g']], ['sugar /100g', p.nutriments && p.nutriments.sugars_100g], ['ingredients', trunc(p.ingredients_text, 200)]]) }; });
    A('foodsearch', 'Search', 'search packaged foods (Open Food Facts)', '.foodsearch nutella', ['findfood'], (q) => 'https://world.openfoodfacts.org/cgi/search.pl?search_simple=1&action=process&json=1&page_size=6&search_terms=' + enc(q), (d) => d && d.products && d.products.length && numberList(d.products.map((p) => `${trunc(p.product_name || 'unknown', 45)} — ${p.brands || ''} ${p.nutriscore_grade ? '(' + p.nutriscore_grade.toUpperCase() + ')' : ''}`), 6));

    // ======================================================================
    // 18. MOVIES, TV, MUSIC, BOOKS & ANIME  (TVmaze, iTunes, Deezer, Jikan ...)
    // ======================================================================
    A('tvcast', 'Search', 'cast of a TV show', '.tvcast Breaking Bad', ['showcast'], (q) => `https://api.tvmaze.com/singlesearch/shows?embed=cast&q=${enc(q)}`, (d) => d && d._embedded && ({ img: d.image && d.image.medium, rows: [kv('show', d.name)].concat(numberList(d._embedded.cast.slice(0, 10).map((c) => `${c.person.name} as ${c.character.name}`), 10)) }));
    A('tvepisodes', 'Search', 'episode list of a TV show (first 12)', '.tvepisodes Dark', ['showepisodes'], (q) => `https://api.tvmaze.com/singlesearch/shows?embed=episodes&q=${enc(q)}`, (d) => d && d._embedded && ({ sub: d.name, rows: numberList(d._embedded.episodes.slice(0, 12).map((e) => `S${e.season}E${e.number} — ${trunc(e.name, 50)} (${e.airdate})`), 12) }));
    A('tvschedule', 'Search', 'TV shows airing today (US, or give a country code)', '.tvschedule GB', ['tvtoday'], (q) => `https://api.tvmaze.com/schedule?country=${enc((q.trim() || 'US').toUpperCase())}`, (d) => (d || []).length && numberList(d.slice(0, 10).map((e) => `${e.airtime || '--:--'} — ${e.show.name} ${e.season ? 'S' + e.season + 'E' + e.number : ''}`), 10), { need: false });
    const IT = (name, media, desc, example) => A(name, 'Search', desc, example, [], (q) => `https://itunes.apple.com/search?limit=6&media=${media}&term=${enc(q)}`, (d) => d && d.results && d.results.length && ({ img: (d.results[0].artworkUrl100 || '').replace('100x100', '600x600'), rows: numberList(d.results.map((r) => `${trunc(r.trackName || r.collectionName || r.artistName, 55)} — ${trunc(r.artistName || '', 30)}${r.trackPrice > 0 ? ' · $' + r.trackPrice : ''}`), 6) }));
    IT('itmovie', 'movie', 'search movies on iTunes', '.itmovie inception'); IT('itpodcast', 'podcast', 'search podcasts', '.itpodcast tech news'); IT('itapp', 'software', 'search iPhone apps', '.itapp notes'); IT('itebook', 'ebook', 'search eBooks on Apple Books', '.itebook dune'); A('mbartist', 'Search', 'artist details (MusicBrainz)', '.mbartist Coldplay', ['artistinfo'], (q) => 'https://musicbrainz.org/ws/2/artist?fmt=json&limit=3&query=' + enc(q), (d) => d && d.artists && d.artists.length && kvs([['artist', d.artists[0].name], ['type', d.artists[0].type], ['country', d.artists[0].country], ['from', d.artists[0]['life-span'] && d.artists[0]['life-span'].begin], ['tags', (d.artists[0].tags || []).slice(0, 5).map((t) => t.name).join(', ')]]));
    A('mbalbum', 'Search', 'find an album (MusicBrainz)', '.mbalbum Parachutes', ['albumsearch'], (q) => 'https://musicbrainz.org/ws/2/release-group?fmt=json&limit=5&query=' + enc(q), (d) => d && d['release-groups'] && d['release-groups'].length && numberList(d['release-groups'].map((r) => `${r.title} — ${((r['artist-credit'] || [])[0] || {}).name || ''} (${(r['first-release-date'] || '').slice(0, 4)})`), 5));
    A('dzchart', 'Search', 'Deezer top tracks right now', '', ['topsongs', 'musiccharts'], () => 'https://api.deezer.com/chart/0/tracks?limit=10', (d) => d && d.data && numberList(d.data.map((t) => `${t.title} — ${t.artist.name}`), 10), { need: false });
    A('dzartist', 'Search', 'Deezer artist: fans and top tracks', '.dzartist Adele', ['artisttop'], async (q) => { const s = await get('https://api.deezer.com/search/artist?limit=1&q=' + enc(q)); const a = s && s.data && s.data[0]; return a && { url: `https://api.deezer.com/artist/${a.id}/top?limit=5`, a }; }, async (d, q) => { const s = await get('https://api.deezer.com/search/artist?limit=1&q=' + enc(q)); const a = s.data[0]; return d && d.data && { img: a.picture_big, rows: [kv('artist', a.name), kv('fans', num(a.nb_fan))].concat(numberList(d.data.map((t) => t.title), 5)) }; });
    A('dzalbum', 'Search', 'Deezer album search with cover', '.dzalbum 21 Adele', ['albumcoverart'], (q) => 'https://api.deezer.com/search/album?limit=4&q=' + enc(q), (d) => d && d.data && d.data.length && ({ img: d.data[0].cover_big, rows: numberList(d.data.map((a) => `${a.title} — ${a.artist.name} (${a.nb_tracks} tracks)`), 4) }));
    A('olauthor', 'Search', 'author details and top works (Open Library)', '.olauthor Stephen King', ['authorinfo'], (q) => 'https://openlibrary.org/search/authors.json?limit=1&q=' + enc(q), (d) => { const a = d && d.docs && d.docs[0]; return a && kvs([['author', a.name], ['born', a.birth_date], ['top work', a.top_work], ['works', num(a.work_count)], ['rating', a.ratings_average && a.ratings_average.toFixed(2)]]); });
    A('olsubject', 'Search', 'popular books on a subject', '.olsubject space', ['booksabout'], (q) => `https://openlibrary.org/subjects/${enc(q.trim().toLowerCase().replace(/\s+/g, '_'))}.json?limit=8`, (d) => d && d.works && d.works.length && numberList(d.works.map((w) => `${w.title} — ${((w.authors || [])[0] || {}).name || ''}`), 8));
    A('gbooks', 'Search', 'search Google Books', '.gbooks atomic habits', ['booksearch'], (q) => 'https://www.googleapis.com/books/v1/volumes?maxResults=5&q=' + enc(q), (d) => d && d.items && d.items.length && ({ img: ((d.items[0].volumeInfo.imageLinks || {}).thumbnail || '').replace('http:', 'https:'), rows: numberList(d.items.map((b) => `${trunc(b.volumeInfo.title, 55)} — ${(b.volumeInfo.authors || []).join(', ')} (${(b.volumeInfo.publishedDate || '').slice(0, 4)})`), 5) }));
    const JK = 'https://api.jikan.moe/v4';
    const animeRow = (a) => `${a.title} ⭐${a.score || '?'} (${a.type || ''}${a.episodes ? ', ' + a.episodes + ' eps' : ''})`;
    A('topanime', 'Anime', 'top rated anime of all time', '', ['bestanime'], () => JK + '/top/anime?limit=10', (d) => d && d.data && numberList(d.data.map(animeRow), 10), { need: false });
    A('topmanga', 'Anime', 'top rated manga of all time', '', ['bestmanga'], () => JK + '/top/manga?limit=10', (d) => d && d.data && numberList(d.data.map((m) => `${m.title} ⭐${m.score || '?'}`), 10), { need: false });
    A('seasonnow', 'Anime', 'anime airing this season', '', ['airinganime'], () => JK + '/seasons/now?limit=10', (d) => d && d.data && numberList(d.data.map(animeRow), 10), { need: false });
    A('seasonnext', 'Anime', 'anime coming next season', '', ['upcominganime'], () => JK + '/seasons/upcoming?limit=10', (d) => d && d.data && numberList(d.data.map((a) => `${a.title} (${a.type || ''})`), 10), { need: false });
    A('animeschedule', 'Anime', 'anime airing on a weekday (monday ... sunday)', '.animeschedule friday', ['airingday'], (q) => `${JK}/schedules?limit=10&filter=${enc((q.trim() || DAYS[new Date().getDay()]).toLowerCase())}`, (d) => d && d.data && d.data.length && numberList(d.data.map((a) => `${a.title} — ${(a.broadcast && a.broadcast.time) || ''}`), 10), { need: false });
    A('randomanime', 'Anime', 'a random anime to watch', '', ['animeroll'], () => JK + '/random/anime', (d) => d && d.data && ({ img: d.data.images.jpg.large_image_url, rows: kvs([['title', d.data.title], ['score', d.data.score], ['episodes', d.data.episodes], ['year', d.data.year], ['genres', (d.data.genres || []).map((g) => g.name).join(', ')], ['story', trunc(d.data.synopsis, 260)]]) }), { need: false });
    A('randommanga', 'Anime', 'a random manga to read', '', ['mangaroll'], () => JK + '/random/manga', (d) => d && d.data && ({ img: d.data.images.jpg.large_image_url, rows: kvs([['title', d.data.title], ['score', d.data.score], ['chapters', d.data.chapters], ['genres', (d.data.genres || []).map((g) => g.name).join(', ')], ['story', trunc(d.data.synopsis, 260)]]) }), { need: false });
    A('animechars', 'Anime', 'search anime characters', '.animechars Gojo', ['charsearch'], (q) => `${JK}/characters?limit=5&order_by=favorites&sort=desc&q=${enc(q)}`, (d) => d && d.data && d.data.length && ({ img: d.data[0].images.jpg.image_url, rows: numberList(d.data.map((c) => `${c.name} ❤${num(c.favorites)}`), 5) }));
    A('animerec', 'Anime', 'anime recommendations similar to one you like', '.animerec Naruto', ['similaranime'], async (q) => { const s = await get(`${JK}/anime?limit=1&q=${enc(q)}`); const a = s && s.data && s.data[0]; return a && `${JK}/anime/${a.mal_id}/recommendations`; }, (d) => d && d.data && d.data.length && numberList(d.data.slice(0, 8).map((r) => r.entry.title), 8));
    A('kitsuanime', 'Anime', 'anime details from Kitsu', '.kitsuanime One Piece', ['kitsu'], (q) => 'https://kitsu.io/api/edge/anime?page[limit]=3&filter[text]=' + enc(q), (d) => { const a = d && d.data && d.data[0] && d.data[0].attributes; return a && { img: a.posterImage && a.posterImage.medium, rows: kvs([['title', a.canonicalTitle], ['rating', a.averageRating], ['episodes', a.episodeCount], ['status', a.status], ['aired', a.startDate], ['story', trunc(a.synopsis, 260)]]) }; });
    A('mdsearch', 'Anime', 'search MangaDex for manga', '.mdsearch Vagabond', ['mangadex'], (q) => 'https://api.mangadex.org/manga?limit=6&title=' + enc(q), (d) => d && d.data && d.data.length && numberList(d.data.map((m) => `${(m.attributes.title.en || Object.values(m.attributes.title)[0])} (${m.attributes.status}, ${m.attributes.year || '?'})`), 6));
    const TRIV = [['triviasci', 17, 'science & nature'], ['triviacomputers', 18, 'computers'], ['triviamath', 19, 'mathematics'], ['triviasports', 21, 'sports'], ['triviageo', 22, 'geography'], ['triviahistory', 23, 'history'], ['triviamovies', 11, 'film'], ['triviamusic', 12, 'music'], ['triviagames', 15, 'video games'], ['triviaanimals', 27, 'animals'], ['triviaanime', 31, 'anime & manga'], ];
    for (const [name, id, label] of TRIV) {
        A(name, 'Fun', `a ${label} trivia question`, '', [], () => `https://opentdb.com/api.php?amount=1&category=${id}&encode=url3986`, (d) => { const x = d && d.results && d.results[0]; if (!x) return null; const dec = (s) => decodeURIComponent(s); const opts = x.incorrect_answers.map(dec).concat(dec(x.correct_answer)).sort(() => Math.random() - 0.5); return kvs([['question', dec(x.question)], ['difficulty', x.difficulty], ['options', opts.join('  |  ')], ['answer', '||' + dec(x.correct_answer) + '||']]); }, { need: false, title: 'Trivia · ' + label });
    }

    // ======================================================================
    // 19. GAMES  (CheapShark, FreeToGame, GamerPower, Steam, Scryfall, YGOPro, Valorant ...)
    // ======================================================================
    A('gamedeals', 'Gaming', 'best PC game deals right now (CheapShark)', '', ['pcdeals', 'gamesale'], () => 'https://www.cheapshark.com/api/1.0/deals?pageSize=10&sortBy=Savings', (d) => (d || []).length && numberList(d.map((x) => `${trunc(x.title, 40)} — $${x.salePrice} (was $${x.normalPrice}, -${Math.round(+x.savings)}%)`), 10), { need: false });
    A('gameprice', 'Gaming', 'cheapest price of a PC game across stores', '.gameprice elden ring', ['cheapestgame'], (q) => 'https://www.cheapshark.com/api/1.0/games?limit=5&title=' + enc(q), (d) => d && d.length && ({ img: d[0].thumb, rows: numberList(d.map((g) => `${trunc(g.external, 45)} — from $${g.cheapest}`), 5) }));
    for (const [name, cat, label] of [['f2pshooter', 'shooter', 'shooter'], ['f2pmmorpg', 'mmorpg', 'MMORPG'], ['f2pbattleroyale', 'battle-royale', 'battle royale'], ]) {
        A(name, 'Gaming', `free-to-play ${label} games (FreeToGame)`, '', [], () => 'https://www.freetogame.com/api/games?category=' + cat, (d) => (d || []).length && ({ img: d[0].thumbnail, rows: numberList(rnd([d, d]).slice(0, 8).map((g) => `${g.title} — ${g.platform}`), 8) }), { need: false });
    }
    A('f2prandom', 'Gaming', 'a random free-to-play game to try', '', ['freegame'], () => 'https://www.freetogame.com/api/games', (d) => { const g = d && rnd(d); return g && { img: g.thumbnail, rows: kvs([['game', g.title], ['genre', g.genre], ['platform', g.platform], ['by', g.publisher], ['about', trunc(g.short_description, 180)], ['link', g.game_url]]) }; }, { need: false });
    for (const [name, plat, label] of [['giveaways', 'all', 'all platforms'], ['givepc', 'pc', 'PC'], ['givesteam', 'steam', 'Steam'], ]) {
        A(name, 'Gaming', `free game & loot giveaways for ${label} (GamerPower)`, '', [], () => 'https://www.gamerpower.com/api/giveaways?platform=' + plat, (d) => Array.isArray(d) && d.length && numberList(d.slice(0, 8).map((g) => `${trunc(g.title, 50)} — ${g.worth || ''} (${g.type})`), 8), { need: false });
    }
    A('steamgame', 'Gaming', 'Steam store page details of a game', '.steamgame cyberpunk', ['steaminfo'], async (q) => { const s = await get('https://store.steampowered.com/api/storesearch/?cc=us&l=en&term=' + enc(q)); const g = s && s.items && s.items[0]; return g && 'https://store.steampowered.com/api/appdetails?cc=us&l=en&appids=' + g.id; }, (d) => { const x = d && Object.values(d)[0]; const g = x && x.success && x.data; return g && { img: g.header_image, rows: kvs([['game', g.name], ['price', g.is_free ? 'free' : g.price_overview && g.price_overview.final_formatted], ['released', g.release_date && g.release_date.date], ['developer', (g.developers || []).join(', ')], ['genres', (g.genres || []).map((x2) => x2.description).join(', ')], ['metacritic', g.metacritic && g.metacritic.score], ['about', trunc(g.short_description, 180)]]) }; });
    A('steamplayers', 'Gaming', 'how many people are playing a Steam game now', '.steamplayers counter-strike', ['playingnow'], async (q) => { const s = await get('https://store.steampowered.com/api/storesearch/?cc=us&l=en&term=' + enc(q)); const g = s && s.items && s.items[0]; return g && { url: 'https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=' + g.id, name: g.name }; }, async (d, q) => { const s = await get('https://store.steampowered.com/api/storesearch/?cc=us&l=en&term=' + enc(q)); return d && d.response && kvs([['game', s.items[0].name], ['playing now', num(d.response.player_count)]]); });
    A('steamfeatured', 'Gaming', 'featured Steam games and deals', '', ['steamdeals'], () => 'https://store.steampowered.com/api/featured/?cc=us&l=en', (d) => d && d.featured_win && numberList(d.featured_win.slice(0, 8).map((g) => `${trunc(g.name, 40)} — $${(g.final_price / 100).toFixed(2)}${g.discount_percent ? ' (-' + g.discount_percent + '%)' : ''}`), 8), { need: false });
    const mtg = (c) => ({ img: c.image_uris && c.image_uris.normal || (c.card_faces && c.card_faces[0].image_uris && c.card_faces[0].image_uris.normal), rows: kvs([['card', c.name], ['type', c.type_line], ['cost', c.mana_cost], ['set', c.set_name], ['rarity', c.rarity], ['price', c.prices && c.prices.usd && '$' + c.prices.usd], ['text', trunc((c.oracle_text || '').replace(/\n/g, ' '), 200)]]) });
    A('mtgcard', 'Gaming', 'a Magic: The Gathering card by name', '.mtgcard black lotus', ['magiccard'], (q) => 'https://api.scryfall.com/cards/named?fuzzy=' + enc(q), mtg);
    A('mtgrandom', 'Gaming', 'a random Magic: The Gathering card', '', ['magicrandom'], () => 'https://api.scryfall.com/cards/random', mtg, { need: false });
    A('mtgsearch', 'Gaming', 'search Magic cards (scryfall syntax works)', '.mtgsearch t:dragon c:red', ['magicsearch'], (q) => 'https://api.scryfall.com/cards/search?order=edhrec&q=' + enc(q), (d) => d && d.data && d.data.length && ({ img: d.data[0].image_uris && d.data[0].image_uris.normal, rows: [kv('found', num(d.total_cards))].concat(numberList(d.data.slice(0, 8).map((c) => `${c.name} — ${c.type_line}`), 8)) }));
    A('ygocard', 'Gaming', 'a Yu-Gi-Oh card by name', '.ygocard dark magician', ['yugioh2'], (q) => 'https://db.ygoprodeck.com/api/v7/cardinfo.php?fname=' + enc(q), (d) => { const c = d && d.data && d.data[0]; return c && { img: c.card_images && c.card_images[0].image_url, rows: kvs([['card', c.name], ['type', c.type], ['attribute', c.attribute], ['level', c.level], ['atk / def', c.atk != null ? c.atk + ' / ' + (c.def != null ? c.def : '-') : null], ['text', trunc(c.desc, 220)]]) }; });
    A('ygorandom', 'Gaming', 'a random Yu-Gi-Oh card', '', ['yugiohroll'], () => 'https://db.ygoprodeck.com/api/v7/randomcard.php', (d) => { const c = d && (d.data ? d.data[0] : d); return c && c.name && { img: c.card_images && c.card_images[0].image_url, rows: kvs([['card', c.name], ['type', c.type], ['text', trunc(c.desc, 220)]]) }; }, { need: false });
    A('ptcg', 'Gaming', 'a Pokémon trading card by name', '.ptcg charizard', ['pokecard'], (q) => `https://api.pokemontcg.io/v2/cards?pageSize=3&q=name:${enc('"' + q.trim() + '"')}`, (d) => { const c = d && d.data && d.data[0]; return c && { img: c.images && c.images.large, rows: kvs([['card', c.name], ['set', c.set && c.set.name], ['rarity', c.rarity], ['hp', c.hp], ['types', (c.types || []).join(', ')], ['artist', c.artist]]) }; });
    const VAL = 'https://valorant-api.com/v1';
    A('valagents', 'Gaming', 'all Valorant agents by role', '', ['valorantagents'], () => VAL + '/agents?isPlayableCharacter=true', (d) => d && d.data && lines(Object.entries(d.data.reduce((o, a) => { (o[a.role.displayName] = o[a.role.displayName] || []).push(a.displayName); return o; }, {})).map(([r, n]) => `${r}: ${n.join(', ')}`).join('\n')), { need: false });
    A('valagent', 'Gaming', 'details of a Valorant agent', '.valagent jett', ['valorantagent'], (q) => VAL + '/agents?isPlayableCharacter=true', (d, q) => { const a = d && d.data && d.data.find((x) => x.displayName.toLowerCase() === q.trim().toLowerCase()); return a && { img: a.fullPortrait || a.displayIcon, rows: kvs([['agent', a.displayName], ['role', a.role.displayName], ['story', trunc(a.description, 200)], ...a.abilities.slice(0, 4).map((x) => [x.slot, x.displayName])]) }; });
    A('fnshop', 'Gaming', 'today\'s Fortnite item shop', '', ['fortniteshop'], () => 'https://fortnite-api.com/v2/shop', (d) => { const e = d && d.data && (d.data.entries || []); return e && e.length && numberList(e.slice(0, 10).map((x) => `${(x.brItems && x.brItems[0] && x.brItems[0].name) || x.devName} — ${x.finalPrice} V-Bucks`), 10); }, { need: false });
    A('fnitem', 'Gaming', 'search a Fortnite cosmetic', '.fnitem renegade raider', ['fortniteitem'], (q) => 'https://fortnite-api.com/v2/cosmetics/br/search?name=' + enc(q), (d) => d && d.data && ({ img: d.data.images && d.data.images.icon, rows: kvs([['item', d.data.name], ['type', d.data.type && d.data.type.displayValue], ['rarity', d.data.rarity && d.data.rarity.displayValue], ['season', d.data.introduction && d.data.introduction.text], ['about', trunc(d.data.description, 160)]]) }));
    A('genshinchar', 'Gaming', 'Genshin Impact character info', '.genshinchar diluc', ['genshin'], (q) => 'https://genshin.jmp.blue/characters/' + enc(q.trim().toLowerCase().replace(/\s+/g, '-')), (d) => d && d.name && kvs([['name', d.name], ['vision', d.vision], ['weapon', d.weapon], ['nation', d.nation], ['rarity', d.rarity + '★'], ['affiliation', d.affiliation], ['about', trunc(d.description, 200)]]));
    A('lolchamp', 'Gaming', 'League of Legends champion info', '.lolchamp ahri', ['champion', 'leaguechamp'], async (q) => { const v = await get('https://ddragon.leagueoflegends.com/api/versions.json'); const k = q.trim().replace(/[^a-z]/gi, ''); return { url: `https://ddragon.leagueoflegends.com/cdn/${v[0]}/data/en_US/champion.json`, ver: v[0] }; }, (d, q) => { const key = Object.keys(d.data).find((k) => k.toLowerCase() === q.trim().replace(/[^a-z]/gi, '').toLowerCase()); const c = key && d.data[key]; return c && { img: `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${key}_0.jpg`, rows: kvs([['champion', c.name + ', ' + c.title], ['roles', c.tags.join(', ')], ['attack', c.info.attack], ['defense', c.info.defense], ['magic', c.info.magic], ['difficulty', c.info.difficulty], ['lore', trunc(c.blurb, 200)]]) }; });
    A('dotaheroes', 'Gaming', 'Dota 2 heroes by attribute', '', ['dota2heroes'], () => 'https://api.opendota.com/api/heroes', (d) => (d || []).length && lines(Object.entries(d.reduce((o, h) => { (o[h.primary_attr] = o[h.primary_attr] || []).push(h.localized_name); return o; }, {})).map(([a, n]) => `${a.toUpperCase()}: ${n.join(', ')}`).join('\n')), { need: false });
    A('owheroes', 'Gaming', 'Overwatch heroes by role', '', ['overwatchheroes'], () => 'https://overfast-api.tokyo/heroes', (d) => (d || []).length && lines(Object.entries(d.reduce((o, h) => { (o[h.role] = o[h.role] || []).push(h.name); return o; }, {})).map(([r, n]) => `${r}: ${n.join(', ')}`).join('\n')), { need: false });
    A('mcuuid', 'Gaming', 'Minecraft player UUID and skin by name', '.mcuuid Notch', ['mcplayerid'], (q) => 'https://playerdb.co/api/player/minecraft/' + enc(q.trim()), (d) => d && d.data && d.data.player && ({ img: `https://crafatar.com/renders/body/${d.data.player.id}?overlay`, rows: kvs([['name', d.data.player.username], ['uuid', d.data.player.id]]) }));
    A('lichesstop', 'Gaming', 'top 10 Lichess players (blitz)', '', ['chesstop'], () => ({ url: 'https://lichess.org/api/player/top/10/blitz', headers: { 'Accept': 'application/vnd.lichess.v3+json' } }), (d) => d && d.users && numberList(d.users.map((u) => `${u.username} — ${u.perfs.blitz.rating}`), 10), { need: false });
    A('chesspuzzle', 'Gaming', 'today\'s Lichess daily puzzle', '', ['dailypuzzle'], () => 'https://lichess.org/api/puzzle/daily', (d) => d && d.puzzle && kvs([['puzzle', d.puzzle.id], ['rating', d.puzzle.rating], ['themes', (d.puzzle.themes || []).join(', ')], ['play at', 'https://lichess.org/training/' + d.puzzle.id]]), { need: false });
    const DND = 'https://www.dnd5eapi.co/api';
    A('dndspell', 'Gaming', 'D&D 5e spell details', '.dndspell fireball', ['spellinfo'], (q) => `${DND}/spells/${enc(q.trim().toLowerCase().replace(/\s+/g, '-'))}`, (d) => d && d.name && kvs([['spell', d.name], ['level', d.level], ['school', d.school && d.school.name], ['casting time', d.casting_time], ['range', d.range], ['duration', d.duration], ['effect', trunc((d.desc || []).join(' '), 260)]]));
    // PokeAPI extras
    const PK = 'https://pokeapi.co/api/v2';
    const pkn = (q) => enc(q.trim().toLowerCase().replace(/\s+/g, '-'));
    const eng = (arr, k) => ((arr || []).find((x) => x.language.name === 'en') || {})[k || 'effect'];
    A('pokeability', 'Gaming', 'what a Pokémon ability does', '.pokeability levitate', ['ability'], (q) => `${PK}/ability/${pkn(q)}`, (d) => kvs([['ability', d.name], ['effect', trunc(eng(d.effect_entries), 260)], ['generation', d.generation && d.generation.name]]));
    A('pokemove', 'Gaming', 'details of a Pokémon move', '.pokemove thunderbolt', ['move'], (q) => `${PK}/move/${pkn(q)}`, (d) => kvs([['move', d.name], ['type', d.type && d.type.name], ['power', d.power], ['accuracy', d.accuracy], ['pp', d.pp], ['class', d.damage_class && d.damage_class.name], ['effect', trunc((eng(d.effect_entries) || '').replace('$effect_chance', d.effect_chance), 200)]]));
    A('poketype', 'Gaming', 'type matchups of a Pokémon type', '.poketype fire', ['typechart'], (q) => `${PK}/type/${pkn(q)}`, (d) => { const n = (a) => (a || []).map((x) => x.name).join(', ') || '—'; const r = d.damage_relations; return kvs([['type', d.name], ['strong against', n(r.double_damage_to)], ['weak against', n(r.double_damage_from)], ['resists', n(r.half_damage_from)], ['no effect on', n(r.no_damage_to)], ['immune to', n(r.no_damage_from)]]); });
    A('pokeitem', 'Gaming', 'what a Pokémon item does', '.pokeitem master ball', ['pitem'], (q) => `${PK}/item/${pkn(q)}`, (d) => ({ img: d.sprites && d.sprites.default, rows: kvs([['item', d.name], ['cost', d.cost], ['category', d.category && d.category.name], ['effect', trunc(eng(d.effect_entries, 'short_effect'), 200)]]) }));
    A('pokespecies', 'Gaming', 'species details and dex entry', '.pokespecies eevee', ['dexentry'], (q) => `${PK}/pokemon-species/${pkn(q)}`, (d) => kvs([['pokémon', d.name], ['habitat', d.habitat && d.habitat.name], ['color', d.color && d.color.name], ['legendary', d.is_legendary ? 'yes' : 'no'], ['mythical', d.is_mythical ? 'yes' : 'no'], ['capture rate', d.capture_rate], ['entry', trunc((eng(d.flavor_text_entries, 'flavor_text') || '').replace(/[\n\f]/g, ' '), 220)]]));
    A('pokestats', 'Gaming', 'base stats of a Pokémon', '.pokestats pikachu', ['basestats'], (q) => `${PK}/pokemon/${pkn(q)}`, (d) => ({ img: d.sprites && d.sprites.other && d.sprites.other['official-artwork'] && d.sprites.other['official-artwork'].front_default, rows: [kv('pokémon', d.name + ' #' + d.id)].concat(d.stats.map((s) => kv(s.stat.name, s.base_stat))) }));
    A('pokeevolve', 'Gaming', 'evolution chain of a Pokémon', '.pokeevolve eevee', ['evolution'], async (q) => { const s = await get(`${PK}/pokemon-species/${pkn(q)}`); return s && s.evolution_chain && s.evolution_chain.url; }, (d) => { const out = []; const walk = (n, depth) => { out.push('•'.repeat(1) + ' '.repeat(depth * 2) + n.species.name + (n.evolution_details && n.evolution_details[0] && n.evolution_details[0].min_level ? ` (lvl ${n.evolution_details[0].min_level})` : '')); (n.evolves_to || []).forEach((c) => walk(c, depth + 1)); }; walk(d.chain, 0); return lines(out.join('\n')); });
    A('disneychar', 'Gaming', 'Disney character info', '.disneychar Mickey', ['disneyinfo'], (q) => 'https://api.disneyapi.dev/character?pageSize=3&name=' + enc(q), (d) => { const c = d && d.data && d.data[0]; return c && { img: c.imageUrl, rows: kvs([['character', c.name], ['films', (c.films || []).slice(0, 4).join(', ')], ['shows', (c.tvShows || []).slice(0, 4).join(', ')], ['games', (c.videoGames || []).slice(0, 3).join(', ')]]) }; });

    // ======================================================================
    // 20. FOOD & DRINK  (TheMealDB, TheCocktailDB)
    // ======================================================================
    const MEAL = 'https://www.themealdb.com/api/json/v1/1';
    const mealList = (d) => d && d.meals && d.meals.length && ({ img: d.meals[0].strMealThumb, rows: numberList(d.meals.slice(0, 10).map((m) => m.strMeal), 10) });
    A('mealingredient', 'Search', 'meals you can make with an ingredient', '.mealingredient chicken breast', ['cookwith'], (q) => `${MEAL}/filter.php?i=${enc(q.trim().replace(/\s+/g, '_'))}`, mealList);
    A('mealarea', 'Search', 'meals from a country\'s kitchen (indian, italian ...)', '.mealarea indian', ['cuisine'], (q) => `${MEAL}/filter.php?a=${enc(cap1(q.trim()))}`, mealList);
    A('mealcategory', 'Search', 'meals in a category (seafood, dessert, vegan ...)', '.mealcategory seafood', ['mealtype'], (q) => `${MEAL}/filter.php?c=${enc(cap1(q.trim()))}`, mealList);
    A('mealcategories', 'Search', 'all meal categories', '', ['mealtypes'], () => `${MEAL}/list.php?c=list`, (d) => d && d.meals && lines(d.meals.map((m) => m.strCategory).join(', ')), { need: false });
    A('mealareas', 'Search', 'all cuisines available', '', ['cuisines'], () => `${MEAL}/list.php?a=list`, (d) => d && d.meals && lines(d.meals.map((m) => m.strArea).join(', ')), { need: false });
    A('mealfull', 'Search', 'full recipe of a meal by name', '.mealfull arrabiata', ['fullrecipe'], (q) => `${MEAL}/search.php?s=${enc(q)}`, (d) => { const m = d && d.meals && d.meals[0]; if (!m) return null; const ing = []; for (let i = 1; i <= 20; i++) if (m['strIngredient' + i] && m['strIngredient' + i].trim()) ing.push(`${(m['strMeasure' + i] || '').trim()} ${m['strIngredient' + i]}`.trim()); return { img: m.strMealThumb, rows: [kv('meal', m.strMeal), kv('cuisine', m.strArea + ' · ' + m.strCategory), kv('ingredients', ing.join(', '))].concat(lines(trunc(m.strInstructions, 900))) }; });
    const CK = 'https://www.thecocktaildb.com/api/json/v1/1';
    const drinkList = (d) => d && d.drinks && d.drinks.length && ({ img: d.drinks[0].strDrinkThumb, rows: numberList(d.drinks.slice(0, 10).map((m) => m.strDrink), 10) });
    A('drinkingredient', 'Search', 'cocktails made with an ingredient', '.drinkingredient vodka', ['mixwith'], (q) => `${CK}/filter.php?i=${enc(q.trim())}`, drinkList);
    A('drinkcategory', 'Search', 'cocktails in a category (shot, cocktail, punch ...)', '.drinkcategory shot', ['drinktype'], (q) => `${CK}/filter.php?c=${enc(q.trim())}`, drinkList);
    A('drinkglass', 'Search', 'cocktails served in a glass type', '.drinkglass highball glass', ['glasstype'], (q) => `${CK}/filter.php?g=${enc(q.trim())}`, drinkList);
    A('drinknoalc', 'Search', 'non-alcoholic drinks and mocktails', '', ['mocktails'], () => `${CK}/filter.php?a=Non_Alcoholic`, (d) => drinkList(d), { need: false });
    A('drinkrandom', 'Search', 'a random cocktail with recipe', '', ['cocktailroll'], () => `${CK}/random.php`, (d) => { const m = d && d.drinks && d.drinks[0]; if (!m) return null; const ing = []; for (let i = 1; i <= 15; i++) if (m['strIngredient' + i]) ing.push(`${(m['strMeasure' + i] || '').trim()} ${m['strIngredient' + i]}`.trim()); return { img: m.strDrinkThumb, rows: [kv('drink', m.strDrink), kv('glass', m.strGlass), kv('ingredients', ing.join(', '))].concat(lines(trunc(m.strInstructions, 400))) }; }, { need: false });
    A('drinkingredientinfo', 'Search', 'details of a cocktail ingredient', '.drinkingredientinfo gin', ['ingredientinfo'], (q) => `${CK}/search.php?i=${enc(q.trim())}`, (d) => { const i = d && d.ingredients && d.ingredients[0]; return i && kvs([['ingredient', i.strIngredient], ['type', i.strType], ['alcoholic', i.strAlcohol], ['abv', i.strABV], ['about', trunc(i.strDescription, 300)]]); });

    // ======================================================================
    // 21. FAITH & WISDOM  (Aladhan, AlQuran Cloud, Bible API, Sefaria, Vedic Scriptures)
    // ======================================================================
    A('asmaulhusna', 'Islamic', 'the 99 names of Allah (or one by number)', '.asmaulhusna 1', ['99names'], (q) => 'https://api.aladhan.com/v1/asmaAlHusna' + (parseInt(q, 10) >= 1 && parseInt(q, 10) <= 99 ? '/' + parseInt(q, 10) : ''), (d) => { const a = d && d.data; if (!a) return null; if (a.length === 1) return kvs([['no.', a[0].number], ['name', a[0].name], ['transliteration', a[0].transliteration], ['meaning', a[0].en.meaning]]); return numberList(a.slice(0, 99).map((x) => `${x.transliteration} — ${x.en.meaning}`), 99).slice(0, 40); }, { need: false });
    A('qibla', 'Islamic', 'qibla direction from a city', '.qibla Colombo', ['qiblah'], async (q) => { const g = await geo1(q); return g && `https://api.aladhan.com/v1/qibla/${g.latitude}/${g.longitude}`; }, (d, q) => d && d.data && kvs([['place', q], ['qibla bearing', d.data.direction.toFixed(2) + '° from north (clockwise)']]));
    A('prayermonth', 'Islamic', 'prayer times for the whole month (city | country)', '.prayermonth Colombo | Sri Lanka', ['monthlyprayer'], (q) => { const p = q.split('|').map((x) => x.trim()); const n = new Date(); return `https://api.aladhan.com/v1/calendarByCity/${n.getFullYear()}/${n.getMonth() + 1}?city=${enc(p[0])}&country=${enc(p[1] || 'Sri Lanka')}&method=${process.env.PRAYER_METHOD || 3}`; }, (d) => d && d.data && lines(d.data.slice(0, 31).map((x) => `${x.date.gregorian.day}: Fajr ${x.timings.Fajr.slice(0, 5)} · Dhuhr ${x.timings.Dhuhr.slice(0, 5)} · Asr ${x.timings.Asr.slice(0, 5)} · Maghrib ${x.timings.Maghrib.slice(0, 5)} · Isha ${x.timings.Isha.slice(0, 5)}`).join('\n')));
    A('hijrimonth', 'Islamic', 'the current Hijri date and month', '', ['hijritoday'], () => { const n = new Date(); return `https://api.aladhan.com/v1/gToH/${String(n.getDate()).padStart(2, '0')}-${String(n.getMonth() + 1).padStart(2, '0')}-${n.getFullYear()}`; }, (d) => d && d.data && kvs([['hijri', `${d.data.hijri.day} ${d.data.hijri.month.en} ${d.data.hijri.year} AH`], ['arabic', d.data.hijri.month.ar], ['weekday', d.data.hijri.weekday.en]]), { need: false });
    A('hijri2greg', 'Islamic', 'convert a Hijri date to Gregorian (dd-mm-yyyy)', '.hijri2greg 01-09-1447', ['hijritogreg'], (q) => 'https://api.aladhan.com/v1/hToG/' + enc(q.trim()), (d) => d && d.data && kvs([['gregorian', `${d.data.gregorian.day} ${d.data.gregorian.month.en} ${d.data.gregorian.year}`], ['weekday', d.data.gregorian.weekday.en]]));
    A('greg2hijri', 'Islamic', 'convert a Gregorian date to Hijri (dd-mm-yyyy)', '.greg2hijri 25-12-2026', ['gregtohijri'], (q) => 'https://api.aladhan.com/v1/gToH/' + enc(q.trim()), (d) => d && d.data && kvs([['hijri', `${d.data.hijri.day} ${d.data.hijri.month.en} ${d.data.hijri.year} AH`], ['weekday', d.data.hijri.weekday.en]]));
    A('quranjuz', 'Islamic', 'the first verses of a juz (1-30)', '.quranjuz 30', ['juz'], (q) => `https://api.alquran.cloud/v1/juz/${parseInt(q, 10) || 1}/en.asad`, (d) => d && d.data && ({ sub: 'juz ' + d.data.number, rows: [kv('verses', d.data.ayahs.length)].concat(lines(d.data.ayahs.slice(0, 3).map((a) => `(${a.surah.englishName} ${a.numberInSurah}) ${trunc(a.text, 200)}`).join('\n'))) }));
    A('quranpage', 'Islamic', 'verses on a Mushaf page (1-604)', '.quranpage 1', ['mushafpage'], (q) => `https://api.alquran.cloud/v1/page/${parseInt(q, 10) || 1}/quran-uthmani`, (d) => d && d.data && ({ sub: 'page ' + d.data.number, rows: lines(d.data.ayahs.slice(0, 8).map((a) => `${a.text} ﴿${a.numberInSurah}﴾`).join('\n')) }));
    A('quransearch', 'Islamic', 'search the Quran translation for a word', '.quransearch patience', ['quranfind'], (q) => `https://api.alquran.cloud/v1/search/${enc(q.trim())}/all/en.asad`, (d) => d && d.data && d.data.matches && d.data.matches.length && ({ sub: d.data.count + ' matches', rows: numberList(d.data.matches.slice(0, 5).map((m) => `${m.surah.englishName} ${m.numberInSurah}: ${trunc(m.text, 150)}`), 5) }));
    A('quranrandom', 'Islamic', 'a random verse with translation', '', ['randomayah'], () => `https://api.alquran.cloud/v1/ayah/${rint(1, 6236)}/editions/quran-uthmani,en.asad`, (d) => d && d.data && d.data.length === 2 && ({ sub: d.data[0].surah.englishName + ' ' + d.data[0].numberInSurah, rows: lines(d.data[0].text + '\n\n' + d.data[1].text) }), { need: false });
    A('qurantrans', 'Islamic', 'a verse in another translation (surah:ayah edition) e.g. 2:255 en.sahih', '.qurantrans 2:255 en.sahih', ['ayahedition'], (q) => { const p = q.trim().split(/\s+/); return /^\d+:\d+$/.test(p[0]) && `https://api.alquran.cloud/v1/ayah/${p[0]}/${p[1] || 'en.sahih'}`; }, (d) => d && d.data && ({ sub: d.data.surah.englishName + ' ' + d.data.numberInSurah, rows: lines(d.data.text) }));
    A('hadithbukhari', 'Islamic', 'a hadith from Sahih al-Bukhari by number', '.hadithbukhari 1', ['bukhari'], (q) => `https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/eng-bukhari/${parseInt(q, 10) || rint(1, 7000)}.json`, (d) => d && d.hadiths && d.hadiths[0] && ({ sub: 'bukhari ' + d.hadiths[0].hadithnumber, rows: lines(trunc(d.hadiths[0].text, 900)) }), { need: false });
    A('hadithmuslim', 'Islamic', 'a hadith from Sahih Muslim by number', '.hadithmuslim 1', ['muslimhadith'], (q) => `https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/eng-muslim/${parseInt(q, 10) || rint(1, 3000)}.json`, (d) => d && d.hadiths && d.hadiths[0] && ({ sub: 'muslim ' + d.hadiths[0].hadithnumber, rows: lines(trunc(d.hadiths[0].text, 900)) }), { need: false });
    A('bibleverse', 'Islamic', 'a Bible verse by reference (KJV)', '.bibleverse John 3:16', ['bibleref'], (q) => 'https://bible-api.com/' + enc(q.trim()) + '?translation=kjv', (d) => d && d.text && ({ sub: d.reference, rows: lines(d.text.trim()) }));
    A('biblerandom', 'Islamic', 'a random Bible verse', '', ['randombible'], () => 'https://bible-api.com/data/web/random', (d) => d && d.random_verse && ({ sub: d.random_verse.book + ' ' + d.random_verse.chapter + ':' + d.random_verse.verse, rows: lines(d.random_verse.text.trim()) }), { need: false });

    console.log('free_commands: ' + added.length + ' commands added');
};
