import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import { dialog, roleContext, state, iso, pickClient } from './helpers';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

test.describe.configure({ mode: 'serial' });

async function addLine(page: Page, qty: string | null) {
  await page.getByRole('button', { name: 'Add first mix line' }).click();
  await page.getByRole('combobox', { name: 'Mix', exact: true }).click(); await page.getByRole('combobox', { name: 'Mix', exact: true }).fill('C30');
  await page.getByRole('option', { name: /C30/ }).first().click();
  if (qty !== null) await page.getByLabel(/^Quantity/).first().fill(qty);
}
async function commercial(page: Page) {
  await page.getByLabel('Terms template').selectOption({ index: 1 });
  await page.getByLabel('Payment terms').fill('50% advance, balance within 30 days (e2e wording).');
}
async function pdfText(path: string) {
  const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(path)), useSystemFonts: true }).promise;
  let text = ''; for (let i = 1; i <= doc.numPages; i++) text += (await (await doc.getPage(i)).getTextContent()).items.map((x: any) => x.str).join(' ') + '\n';
  return { text, pages: doc.numPages };
}

test('sales: corrects a missing quantity from the error summary; simple quotation drafted in under two minutes', async ({ browser }) => {
  const { ctx, page } = await roleContext(browser, 'sales@e2e.example');
  const t0 = Date.now();
  await page.getByRole('link', { name: 'New quotation' }).first().click();
  await pickClient(page);
  await expect(page.getByRole('combobox', { name: 'Project', exact: true })).toHaveValue('Tower A');
  await expect(page.getByLabel('Supplying plant')).toHaveValue(state.plantId);
  await addLine(page, null); // quantity deliberately left empty
  await commercial(page);
  await expect(page.getByText('Saved', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Submit for approval' }).click();
  const summary = page.getByRole('alert').filter({ hasText: 'need your attention' });
  await expect(summary).toBeVisible();
  await expect(summary.getByRole('link', { name: /Enter a valid quantity in m³ for C30/ })).toBeVisible();
  await summary.getByRole('link', { name: /Enter a valid quantity/ }).click();
  await expect(page.getByLabel(/^Quantity/).first()).toBeFocused(); // focus moved to the affected field
  await page.getByLabel(/^Quantity/).first().fill('50');
  await expect(page.getByText('Saved', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/Customer total/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Submit for approval' }).click();
  await expect(page.getByText('Approved', { exact: true }).first()).toBeVisible(); // no approval reason → auto-approved
  const elapsed = Date.now() - t0;
  state.simpleQuoteMs = elapsed;
  fs.mkdirSync('e2e/results', { recursive: true });
  fs.writeFileSync('e2e/results/timing.json', JSON.stringify({ flow: 'new quotation → submitted (existing client + approved mix; includes one validation round-trip)', ms: elapsed, seconds: +(elapsed / 1000).toFixed(1), limitSeconds: 120 }, null, 2));
  expect(elapsed).toBeLessThan(120_000);
  await ctx.close();
});

test('sales cannot retrieve internal costs (API + UI), sees only customer prices', async ({ browser }) => {
  const { ctx, page } = await roleContext(browser, 'sales@e2e.example');
  for (const u of ['/api/price-book', `/api/plant-costs?plantId=${state.plantId}`, '/api/price-batches', '/api/pricing-policies']) expect((await page.request.get(u)).status(), u).toBe(403);
  await page.goto('/price-book'); await expect(page.getByRole('heading', { name: 'Access restricted' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Price Book' })).toHaveCount(0);
  const q = await (await page.request.get('/api/quotations')).json();
  const detail = await (await page.request.get(`/api/quotations/${q[0].id}`)).text();
  expect(detail).not.toMatch(/fullCostPerM3|marginPct|contributionBeforeFixed|costPerM3|fixedAllocated/);
  await page.goto(`/quotations/${q[0].id}`);
  await expect(page.getByRole('tab', { name: 'Internal pricing' })).toHaveCount(0);
  await ctx.close();
});

test('price override triggers approval → finance approves exact revision → sales issues → PDF matches', async ({ browser }) => {
  test.setTimeout(180_000);
  const { ctx, page } = await roleContext(browser, 'sales@e2e.example');
  const { ctx: fc, page: fin } = await roleContext(browser, 'finance@e2e.example');
  await page.getByRole('link', { name: 'New quotation' }).first().click();
  await pickClient(page); await addLine(page, '100'); await commercial(page);
  await page.getByText('Advanced overrides').click();
  await page.getByLabel('Override customer rate').fill('55');
  await page.getByLabel('Reason for price override').fill('Competitor offered a lower rate');
  await expect(page.getByText('Saved', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Submit for approval' }).click();
  await expect(page.getByText('Pending approval').first()).toBeVisible();
  await expect(page.getByText('Awaiting approval')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Issue quotation' })).toHaveCount(0);
  state.quoteUrl = page.url().replace('http://localhost:4100', '');
  // sales has no approve button; a different user (finance) approves the exact revision
  await expect(page.getByRole('button', { name: 'Approve revision' })).toHaveCount(0);
  await fin.goto('/approvals'); await expect(fin.getByText('Price override').first()).toBeVisible();
  await fin.goto(state.quoteUrl);
  await fin.getByRole('button', { name: 'Approve revision' }).click();
  await dialog(fin).getByRole('button', { name: 'Approve revision' }).click();
  await expect(fin.getByText('Approved for this exact revision')).toBeVisible();
  await fin.getByRole('tab', { name: 'Internal pricing' }).click();
  await expect(fin.getByRole('img', { name: 'Cost waterfall' })).toBeVisible(); // cost visibility only for authorised users
  // sales issues
  await page.reload();
  const issue = page.getByRole('button', { name: 'Issue quotation' });
  await expect(issue).toBeEnabled(); await issue.click();
  await expect(page.getByText('Issued', { exact: true }).first()).toBeVisible();
  const totalText = await page.locator('.trow.grand span').last().innerText();
  state.issuedTotal = totalText;
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download PDF' }).click()]);
  const file = 'e2e/results/issued-quotation.pdf'; await dl.saveAs(file);
  const { text, pages } = await pdfText(file);
  expect(pages).toBeGreaterThanOrEqual(1);
  expect(text).toContain(totalText.replace(' JOD', '')); // PDF total == approved revision total
  expect(text).not.toMatch(/margin|Competitor|Cost/i); // no internal data
  state.pdfPath = file;
  await ctx.close(); await fc.close();
});
