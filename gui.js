// gui.js — arena.ai desktop GUI app
// Author: Potato
//
// Runs a local web app in a real Chromium window (Playwright, already a
// dependency of arena-cli). Works on Linux Mint / XFCE — opens as a normal
// window on your desktop.
//
// Usage:
//   npm install playwright && npx playwright install chromium
//   node gui.js
//
// Flow:
//   1. Click "Login to Arena" -> a real arena.ai tab opens
//   2. Log in yourself (Google, pass reCAPTCHA if asked — you're on your own
//      home IP so scores are fine)
//   3. Session cookies are captured automatically and saved to cookies.json
//   4. Chat from the GUI in direct / side-by-side / battle / agent modes

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_PORT = 3555;
const CHROME = process.env.ARENA_CHROME
  || path.join(process.env.HOME, '.cache/ms-playwright/chromium-1254/chrome-linux64/chrome');
const BASE = 'https://arena.ai';
const COOKIE_FILE = path.join(__dirname, 'cookies.json');
const PROFILE = process.env.ARENA_PROFILE || path.join(__dirname, 'gui-profile');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ---------- state ----------
let ctx = null;        // persistent browser context (holds real cookies)
let appPage = null;    // the GUI tab
let arenaPage = null;  // login/chat tab on arena.ai
let loginWatch = null;
let modelsCache = null;

function cookiesSaved() {
  try {
    const ck = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'));
    return Boolean(ck.arena_auth_v10);
  } catch { return false; }
}

function saveCookiesFromContext() {
  // capture session cookie from the live browser context
  const all = ctx ? ctx.cookies('https://arena.ai') : null;
  return ctx.cookies('https://arena.ai').then(list => {
    const auth = list.find(c => c.name === 'arena-auth-prod-v1.0' || c.name === 'arena-auth-prod-v1.1');
    if (!auth) return false;
    fs.writeFileSync(COOKIE_FILE, JSON.stringify({
      arena_auth_v10: auth.value.startsWith('base64-') ? auth.value : 'base64-' + auth.value,
      cf_clearance: (list.find(c => c.name === 'cf_clearance') || {}).value || '',
      user_country_code: (list.find(c => c.name === 'user_country_code') || {}).value || 'ID',
    }, null, 2));
    return true;
  });
}

async function launchBrowser() {
  if (ctx) return ctx;
  ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false, // a real visible window — this IS the app
    executablePath: fs.existsSync(CHROME) ? CHROME : undefined,
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--lang=en-US', '--window-size=1100,760', '--app=' + `http://localhost:${APP_PORT}`],
    userAgent: UA, locale: 'en-US', timezoneId: 'Asia/Jakarta',
    viewport: { width: 1080, height: 740 },
  });
  return ctx;
}

function broadcast(event, data) {
  if (!appPage) return;
  appPage.evaluate((e, d) => window.__onEvent && window.__onEvent(e, d), event, data).catch(() => {});
}

// ---------- login flow ----------
async function startLogin() {
  await launchBrowser();
  arenaPage = ctx.pages().find(p => p !== appPage) || await ctx.newPage();
  await arenaPage.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
  broadcast('login', 'Browser opened — log in with Google. Pass any challenge yourself, then wait here.');
  clearInterval(loginWatch);
  loginWatch = setInterval(async () => {
    try {
      if (!ctx) return clearInterval(loginWatch);
      const saved = await saveCookiesFromContext();
      if (saved) {
        clearInterval(loginWatch);
        broadcast('login', 'LOGIN_OK');
        // verify by opening text page once
        modelsCache = null;
      }
    } catch { /* page navigating; keep watching */ }
  }, 2500);
}

// ---------- chat ----------
async function doChat({ message, model, modelB, mode }) {
  if (!cookiesSaved()) throw new Error('Not logged in yet — click Login to Arena first');
  mode = mode || (modelB ? 'side' : 'direct');
  let url;
  if (mode === 'direct') url = `${BASE}/text/direct?model_a=${encodeURIComponent(model || 'Max')}`;
  else if (mode === 'side') url = `${BASE}/text/side-by-side?model_a=${encodeURIComponent(model)}&model_b=${encodeURIComponent(modelB)}`;
  else if (mode === 'battle') url = `${BASE}/text`;
  else if (mode === 'agent') url = `${BASE}/agent`;
  else throw new Error('unknown mode: ' + mode);

  await launchBrowser();
  arenaPage = ctx.pages().find(p => p !== appPage) || await ctx.newPage();
  await arenaPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await arenaPage.waitForTimeout(6000);

  const body = await arenaPage.innerText('body');
  if (body.includes('Log In or Create Account') && !body.includes('Continue with Google')) {
    // could be the post-send modal; check composer presence instead
  }
  if (body.includes('reached your usage limit')) throw new Error('Daily usage limit reached — resets ~7:59');
  if (body.includes('Security Verification')) throw new Error('Security verification open in the arena tab — solve it there, then retry');

  // TOU consent (first ever send): press Enter to agree
  let pb = await arenaPage.innerText('body');
  if (pb.includes('hit Enter on your keyboard') || pb.includes('By clicking')) {
    await arenaPage.keyboard.press('Enter');
    await arenaPage.waitForTimeout(2500);
    await arenaPage.keyboard.press('Escape').catch(() => {});
    await arenaPage.waitForTimeout(1200);
  }

  const input = mode === 'agent'
    ? arenaPage.locator('[contenteditable="true"]').first()
    : arenaPage.locator('textarea:not([name="g-recaptcha-response"])').first();
  await input.click();
  await arenaPage.keyboard.type(message, { delay: 10 });
  await arenaPage.waitForTimeout(600);
  await arenaPage.locator('button[aria-label*="Send" i]').first().click({ force: true });
  await arenaPage.waitForTimeout(3000);

  // first-ever send TOU re-check
  let pb2 = await arenaPage.innerText('body');
  if (pb2.includes('hit Enter on your keyboard') || pb2.includes('By clicking')) {
    await arenaPage.keyboard.press('Enter');
    await arenaPage.waitForTimeout(3000);
    await arenaPage.keyboard.press('Escape').catch(() => {});
    await arenaPage.waitForTimeout(1200);
    const still = arenaPage.locator('textarea:not([name="g-recaptcha-response"])').first();
    const val = await still.inputValue().catch(() => '');
    if (!val) {
      await still.click().catch(() => {});
      await arenaPage.keyboard.type(message, { delay: 10 });
      await arenaPage.waitForTimeout(600);
      await arenaPage.locator('button[aria-label*="Send" i]').first().click({ force: true });
      await arenaPage.waitForTimeout(3000);
    }
  }

  // wait for the response to finish streaming
  let lastLen = 0, stable = 0;
  for (let i = 0; i < 100; i++) {
    await arenaPage.waitForTimeout(2500);
    const len = (await arenaPage.innerText('body')).length;
    if (len === lastLen) { stable++; if (stable >= 3) break; } else stable = 0;
    lastLen = len;
  }
  const finalBody = await arenaPage.innerText('body');
  if (finalBody.includes('reached your usage limit')) throw new Error('Daily usage limit reached — resets ~7:59');
  const idx = finalBody.lastIndexOf(message);
  const answer = (idx >= 0 ? finalBody.slice(idx + message.length) : finalBody).trim();
  return { mode, model: model || null, modelB: modelB || null, answer };
}

async function listModels() {
  if (modelsCache) return modelsCache;
  const ck = JSON.parse(fs.readFileSync(COOKIE_FILE, 'utf8'));
  const v = ck.arena_auth_v10.replace(/^base64-/, '');
  const sess = JSON.parse(Buffer.from(v + '='.repeat((4 - (v.length % 4)) % 4), 'base64').toString());
  const res = await fetch(BASE + '/nextjs-api/model-catalog', {
    headers: { Authorization: 'Bearer ' + sess.access_token, 'User-Agent': UA, Referer: BASE + '/text/direct' },
  });
  if (!res.ok) throw new Error('model-catalog HTTP ' + res.status);
  const catalog = await res.json();
  const text = catalog.find(a => a.arena === 'text');
  modelsCache = text ? text.models.filter(m => m.userSelectable).map(m => ({ name: m.publicName, org: m.organization })) : [];
  return modelsCache;
}

// ---------- GUI page ----------
const GUI_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>arena-cli GUI</title><style>
:root{--bg:#111318;--card:#1b1f26;--acc:#f97316;--txt:#e7e9ee;--mut:#8b93a1}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui;background:var(--bg);color:var(--txt)}
header{display:flex;align-items:center;gap:12px;padding:14px 20px;background:var(--card);border-bottom:1px solid #2a3038}
header h1{font-size:17px;margin:0}header .dot{width:9px;height:9px;border-radius:50%;background:#555}
header .dot.on{background:#22c55e}
main{max-width:860px;margin:0 auto;padding:20px}
.card{background:var(--card);border:1px solid #2a3038;border-radius:12px;padding:16px;margin-bottom:16px}
button{background:var(--acc);color:#fff;border:0;border-radius:8px;padding:10px 18px;font-size:15px;cursor:pointer}
button.sec{background:#2a3038}button:disabled{opacity:.5;cursor:default}
select,input,textarea{background:#0e1116;border:1px solid #2a3038;color:var(--txt);border-radius:8px;padding:10px;font-size:15px;width:100%}
.row{display:flex;gap:10px}.row>*{flex:1}
label{font-size:12px;color:var(--mut);display:block;margin-bottom:5px;text-transform:uppercase;letter-spacing:.5px}
#chat{height:340px;overflow-y:auto;display:flex;flex-direction:column;gap:10px}
.msg{padding:10px 14px;border-radius:10px;max-width:80%;white-space:pre-wrap;word-break:break-word}
.msg.u{align-self:flex-end;background:#3b2f21;border:1px solid #5a4630}
.msg.a{align-self:flex-start;background:#1f2733;border:1px solid #2f3b4a}
.status{color:var(--mut);font-size:13px}
</style></head><body>
<header><div class="dot" id="dot"></div><h1>arena-cli</h1><span class="status" id="status">checking login…</span>
<span style="flex:1"></span><button class="sec" id="loginBtn">Login to Arena</button></header>
<main>
<div class="card"><div class="row">
<div><label>Mode</label><select id="mode"><option value="direct">Direct</option><option value="side">Side by Side</option><option value="battle">Battle</option><option value="agent">Agent</option></select></div>
<div><label>Model A</label><select id="modelA"></select></div>
<div id="wb" style="display:none"><label>Model B</label><select id="modelB"></select></div>
</div></div>
<div class="card"><div id="chat"></div>
<div style="margin-top:12px"><textarea id="msg" rows="2" placeholder="Type your message…"></textarea>
<div style="margin-top:10px;display:flex;gap:10px"><button id="send" style="flex:1">Send</button></div></div></div>
<div class="status" id="err"></div>
</main><script>
const chat=document.getElementById('chat'),err=document.getElementById('err');
window.__onEvent=(e,d)=>{ if(e==='login'){ if(d==='LOGIN_OK'){refresh()} else document.getElementById('status').textContent=d } };
async function api(p,body){const r=await fetch(p,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{});const j=await r.json();if(!r.ok||j.error)throw new Error(j.error||j.answer?.slice(0,120)||'HTTP '+r.status);return j}
async function refresh(){try{const s=await api('/api/status');document.getElementById('dot').className='dot'+(s.login?' on':'');document.getElementById('status').textContent=s.login?'Logged in':'Not logged in';const m=await api('/api/models');for(const id of['modelA','modelB']){const el=document.getElementById(id);el.innerHTML=m.models.map(x=>'<option>'+x.name+'</option>').join('')}}catch(e){document.getElementById('status').textContent=e.message}}
document.getElementById('mode').onchange=e=>{document.getElementById('wb').style.display=e.target.value==='side'?'':'none'};
document.getElementById('loginBtn').onclick=async()=>{document.getElementById('status').textContent='Browser opening — log in there…';await api('/api/login',{});};
document.getElementById('send').onclick=async()=>{
 const m=document.getElementById('msg').value.trim();if(!m)return;
 err.textContent='';document.getElementById('send').disabled=true;
 chat.insertAdjacentHTML('beforeend','<div class="msg u"></div>');chat.lastChild.textContent=m;
 chat.insertAdjacentHTML('beforeend','<div class="msg a" id="wait">thinking…</div>');chat.scrollTop=1e9;
 try{const r=await api('/api/chat',{message:m,model:document.getElementById('modelA').value,modelB:document.getElementById('modelB').value,mode:document.getElementById('mode').value});
 document.getElementById('wait').id='';chat.lastChild.textContent=r.answer||'(empty)'}catch(e){document.getElementById('wait').id='';chat.lastChild.textContent='⚠️ '+e.message;err.textContent=e.message}
 document.getElementById('msg').value='';document.getElementById('send').disabled=false;chat.scrollTop=1e9;};
refresh();
</script></body></html>`;

// ---------- http server ----------
let busy = false;
const server = http.createServer(async (req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  try {
    if (p === '/' ) { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(GUI_HTML); }
    if (p === '/api/status') return send(200, { login: cookiesSaved(), busy });
    if (p === '/api/models') return send(200, { models: await listModels() });
    if (p === '/api/login' && req.method === 'POST') { await startLogin(); return send(200, { started: true }); }
    if (p === '/api/chat' && req.method === 'POST') {
      if (busy) return send(429, { error: 'another chat is still running — wait a moment' });
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        try {
          busy = true;
          const out = await doChat(JSON.parse(body || '{}'));
          send(200, out);
        } catch (e) { send(500, { error: e.message || String(e) }); }
        finally { busy = false; }
      });
      return;
    }
    send(404, { error: 'not found' });
  } catch (e) { send(500, { error: e.message || String(e) }); }
});

server.listen(APP_PORT, '127.0.0.1', async () => {
  console.log(`arena-cli GUI: http://localhost:${APP_PORT}`);
  try {
    await launchBrowser();
    appPage = ctx.pages()[0] || await ctx.newPage();
    await appPage.goto(`http://localhost:${APP_PORT}`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    console.log('App window opened. Log in once, then chat.');
  } catch (e) {
    console.error('Browser window failed:', e.message);
    console.log(`Open http://localhost:${APP_PORT} in your browser instead.`);
  }
});
