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
await pg.goto('https://arena.ai/text', { waitUntil: 'domcontentloaded', timeout: 60000 });
await pg.waitForTimeout(8000);
const ta = pg.locator('textarea:not([name="g-recaptcha-response"])').first();
await ta.click();
await pg.keyboard.type('Say hi in exactly 3 words', { delay: 40 });
await pg.waitForTimeout(1000);
await pg.locator('button[aria-label*="Send" i]').first().click({ force: true });
await pg.waitForTimeout(6000);
let body = await pg.innerText('body');
console.log('BATTLE loginModal?', body.includes('Log In or Create Account'), '| generating?', body.includes('Generating'));
await pg.waitForTimeout(30000);
body = await pg.innerText('body');
const idx = body.lastIndexOf('Say hi in exactly 3 words');
console.log('BATTLE ANSWER:', JSON.stringify(body.slice(idx + 25, idx + 150)));
await b.close();
