import { expect, test } from '@playwright/test';
import { dialog, iso, roleContext, state } from './helpers';

test.describe.configure({ mode: 'serial' });

test('publish a price change → issued quotation is unchanged → repriced revision uses the new price', async ({ browser }) => {
  test.setTimeout(180_000);
  const { ctx: pc, page: pricing } = await roleContext(browser, 'pricing@e2e.example');
  const { ctx: fc, page: fin } = await roleContext(browser, 'finance@e2e.example');
  const { ctx: sc, page: sales } = await roleContext(browser, 'sales@e2e.example');
  await sales.goto(state.quoteUrl);
  const before = await sales.locator('.trow.grand span').last().innerText();
  expect(before).toBe(state.issuedTotal);
  // propose a cement price rise from the Price Book (creates a proposal, never edits in place)
  await pricing.goto('/price-book');
  await pricing.getByRole('row', { name: /Cement CEM I/ }).getByRole('button', { name: 'Propose change' }).click();
  await dialog(pricing).getByLabel('Proposed price').fill('95'); await dialog(pricing).getByLabel('Effective from').fill(iso(0));
  await dialog(pricing).getByRole('button', { name: 'Create price proposal' }).click();
  await expect(pricing.getByText('Estimated impact on approved mixes')).toBeVisible();
  await expect(pricing.getByText('C30').first()).toBeVisible();
  await expect(pricing.getByText('+15.0000').first()).toBeVisible(); // 95 − 80 per tonne ⇒ shown as change
  await pricing.getByRole('button', { name: 'Submit for approval' }).click();
  await fin.goto(pricing.url().replace('http://localhost:4100', ''));
  await fin.getByRole('button', { name: 'Approve & publish' }).first().click();
  await dialog(fin).getByRole('button', { name: 'Approve & publish' }).click();
  await expect(fin.getByText('Published').first()).toBeVisible();
  await pricing.goto('/price-book'); await expect(pricing.getByRole('row', { name: /Cement CEM I/ })).toContainText('95.000');
  // issued quotation untouched
  await sales.reload();
  await expect(sales.getByText('Issued', { exact: true }).first()).toBeVisible();
  expect(await sales.locator('.trow.grand span').last().innerText()).toBe(before);
  // reprice as new revision (explicit action) → new draft with the higher total
  await sales.getByRole('button', { name: 'Reprice as new revision' }).click();
  await expect(sales.getByText('Revision 2')).toBeVisible();
  await expect(sales.getByText('Prices pinned')).toHaveCount(0);
  await expect(sales.getByText('Draft', { exact: true }).first()).toBeVisible();
  // the quotation carries a manual price override, so the customer rate is unchanged — but the internal cost moved with the new cement price
  const { ctx: f2, page: fin2 } = await roleContext(browser, 'finance@e2e.example');
  await fin2.goto(`${state.quoteUrl}?rev=1`); await fin2.getByRole('tab', { name: 'Internal pricing' }).click();
  await expect(fin2.getByRole('cell', { name: /47\.3160/ })).toBeVisible(); // frozen: cement at 80 JOD/tonne
  await fin2.goto(`${state.quoteUrl}?rev=2`); await fin2.getByRole('tab', { name: 'Internal pricing' }).click();
  await expect(fin2.getByRole('cell', { name: /52\.5660/ })).toBeVisible(); // repriced: cement at 95 JOD/tonne (+5.25 JOD/m³)
  await f2.close();
  // revision 1 remains issued/superseded and unchanged
  await sales.goto(`${state.quoteUrl}?rev=1`);
  expect(await sales.locator('.trow.grand span').last().innerText()).toBe(before);
  // approver sees a different price for current vs pinned: "create revision" keeps old prices
  await pc.close(); await fc.close(); await sc.close();
});
