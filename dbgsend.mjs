import { chromium } from 'playwright';
import fs from 'fs';
const ck = JSON.parse(fs.readFileSync('/tmp/arena-repo/cookies.json','utf8'));
const b = await chromium.launchPersistentContext('/tmp/arena-repo/profile', {
  headless: false,
  executablePath: '/home/agentuser/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome',
  args: ['--no-sandbox','--disable-blink-features=AutomationControlled'],
});
await b.addCookies([
  { name: 'arena-auth-prod-v1.0', value: ck.arena_auth_v10, domain: 'arena.ai', path: '/', expires: 2000000000, httpOnly: true, secure: true, sameSite: 'Lax' },
  { name: 'cf_clearance', value: ck.cf_clearance, domain: '.arena.ai', path: '/', expires: 2000000000, httpOnly: true, secure: true, sameSite: 'None' },
]);
const pg = b.pages()[0] || await b.newPage();
const events = [];
pg.on('response', async rr => {
  const u = rr.url();
  if (rr.request().method() === 'POST' && u.includes('create-evaluation')) {
    let body = '';
    try { body = (await rr.text()).slice(0, 300); } catch {}
    events.push({ s: rr.status(), u: u.slice(0,80), body });
  }
});
await pg.goto('https://arena.ai/text/direct?model_a=max', { waitUntil: 'domcontentloaded', timeout: 60000 });
await pg.waitForTimeout(8000);
const body0 = await pg.innerText('body');
console.log('PRE loginModal?', body0.includes('Log In or Create Account'), '| logged in?', !body0.includes('Log In or Create Account'));
const ta = pg.locator('textarea:not([name="g-recaptcha-response"])').first();
await ta.click();
await pg.keyboard.type('Say hi in exactly 3 words', { delay: 40 });
await pg.waitForTimeout(1000);
await pg.locator('button[aria-label*="Send" i]').first().click({ force: true });
await pg.waitForTimeout(8000);
console.log('create-evaluation responses:', JSON.stringify(events, null, 1).slice(0, 800));
const body = await pg.innerText('body');
console.log('POST loginModal?', body.includes('Log In or Create Account'));
await b.close();
