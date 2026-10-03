# NIMAH MD — Private WhatsApp Bot

**© Nimah Dev. All rights reserved.**
This is a private project built for and owned by **Nimah Dev**. It is not an
open-source or public template — see [`LICENSE`](./LICENSE).

Owner contact: `wa.me/94744136085`

---

## What this is

A multi-device WhatsApp bot (built on [Baileys](https://github.com/WhiskeySockets/Baileys))
with:

- **Many commands** across System, Owner, Group, Fun, Tools, and
  Text categories — send `.menu` (or `.help`) to any paired bot for the full
  list.
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
| `OPENROUTER_API_KEY`  | Optional | API key for the Nimah AI agent (OpenRouter). Falls back to a built-in default — **rotate this from your OpenRouter dashboard and set it here instead**, since it was originally shared in plain chat. |
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
public/pair.html   Pairing portal (static page, no external icon assets)
public/logo.jpg    Bot logo (used in the portal and in .alive/.menu)
public/bg.jpg      Pairing portal background
Procfile           Railway/Heroku-style start command
```

## Notes on scope

- Group settings (`rules`, `antilink`, `warn` counts) and the Nimah AI
  agent's chat memory are stored **in memory only** — they reset on
  restart. For anything that needs to survive restarts long-term, wire up
  a small database.

## Styled replies, downloaders and extras (2026-10)

- `.menu` / `.alive` / `.ping` use the status-panel design. Reply to the menu with a number to open a category (`0` = back).
- Social downloaders: `.fb`, `.insta` / `.ig`, `.tt`, `.twitter` / `.x`, `.pinterest` / `.pin` (also work when you reply to a link).
  Set `CHAMINDU_API_KEY` in Railway to override the built-in key. `DL_MAX_MB` (default 95) caps file size. `DL_DEBUG=1` logs raw API responses.
- Banners: drop images into `public/banners/` for random menu banners, or name one `<category>.jpg` (e.g. `download.jpg`) for a fixed banner per category.
- Audio: `.ping` and `.alive` send `public/voice.mp3` as an mp3 audio. Replace that file to change it. `VOICE_PTT=1` shows it as a voice-note bubble instead.
- `.welcome on|off` and `.goodbye on|off` send a card with the member's profile picture.
- `REACTIONS=off` disables the hourglass / tick reactions. `NEWSLETTER_JID` adds the forwarded-from-channel look.
- `.xvideos <words>` (alias `.xv`): 18+ search, returns titles and links. Works in private chats; in groups an admin must run `.nsfw on` first. Searches and results about minors are always blocked.
- `.xhamster <words>` (`.xh`) search; `.pornhub <url>` (`.ph`) and `.xnxx <url>` download. Same rules as `.xvideos`: private chats, or groups after `.nsfw on`; minor-related terms are always blocked.

## Staying online

- Add a Railway Volume (service -> Volumes -> mount path `/data`). Without it the pairing files are wiped on every restart or redeploy and the bot needs to be paired again.
- Optional env: `APP_URL` (public https URL) for a keep-alive ping, `DL_MAX_MB` (default 64) to keep downloads small.
- Logs now show `Received SIGTERM` when the host stops the app and a memory line every 10 minutes.

## Stability update (6.1)

- **Cloud session backup**: every paired bot is saved (gzipped) to Firestore (`sessionBackup`, `sessionBackupParts`) and restored automatically on start, so bots reconnect after a restart even without a Railway Volume. Env: `BACKUP_INTERVAL_MIN` (default 10).
- **Pair site = unlimited bots**: a **Pair another number** button starts a fresh session while earlier bots keep running. Unpaired sessions nobody is watching are removed after `PENDING_TTL_MIN` (default 10) minutes, at most `MAX_PENDING_PAIRS` (default 40) waiting at once, `NEW_SESSIONS_PER_HOUR` (default 40) per IP.
- `railway.json` now uses `restartPolicyType: ALWAYS` (the old `ON_FAILURE` never restarted the app after a clean SIGTERM exit).
- Watchdog also restarts sockets that are marked online but already closed; in-memory caches are trimmed every 30 minutes; default download cap is 40 MB.

## Song + DP commands

- `.song <name>` (aliases `.play`, `.mp3`, `.music`): searches YouTube, finds it with the tools API `youtube/search` and downloads the mp3 with `youtube/savetube/mp3` and sends it as audio with a title card. Env: `SONG_MAX_MIN` (default 12), `SONG_API_URL` (full URL template with `{url}`), `SONG_API_PATHS` (comma list of API paths to try). Use `DL_DEBUG=1` to see raw API responses.
- `.dp <number>` (aliases `.getdp`, `.pp`): WhatsApp profile picture via the tools API (falls back to WhatsApp itself). Also works by replying to / @mentioning someone, or with no argument for your own picture.
- Pairing sound: when a number gets paired, the pair page plays a short beep and `public/voice.mp3` is sent to the bot's own "You" chat together with the settings login message.
- Button menu: `.menu` sends the menu card with a "Select Category" list button plus quick-reply buttons (Ping / Owner), built as a native-flow interactive message. `.menu <category>` and `.menu all` also work as typed commands, and the reply-with-number menu still works. WhatsApp can hide buttons on some phones/versions; set `MENU_BUTTONS=off` to go back to the plain card.
