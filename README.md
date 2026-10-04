# NIMAH MD — Private WhatsApp Bot

**© Nimah Dev. All rights reserved.**
This is a private project built for and owned by **Nimah Dev**. It is not an
open-source or public template — see [`LICENSE`](./LICENSE).

Owner contact: `wa.me/94744136085`

---

## What this is

A multi-device WhatsApp bot (built on [Baileys](https://github.com/WhiskeySockets/Baileys))
with:

- **230+ commands** across System, Search, Media, Tools, Text, Fun, Group and
  Owner sections — send `.menu` and **reply with a number** to open a section,
  page through it (`n` / `p`) and run a command straight from the list.
  Every reply uses the Nimah glyph design system (no emoji clutter).
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
