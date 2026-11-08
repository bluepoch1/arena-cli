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
await pg.waitForTimeout(8000);
// trigger token refresh: goto a chat page (auth-aware)
await pg.goto('https://arena.ai/text/direct?model_a=max', { waitUntil: 'domcontentloaded', timeout: 60000 });
await pg.waitForTimeout(8000);
const cookies = await b.cookies('https://arena.ai');
const auth = cookies.find(c => c.name.startsWith('arena-auth-prod'));
if (auth) {
  fs.writeFileSync('/tmp/arena-repo/cookies.json', JSON.stringify({
    arena_auth_v10: auth.value,
    cf_clearance: (cookies.find(c => c.name === 'cf_clearance') || {}).value || ck.cf_clearance,
    user_country_code: 'ID',
  }, null, 2));
  console.log('NEW AUTH COOKIE SAVED, name:', auth.name, 'len:', auth.value.length);
} else console.log('NO AUTH COOKIE FOUND');
await b.close();
