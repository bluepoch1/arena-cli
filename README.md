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
