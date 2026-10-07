import { chromium } from 'playwright-core';
const BASE = 'http://localhost:4000', PW = 'Demo!Passw0rd2026', OUT = 'docs/screenshots/pages';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
let n = 0;
async function sess(email) { const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true }); const p = await ctx.newPage(); await p.goto(BASE + '/login'); await p.getByLabel('Email').fill(email); await p.getByLabel('Password').fill(PW); await p.locator('button.btn-primary').click(); await p.waitForURL(BASE + '/'); return { ctx, p }; }
const api = async (p, u) => (await p.request.get(BASE + '/api' + u)).json();
async function shot(p, path, name, act) { await p.goto(BASE + path); await p.waitForTimeout(900); if (act) { await act(p); await p.waitForTimeout(500); } await p.screenshot({ path: `${OUT}/${String(++n).padStart(2, '0')}-${name}.png`, fullPage: true }); }
const tab = (name) => (p) => p.getByRole('tab', { name }).click();
{ const c = await b.newContext({ viewport: { width: 1440, height: 900 } }); const p = await c.newPage(); await p.goto(BASE + '/login'); await p.waitForTimeout(500); await p.screenshot({ path: `${OUT}/${String(++n).padStart(2, '0')}-login.png` }); await c.close(); }
{ const { ctx, p } = await sess('sales@demo.example');
  await shot(p, '/', 'overview-sales'); await shot(p, '/quotations', 'quotations-list');
  await shot(p, '/quotations?view=attention', 'quotations-list-needs-attention', (p) => p.getByRole('button', { name: 'Needs attention' }).click());
  const q = await api(p, '/quotations'); const by = (no) => q.find((x) => x.number === no);
  await shot(p, '/quotations/new', 'quotation-builder-new');
  await shot(p, `/quotations/${by('Q-2026-00002').id}/edit`, 'quotation-builder-delivery-pumping-draft');
  await shot(p, `/quotations/${by('Q-2026-00005').id}`, 'quotation-detail-returned');
  await shot(p, '/mixes', 'mix-library-sales-view'); await shot(p, '/price-book', 'forbidden-price-book-for-sales'); await ctx.close(); }
{ const { ctx, p } = await sess('finance@demo.example');
  await shot(p, '/', 'overview-pricing-finance'); const q = await api(p, '/quotations'); const pend = q.find((x) => x.status === 'pending_approval');
  await shot(p, `/quotations/${pend.id}`, 'quotation-detail-pending-approval-customer-view');
  await shot(p, `/quotations/${pend.id}`, 'quotation-detail-internal-pricing', tab('Internal pricing'));
  await shot(p, `/quotations/${pend.id}`, 'quotation-detail-revisions', tab('Revisions')); await shot(p, `/quotations/${pend.id}`, 'quotation-detail-history', tab('History'));
  await shot(p, '/approvals', 'approvals');
  await shot(p, '/price-book', 'price-book-by-plant'); await shot(p, '/price-book', 'price-book-material-by-plant', (p) => p.getByRole('button', { name: 'Material × plant' }).click());
  const bt = await api(p, '/price-batches'); await shot(p, '/price-book/updates', 'price-updates-list');
  await shot(p, `/price-book/updates/${bt.find((x) => x.status === 'submitted').id}`, 'price-update-detail-with-impact');
  for (const [t, f] of [['Monthly fixed costs', 'plant-costs-fixed'], ['Variable production costs', 'plant-costs-variable'], ['Delivery', 'plant-costs-delivery'], ['Pumping', 'plant-costs-pumping'], ['Corporate / commercial', 'plant-costs-corporate'], ['Volume sensitivity', 'plant-costs-sensitivity'], ['Versions', 'plant-costs-versions']]) await shot(p, '/plant-costs', f, tab(t));
  const m = await api(p, '/mixes'); const c30 = m.find((x) => x.code === 'C30').id;
  await shot(p, '/mixes', 'mix-library'); for (const [t, f] of [['Specification', 'mix-specification'], ['Ingredients', 'mix-ingredients'], ['Pricing', 'mix-pricing'], ['Revision history', 'mix-revision-history']]) await shot(p, `/mixes/${c30}`, f, tab(t));
  await shot(p, '/clients', 'clients-and-projects', (p) => p.getByRole('button', { name: /project\(s\)/ }).first().click());
  await shot(p, '/admin/settings', 'settings-pricing-policies-readonly-tabs'); await ctx.close(); }
{ const { ctx, p } = await sess('technical@demo.example'); await shot(p, '/', 'overview-technical'); const m = await api(p, '/mixes'); await shot(p, `/mixes/${m.find((x) => x.code === 'C30').id}`, 'mix-draft-revision-2', async (p) => { await p.locator('select').last().selectOption({ index: 0 }).catch(() => {}); }); await ctx.close(); }
{ const { ctx, p } = await sess('admin@demo.example'); await shot(p, '/', 'overview-admin');
  for (const [t, f] of [['Company', 'settings-company'], ['Plants', 'settings-plants'], ['Materials', 'settings-materials'], ['Tax policies', 'settings-tax-policies'], ['Terms', 'settings-terms'], ['Pricing policies', 'settings-pricing-policies']]) await shot(p, '/admin/settings', f, tab(t));
  await shot(p, '/admin/users', 'users'); await shot(p, '/admin/audit', 'audit-history'); await ctx.close(); }
// PDF previews from frozen revisions
{ const { ctx, p } = await sess('finance@demo.example'); const me = await api(p, '/auth/me'); const q = await api(p, '/quotations');
  for (const no of ['Q-2026-00004', 'Q-2026-00003']) for (const lang of ['en', 'ar']) { const x = q.find((y) => y.number === no); const r = await p.request.get(`${BASE}/api/quotations/${x.id}/revisions/1/pdf?lang=${lang}`); const fs = await import('node:fs'); fs.writeFileSync(`docs/pdf-previews/${no}-${lang}.pdf`, await r.body()); }
  await ctx.close(); }
await b.close(); console.log('done', n);
