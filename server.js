// server.js — arena.ai HTTP API wrapper
// Author: Potato
//
// Endpoints:
//   GET  /models                 -> list model catalog
//   POST /set-cookies            -> { arena_auth_v10, cf_clearance?, user_country_code? } (saves cookies.json)
//   POST /chat                   -> { message, model?, modelB?, mode? } mode: direct|side|battle|agent
//   GET  /health                 -> ok
//
// All chat requests are serialized (one browser task at a time) to avoid arena.ai rate limits.

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHROME = process.env.ARENA_CHROME
  || path.join(process.env.HOME, '.cache/ms-playwright/chromium-1254/chrome-linux64/chrome');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const BASE = 'https://arena.ai';
const COOKIE_FILE = path.join(__dirname, 'cookies.json');
const PROFILE = process.env.ARENA_PROFILE || path.join(__dirname, 'profile');
const PORT = process.env.PORT || 3123;
const API_KEY = process.env.ARENA_API_KEY || ''; // optional shared secret

function fail(res, code, msg) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: msg })); }
function ok(res, obj) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }

function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', c => { d += c; if (d.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(d || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function auth(req) {
  if (!API_KEY) return true;
  return req.headers['x-api-key'] === API_KEY;
}

// ---- browser task queue ----
let chain = Promise.resolve();
function enqueue(fn) {
  const p = chain.then(fn, fn);
  chain = p.catch(() => {});
  return p;
}

async function withPage(fn) {
  const ck = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'));
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: process.env.ARENA_HEADLESS === '1',
    executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--lang=en-US'],
    userAgent: UA, locale: 'en-US', timezoneId: 'Asia/Jakarta',
    viewport: { width: 1366, height: 768 },
  });
  await ctx.addCookies([
    { name: 'arena-auth-prod-v1.0', value: ck.arena_auth_v10, domain: 'arena.ai', path: '/', expires: 2000000000, httpOnly: true, secure: true, sameSite: 'Lax' },
    { name: 'user_country_code', value: ck.user_country_code || 'ID', domain: 'arena.ai', path: '/' },
    ...(ck.cf_clearance ? [{ name: 'cf_clearance', value: ck.cf_clearance, domain: '.arena.ai', path: '/', expires: 2000000000, httpOnly: true, secure: true, sameSite: 'None' }] : []),
  ]);
  try { return await fn(ctx); } finally { await ctx.close().catch(() => {}); }
}

function extractAnswer(body, prompt) {
  const idx = body.lastIndexOf(prompt);
  return (idx >= 0 ? body.slice(idx + prompt.length) : body).trim();
}

async function doChat({ message, model, modelB, mode }) {
  mode = mode || (modelB ? 'side' : 'direct');
  let url;
  if (mode === 'direct') url = `${BASE}/text/direct?model_a=${encodeURIComponent(model || 'Max')}`;
  else if (mode === 'side') url = `${BASE}/text/side-by-side?model_a=${encodeURIComponent(model)}&model_b=${encodeURIComponent(modelB)}`;
  else if (mode === 'battle') url = `${BASE}/text`;
  else if (mode === 'agent') url = `${BASE}/agent`;
  else throw new Error('unknown mode: ' + mode);

  return withPage(async (ctx) => {
    const pg = await ctx.newPage();
    await pg.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
    await pg.waitForTimeout(4000);
    let loaded = false;
    for (let i = 0; i < 3 && !loaded; i++) {
      await pg.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
      await pg.waitForTimeout(8000);
      const btxt = await pg.innerText('body');
      if (btxt.includes('MIDDLEWARE_INVOCATION_FAILED')) { await pg.waitForTimeout(6000); continue; }
      loaded = true;
    }
    if (!loaded) throw new Error('arena.ai page keeps failing (500)');

    const body = await pg.innerText('body');
    if (body.includes('Log In or Create Account')) throw new Error('not logged in — cookies expired, POST /set-cookies again');
    if (body.includes('reached your usage limit')) throw new Error('daily usage limit reached — resets ~7:59');
    if (body.includes('Security Verification')) throw new Error('security verification required — run one chat manually in the profile browser to clear, or retry later');

    // TOU consent dialog: accept once if present (Enter = agree)
    let pb = await pg.innerText('body');
    if (pb.includes('hit Enter on your keyboard') || pb.includes('By clicking')) {
      await pg.keyboard.press('Enter');
      await pg.waitForTimeout(2500);
      // login upsell modal may appear after — dismiss with Escape
      await pg.keyboard.press('Escape').catch(() => {});
      await pg.waitForTimeout(1500);
    }

    const input = mode === 'agent'
      ? pg.locator('[contenteditable="true"]').first()
      : pg.locator('textarea:not([name="g-recaptcha-response"])').first();
    await input.click();
    await pg.keyboard.type(message, { delay: 12 });
    await pg.waitForTimeout(700);
    await pg.locator('button[aria-label*="Send" i]').first().click({ force: true });
    await pg.waitForTimeout(3500);

    // TOU dialog appears on first-ever send: accept (Enter), dismiss login modal (Esc), send again
    let pb2 = await pg.innerText('body');
    if (pb2.includes('hit Enter on your keyboard') || pb2.includes('By clicking')) {
      await pg.keyboard.press('Enter');
      await pg.waitForTimeout(3000);
      await pg.keyboard.press('Escape').catch(() => {});
      await pg.waitForTimeout(1500);
      const still = pg.locator('textarea:not([name="g-recaptcha-response"])').first();
      let val = await still.inputValue().catch(() => '');
      if (!val) {
        // modal login wiped the composer — refill and resend
        await still.click().catch(() => {});
        await pg.keyboard.type(message, { delay: 12 });
        await pg.waitForTimeout(700);
      }
      await pg.locator('button[aria-label*="Send" i]').first().click({ force: true });
      await pg.waitForTimeout(3000);
    }

    let lastLen = 0, stable = 0;
    for (let i = 0; i < 120; i++) {
      await pg.waitForTimeout(2500);
      const len = (await pg.innerText('body')).length;
      if (len === lastLen) { stable++; if (stable >= 3) break; } else stable = 0;
      lastLen = len;
    }
    const finalBody = await pg.innerText('body');
    fs.appendFileSync('/tmp/arena-debug.log', `[chat] url=${pg.url()} loginModal=${finalBody.includes('Log In or Create Account')} tou=${finalBody.includes('hit Enter')}\n`); if (false) console.error('[chat] url after:', pg.url(), '| login modal:', finalBody.includes('Log In or Create Account'), '| TOU:', finalBody.includes('hit Enter'));
    if (finalBody.includes('reached your usage limit')) throw new Error('daily usage limit reached — resets ~7:59');
    return { mode, model: model || null, modelB: modelB || null, answer: extractAnswer(finalBody, message) };
  });
}

async function listModelsApi() {
  const ck = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'));
  const v = ck.arena_auth_v10.replace(/^base64-/, '');
  const sess = JSON.parse(Buffer.from(v + '='.repeat((4 - (v.length % 4)) % 4), 'base64').toString());
  const res = await fetch(BASE + '/nextjs-api/model-catalog', {
    headers: { Authorization: 'Bearer ' + sess.access_token, 'User-Agent': UA, Referer: BASE + '/text/direct' },
  });
  if (!res.ok) throw new Error('model-catalog HTTP ' + res.status);
  const catalog = await res.json();
  return catalog.map(a => ({ arena: a.arena, models: a.models.filter(m => m.userSelectable).map(m => ({ name: m.publicName, org: m.organization })) }));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/health') return ok(res, { status: 'ok', queue_pending: chain === Promise.resolve() ? 0 : 1 });

    if (!auth(req)) return fail(res, 401, 'bad x-api-key');

    if (p === '/set-cookies' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.arena_auth_v10) return fail(res, 400, 'arena_auth_v10 required');
      fs.writeFileSync(COOKIE_FILE, JSON.stringify({
        arena_auth_v10: body.arena_auth_v10,
        cf_clearance: body.cf_clearance || '',
        user_country_code: body.user_country_code || 'ID',
      }, null, 2));
      return ok(res, { saved: true });
    }

    if (p === '/models' && req.method === 'GET') {
      return ok(res, await listModelsApi());
    }

    if (p === '/chat' && req.method === 'POST') {
      const body = await readBody(req);
      if (!body.message) return fail(res, 400, 'message required');
      const result = await enqueue(() => Promise.race([
        doChat(body),
        new Promise((_, rej) => setTimeout(() => rej(new Error('chat task timeout (150s)')), 150000)),
      ]));
      return ok(res, result);
    }

    fail(res, 404, 'not found');
  } catch (e) {
    fail(res, 500, e.message || String(e));
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`arena-api listening on :${PORT}`));
