// Author: Potato
// arena.ai API proxy — public endpoint on Cloudflare Workers.
// Forwards requests to the arena-cli server.js backend (running with a real
// browser session). Backend URL and shared API key come from env vars:
//   wrangler secret put BACKEND_URL   -> tunnel or VPS URL of server.js
//   wrangler secret put API_KEY       -> shared secret, clients send x-api-key

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type,x-api-key,authorization',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', ...CORS },
  });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const backend = env.BACKEND_URL;
    if (!backend) return json({ error: 'BACKEND_URL not configured' }, 500);

    const apiKey = env.API_KEY || '';
    // /health is open so clients can check availability; everything else needs the key
    const openPath = url.pathname === '/health';
    if (!openPath && (!apiKey || req.headers.get('x-api-key') !== apiKey)) {
      return json({ error: 'unauthorized' }, 401);
    }

    const target = backend.replace(/\/$/, '') + url.pathname + url.search;
    const init = {
      method: req.method,
      headers: { 'content-type': 'application/json' },
    };
    if (req.method === 'POST') init.body = await req.text();

    try {
      const r = await fetch(target, init);
      const text = await r.text();
      return new Response(text, { status: r.status, headers: { 'content-type': 'application/json', ...CORS } });
    } catch (e) {
      return json({ error: 'backend unreachable', detail: String(e) }, 502);
    }
  },
};
