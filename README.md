# arena-cli

Chat CLI for [arena.ai](https://arena.ai) (LMArena) via Playwright.
Chat with models, pick your mode (direct / side-by-side / battle / agent), list the model catalog.

> Author: Potato

## Requirements

- Node.js >= 18
- Playwright Chromium (install instructions below)
- A logged-in arena.ai session (cookies)

## Setup

```bash
npm install playwright
npx playwright install chromium
```

## Login (automatic cookie capture)

```bash
node arena.js login
```

A browser window opens — log in to arena.ai once (Google or email).
The script detects the login and saves your session to `cookies.json` automatically.
You never need to touch DevTools.

## Install Chromium binary (if the default download fails)

The script looks for the Chromium binary at:
`~/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome`
Override with the `ARENA_CHROME` env var if yours is elsewhere.

## Usage

```bash
# List available models
node arena.js models

# Direct chat with one model
node arena.js direct grok-4.6 "explain quines briefly"

# Side by side: compare two models
node arena.js side claude-sonnet-5-5-high gpt-6-luna-max "write a haiku about fds"

# Battle: two anonymous models
node arena.js battle "what is 2+2?"

# Agent mode (with workspace + connectors)
node arena.js agent "make a hello world python script"
```

## Modes

| Mode | Command | Description |
|------|---------|-------------|
| direct | `node arena.js direct <model> "<msg>"` | Chat with 1 chosen model |
| side | `node arena.js side <modelA> <modelB> "<msg>"` | Compare 2 chosen models |
| battle | `node arena.js battle "<msg>"` | 2 anonymous models |
| agent | `node arena.js agent "<msg>"` | Agent mode with workspace |
| models | `node arena.js models` | List model catalog |

## Notes

- Headless is used by default. If you hit bot detection, run with a virtual display:
  `xvfb-run -a node arena.js ...` or set `ARENA_HEADLESS=1` off (default runs with `headless: false` under xvfb).
- Daily usage limits apply per arena.ai account (resets ~7:59).
- Do NOT commit your real `cookies.json` — it contains your session token.

## HTTP API mode (server.js)

Run a local API server so any app can chat without touching the browser directly:

```bash
node server.js          # listens on :3123 (override with PORT)
```

Endpoints:
- `GET /health` — status
- `GET /models` — model catalog
- `POST /set-cookies` — `{arena_auth_v10, cf_clearance?, user_country_code?}` — save session
- `POST /chat` — `{message, model?, modelB?, mode?}` — mode: direct | side | battle | agent

Example:

```bash
curl -X POST http://localhost:3123/chat \
  -H 'Content-Type: application/json' \
  -d '{"message": "hello", "model": "grok-4.6", "mode": "direct"}'
```

Optional auth: set `ARENA_API_KEY=secret` and send header `x-api-key: secret`.

## Important: run on a residential machine

arena.ai gates chat sends with reCAPTCHA v3. Datacenter/VPS IPs get a low bot
score and the send is blocked with a login modal. Run this API on your own PC
(home IP) for reliable chat. The model catalog and history APIs work from VPS.

## GUI app (recommended for desktop users)

Opens a real Chromium window on your desktop (Linux Mint / XFCE works out of
the box) with a built-in chat interface:

```bash
node gui.js
```

- Click **Login to Arena** -> arena.ai opens in a tab -> log in with Google
  yourself (pass any challenge - you are on your own home IP, so reCAPTCHA
  scores are fine). Cookies are captured automatically and saved to
  cookies.json. No manual cookie copying.
- Pick mode (Direct / Side by Side / Battle / Agent) and model, then chat.
- Chat requests run from your own browser profile and IP, which gives the
  best reCAPTCHA v3 results.

Requires: Node 20+, `npm install playwright`, `npx playwright install chromium`.
