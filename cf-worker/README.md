# Author: Potato

## Cloudflare Worker (public API endpoint)

The worker is a thin public proxy in front of the arena-cli `server.js`
backend. Clients hit the worker URL; the worker forwards to the backend
over a cloudflared tunnel, so the VPS never needs an open inbound port.

### One-time deploy (needs a Cloudflare account)

```bash
cd cf-worker

# login (opens browser) OR use an API token:
export CLOUDFLARE_API_TOKEN=your_token_here

npx wrangler deploy

# configure secrets:
npx wrangler secret put BACKEND_URL    # e.g. https://xxxx.trycloudflare.com
npx wrangler secret put API_KEY        # any long random string
```

Your public API URL: `https://arena-api.<your-subdomain>.workers.dev`

### Client usage

```bash
curl -X POST https://arena-api.<your-subdomain>.workers.dev/chat \
  -H 'Content-Type: application/json' \
  -H 'x-api-key: <API_KEY>' \
  -d '{"message": "hello", "model": "grok-4.6", "mode": "direct"}'
```

### Backend side (VPS)

```bash
# 1. run the API server
cd arena-cli && node server.js

# 2. expose it publicly (no open ports needed)
cloudflared tunnel --url http://localhost:3123
# copy the https://xxxx.trycloudflare.com URL from output
# -> put it in BACKEND_URL secret (URL changes on restart; use a named
#    tunnel with a token for a stable URL)

# 3. keep both alive: systemd or a simple watchdog is recommended
```

Note: chat sends are gated by reCAPTCHA v3 on arena.ai's side. Datacenter
IPs (VPS) get low scores and the send may be blocked with a login modal.
Running `server.js` on a residential machine gives the best results.
