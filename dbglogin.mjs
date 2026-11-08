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
await pg.goto('https://arena.ai/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await pg.waitForTimeout(6000);
const body0 = await pg.innerText('body');
console.log('HOME loginModal?', body0.includes('Log In or Create Account'));
console.log('HOME limit?', body0.includes('usage limit'));
// login? check via history API state: find avatar / username
console.log('HOME head:', JSON.stringify(body0.slice(0,150)));
await b.close();
