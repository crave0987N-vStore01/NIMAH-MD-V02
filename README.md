# NIMAH MD — Private WhatsApp Bot

**© Nimah Dev. All rights reserved.**
This is a private project built for and owned by **Nimah Dev**. It is not an
open-source or public template — see [`LICENSE`](./LICENSE).

Owner contact: `wa.me/94744136085`

---

## What this is

A multi-device WhatsApp bot (built on [Baileys](https://github.com/WhiskeySockets/Baileys))
with:

- **1000 commands** across System, Search, Media, Tools, Text, Fun, Anime, Gaming, Islamic, Group and
  Owner sections — send `.menu` and **reply with a number** to open a section,
  page through it (`n` / `p`) and run a command straight from the list.
  Every reply uses the Nimah glyph design system (no emoji clutter).
- **50 menu designs** — `.menu01` to `.menu50` show the same commands in fifty
  different styles. `.menus` lists them. `.menu` stays the reply-with-a-number index.
- **Settings panel inside the bot** — in a private chat send `.settings <password>`
  (the password the bot sent to its own chat when it first connected). Reply with a
  number to flip a switch, or use `.set <number> [value]`. `.set 9 <new password>`
  changes the password, `.set 10` locks the panel. 5 wrong tries lock it for 10 minutes.
- **Nimah — a private AI agent** built into the bot (OpenRouter + DeepSeek).
  In a DM, it replies to anything. In a group, it jumps in when addressed by
  name or replied to, and occasionally joins the conversation naturally.
- **Multi-bot pairing portal** — any number of people can pair their own
  WhatsApp number through the same deployment, each getting their own
  independent bot session. QR-code **and** pair-code (phone number) linking. Optional `PAIR_CODE` env var (8 chars, A-Z/0-9) sets the custom pair code.
- **Auto Status View + React** — on by default per bot, toggle with
  `.autostatus`.
- **Anti-ban send pacing** — outgoing messages are queued with randomized,
  human-like delays and a typing indicator instead of firing instantly;
  mass-@mention commands (`.tagall`/`.hidetag`) have a per-group cooldown.
  This reduces (not eliminates) the risk of WhatsApp flagging the account.

## Deploying on Railway

1. Push this project to a GitHub repo and create a new Railway service from
   it (or `railway up` from this folder).
2. Railway auto-detects `Procfile` / `npm start` — no build command needed.
3. Once deployed, open the Railway-provided URL. That's the pairing portal.
4. Scan the QR code with WhatsApp: **Settings → Linked Devices → Link a
   Device**.
5. Anyone else who opens the same URL gets their own separate QR and their
   own independent bot — no limit on how many can pair.

## Environment variables

| Variable             | Required | Purpose                                                                 |
|-----------------------|----------|--------------------------------------------------------------------------|
| `OWNER_NUMBER`        | Optional | WhatsApp number (digits only, with country code) that unlocks owner-only commands. Defaults to `94744136085`. |
| `OPENROUTER_API_KEY`  | Optional | API key for the Nimah AI agent (OpenRouter). Set it as a Railway variable or in a local `.env` file (see `.env.example`). No key is stored in the source code. |
| `OPENROUTER_MODEL`    | Optional | OpenRouter model slug for the AI agent. Defaults to `deepseek/deepseek-chat`. |
| `RAILWAY_VOLUME_MOUNT_PATH` | Auto-set by Railway | Where paired sessions are stored persistently — see below. |

## Session persistence (important)

Railway's default filesystem is **ephemeral** — anything written to disk
(including WhatsApp login credentials) is wiped on every redeploy/restart.

- **Without a volume**: everyone has to re-pair via the portal after every
  redeploy or restart.
- **To fix it**: in Railway, go to your service → **Volumes** → **New
  Volume**, mount it anywhere (e.g. `/data`). Railway sets
  `RAILWAY_VOLUME_MOUNT_PATH` automatically, and the bot already uses it —
  no code changes needed. All paired sessions then survive redeploys.

## Connection reliability

Each paired bot reconnects automatically with exponential backoff on
disconnect, and a watchdog checks every 90 seconds for any session stuck
offline with no reconnect scheduled and restarts it. Logged-out or corrupted
sessions are detected and cleared automatically so the portal can re-pair
cleanly instead of looping forever.

## Project structure

```
index.js          Bot logic, commands, multi-session manager, web server
public/nimah.css   Shared "Ember Press" design system for the web pages
public/pair.html   Pairing portal
public/admin.html  Admin panel
public/settings.html  Per-bot settings
public/logo.jpg    Bot logo (used in the portal and in .alive/.menu)
public/bg.jpg      Pairing portal background
Procfile           Railway/Heroku-style start command
```

## Notes on scope

- Group settings (`rules`, `antilink`, `warn` counts) and the Nimah AI
  agent's chat memory are stored **in memory only** — they reset on
  restart. For anything that needs to survive restarts long-term, wire up
  a small database.

## 24/7 uptime

- Railway restart policy is `ALWAYS`, plus an in-app watchdog, liveness probe, memory guard and self-ping (`/ping`).
- **Attach a Railway Volume** (mounted anywhere; the app uses `RAILWAY_VOLUME_MOUNT_PATH`) so paired sessions survive redeploys.
- Optional variables: `SELF_URL`, `MAX_RSS_MB`, `AD_CARD`.

## Sounds & extras
- `.ping` and `.alive` also send your welcome voice (`public/audio/welcome.ogg`, voice note; `welcome.mp3` is the fallback). Replace those files to change it. Owner toggle: `.sound on|off`, or `SOUND=off`.
- `.anticall on|off`, `.profile`, `.sysinfo`, `.currency`, `.sticker`, `.toimg`, `.tiktok`.

## Anti-delete & view-once
- `.antidelete` (owner) — turn on once; afterwards every message someone deletes for everyone (text, photo, video, voice, sticker, file) is sent to the owner's inbox automatically. `.antidelete chat` shows it in the same chat, `.antidelete off` disables it. Only messages received *after* enabling can be recovered.
- `.vv` (owner) — reply to a view-once photo/video/voice note and it is saved to the owner's inbox.

## Economy system (🪙 Nimah Coins)
Type `.eco` in WhatsApp for the full list.
- Earn: `.daily` (streak bonus) `.weekly` `.work` `.beg` `.crime` `.fish` `.mine`
- Bank: `.balance` `.deposit` `.withdraw` `.send` `.rob`
- Casino: `.gamble` `.coinflip` `.slots` `.roulette`
- Shop: `.shop` `.buy` `.sell` `.inventory` (pickaxe, rod, laptop, padlock, clover, vault, trophy)
- Rank: `.leaderboard` `.level` — Owner: `.addcoins` `.ecoreset`
Data is saved to `economy.json` (on your Railway Volume) and backed up to Firestore.

## Chama API (api.chamindu.site)
- `.ytmp3 [youtube link]` (aliases `.song`, `.mp3`, `.yta`) downloads a YouTube song as MP3 with a cover card.
- `.ytmp4 [youtube link] [144-1080]` downloads a YouTube video (default 480p).
- `.fb [facebook link]` downloads a public Facebook video.
- `.wadp [number]` fetches the public profile photo of a WhatsApp number.
- Set `CHAMA_API_KEY` as a Railway variable (or in `.env`). The key is never stored in the code.

## Many bots on one server
Anyone can open the pairing page and link their own WhatsApp number; every number is a fully independent bot (own settings, owner, anti-delete inbox, economy).
- `MAX_BOTS` (default 60) and a memory check stop the server from overfilling; a full server refuses new pairings politely.
- Saved bots are resumed one at a time after a restart; abandoned pairing pages are cleaned up after 20 minutes.
- Each bot's owner is the number that paired it (they can use owner commands on their own bot, from their own phone too). `OWNER_NUMBER` stays the platform owner across all bots.
- `.restart` restarts only that bot; the platform owner can use `.restart all` and `.bots` (list of every linked bot).
- Use a Railway Volume so every paired session survives redeploys. Rough capacity: ~40-50 MB RAM per bot.

## Railway Free plan notes
- Free plan = $1 credit/month, 0.5 GB RAM. A bot that runs 24/7 can use more than $1/month; when the credit is gone Railway stops the service (that looks like the bot going offline). The Hobby plan ($5, includes $5 credit) is what keeps it online all month.
- Add a **Volume** (free, 0.5 GB) mounted at `/data` so paired sessions survive restarts.
- **Session backup:** an encrypted copy of every paired session is stored in Firestore and restored on boot, so a restart/redeploy no longer unpairs your bots even without a Volume. Set `BACKUP_SECRET` (any long random text) in Variables; if you don't, `OPENROUTER_API_KEY` is used to derive the key. Do not change it later or old backups cannot be decrypted.
- `MAX_BOTS` auto-sizes to the plan RAM (about 8 bots on 512 MB). The server runs with a 320 MB heap cap.

## Command Studio (admin panel → /studio)
Add and fix commands without touching code. Everything is saved in Firestore and goes live instantly.
- **API keys:** save keys (e.g. `CHAMA`) once; use them in any address as `{{key:CHAMA}}`. Encrypted at rest when `BACKUP_SECRET` is set, masked in the panel.
- **API commands:** paste an API link from the provider's playground, press Convert, press Test, then Save. Choose to send text, image, video, audio or a file. Tap fields in the test result to pick the file link or build the message (`{{data.title}}`).
- **Placeholders:** `{{q}}` (all text after the command), `{{arg1}}`…`{{arg9}}`, `{{arg2|480}}` (with default), `{{name}}`, `{{sender}}`, `{{key:NAME}}`.
- **Fixing things:** each command shows how often it ran/failed and its last error. Edit, turn off or delete it any time. Switch a broken built-in command off, then create your own command with the same name to replace it.
- Custom commands appear in `.menu` under the **Custom** section.
- Set a strong `ADMIN_PASSWORD` variable (the default is guessable) because the panel holds your keys.

## Brand & Messages (admin panel → /brand)
Change how the bot looks without code; applies to every paired bot instantly.
- **Identity:** bot name, developer name, tagline (menu header), description (link card), footer line.
- **Messages:** write your own top part of `.menu`, your own `.alive` and `.ping` messages with placeholders such as `{{bot}} {{user}} {{greeting}} {{time}} {{uptime}} {{memory}} {{commands}} {{ping}} {{signal}} {{meter}}`. Starter styles and a live preview are built in. Empty box = built-in design.
- **Logo:** upload a picture; it is used on menu/alive/ping, the link card and the web pages. **Welcome voice:** upload an audio clip (converted to a WhatsApp voice note automatically). Both are saved to the database (and the Volume) so they survive redeploys.
- Switches: logo banner on/off, welcome voice on `.ping` / `.alive`.

## Command Studio upgrades
- **Two-step commands:** step 1 looks something up (e.g. search), step 2 uses its answer as `{{s1.data.0.slug}}`.
- **Who can use it:** everyone / groups only / group admins / bot owner.
- Users can **reply to a message with the link** and send only the command.
- Paste a sample answer to pick fields without calling the API; copy a command; export/import all commands as a backup file.
- **Direct files:** if an API sends a picture/video/audio file straight back (no JSON), pick Image/Video/Audio in Studio and it is detected automatically.
- **Result lists:** `{{#each data.results limit=8}}{{n}}. {{title}}\n{{/each}}` prints one line per item.

## v7.13 — more bots, smarter Sinhala AI, lighter RAM
- **Pair many numbers from one browser:** after a number is linked the pairing page shows **Pair another number** and a list of your linked numbers (masked). `?new=1` on the page also forces a fresh session.
- **AI that understands Sinhala:** replies in the same language as the user (Sinhala script, Singlish or English) in warm, everyday spoken Sinhala. Default model `google/gemini-2.5-flash-lite` with automatic backup `deepseek/deepseek-chat`. Change the model, reply language, creativity and extra instructions in **/brand → AI chat**, and test it right there.
- **Lower RAM (~98 MB idle instead of ~135 MB):** Firestore now uses its REST API (the heavy Firebase SDK was removed), caches are capped, rarely used libraries load on demand, and `npm start` runs Node with memory-saving flags. Pairing capacity auto-sizes to the plan RAM (`MAX_BOTS` overrides).
- Railway bills RAM by use, so a smaller footprint stretches the free credit — but one bot running 24/7 can still use more than the free $1/month on some months. Keep the number of linked bots small on the free plan.

## v7.14 — photos & videos always open
Every picture, video, voice note and file the bot sends now goes through a **media pipeline**:
- The file is downloaded by the server (with browser headers), and its **real format is detected** (not trusted from the link).
- **Pictures** (PNG/WebP/odd JPEGs) become proper JPEGs; **videos** that WhatsApp cannot play (VP9/WebM/MKV, wrong pixel format, Opus audio) are converted to **H.264 + AAC MP4** with a preview thumbnail; **voice notes** become Opus; other audio is sent with the right type.
- Login/"access denied" pages or expired links are never sent as a broken photo — the user gets a clear message instead. Files over ~40 MB are refused with a hint to pick a lower quality.
- Conversion needs ffmpeg: it is bundled through `ffmpeg-static` (installed automatically). Conversions run one at a time to protect a small server.
- Applies to `.ytmp4`, `.ytmp3`, `.fb`, `.tiktok`, `.getimg/.getvid/.getaudio/.getfile`, `.getdp`, `.wadp`, `.imagine`, `.tts`, and every Studio command.

## v7.15 — YouTube by name, pick a result, pick a quality
- `.yt <name>` (aliases `.play`, `.yts`): search YouTube, reply with a number to choose a result, then reply with a number to choose **MP3 / MP3 as a file / 144p – 1080p video**.
- `.ytmp3 <name>` and `.ytmp4 <name>` also accept a song / video name now (links still download straight away). `.ytmp4 <name> 360` skips the quality question.
- `.yt <link>` jumps straight to the quality list. Only the person who asked can choose. Reply `0` to cancel.
- Search uses YouTube's public results page, with Piped/Invidious servers as backup (`YT_SEARCH_INSTANCES` to change them). Downloads use your Chama API key.

## v7.16 — Sinhala AI, YouTube name search fixes, no surprise logouts, same-chat view-once
- **AI:** understands Singlish better (built-in Singlish word hints for every message), thinks about the real meaning first, then answers in warm everyday Sinhala / Singlish / English. Tries 3 models in order (your model → `google/gemini-2.5-flash` → `deepseek/deepseek-chat`) so it almost never fails.
- **YouTube by name:** search now has 4 layers (YouTube page → YouTube app API → Piped → Invidious). Owner command **`.ytcheck`** shows which layer works from your server.
- **Staying linked:** `creds.json` is validated and a `.bak` copy is kept (a half-written file after a crash is repaired automatically); a single "logged out"/"bad session" error no longer wipes a session (it retries first); sessions are saved on shutdown. Set Railway variable `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=10` so redeploys have time to save.
- **Alerts:** WhatsApp message to `OWNER_NUMBER` if a bot is logged out, stays offline 3+ minutes, memory forces a restart, or the server starts (`OWNER_ALERTS=off` / `BOOT_ALERT=off` to silence).
- **RAM:** `--expose-gc` + periodic garbage collection, small thread pool, caches trimmed automatically at 70% of the plan RAM.
- **View-once & deleted messages** are now shown in the **same chat** (`.vv inbox` / `.antidelete inbox` send them to your own number instead).
- **Admin panel → Activity:** messages, people and most-used commands today, plus 7-day history.


## ❤️ GF Mode (v7.17)
When the owner's girlfriend sends a DM, the AI replies in the owner's loving voice
(සුදූ, මැනික, පැටියෝ ... + emojis, Sinhala / Singlish / English). Everyone else gets the normal AI.

| Command (owner only) | What it does |
|---|---|
| `.gf here` | send inside HER chat once - links that chat (most reliable) |
| `.gf add 947XXXXXXXX` | link by phone number |
| `.gf remove 947XXXXXXXX` | unlink |
| `.gf on` / `.gf off` | enable / disable |
| `.gf nick සුදූ, මැනික, පැටියෝ` | change pet names |
| `.gf style text` | extra style instructions (e.g. "always end with a kiss emoji") |
| `.gf` | show status |

Optional env: `GF_NUMBERS=947XXXXXXXX`. Needs `OPENROUTER_API_KEY`.

Her number +94751139018 is built in (GF_DEFAULT_NUMBERS in index.js) - no command needed.

### GF mode v7.18 - how a reply is made
1. **Understand** - AI analyses her message (Sinhala / Singlish / typos / mood / what she needs) with a built-in Singlish love-chat dictionary.
2. **Write** - loving reply in natural spoken Sinhala, fitted to what she actually said.
3. **Proofread** - second AI pass fixes Sinhala spelling, grammar and translated-sounding phrases.
4. **Clean** - code fixes known wrong phrases, adds emoji, trims length.
5. Several quick messages in a row are read together and answered once. Photos / voice notes / stickers get a loving reply too.
6. If the AI is down she still gets a loving fallback (never silence).

Models: `GF_MODEL` env (default google/gemini-2.5-flash) -> gemini-2.5-pro -> deepseek.


## 🧰 File tools (v7.19)
| Command | What it does |
|---|---|
| `.img2pdf` | reply to an image → PDF |
| `.pdfadd` + `.pdfmake [name]` | add many images/PDFs, then get ONE PDF (merge) · `.pdflist` · `.pdfclear` |
| `.pdf2img [2 / 1-3 / all]` | reply to a PDF → page images |
| `.pdf2text` | reply to a PDF → text (long text sent as .txt) |
| `.ocr` | reply to an image → text inside it (Sinhala / English / Tamil, AI vision) |
| `.imgcompress [10-95]` | reply to an image → smaller file |
| `.summarize` | summarize long text (same language) |
| `.grammar` | fix spelling / grammar (English + Sinhala) |

Needs `npm install` (pdf-lib, pdfjs-dist, @napi-rs/canvas, sharp). OCR / summarize / grammar need `OPENROUTER_API_KEY`.


## 🧠 RAM manager (v7.20)
| Where | What |
|---|---|
| `.ram` | live RAM card (owner) |
| `.clearram [soft\|deep]` | free memory now, shows before → after |
| `.ramguard on\|off` | automatic cleaning (soft at 60%, deep at 75%) |
| Admin panel → RAM | live bars + Clear RAM / Quick clean / Auto guard buttons |

Only rebuildable caches are cleared; bots, logins and settings are never touched.
If memory is still full after two deep cleans, the server restarts itself as a last resort.


## 👑 Owner (v7.21)
Owner commands work **only** from +94 74 4136085 (`OWNER_NUMBER`), whichever number the bot is paired with.

## ⬇️ Downloader (v7.21)
`.dl <link> [360|480|720]` · `.dlaudio <link>` — yt-dlp engine (auto-installed), limit `DL_MAX_MB` (40). YouTube bot-check: set `YTDLP_COOKIES_B64`.
Older commands `.tiktok` (tikwm) and `.fb` / `.yt` / `.ytmp3` / `.ytmp4` / `.wadp` (need `CHAMA_API_KEY`) are unchanged.

## v7.23 — more Chama API downloaders
- `.tiktok <link>` now uses the Chama API (no-watermark HD, photo slideshows too) with the old service as backup; `.ttmp3 <link>` sends the sound as MP3.
- `.ig <link>` (aliases `.reel`, `.insta`): public Instagram reels, videos, photos and carousels.
- `.gdrive <link>` (`.gd`): public Google Drive files up to 40 MB; bigger ones get the link instead.
- `.lyrics <song>`: finds the lyrics page for a song (Sinhala songs included) and sends the title + link.
- If a CDN refuses the bot's own download, the file is fetched through the Chama proxy automatically. All use `CHAMA_API_KEY`.

## v7.25 additions
- `.menu` uses your saved design. `.menus` lists 30 designs (21-30 are colourful tech styles). `.setmenu 21` saves one, `.setmenu classic` brings back the reply-a-number index.
- `.logochange <image link>` changes the logo (also: reply to a photo with `.logochange`, or `.logochange reset`).
- Safer connection: message-per-minute ceiling, typing time that follows message length, jittered reconnect backoff (max 3 min), staggered boot, status view/react delays, per-sender flood guard.


## v7.27 — Extra commands pack (`extra_commands.js`)

100 more commands that use free, key-less public APIs (no API key needed): X/Twitter, Reddit, MediaFire, APK, GitHub ZIP, Pinterest, TikTok search/user, music previews, free eBooks, wallpapers, GIFs, screenshots, memes, charts, anime, Quran/prayer times, forecasts, and more. Type `.menu` to browse them. Optional env: `NASA_API_KEY` (higher `.apod` limit), `PRAYER_METHOD` (Aladhan method number, default 3).


## v7.28 — Download commands pack (`download_commands.js`)
173 new download commands, all in the **Media** category. No other category was touched.
Every command uses a free, published, key-less public API (or the built-in yt-dlp engine). No API key is needed.

- **Other sites (yt-dlp):** vimeo, dailymotion, soundcloud, bandcamp, mixcloud, audiomack, twitch, kickclip, streamable, imgur, ninegag, rumble, odysee, bitchute, bilibili, likee, snapchat, threads, tumblr, vk, okru, linkedin, ytshorts, bsky, tedtalk, loom, coub, ifunny, giphydl
- **Animals:** shibe, birdpic, redpanda, koala, kangaroo, raccoon, whale, catgif, catsay, dogbreed, catbreed, dogvideo
- **Anime GIFs / pictures (SFW):** cuddle, cry, smug, bonk, yeet, blush, smile, wave, highfive, handhold, nom, bite, glomp, happy, wink, cringe, baka, bored, facepalm, feed, laugh, nod, nope, pout, run, shrug, sleep, stare, think, thumbsup, tickle, yawn, kitsune, husbando, shinobu, megumin, awoo, lick
- **Wallpapers / photos:** wallnature, wallanime, wallcar, wallspace, wallcity, wallabstract, wallgame, wallminimal, wallmobile, walldark, wallanimal, wallflower, wallsunset, wallocean, wallmountain, wallforest, wallneon, wallmusic, wallsport, wallbike, wallplane, walltech, wallsl (add `hd` for the full-quality file), bingwall, picgray, picblur, picseed, flickrpic
- **Reddit pictures / memes:** dankmeme, wholesome, codememe, animememe, historymeme, sciencememe, gamememe, awwpic, landscapepic, cityscape, foodshot, artpic, carpic, cutecat, cutedog, xkcd
- **Art / space:** artwork, metart, clevelandart, nasaimg, nasavideo, nasaaudio, earthnow
- **Free media:** commonsaudio, commonsvideo, openimg, openaudio, soundfx, freemusic, ccmusic, archiveaudio, archivevideo, archivebook
- **Books:** booktxt, bookcover, wikitxt
- **Quran:** surahmp3 (any surah, many reciters), ayahpic
- **Pokémon / emoji:** pokeart, pokeshiny, pokerandom, pokecry, emojipng, emojigif
- **GitHub:** ghrelease, ghfile, ghreadme, ghavatar, gistdl
- **Packages:** npmdl, pypidl, cratedl, gemdl, nugetdl, fdroid, cdnjs, wpplugin, wptheme, dropbox
- **Posters / covers:** movieposter, tvposter, albumart, appicon, podcastart, artistpic, gamecover

Files that are too big for WhatsApp are not lost: the bot sends the direct download link instead.


## v7.29 — Download commands pack 2 (`download_commands2.js`) + new classic menu

**50 more download commands**, all in the **Media** category (nothing else was touched). Every one uses a free, published, key-less public API or the built-in yt-dlp engine — no API key needed.

- **More sites (yt-dlp, 14):** dumpert, niconico, rutube, weibo, bbcvid, cnnvid, espnvid, flickrvid, spreaker, podbean, applepodcast, hearthis, reverbnation, twitcasting
- **Documents & books (8):** wikipdf, bookepub, arxivpdf, doipdf, rfcdl, pastedl, pixeldrain, isbncover
- **Pictures, icons, avatars (10):** iconsvg (PNG + SVG), placeholder, colorimg, gravatar, favicon, flagdl, wttrpic, mchead, cattag, iaimage
- **Anime / cartoon / games (12):** animeposter, mangacover, animechar, waifuim, nekopic, rickmorty, ghibliposter, hpchar, digimon, swchar, dndmonster, locphoto
- **Music, food (5):** artistbanner, artistfanart, mealpic, cocktailpic, ayahmp3
- **Voice (1):** sinhalatts — a Sinhala voice message (`.sinhalatts ආයුබෝවන්`; `ta:` / `en:` / `hi:` for other languages)

Public APIs go down now and then. **`.dlcheck`** (owner only, aliases `.dltest`, `.apicheck`) pings every API of this pack and lists the ones that are not answering at that moment.

**New classic menu (`.menu`)** — each section has its own glyph and a one-line description, the header shows a live status box and a quick-start box, and section pages show the page number with a progress bar. Reply `n` / `p` for next / previous page and **`g3`** to jump to page 3. A command list now shows a short description under each command. `.menu` now defaults to the classic menu; `.setmenu 1` (or any 1-50) switches to a font-art design, `.setmenu classic` brings the classic back.

**Site:** the pairing page's command counter is now live (it reads the real number from the bot via `/api/stats`). In the Theme panel, leave *Stat 1 — number* as `auto` to keep it live, or type your own text to override it.


## v7.30 — Free API commands pack (`free_commands.js`)

319 new commands + the new button menu (`.buttonmenu`), bringing the bot to exactly **1000 commands**. All run on free, key-less public APIs — no API key needed.

- **Developer (Search):** GitHub (orgs, repos, issues, PRs, commits, languages, contributors, tags, search, topics, licenses, .gitignore), npm / PyPI / crates / gems / Packagist / Docker Hub / Homebrew stats and search, StackOverflow, Hacker News, Lobsters, DEV
- **Weather & places:** UV, wind, rain chance, hourly, feels-like, humidity, waves, river flow, pollutants, past weather, geocode, reverse geocode, elevation, day length, distance between cities
- **Countries & data:** capital, currency, languages, calling code, population, borders, ISO codes, driving side, time zones, next holidays, long weekends, 8 World Bank indicators (GDP, life expectancy, internet users ...)
- **Money:** exchange rates, FX history and trend, 16 live coin prices (`.btcprice` ...), CoinGecko trending / global / search / coin info
- **Tools:** QR codes (Wi-Fi, link, mail, SMS, call, map, contact, WhatsApp), barcodes, charts, word cloud, colour names and palettes, link shorteners, paste, 6 avatar styles, fake person, name guessers, AI pictures in many styles, translators (`.tosinhala`, `.totamil`, `.tohindi`, `.toarabic`, `.tofrench`, `.toenglish`)
- **Words & knowledge:** Datamuse word finders (rhymes, sounds-like, synonyms by pattern ...), Wiktionary, Wikipedia featured article, Wikidata, Crossref, OpenAlex, PubMed, Semantic Scholar, Nobel prizes
- **Space & science:** SpaceX, people in space, planets, natural events, earthquakes, periodic table, PubChem, molar mass, drug labels, food barcodes
- **Entertainment:** TV cast / episodes / schedule, iTunes search, MusicBrainz, Deezer, Open Library, Google Books, anime (Jikan, Kitsu, MangaDex), 12 trivia categories, funny speak translators, jokes
- **Games & food:** game deals, free-to-play, giveaways, Steam, Magic / Yu-Gi-Oh / Pokémon cards, Valorant, Fortnite, Genshin, LoL, Dota, Overwatch, D&D spells, PokéAPI extras, meals and cocktails by ingredient / category / area
- **Faith:** Asma ul Husna, qibla, monthly prayer times, Hijri conversion, Quran juz / page / search / random / translations, hadith (Bukhari, Muslim), Bible verses

Public APIs go down now and then — a command then answers “service busy”; try again later.

### API key expired? Change it from the admin panel (no redeploy needed)

Admin panel → **Studio → API keys**: paste the new `CHAMA` key and press **Save key**. It is saved in the database, tested straight away, applied instantly and loaded automatically after every redeploy. The panel key always wins over the `CHAMA_API_KEY` server variable. The panel also shows a red warning when the key gets rejected, has a **Test CHAMA key** button, and lets you change the API server address if your provider moves. Any other key works the same way: a key named `NAME` falls back to the `NAME_API_KEY` server variable when none is saved in the panel.

### Button menu (`.buttonmenu`)

A tappable menu: one **Open menu** list (all sections), quick buttons (Ping / Alive / Owner), then a **Pick a command** list for each section (30 per page with next / previous / skip-5 rows). Commands that need input open a card showing how to use them; the others run on tap. `.setmenu buttons` makes `.menu` use it, `.setmenu classic` goes back. If WhatsApp refuses to send the buttons, the normal text menu is sent instead. WhatsApp can change how it shows this kind of message on personal numbers, so try `.buttonmenu` first before switching `.menu` over.

### Pro settings (WhatsApp list + web page, one shared schema)

`.settings <password>` (private chat) opens a tappable **OPEN CONFIG** list, and the same settings are on the web page `/settings` (sign in with your number and bot password). Both read from one schema, so they always match. Every change is saved per bot and survives a redeploy.

- **Personalization:** bot name, status emoji, menu design (0-50), change password
- **Work mode:** public, private (only you), groups only, inbox only
- **Ghost & privacy:** always online, status view, status react, auto reject call
- **Live activity:** auto typing, auto recording (shown when a command arrives)
- **Voice & deleted messages:** auto voice sender, anti delete, send recovered messages to the chat or your inbox
- **Message handling:** read all / read commands only / off, react to commands (with your own emoji), Nimah AI chat on or off
- **Menu style:** default, classic text, or the tappable button menu — per bot
- **Quick presets:** Ghost, Social, Secure (one tap sets many switches), and Reset to defaults

The text panel is still there as `.set`, and is used automatically if WhatsApp refuses to show the list. Text settings can also be typed: `.cfg name My Bot`, `.cfg emoji 😍`, `.cfg design 12`, `.cfg cmdemoji 🔥`.

### Bot settings for every paired user (separate from the admin panel)

The pair page now has a **⚙ Customize my bot** button that opens `/settings`. Anyone who paired a bot signs in there with their own number and the password the bot sent to their WhatsApp chat, and sees only their own bot. Besides the switches above, each bot owner can now set:

- **Auto replies:** up to 20 rules (word → reply, contains / exact / starts with, chats / groups / both, on or off; `{name}` `{time}` `{date}` work inside the reply). On WhatsApp: `.cfg autoreply add hello | Hi {name}!`, `.cfg autoreply del 2`, `.cfg autoreply clear`
- **Command groups:** switch whole groups (Media, Fun, Tools ...) off for other people; the owner always keeps access
- **Allowed numbers** (work in Private / Groups / Inbox mode) and **Blocked numbers** (always ignored)
- **Alive message:** their own text for `.alive` (`{name} {time} {date} {uptime}`)

The **admin panel, Brand, Theme and Command Studio** stay admin-only: every action needs the admin login, the pages are marked `noindex`, and `/robots.txt` disallows them. They are not linked from the pair page or the user settings page. These per-bot settings never change the global look or other people's bots.
