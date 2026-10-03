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
- `.alive` and `.menu` also send a short tech jingle (original, copyright-free, in `public/audio/`). Owner can toggle with `.sound on|off`, or set `SOUND=off`.
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
