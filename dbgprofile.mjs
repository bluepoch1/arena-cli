import { chromium } from 'playwright';
const b = await chromium.launchPersistentContext('/tmp/arena-repo/profile', {
  headless: false,
  executablePath: '/home/agentuser/.cache/ms-playwright/chromium-1254/chrome-linux64/chrome',
  args: ['--no-sandbox','--disable-blink-features=AutomationControlled'],
});
const pg = b.pages()[0] || await b.newPage();
await pg.goto('https://arena.ai/text', { waitUntil: 'domcontentloaded', timeout: 60000 });
await pg.waitForTimeout(8000);
const body0 = await pg.innerText('body');
console.log('LOGIN?', !body0.includes('Log In or Create Account'));
const ta = pg.locator('textarea:not([name="g-recaptcha-response"])').first();
await ta.click();
await pg.keyboard.type('Say hi in exactly 3 words', { delay: 40 });
await pg.waitForTimeout(1000);
await pg.locator('button[aria-label*="Send" i]').first().click({ force: true });
await pg.waitForTimeout(6000);
let body = await pg.innerText('body');
console.log('AFTER loginModal?', body.includes('Log In or Create Account'));
await pg.waitForTimeout(30000);
body = await pg.innerText('body');
const idx = body.lastIndexOf('Say hi in exactly 3 words');
console.log('ANSWER:', JSON.stringify(body.slice(idx + 25, idx + 120)));
await b.close();
