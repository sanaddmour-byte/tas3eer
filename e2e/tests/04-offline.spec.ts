import { expect, test } from '@playwright/test';
import { pickClient, roleContext, state } from './helpers';

test.describe.configure({ mode: 'serial' });

test('offline draft: edits are saved locally, survive reload, sync once on reconnect (no duplicates), conflicts are visible', async ({ browser }) => {
  test.setTimeout(180_000);
  const { ctx, page } = await roleContext(browser, 'sales@e2e.example');
  const owner = async () => (await (await page.request.get('/api/quotations?view=mine')).json()) as any[];
  const countBefore = (await owner()).length;
  await page.getByRole('link', { name: 'New quotation' }).first().click();
  await pickClient(page);
  await page.getByRole('button', { name: 'Add first mix line' }).click();
  await page.getByRole('combobox', { name: 'Mix', exact: true }).click(); await page.getByRole('combobox', { name: 'Mix', exact: true }).fill('C30'); await page.getByRole('option', { name: /C30/ }).first().click();
  await page.getByLabel(/^Quantity/).first().fill('20');
  await expect(page.getByText('Saved', { exact: true }).first()).toBeVisible();
  const draftUrl = page.url();
  await page.evaluate(() => navigator.serviceWorker?.ready); // app shell cached
  await page.waitForTimeout(500);

  await ctx.setOffline(true);
  await expect(page.getByText('Offline', { exact: true }).first()).toBeVisible();
  await page.getByLabel(/^Quantity/).first().fill('75');
  await expect(page.getByText('Offline draft — saved on this device')).toBeVisible(); // durable local write, NOT "Saved"
  await expect(page.getByText('Saved', { exact: true })).toHaveCount(0);
  await expect(page.getByText(/Offline estimate/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submit for approval' })).toBeDisabled(); // never submit/approve/issue offline
  // reload while offline: draft + reference snapshot restored from the per-user IndexedDB
  await page.reload();
  await expect(page.getByLabel(/^Quantity/).first()).toHaveValue('75');
  await expect(page.getByText('Price snapshot age')).toBeVisible();
  // meanwhile another session edits the same draft on the server → conflict later
  const other = await roleContext(browser, 'sales@e2e.example');
  const id = new URL(draftUrl).pathname.split('/')[2]!;
  const srv = await (await other.page.request.get(`/api/quotations/${id}`)).json();
  const me = await (await other.page.request.get('/api/auth/me')).json();
  const put = await other.page.request.put(`/api/quotations/${id}/revisions/1`, { headers: { 'X-CSRF-Token': me.csrfToken }, data: { baseVersion: srv.revision.version, doc: { ...srv.revision.doc, customerNotes: 'Edited on another device' } } });
  expect(put.status()).toBe(200);
  await other.ctx.close();

  await ctx.setOffline(false);
  await expect(page.getByText('This draft changed on another device')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('dialog')).toContainText('Server version'); // conflict is visible and needs an explicit decision
  await page.getByRole('dialog').getByRole('button', { name: 'Keep my changes' }).click();
  await expect(page.getByText('Saved', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  const list = await owner();
  expect(list.length).toBe(countBefore + 1); // exactly one quotation created: no duplication
  const final = await (await page.request.get(`/api/quotations/${id}`)).json();
  expect(final.revision.doc.lines[0].quantityM3).toBe('75');
  // a draft created entirely offline (from the cached reference snapshot) syncs once and receives its server-side number
  await page.getByRole('link', { name: 'Quotations', exact: true }).first().click();
  await ctx.setOffline(true);
  await page.getByRole('link', { name: 'New quotation' }).first().click();
  await pickClient(page);
  await page.getByRole('button', { name: 'Add first mix line' }).click();
  const mix = page.getByRole('combobox', { name: 'Mix', exact: true }); await mix.click(); await mix.fill('C30'); await page.getByRole('option', { name: /C30/ }).first().click();
  await page.getByLabel(/^Quantity/).first().fill('12');
  await expect(page.getByText('Offline draft — saved on this device')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'New quotation' })).toBeVisible(); // no number until the server assigns one
  await ctx.setOffline(false);
  await expect(page.getByText('Saved', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: /Quotation Q-\d{4}-\d{5}/ })).toBeVisible();
  expect((await owner()).length).toBe(countBefore + 2);
  await ctx.close();
});
