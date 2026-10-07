// Captures documentation screenshots of the running demo tenant (npm run db:seed:demo, then start the app on :4000).
import { chromium } from 'playwright-core';
const BASE = process.env.BASE ?? 'http://localhost:4000'; const PW = process.env.DEMO_PASSWORD ?? 'Demo!Passw0rd2026';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
async function session(email, w = 1440, h = 900) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } }); const page = await ctx.newPage();
  await page.goto(`${BASE}/login`); await page.getByLabel('Email').fill(email); await page.getByLabel('Password').fill(PW); await page.locator('button.btn-primary').click(); await page.waitForURL(`${BASE}/`);
  return { ctx, page };
}
const shot = async (page, path, file, after) => { await page.goto(BASE + path); await page.waitForTimeout(900); if (after) await after(page); await page.waitForTimeout(400); await page.screenshot({ path: `docs/screenshots/${file}.png` }); console.log('saved', file); };
const api = async (page, url) => (await (await page.request.get(`${BASE}/api${url}`)).json());
{ const { ctx, page } = await session('sales@demo.example');
  await shot(page, '/', '01-overview-sales');
  await shot(page, '/quotations', '02-quotation-list');
  const q = await api(page, '/quotations'); const draft = q.find((x) => x.number === 'Q-2026-00002');
  await shot(page, `/quotations/${draft.id}/edit`, '03-quotation-builder', (p) => p.getByRole('link', { name: /Review & issue/ }).click());
  await page.setViewportSize({ width: 360, height: 800 }); await shot(page, `/quotations/${draft.id}/edit`, '10-mobile-builder');
  await page.setViewportSize({ width: 1440, height: 900 });
  await shot(page, '/price-book', '11-forbidden-for-sales'); await ctx.close(); }
{ const { ctx, page } = await session('finance@demo.example');
  const q = await api(page, '/quotations'); const pend = q.find((x) => x.status === 'pending_approval');
  await shot(page, `/quotations/${pend.id}`, '04-approval-banner');
  await shot(page, `/quotations/${pend.id}`, '05-internal-pricing', (p) => p.getByRole('tab', { name: 'Internal pricing' }).click());
  await shot(page, '/price-book', '06-price-book');
  const b = await api(page, '/price-batches'); await shot(page, `/price-book/updates/${b.find((x) => x.status === 'submitted').id}`, '07-price-update-impact');
  await shot(page, '/plant-costs', '08-plant-costs', (p) => p.getByRole('tab', { name: 'Volume sensitivity' }).click());
  const m = await api(page, '/mixes'); await shot(page, `/mixes/${m.find((x) => x.code === 'C30').id}`, '09-mix-pricing', (p) => p.getByRole('tab', { name: 'Pricing' }).click());
  await shot(page, '/', '12-overview-pricing');
  await shot(page, '/quotations', '13-arabic-quotation-list', async (p) => { await p.getByRole('button', { name: 'Switch language' }).click(); await p.waitForTimeout(500); });
  await page.request.post(`${BASE}/api/auth/locale`, { headers: { 'X-CSRF-Token': (await api(page, '/auth/me')).csrfToken }, data: { locale: 'en' } });
  await ctx.close(); }
await browser.close();
