// arena.js — LMArena (arena.ai) chat CLI via Playwright
// Author: Potato
//
// Requirements: Node >= 18, `npm install playwright chromium` (or playwright + chromium binary),
//   and a cookies.json next to this file containing your arena.ai session:
//   { "arena_auth_v10": "<arena-auth-prod-v1.0 cookie value>", "cf_clearance": "<cf_clearance cookie value>" }
//
// Usage:
//   node arena.js direct <model> "<message>"        # chat with one model
//   node arena.js side <modelA> <modelB> "<msg>"    # compare two models
//   node arena.js battle "<message>"                # two anonymous models
//   node arena.js agent "<message>"                 # agent mode (workspace)
//   node arena.js models                            # list available models
//   node arena.js login                             # interactive login (saves cookies automatically)
//
// Examples:
//   node arena.js direct grok-4.6 "explain quines briefly"
//   node arena.js side claude-sonnet-5-5-high gpt-6-luna-max "write a haiku about fds"

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import os from 'os';

const CHROME = process.env.ARENA_CHROME
  || path.join(os.homedir(), '.cache/ms-playwright/chromium-1254/chrome-linux64/chrome');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const BASE = 'https://arena.ai';
const COOKIE_FILE = path.join(path.dirname(new URL(import.meta.url).pathname), 'cookies.json');

function fail(msg) { console.error('ERROR: ' + msg); process.exit(2); }

function loadCookies() {
  if (!fs.existsSync(COOKIE_FILE)) {
    fail(`cookies.json not found at ${COOKIE_FILE}. Run: node arena.js login`);
  }
  const ck = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'));
  if (!ck.arena_auth_v10) fail('cookies.json missing "arena_auth_v10"');
  return ck;
}

const PROFILE = process.env.ARENA_PROFILE || path.join(path.dirname(new URL(import.meta.url).pathname), 'profile');

async function launch(ck) {
  // Persistent profile: stable fingerprint across runs keeps bot-score high.
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: process.env.ARENA_HEADLESS === '1',
    executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--lang=en-US'],
    userAgent: UA,
    locale: 'en-US',
    timezoneId: 'Asia/Jakarta',
    viewport: { width: 1366, height: 768 },
  });
  await ctx.addCookies([
    { name: 'arena-auth-prod-v1.0', value: ck.arena_auth_v10, domain: 'arena.ai', path: '/', expires: 2000000000, httpOnly: true, secure: true, sameSite: 'Lax' },
    { name: 'user_country_code', value: ck.user_country_code || 'ID', domain: 'arena.ai', path: '/' },
    ...(ck.cf_clearance ? [{ name: 'cf_clearance', value: ck.cf_clearance, domain: '.arena.ai', path: '/', expires: 2000000000, httpOnly: true, secure: true, sameSite: 'None' }] : []),
  ]);
  return { b: ctx, ctx };
}

async function isLoggedIn(pg) {
  const body = await pg.innerText('body');
  return !body.includes('Log In or Create Account');
}

// Interactive login: opens a visible browser, user logs in once, cookies are saved.
async function login() {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--lang=en-US'],
    locale: 'en-US',
    timezoneId: 'Asia/Jakarta',
    viewport: { width: 1366, height: 768 },
  });
  const pg = ctx.pages()[0] || await ctx.newPage();
  await pg.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  console.log('Browser opened. Log in at arena.ai (Google/email).');
  console.log('Waiting for login... (this checks every 3 seconds)');
  for (let i = 0; i < 600; i++) {
    await pg.waitForTimeout(3000);
    let body = '';
    try { body = await pg.innerText('body'); } catch {}
    if (body && !body.includes('Log In or Create Account') && !/404|Sign in with Google/.test(body.slice(0, 400))) {
      const cookies = await ctx.cookies('https://arena.ai');
      const auth = cookies.find(c => c.name === 'arena-auth-prod-v1.0' || c.name.startsWith('arena-auth-prod'));
      if (auth) {
        const cf = cookies.find(c => c.name === 'cf_clearance');
        const country = cookies.find(c => c.name === 'user_country_code');
        fs.writeFileSync(COOKIE_FILE, JSON.stringify({
          arena_auth_v10: auth.value,
          cf_clearance: cf ? cf.value : '',
          user_country_code: country ? country.value : 'ID',
        }, null, 2));
        console.log('LOGIN OK — cookies saved to ' + COOKIE_FILE);
        await ctx.close();
        return;
      }
    }
    if (i % 10 === 9) console.log('still waiting... (' + (i + 1) * 3 + 's)');
  }
  await ctx.close();
  fail('login timeout (30 min) — run `node arena.js login` again');
}

// List models from the catalog API using the session's access token.
async function listModels() {
  const ck = loadCookies();
  const v = ck.arena_auth_v10.replace(/^base64-/, '');
  const sess = JSON.parse(Buffer.from(v + '='.repeat((4 - (v.length % 4)) % 4), 'base64').toString());
  const at = sess.access_token;
  const res = await fetch(BASE + '/nextjs-api/model-catalog', {
    headers: { Authorization: 'Bearer ' + at, 'User-Agent': UA, Referer: BASE + '/text/direct' },
  });
  if (!res.ok) fail('model-catalog HTTP ' + res.status);
  const catalog = await res.json();
  for (const arena of catalog) {
    console.log('== ' + arena.arena + ' ==');
    for (const m of arena.models) {
      if (m.userSelectable) console.log('  ' + m.publicName + '  (' + m.organization + ')');
    }
  }
}

async function chat(mode, args) {
  const ck = loadCookies();
  const { b, ctx } = await launch(ck);
  const pg = await ctx.newPage();

  let url;
  if (mode === 'direct') url = `${BASE}/text/direct?model_a=${encodeURIComponent(args[0])}`;
  else if (mode === 'side') url = `${BASE}/text/side-by-side?model_a=${encodeURIComponent(args[0])}&model_b=${encodeURIComponent(args[1])}`;
  else if (mode === 'battle') url = `${BASE}/text`;
  else if (mode === 'agent') url = `${BASE}/agent`;
  else fail('unknown mode: ' + mode);

  // Warmup: land on home first so the nav looks human and v3 score rises.
  await pg.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
  await pg.waitForTimeout(5000);

  let loaded = false;
  for (let i = 0; i < 3 && !loaded; i++) {
    await pg.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await pg.waitForTimeout(8000);
    const btxt = await pg.innerText('body');
    if (btxt.includes('MIDDLEWARE_INVOCATION_FAILED')) {
      console.error('server 500, retrying (' + (i + 1) + '/3)...');
      await pg.waitForTimeout(6000);
    } else loaded = true;
  }
  if (!loaded) fail('arena.ai page keeps failing (500)');

  if (await isLoggedIn(pg) === false) {
    await ctx.close();
    fail('not logged in — cookies expired, re-export them from the browser');
  }
  if ((await pg.innerText('body')).includes('reached your usage limit')) {
    await ctx.close();
    fail('daily usage limit reached for this account — resets at 7:59 (account timezone)');
  }

  const message = args[mode === 'side' ? 2 : (mode === 'direct' ? 1 : 0)];
  if (!message) fail('missing message argument');

  // Agent mode uses a contenteditable box; other modes use a textarea.
  const isAgent = mode === 'agent';
  const input = isAgent ? pg.locator('[contenteditable="true"]').first() : pg.locator('textarea:not([name="g-recaptcha-response"])').first();
  await input.click();
  await pg.keyboard.type(message, { delay: 15 });
  await pg.waitForTimeout(700);
  await pg.locator('button[aria-label*="Send" i]').first().click({ force: true });

  // Wait for the response to settle (send button returns / body stops growing).
  let lastLen = 0, stable = 0;
  for (let i = 0; i < 120; i++) {
    await pg.waitForTimeout(2500);
    const len = (await pg.innerText('body')).length;
    if (len === lastLen) { stable++; if (stable >= 3) break; } else stable = 0;
    lastLen = len;
  }
  const body = await pg.innerText('body');

  if (mode === 'direct') {
    // Answer appears after the echoed prompt; print text after the user message.
    const idx = body.lastIndexOf(message);
    console.log(body.slice(idx + message.length).trim() || '(empty response)');
  } else if (mode === 'side' || mode === 'battle') {
    // Two panels; split naively around the vote row markers.
    console.log(body.slice(body.indexOf(message) + message.length).trim() || '(empty response)');
  } else {
    console.log(body.slice(body.indexOf(message) + message.length).trim() || '(empty response)');
  }
  await ctx.close();
}

const [mode, ...rest] = process.argv.slice(2);
if (!mode || mode === '-h' || mode === '--help') {
  console.log('Usage: node arena.js <direct|side|battle|agent|models> [args]');
  console.log('  node arena.js direct <model> "<message>"');
  console.log('  node arena.js side <modelA> <modelB> "<message>"');
  console.log('  node arena.js battle "<message>"');
  console.log('  node arena.js agent "<message>"');
  console.log('  node arena.js models');
  process.exit(0);
}
if (mode === 'login') await login();
else if (mode === 'models') await listModels();
else await chat(mode, rest);
