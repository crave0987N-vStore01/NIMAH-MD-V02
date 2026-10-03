// =========================================================================
// NIMAH MD — Social media downloader
// Facebook / Instagram / TikTok / Twitter(X) / Pinterest through the
// api.chamindu.site tools API.
//
// The API response shape is not fixed, so nothing here depends on exact field
// names. Every media link inside the JSON is collected, probed with a tiny
// ranged request (to learn whether it is really a video / image / audio and
// how big it is) and the best one is chosen.
//
// Env overrides:  CHAMINDU_API_KEY, CHAMINDU_API_BASE, DL_MAX_MB (default 40),
//                 DL_DEBUG=1 (logs the raw API response keys)
// =========================================================================
const axios = require('axios');

const API_BASE = (process.env.CHAMINDU_API_BASE || 'https://api.chamindu.site/api/v1/tools').replace(/\/+$/, '');
const API_KEY = process.env.CHAMINDU_API_KEY || 'chama_api_6a6fc4886184923c23aa7da0e820819f';
const MAX_BYTES = (parseInt(process.env.DL_MAX_MB, 10) || 40) * 1024 * 1024;
const UA = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';

const PLATFORMS = {
    facebook:  { label: 'Facebook',  path: 'facebook',  multi: false, re: /(facebook\.com|fb\.watch|fb\.com)\//i },
    instagram: { label: 'Instagram', path: 'instagram', multi: true,  re: /instagram\.com\//i },
    tiktok:    { label: 'TikTok',    path: 'tiktok',    multi: false, re: /(tiktok\.com)\//i },
    twitter:   { label: 'Twitter / X', path: 'twitter', multi: false, re: /(twitter\.com|x\.com|t\.co)\//i },
    pinterest: { label: 'Pinterest', path: 'pinterest', multi: true,  re: /(pinterest\.[a-z.]+|pin\.it)\//i },
    pornhub:   { label: 'Pornhub',   path: 'adult/pornhub', multi: false, adult: true, re: /pornhub\.(com|org|net)\//i },
    xnxx:      { label: 'XNXX',      path: 'adult/xnxx',    multi: false, adult: true, re: /xnxx\.(com|tv|es)\//i }
};

function extractUrl(text) {
    const m = String(text || '').match(/https?:\/\/[^\s<>"']+/i);
    return m ? m[0].replace(/[)\]}.,;!?]+$/, '') : null;
}

// ---- walk the JSON and collect every http(s) string with its key path ----
function collect(node, pathStr, out) {
    if (typeof node === 'string') {
        if (/^https?:\/\//i.test(node.trim())) out.push({ url: node.trim(), path: pathStr });
    } else if (Array.isArray(node)) {
        node.forEach((v, i) => collect(v, `${pathStr}[${i}]`, out));
    } else if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) collect(v, pathStr ? `${pathStr}.${k}` : k, out);
    }
    return out;
}

function hintScore(path) {
    const k = path.toLowerCase();
    let s = 0;
    if (/thumb|cover|avatar|profile|icon|poster|preview|snapshot|logo/.test(k)) s -= 8;
    if (/watermark|(^|[._\[])wm|_wm|wmplay/.test(k)) s -= 5;
    if (/nowm|no_wm|nowatermark|no-watermark|without/.test(k)) s += 4;
    if (/orig|original|large|full|highest|best/.test(k)) s += 3;
    if (/hd|high|1080|720/.test(k)) s += 2;
    if (/(^|[._\[])sd|low|480|360|240/.test(k)) s -= 1;
    if (/video|play|download|media|src|url/.test(k)) s += 1;
    return s;
}

function guessKind(c) {
    const u = c.url.split('?')[0].toLowerCase();
    const k = c.path.toLowerCase();
    if (/\.(mp4|mov|m4v|webm|mkv)$/.test(u) || /video|mp4/.test(k)) return 'video';
    if (/\.(jpg|jpeg|png|webp|gif)$/.test(u) || /image|photo|img|pic|thumb|cover/.test(k)) return 'image';
    if (/\.(mp3|m4a|aac|ogg|opus)$/.test(u) || /audio|music|mp3/.test(k)) return 'audio';
    return 'unknown';
}

async function probe(url) {
    try {
        const r = await axios.get(url, {
            responseType: 'stream', timeout: 15000, maxRedirects: 5,
            headers: { Range: 'bytes=0-0', 'User-Agent': UA },
            validateStatus: (s) => s < 400
        });
        const ct = String(r.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
        let size = Number(String(r.headers['content-range'] || '').split('/')[1]) || Number(r.headers['content-length']) || 0;
        if (size <= 1) size = 0;
        r.data.destroy();
        return { ok: true, ct, size };
    } catch (e) {
        return { ok: false, ct: '', size: 0 };
    }
}

function classify(c, p) {
    if (p.ok) {
        if (p.ct.startsWith('video/')) return 'video';
        if (p.ct.startsWith('image/')) return 'image';
        if (p.ct.startsWith('audio/')) return 'audio';
        if (/html|json|text|xml/.test(p.ct)) return 'none';       // a web page, not a file
        return guessKind(c);                                       // octet-stream etc.
    }
    return guessKind(c);                                           // probe blocked: trust the name
}

// One "item" = one post / one carousel slide. Pick its best downloadable file.
async function bestForItem(item) {
    const seen = new Set();
    const cands = collect(item, '', []).filter((c) => (seen.has(c.url) ? false : (seen.add(c.url), true))).slice(0, 12);
    if (!cands.length) return null;
    const probes = await Promise.all(cands.map((c) => probe(c.url)));
    const rows = cands.map((c, i) => {
        const kind = classify(c, probes[i]);
        return { ...c, kind, size: probes[i].size, ct: probes[i].ct, score: hintScore(c.path) };
    }).filter((r) => r.kind !== 'none' && r.kind !== 'unknown');
    if (!rows.length) return null;

    const usable = rows.filter((r) => !r.size || r.size <= MAX_BYTES);
    if (!usable.length) throw new Error(`File is larger than the ${Math.round(MAX_BYTES / 1048576)}MB limit.`);
    const pool = usable;
    const byQuality = (a, b) => (b.score - a.score) || (b.size - a.size);
    const good = (r) => r.score > -5;                               // not a thumbnail / avatar
    for (const kind of ['video', 'image', 'audio']) {
        const list = pool.filter((r) => r.kind === kind && good(r)).sort(byQuality);
        if (list.length) return list[0];
    }
    // only thumbnails exist: better than nothing for image posts
    const any = pool.filter((r) => r.kind === 'image').sort(byQuality);
    return any[0] || null;
}

// Longest array (>= 2 objects) whose objects each carry a link: a carousel.
function findItemArray(node) {
    let best = null;
    (function walk(n) {
        if (Array.isArray(n)) {
            const objs = n.filter((x) => x && typeof x === 'object');
            if (objs.length >= 2 && objs.every((o) => collect(o, '', []).length)) {
                if (!best || objs.length > best.length) best = objs;
            }
            n.forEach(walk);
        } else if (n && typeof n === 'object') {
            Object.values(n).forEach(walk);
        }
    })(node);
    return best;
}

function firstText(node, re) {
    let found = null;
    (function walk(n, key) {
        if (found) return;
        if (typeof n === 'string') {
            if (re.test(key || '') && !/^https?:\/\//i.test(n) && n.trim().length > 0 && n.length < 600) found = n.trim();
        } else if (Array.isArray(n)) n.forEach((v) => walk(v, key));
        else if (n && typeof n === 'object') for (const [k, v] of Object.entries(n)) walk(v, k);
    })(node, '');
    return found;
}

async function callApi(platform, url) {
    const p = PLATFORMS[platform];
    const res = await axios.get(`${API_BASE}/${p.path}/download`, {
        params: { url, api_key: API_KEY },
        timeout: 60000,
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        validateStatus: () => true
    });
    const body = res.data;
    if (process.env.DL_DEBUG) console.log(`[dl:${platform}] HTTP ${res.status}`, JSON.stringify(body).slice(0, 600));
    const apiMsg = body && typeof body === 'object' ? (body.message || body.error || body.msg || body.detail) : null;
    if (res.status === 401 || res.status === 403) throw new Error(apiMsg || 'API key rejected (invalid or expired).');
    if (res.status === 429) throw new Error(apiMsg || 'API rate limit reached, try again in a minute.');
    if (res.status >= 400) throw new Error(apiMsg || `API error (HTTP ${res.status}).`);
    if (body && typeof body === 'object' && (body.status === false || body.success === false || body.ok === false)) {
        throw new Error(apiMsg || 'The API could not fetch this link.');
    }
    if (typeof body === 'string') throw new Error('Unexpected API response.');
    return body;
}

// Returns { title, author, media: [{ kind, url, size, ct }] }
async function resolveMedia(platform, url) {
    const p = PLATFORMS[platform];
    if (!p) throw new Error('Unknown platform.');
    const body = await callApi(platform, url);

    let items = [body];
    if (p.multi) {
        const arr = findItemArray(body);
        if (arr) items = arr.slice(0, 10);
    }
    const media = [];
    for (const it of items) {
        const best = await bestForItem(it);
        if (best && !media.some((m) => m.url === best.url)) media.push(best);
    }
    if (!media.length) throw new Error('No downloadable media found. The post may be private or removed.');
    return {
        title: firstText(body, /^(title|caption|description|desc|text|content)$/i),
        author: firstText(body, /^(author|username|user_name|nickname|owner|uploader|name)$/i),
        media
    };
}

// Last-resort download when WhatsApp's own fetch is refused by the CDN.
async function downloadBuffer(url) {
    const r = await axios.get(url, {
        responseType: 'arraybuffer', timeout: 120000, maxRedirects: 5,
        maxContentLength: MAX_BYTES, headers: { 'User-Agent': UA }
    });
    return Buffer.from(r.data);
}


// ---------------------------------------------------------------------------
// XVideos search (18+). Returns [{ title, url, duration, views }]
// Queries and results that point at minors are always dropped.
// ---------------------------------------------------------------------------
const MINOR_TERMS = /\b(child|children|kid|kids|minor|minors|underage|under\s?age|preteen|pre-teen|loli|lolita|shota|cp|pedo|paedo|pedophile|jailbait|toddler|infant|baby|schoolgirl|school\s?girl|schoolboy|school\s?boy|teen|teens|teenage|teenager|young\s?(girl|boy)|little\s?(girl|boy)|\d{1,2}\s?(yo|y\/o|yr|year\s?old|years\s?old))\b/i;

function scalarFor(node, re) {
    for (const [k, v] of Object.entries(node || {})) {
        if (re.test(k) && (typeof v === 'string' || typeof v === 'number') && String(v).trim() && !/^https?:\/\//i.test(String(v))) return String(v).trim();
    }
    return null;
}
function longestObjectArray(node) {
    let best = null;
    (function walk(n) {
        if (Array.isArray(n)) {
            const objs = n.filter((x) => x && typeof x === 'object' && !Array.isArray(x));
            if (objs.length && (!best || objs.length > best.length)) best = objs;
            n.forEach(walk);
        } else if (n && typeof n === 'object') Object.values(n).forEach(walk);
    })(node);
    return best || [];
}
async function searchAdult(site, query, limit = 10) {
    if (MINOR_TERMS.test(query)) throw new Error('This search is not allowed.');
    const res = await axios.get(`${API_BASE}/adult/${site}/search`, {
        params: { q: query, api_key: API_KEY },
        timeout: 45000,
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        validateStatus: () => true
    });
    const body = res.data;
    if (process.env.DL_DEBUG) console.log(`[search:${site}] HTTP ${res.status}`, JSON.stringify(body).slice(0, 600));
    const apiMsg = body && typeof body === 'object' ? (body.message || body.error || body.msg || body.detail) : null;
    if (res.status === 401 || res.status === 403) throw new Error(apiMsg || 'API key rejected (invalid or expired).');
    if (res.status === 429) throw new Error(apiMsg || 'API rate limit reached, try again in a minute.');
    if (res.status >= 400) throw new Error(apiMsg || `API error (HTTP ${res.status}).`);
    if (!body || typeof body !== 'object') throw new Error('Unexpected API response.');
    if (body.status === false || body.success === false || body.ok === false) throw new Error(apiMsg || 'Search failed.');

    const out = [];
    for (const it of longestObjectArray(body)) {
        const title = scalarFor(it, /^(title|name)$/i);
        if (!title || MINOR_TERMS.test(title)) continue;
        const links = collect(it, '', []);
        const page = links.find((c) => /(^|[._\[])(url|link|href|video_url|page|watch)$/i.test(c.path) && !/thumb|image|img|cover|preview|poster/i.test(c.path))
            || links.find((c) => !/thumb|image|img|cover|preview|poster|\.(jpe?g|png|webp|gif)(\?|$)/i.test(c.path + c.url));
        if (!page) continue;
        out.push({ title: title.slice(0, 120), url: page.url, duration: scalarFor(it, /duration|length|time/i), views: scalarFor(it, /views?/i) });
        if (out.length >= limit) break;
    }
    return out;
}

const searchXvideos = (q, n) => searchAdult('xvideos', q, n);
const searchXhamster = (q, n) => searchAdult('xhamster', q, n);

// ---------------------------------------------------------------------------
// SONG (.song) — YouTube search (no key needed) + mp3 link from the tools API
//   Env: SONG_API_URL    optional full template, e.g. https://host/dl?url={url}&api_key=KEY
//        SONG_API_PATHS  optional comma list of API paths to try (default: youtube/savetube/mp3 first)
//        SONG_MAX_MIN    longest song allowed in minutes (default 12)
//        DL_DEBUG=1      logs raw API responses
// ---------------------------------------------------------------------------
const SONG_MAX_SEC = (parseInt(process.env.SONG_MAX_MIN, 10) || 12) * 60;

function durToSec(t) {
    const parts = String(t || '').split(':').map((x) => parseInt(x, 10));
    if (!parts.length || parts.some(isNaN)) return 0;
    return parts.reduce((a, b) => a * 60 + b, 0);
}

async function searchYoutubeApi(query, limit = 5) {
    const res = await axios.get(`${API_BASE}/youtube/search`, {
        params: { q: query, api_key: API_KEY },
        timeout: 30000,
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        validateStatus: () => true
    });
    const body = res.data;
    if (process.env.DL_DEBUG) console.log(`[song:search] HTTP ${res.status}`, JSON.stringify(body).slice(0, 700));
    if (res.status === 401 || res.status === 403) throw new Error('API key rejected (invalid or expired).');
    if (res.status === 429) throw new Error('API rate limit reached, try again in a minute.');
    if (res.status >= 400 || !body || typeof body !== 'object') throw new Error(`Search API error (HTTP ${res.status}).`);
    if (body.status === false || body.success === false || body.ok === false) throw new Error(body.message || body.error || 'Search failed.');
    const out = [];
    for (const it of longestObjectArray(body)) {
        const title = scalarFor(it, /^(title|name)$/i);
        if (!title) continue;
        const links = collect(it, '', []);
        let id = scalarFor(it, /^(video_?id|id)$/i);
        let url = (links.find((c) => /youtu\.?be/i.test(c.url) && !/\.(jpe?g|png|webp)/i.test(c.url)) || {}).url;
        if (!url && id && /^[\w-]{11}$/.test(id)) url = `https://www.youtube.com/watch?v=${id}`;
        if (!url) continue;
        if (!id) { const m = url.match(/(?:v=|youtu\.be\/|shorts\/)([\w-]{11})/); id = m ? m[1] : null; }
        const dur = scalarFor(it, /^(duration|length|timestamp|time|duration_?string)$/i) || '';
        const secs = /^\d+(:\d+)+$/.test(dur) ? durToSec(dur) : (Number(dur) || 0);
        if (secs && secs > SONG_MAX_SEC) continue;
        const thumbC = links.find((c) => /thumb|image|img|cover|poster/i.test(c.path)) || links.find((c) => /\.(jpe?g|png|webp)(\?|$)/i.test(c.url));
        out.push({
            id, url, title: title.slice(0, 150),
            channel: scalarFor(it, /^(channel|author|uploader|owner|channel_?name)$/i) || firstText(Object.fromEntries(Object.entries(it).filter(([k]) => /channel|author|uploader|owner/i.test(k))), /^(name|title|channel|author)$/i) || '',
            duration: dur && /^\d+(:\d+)+$/.test(dur) ? dur : (secs ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : (dur || '')),
            seconds: secs,
            views: scalarFor(it, /views?/i) || '',
            thumb: thumbC ? thumbC.url : (id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null)
        });
        if (out.length >= limit) break;
    }
    return out;
}

async function searchYoutubeScrape(query, limit = 5) {
    const res = await axios.get('https://www.youtube.com/results', {
        params: { search_query: query, sp: 'EgIQAQ==' },
        timeout: 20000,
        headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
        validateStatus: () => true
    });
    const html = String(res.data || '');
    const m = html.match(/var ytInitialData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
    if (!m) throw new Error('YouTube search is not reachable right now.');
    let data;
    try { data = JSON.parse(m[1]); } catch (e) { throw new Error('Could not read YouTube results.'); }
    const out = [];
    (function walk(n) {
        if (out.length >= 25) return;
        if (Array.isArray(n)) return n.forEach(walk);
        if (n && typeof n === 'object') {
            if (n.videoRenderer && n.videoRenderer.videoId) {
                const v = n.videoRenderer;
                const dur = v.lengthText && v.lengthText.simpleText;
                if (dur) out.push({
                    id: v.videoId,
                    url: `https://www.youtube.com/watch?v=${v.videoId}`,
                    title: (v.title && v.title.runs && v.title.runs[0] && v.title.runs[0].text) || 'Unknown title',
                    channel: (v.ownerText && v.ownerText.runs && v.ownerText.runs[0] && v.ownerText.runs[0].text) || '',
                    duration: dur,
                    seconds: durToSec(dur),
                    views: (v.viewCountText && v.viewCountText.simpleText) || '',
                    thumb: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`
                });
                return;
            }
            Object.values(n).forEach(walk);
        }
    })(data);
    return out.filter((r) => r.seconds > 0 && r.seconds <= SONG_MAX_SEC).slice(0, limit);
}

async function searchYoutube(query, limit = 5) {
    try {
        const r = await searchYoutubeApi(query, limit);
        if (r.length) return r;
    } catch (e) { console.log('[song] API search failed, trying YouTube page:', e.message); }
    return searchYoutubeScrape(query, limit);
}

function songEndpoints(videoUrl) {
    const key = encodeURIComponent(API_KEY);
    const u = encodeURIComponent(videoUrl);
    const list = [];
    if (process.env.SONG_API_URL) {
        list.push(process.env.SONG_API_URL.replace('{url}', u).replace('{key}', key));
    }
    const paths = (process.env.SONG_API_PATHS || 'youtube/savetube/mp3,youtube/mp3,youtube/download')
        .split(',').map((x) => x.trim()).filter(Boolean);
    for (const p of paths) list.push(`${API_BASE}/${p}?url=${u}&api_key=${key}`);
    return list;
}

// Returns { url, size, ct } of an audio file for a YouTube link.
async function resolveSong(videoUrl) {
    let lastErr = 'No working download endpoint found.';
    for (const ep of songEndpoints(videoUrl)) {
        try {
            const res = await axios.get(ep, { timeout: 90000, headers: { 'User-Agent': UA, Accept: 'application/json' }, validateStatus: () => true });
            const body = res.data;
            if (process.env.DL_DEBUG) console.log(`[song] ${ep.replace(/api_key=[^&]+/, 'api_key=***')} -> HTTP ${res.status}`, JSON.stringify(body).slice(0, 500));
            if (res.status === 401 || res.status === 403) { lastErr = 'API key rejected (invalid or expired).'; continue; }
            if (res.status === 429) { lastErr = 'API rate limit reached, try again in a minute.'; continue; }
            if (res.status >= 400 || !body || typeof body !== 'object') continue;
            if (body.status === false || body.success === false || body.ok === false) { lastErr = body.message || body.error || lastErr; continue; }

            const seen = new Set();
            const cands = collect(body, '', []).filter((c) => (seen.has(c.url) ? false : (seen.add(c.url), true))).slice(0, 10);
            if (!cands.length) continue;
            const probes = await Promise.all(cands.map((c) => probe(c.url)));
            const rows = cands.map((c, i) => {
                const kind = classify(c, probes[i]);
                let score = hintScore(c.path);
                if (/mp3|audio|m4a|aac/i.test(c.path + ' ' + c.url.split('?')[0])) score += 6;
                return { ...c, kind, size: probes[i].size, ct: probes[i].ct, score };
            }).filter((r) => (r.kind === 'audio' || r.kind === 'video') && r.score > -5);
            const pick = rows.filter((r) => !r.size || r.size <= MAX_BYTES)
                .sort((a, b) => ((b.kind === 'audio') - (a.kind === 'audio')) || (b.score - a.score))[0];
            if (pick) return { url: pick.url, size: pick.size, ct: pick.ct, kind: pick.kind };
            lastErr = `File is larger than the ${Math.round(MAX_BYTES / 1048576)}MB limit or no audio link found.`;
        } catch (e) { lastErr = e.message || lastErr; }
    }
    throw new Error(lastErr);
}

// ---------------------------------------------------------------------------
// WhatsApp profile picture (api /whatsapp/dp?number=...)
// ---------------------------------------------------------------------------
async function getWhatsappDp(number) {
    const res = await axios.get(`${API_BASE}/whatsapp/dp`, {
        params: { number, api_key: API_KEY },
        timeout: 30000,
        headers: { 'User-Agent': UA, Accept: 'application/json, image/*' },
        validateStatus: () => true
    });
    const body = res.data;
    if (process.env.DL_DEBUG) console.log('[dp] HTTP', res.status, JSON.stringify(body).slice(0, 400));
    if (res.status === 401 || res.status === 403) throw new Error('API key rejected (invalid or expired).');
    if (res.status === 429) throw new Error('API rate limit reached, try again in a minute.');
    if (res.status >= 400 || !body || typeof body !== 'object') throw new Error('No profile picture found.');
    if (body.status === false || body.success === false || body.ok === false) throw new Error(body.message || body.error || 'No profile picture found.');
    const seen = new Set();
    const cands = collect(body, '', []).filter((c) => (seen.has(c.url) ? false : (seen.add(c.url), true))).slice(0, 8);
    const probes = await Promise.all(cands.map((c) => probe(c.url)));
    const rows = cands.map((c, i) => ({ ...c, kind: classify(c, probes[i]), score: hintScore(c.path) + (/dp|profile|avatar|image|photo|pic/i.test(c.path) ? 3 : 0) }))
        .filter((r) => r.kind === 'image' || r.kind === 'unknown').sort((a, b) => b.score - a.score);
    if (!rows.length) throw new Error('No profile picture found (private or not set).');
    return rows[0].url;
}

module.exports = { searchYoutube, resolveSong, getWhatsappDp, PLATFORMS, extractUrl, resolveMedia, downloadBuffer, searchAdult, searchXvideos, searchXhamster, MINOR_TERMS };
