'use strict';
// =========================================================================
// NIMAH MD — PRO STICKER STUDIO (v7.32)
//   .ttp   text -> sticker (auto-fit, Sinhala + English + emoji)
//   .attp  text -> animated colour-cycling sticker
//   .stext text -> sticker in a chosen style (neon, fire, gold, ice ...)
//   .vibe  reads the MOOD of the text (Sinhala / Singlish / English) and
//          builds a sticker whose colours + emoji match that mood
//   .stickerstyles  list of all styles
// Needs only @napi-rs/canvas (already a dependency) + sharp / ffmpeg (optional).
// =========================================================================
const path = require('path');

module.exports = function installProCommands(D) {
    const { commands, card, kv, sc, axios, runFfmpeg, tmpName, rmQuiet, fs } = D;
    // never overwrite a command (or alias) that already exists
    const reg = (name, def) => {
        if (commands[name]) { console.log('pro_commands: ".' + name + '" already exists, skipped'); return; }
        def.aliases = (def.aliases || []).filter((a) => !commands[a]);
        D.reg(name, def);
    };
    const botName = () => (D.getBotName ? D.getBotName() : 'NIMAH MD') || 'NIMAH MD';
    const ownerName = () => (D.getOwnerName ? D.getOwnerName() : 'Nimah Dev') || 'Nimah Dev';

    let canvasLib = null, sharpLib = null, fontReady = false;
    try { canvasLib = require('@napi-rs/canvas'); } catch (e) { /* reported when a command runs */ }
    try { sharpLib = require('sharp'); } catch (e) { /* reported when a command runs */ }
    if (canvasLib) {
        try {
            const fp = path.join(__dirname, 'public', 'fonts', 'NotoSansSinhala-Bold.ttf');
            if (fs.existsSync(fp)) { canvasLib.GlobalFonts.registerFromPath(fp, 'NimahSi'); fontReady = true; }
        } catch (e) { console.log('pro_commands: font not loaded:', e && e.message); }
    }
    const FONT = (px) => `bold ${px}px ${fontReady ? '"NimahSi", ' : ''}"Noto Sans", "DejaVu Sans", Arial, sans-serif`;

    // ------------------------------------------------------------------ emoji (Twemoji PNGs, cached)
    const emojiCache = new Map();
    const EMOJI_RE = /\p{Extended_Pictographic}|\p{Regional_Indicator}|[\u0023\u002A\u0030-\u0039]\uFE0F?\u20E3/u;
    const isEmoji = (g) => EMOJI_RE.test(g);
    const emojiCode = (g) => {
        let cps = Array.from(g).map((c) => c.codePointAt(0).toString(16));
        if (!g.includes('\u200D')) cps = cps.filter((c) => c !== 'fe0f');
        return cps.join('-');
    };
    async function emojiImage(g) {
        const code = emojiCode(g);
        if (emojiCache.has(code)) return emojiCache.get(code);
        let img = null;
        const urls = [
            `https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/72x72/${code}.png`,
            `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/${code}.png`
        ];
        for (const u of urls) {
            try {
                const r = await axios.get(u, { responseType: 'arraybuffer', timeout: 6000 });
                img = await canvasLib.loadImage(Buffer.from(r.data));
                break;
            } catch (e) { /* try the next mirror */ }
        }
        if (emojiCache.size > 400) emojiCache.clear();
        emojiCache.set(code, img);
        return img;
    }

    // ------------------------------------------------------------------ text layout
    const seg = (typeof Intl !== 'undefined' && Intl.Segmenter) ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
    const graphemes = (s) => (seg ? Array.from(seg.segment(s), (x) => x.segment) : Array.from(s));

    // lines -> [{ runs: [{ t, emoji, w }], w }]
    function layout(ctx, tokens, size, maxW) {
        const eW = size * 1.05;
        ctx.font = FONT(size);
        const lines = [];
        let cur = [], curW = 0, lastSpace = -1, midWord = false;
        const widthOf = (tk) => (tk.emoji ? eW : ctx.measureText(tk.t).width);
        const flush = () => { lines.push(cur); cur = []; curW = 0; lastSpace = -1; };
        for (const tk of tokens) {
            if (tk.t === '\n') { flush(); continue; }
            const w = widthOf(tk);
            if (curW + w > maxW && cur.length) {
                if (lastSpace > -1) {
                    const rest = cur.splice(lastSpace + 1);
                    cur.pop(); // drop the space itself
                    flush();
                    cur = rest; curW = rest.reduce((a, x) => a + widthOf(x), 0); lastSpace = -1;
                } else { midWord = true; flush(); }
            }
            if (tk.t === ' ' && !cur.length) continue;
            cur.push(tk); curW += w;
            if (tk.t === ' ') lastSpace = cur.length - 1;
        }
        if (cur.length) flush();
        // merge plain-text tokens into runs so Sinhala letters shape correctly
        const merged = lines.map((ln) => {
            const runs = [];
            for (const tk of ln) {
                const last = runs[runs.length - 1];
                if (!tk.emoji && last && !last.emoji) last.t += tk.t;
                else runs.push({ t: tk.t, emoji: !!tk.emoji, img: tk.img });
            }
            for (const r of runs) r.w = r.emoji ? eW : ctx.measureText(r.t).width;
            while (runs.length && !runs[runs.length - 1].emoji && !runs[runs.length - 1].t.trim()) runs.pop();
            return { runs, w: runs.reduce((a, r) => a + r.w, 0) };
        });
        merged.midWord = midWord;
        return merged;
    }

    function fitText(ctx, tokens, box) {
        // first pass: never cut a word in half; second pass: allow it
        for (const allowMid of [false, true]) {
            for (let size = 190; size >= 26; size -= 6) {
                const lines = layout(ctx, tokens, size, box);
                const lineH = size * 1.2;
                if (lines.midWord && !allowMid) continue;
                if (lines.length * lineH <= box && lines.every((l) => l.w <= box + 1)) return { size, lines, lineH };
            }
        }
        const size = 26;
        const lines = layout(ctx, tokens, size, box).slice(0, 14);
        return { size, lines, lineH: size * 1.2 };
    }

    // ------------------------------------------------------------------ styles
    // fill(ctx, b) -> fillStyle, b = {x0,y0,x1,y1} bounds of the text block
    const vgrad = (ctx, b, stops) => { const g = ctx.createLinearGradient(0, b.y0, 0, b.y1); stops.forEach(([o, c]) => g.addColorStop(o, c)); return g; };
    const hgrad = (ctx, b, stops) => { const g = ctx.createLinearGradient(b.x0, 0, b.x1, 0); stops.forEach(([o, c]) => g.addColorStop(o, c)); return g; };
    const STYLES = {
        pro:     { icon: '⚪', info: 'white with a bold black outline (classic)', fill: () => '#ffffff', stroke: '#111111', sw: 0.11 },
        neon:    { icon: '💡', info: 'glowing electric cyan', fill: () => '#eaffff', stroke: '#00e5ff', sw: 0.05, glow: '#00e5ff' },
        fire:    { icon: '🔥', info: 'yellow-to-red flame', fill: (c, b) => vgrad(c, b, [[0, '#fff27a'], [0.45, '#ff9d00'], [1, '#e8210c']]), stroke: '#3b0a00', sw: 0.09, glow: '#ff5a00' },
        gold:    { icon: '🥇', info: 'shiny gold', fill: (c, b) => vgrad(c, b, [[0, '#fff6c2'], [0.4, '#f5c518'], [0.7, '#b8860b'], [1, '#f5d76e']]), stroke: '#4a3300', sw: 0.08 },
        ice:     { icon: '🧊', info: 'frosty blue', fill: (c, b) => vgrad(c, b, [[0, '#ffffff'], [0.5, '#8fdcff'], [1, '#2b7cff']]), stroke: '#07325f', sw: 0.08, glow: '#6ad2ff' },
        candy:   { icon: '🍬', info: 'pink and purple', fill: (c, b) => vgrad(c, b, [[0, '#ffb3e6'], [1, '#c471ff']]), stroke: '#ffffff', sw: 0.09, glow: '#ff4fd8' },
        rainbow: { icon: '🌈', info: 'full rainbow', fill: (c, b) => hgrad(c, b, [[0, '#ff3b3b'], [0.2, '#ffa500'], [0.4, '#ffe600'], [0.6, '#2ee66b'], [0.8, '#2f8bff'], [1, '#b24bff']]), stroke: '#111111', sw: 0.09 },
        dark:    { icon: '🖤', info: 'black with a white outline', fill: () => '#111111', stroke: '#ffffff', sw: 0.1 },
        glitch:  { icon: '📺', info: 'red / cyan glitch split', fill: () => '#ffffff', stroke: '#000000', sw: 0.05, glitch: true },
        love:    { icon: '💖', info: 'soft rose with a pink glow', fill: (c, b) => vgrad(c, b, [[0, '#ffd1dc'], [1, '#ff4d88']]), stroke: '#ffffff', sw: 0.09, glow: '#ff2d75' }
    };
    const STYLE_ALIAS = { classic: 'pro', white: 'pro', default: 'pro', blue: 'ice', cold: 'ice', red: 'fire', hot: 'fire', yellow: 'gold', pink: 'candy', sweet: 'candy', color: 'rainbow', colour: 'rainbow', black: 'dark', heart: 'love', rose: 'love' };
    const styleOf = (n) => { n = String(n || '').toLowerCase(); return STYLES[n] ? n : (STYLE_ALIAS[n] || null); };

    async function prepare(text) {
        const tokens = [];
        for (const g of graphemes(String(text))) {
            if (g === '\n' || g === '\r\n' || g === '\r') { tokens.push({ t: '\n' }); continue; }
            if (isEmoji(g)) tokens.push({ t: g, emoji: true });
            else tokens.push({ t: /\s/.test(g) ? ' ' : g });
        }
        const seen = new Set();
        for (const tk of tokens) if (tk.emoji && !seen.has(tk.t)) { seen.add(tk.t); }
        const imgs = new Map();
        await Promise.all([...seen].map(async (g) => { imgs.set(g, await emojiImage(g)); }));
        // emoji that could not be downloaded are dropped (no empty boxes)
        return tokens.filter((tk) => !tk.emoji || imgs.get(tk.t)).map((tk) => (tk.emoji ? Object.assign(tk, { img: imgs.get(tk.t) }) : tk));
    }

    // draw one frame. override = { fill, stroke } for the animated version
    function drawFrame(tokens, styleName, override) {
        const S = 512, PAD = 28, BOX = S - PAD * 2;
        const st = STYLES[styleName] || STYLES.pro;
        const canvas = canvasLib.createCanvas(S, S);
        const ctx = canvas.getContext('2d');
        ctx.textBaseline = 'alphabetic';
        ctx.lineJoin = 'round'; ctx.miterLimit = 2;
        const { size, lines, lineH } = fitText(ctx, tokens, BOX);
        const blockH = lines.length * lineH;
        const top = (S - blockH) / 2;
        const b = { x0: PAD, x1: S - PAD, y0: top, y1: top + blockH };
        const fill = override && override.fill ? override.fill : st.fill(ctx, b);
        const strokeCol = override && override.stroke ? override.stroke : st.stroke;
        ctx.font = FONT(size);
        const emSize = size * 1.05;

        const paint = (dx, dy, mode, color) => {
            lines.forEach((ln, i) => {
                let x = (S - ln.w) / 2 + dx;
                const base = top + i * lineH + size * 0.92 + dy;
                for (const r of ln.runs) {
                    if (r.emoji) { if (mode === 'fill') ctx.drawImage(r.img, x, base - size * 0.86, emSize, emSize); }
                    else if (mode === 'stroke') ctx.strokeText(r.t, x, base);
                    else ctx.fillText(r.t, x, base);
                    x += r.w;
                }
            });
        };

        if (st.glitch && !override) {
            ctx.fillStyle = '#ff2a2a'; paint(-size * 0.035, 0, 'fill');
            ctx.fillStyle = '#00f0ff'; paint(size * 0.035, size * 0.01, 'fill');
        }
        if (st.glow) { ctx.save(); ctx.shadowColor = st.glow; ctx.shadowBlur = size * 0.35; ctx.fillStyle = st.glow; ctx.strokeStyle = st.glow; ctx.lineWidth = size * 0.06; paint(0, 0, 'stroke'); ctx.restore(); }
        ctx.lineWidth = Math.max(3, size * st.sw * 2);
        ctx.strokeStyle = strokeCol; paint(0, 0, 'stroke');
        ctx.fillStyle = fill; paint(0, 0, 'fill');
        return canvas;
    }

    // ------------------------------------------------------------------ WebP + EXIF (pack name shows in WhatsApp)
    function stickerExif(pack, author) {
        const json = Buffer.from(JSON.stringify({ 'sticker-pack-id': 'nimah-md-' + Date.now().toString(36), 'sticker-pack-name': pack, 'sticker-pack-publisher': author, emojis: ['✨'] }), 'utf8');
        const head = Buffer.from([0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00]);
        const exif = Buffer.concat([head, json]);
        exif.writeUInt32LE(json.length, 14);
        return exif;
    }
    function withExif(buf, exif) {
        try {
            if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return buf;
            let chunks = [], o = 12;
            while (o + 8 <= buf.length) {
                const id = buf.toString('ascii', o, o + 4), size = buf.readUInt32LE(o + 4);
                chunks.push({ id, data: Buffer.from(buf.subarray(o + 8, o + 8 + size)) });
                o += 8 + size + (size & 1);
            }
            let vp8x = chunks.find((c) => c.id === 'VP8X');
            if (!vp8x) {
                const im = chunks.find((c) => c.id === 'VP8 ' || c.id === 'VP8L');
                if (!im) return buf;
                let w, h;
                if (im.id === 'VP8 ') { w = im.data.readUInt16LE(6) & 0x3fff; h = im.data.readUInt16LE(8) & 0x3fff; }
                else { const bits = im.data.readUInt32LE(1); w = (bits & 0x3fff) + 1; h = ((bits >> 14) & 0x3fff) + 1; }
                const d = Buffer.alloc(10); d.writeUIntLE(w - 1, 4, 3); d.writeUIntLE(h - 1, 7, 3);
                vp8x = { id: 'VP8X', data: d }; chunks.unshift(vp8x);
            }
            vp8x.data[0] |= 0x08;
            chunks = chunks.filter((c) => c.id !== 'EXIF'); chunks.push({ id: 'EXIF', data: exif });
            const parts = [];
            for (const c of chunks) {
                const h = Buffer.alloc(8); h.write(c.id, 0, 4, 'ascii'); h.writeUInt32LE(c.data.length, 4);
                parts.push(h, c.data); if (c.data.length & 1) parts.push(Buffer.alloc(1));
            }
            const body = Buffer.concat(parts);
            const riff = Buffer.alloc(12); riff.write('RIFF', 0, 4, 'ascii'); riff.writeUInt32LE(body.length + 4, 4); riff.write('WEBP', 8, 4, 'ascii');
            return Buffer.concat([riff, body]);
        } catch (e) { return buf; }
    }
    const tag = (buf) => withExif(buf, stickerExif(botName(), ownerName()));

    async function staticSticker(text, styleName) {
        const tokens = await prepare(text);
        if (!tokens.length) throw Object.assign(new Error('empty'), { code: 'EMPTY' });
        const png = drawFrame(tokens, styleName).toBuffer('image/png');
        const webp = await sharpLib(png).resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 92 }).toBuffer();
        return tag(webp);
    }

    async function animatedSticker(text) {
        const tokens = await prepare(text);
        if (!tokens.length) throw Object.assign(new Error('empty'), { code: 'EMPTY' });
        const dir = tmpName('_attp');
        fs.mkdirSync(dir, { recursive: true });
        const out = tmpName('.webp');
        try {
            const N = 8;
            for (let i = 0; i < N; i++) {
                const hue = Math.round((i * 360) / N);
                const fill = `hsl(${hue}, 100%, 58%)`;
                const stroke = i % 2 ? '#101010' : '#ffffff';
                fs.writeFileSync(path.join(dir, `f${String(i).padStart(2, '0')}.png`), drawFrame(tokens, 'pro', { fill, stroke }).toBuffer('image/png'));
            }
            const r = await runFfmpeg(['-y', '-framerate', '6', '-i', path.join(dir, 'f%02d.png'), '-vcodec', 'libwebp', '-pix_fmt', 'yuva420p', '-lossless', '0', '-q:v', '50', '-loop', '0', '-preset', 'default', '-an', '-vsync', '0', '-s', '512:512', out], 60000);
            if (r.missing) throw Object.assign(new Error('no ffmpeg'), { code: 'NOFFMPEG' });
            if (!r.ok || !fs.existsSync(out)) throw new Error('ffmpeg failed: ' + String(r.err).slice(-200));
            return tag(fs.readFileSync(out));
        } finally {
            try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
            rmQuiet(out);
        }
    }

    // ------------------------------------------------------------------ VIBE (mood reader)
    const MOODS = {
        love:    { icon: '💖', label: 'Loving',     style: 'love',    words: ['love', 'luv', 'adare', 'adarei', 'adarey', 'ආදර', 'miss you', 'miss u', 'missing', 'baby', 'babe', 'sudu', 'සුදු', 'මගේ', 'pissu', 'හිතවත', 'kiss', 'heart', '❤', '💕', '😍', '🥰', '😘', 'මතක'] },
        happy:   { icon: '😄', label: 'Happy',      style: 'rainbow', words: ['happy', 'sathutui', 'සතුටු', 'lassanai', 'ලස්සන', 'super', 'supiri', 'සුපිරි', 'wow', 'yay', 'haha', 'hehe', 'lol', 'thanks', 'thank you', 'istuti', 'ස්තූති', 'congrat', 'win', '😂', '😄', '😊', '🎉', 'ජයවේවා'] },
        sad:     { icon: '😢', label: 'Sad',        style: 'ice',     words: ['sad', 'cry', 'crying', 'duka', 'dukai', 'දුක', 'අඬ', 'ada', 'alone', 'hurt', 'sorry', 'සමාවෙන්න', 'sorry', 'lonely', 'pain', 'broken', 'ekalai', 'තනි', '😢', '😭', '💔', '🥺'] },
        angry:   { icon: '😡', label: 'Angry',      style: 'fire',    words: ['angry', 'mad', 'hate', 'tharaha', 'තරහ', 'kopaya', 'කෝපය', 'shut up', 'stupid', 'idiot', 'hutta', 'පිස්සු', 'balanna', 'enough', '😡', '🤬', '😤', '👿'] },
        cool:    { icon: '😎', label: 'Cool / Hype', style: 'neon',   words: ['cool', 'king', 'queen', 'boss', 'rajaa', 'raja', 'රජා', 'lit', 'fire', 'goat', 'legend', 'pro', 'epic', 'swag', 'macho', 'machan', 'මචං', 'bro', '😎', '🔥', '💪', '👑'] },
        sleepy:  { icon: '😴', label: 'Sleepy',     style: 'dark',    words: ['good night', 'goodnight', 'gn', 'nida', 'නිදා', 'sleep', 'sleepy', 'night', 'සුබ රාත්‍රියක්', 'subha rathriyak', 'rathriyak', 'tired', 'yawn', '😴', '🌙', '💤'] },
        morning: { icon: '🌅', label: 'Good vibes', style: 'gold',    words: ['good morning', 'gm', 'morning', 'subha udesanak', 'සුබ උදෑසනක්', 'udesanak', 'sunrise', 'sunshine', 'blessed', 'සුභ', 'subha', 'ayubowan', 'ආයුබෝවන්', '🌅', '☀', '🌞'] }
    };
    function readMood(text) {
        const t = String(text).toLowerCase();
        let best = null, bestHits = 0, total = 0;
        for (const [key, m] of Object.entries(MOODS)) {
            let hits = 0;
            for (const w of m.words) { if (w && t.includes(w.toLowerCase())) hits += (w.length > 3 || /[\u0D80-\u0DFF]/.test(w)) ? 2 : 1; }
            total += hits;
            if (hits > bestHits) { best = key; bestHits = hits; }
        }
        if (!best) return { key: 'neutral', icon: '🙂', label: 'Neutral', style: 'pro', pct: 50 };
        const m = MOODS[best];
        const pct = Math.max(55, Math.min(99, Math.round((bestHits / Math.max(1, total)) * 70 + Math.min(bestHits, 6) * 5)));
        return { key: best, icon: m.icon, label: m.label, style: m.style, pct };
    }
    const bar = (pct) => { const f = Math.round(pct / 10); return '▰'.repeat(f) + '▱'.repeat(10 - f); };

    // ------------------------------------------------------------------ commands
    const textOf = (ctx) => String(ctx.q || (D.quotedTextOf ? D.quotedTextOf(ctx.msg) : '') || '').trim();
    const MAXLEN = 160;
    const usage = (cmd, ex) => card(cmd, 'how to use', [kv('type', `.${cmd} your text`), kv('or', 'reply to a message with .' + cmd), ex ? kv('example', ex) : null].filter(Boolean));
    const needLibs = () => (!canvasLib ? '@napi-rs/canvas' : (!sharpLib ? 'sharp' : null));
    const fail = (ctx, e, title) => {
        console.log('.' + title + ' failed:', e && e.message);
        if (e && e.code === 'NOFFMPEG') return ctx.reply('❌ Animated stickers need ffmpeg, which is not available on this server. Try .ttp instead.');
        if (e && e.code === 'EMPTY') return ctx.reply('❌ I could not read any text to draw.');
        return ctx.reply('❌ Could not make the sticker this time. Please try again.');
    };
    const send = (ctx, buf) => ctx.session.queueSend(ctx.from, { sticker: buf }, { quoted: ctx.msg });
    const guard = async (ctx, title, fn) => {
        const miss = needLibs();
        if (miss) return ctx.reply(`❌ Sticker studio needs "${miss}" which is not installed on this server.`);
        try { await fn(); } catch (e) { await fail(ctx, e, title); }
    };

    reg('ttp', { category: 'Sticker', desc: '.ttp [text] — Sinhala · English · emoji', aliases: ['texttosticker', 'tsticker', 'textsticker'], run: async (ctx) => {
        const text = textOf(ctx);
        if (!text) return ctx.reply(usage('ttp', '.ttp ආදරෙයි ❤️'));
        if (text.length > MAXLEN) return ctx.reply(`❌ Keep it under ${MAXLEN} characters.`);
        await guard(ctx, 'ttp', async () => { await send(ctx, await staticSticker(text, 'pro')); });
    } });

    reg('attp', { category: 'Sticker', desc: '.attp [text] — animated text sticker', aliases: ['animtext', 'atext'], run: async (ctx) => {
        const text = textOf(ctx);
        if (!text) return ctx.reply(usage('attp', '.attp NIMAH MD'));
        if (text.length > 80) return ctx.reply('❌ Keep animated stickers under 80 characters.');
        await guard(ctx, 'attp', async () => { await send(ctx, await animatedSticker(text)); });
    } });

    reg('stext', { category: 'Sticker', desc: '.stext [style] [text] — neon, fire, gold, ice', aliases: ['styledsticker', 'ss'], run: async (ctx) => {
        const args = ctx.args || [];
        let styleName = styleOf(args[0]);
        let text;
        if (styleName) text = args.slice(1).join(' ').trim() || (D.quotedTextOf ? D.quotedTextOf(ctx.msg) : '');
        else { styleName = Object.keys(STYLES)[Math.floor(Math.random() * Object.keys(STYLES).length)]; text = textOf(ctx); }
        text = String(text || '').trim();
        if (!text) return ctx.reply(usage('stext', '.stext fire Let\'s go!') + '\n\n▸ ' + Object.keys(STYLES).map((k) => STYLES[k].icon + ' ' + k).join('  '));
        if (text.length > MAXLEN) return ctx.reply(`❌ Keep it under ${MAXLEN} characters.`);
        await guard(ctx, 'stext', async () => { await send(ctx, await staticSticker(text, styleName)); });
    } });

    reg('stickerstyles', { category: 'Sticker', desc: '.stickerstyles — every text sticker style', aliases: ['sstyles', 'stylelist'], run: async (ctx) => {
        const rows = Object.keys(STYLES).map((k) => kv(STYLES[k].icon + ' ' + k, STYLES[k].info));
        await ctx.reply(card('Sticker styles', Object.keys(STYLES).length + ' styles', rows, `↳ .stext <style> your text\n↳ .vibe your text  ${sc('(picks the style for you)')}\n↳ .attp your text  ${sc('(animated)')}`));
    } });

    reg('vibe', { category: 'Sticker', desc: '.vibe [text] — mood to matching sticker', aliases: ['moodsticker', 'mood'], run: async (ctx) => {
        const text = textOf(ctx);
        if (!text) return ctx.reply(usage('vibe', '.vibe අද මට හරිම දුකයි'));
        if (text.length > MAXLEN) return ctx.reply(`❌ Keep it under ${MAXLEN} characters.`);
        await guard(ctx, 'vibe', async () => {
            const m = readMood(text);
            const withIcon = /\p{Extended_Pictographic}/u.test(text) ? text : `${text} ${m.icon}`;
            await send(ctx, await staticSticker(withIcon, m.style));
            await ctx.session.queueSend(ctx.from, { text: card('Vibe check', 'mood reader', [kv(m.icon + ' mood', m.label), kv('match', m.pct + '%'), kv('style', (STYLES[m.style] ? STYLES[m.style].icon + ' ' : '') + m.style), `┃ ${bar(m.pct)}`]) }, { quoted: ctx.msg });
        });
    } });

    console.log('pro_commands: sticker studio ready (' + (canvasLib ? 'canvas' : 'NO canvas') + ', ' + (sharpLib ? 'sharp' : 'NO sharp') + ', sinhala font ' + (fontReady ? 'yes' : 'no') + ')');
    return { renderStatic: staticSticker, renderAnimated: animatedSticker, readMood };
};
