import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--no-sandbox'] });
const p = await b.newPage();
const r = await p.goto('https://arena-api-preview.occipital-caravan.workers.dev/health', { waitUntil: 'domcontentloaded', timeout: 30000 });
await p.waitForTimeout(3000);
const t = await p.innerText('body');
console.log('status:', r.status(), '| body:', t.slice(0, 200));
await b.close();
