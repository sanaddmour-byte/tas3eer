import { expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from '@playwright/test';
import ExcelJS from 'exceljs';

export const PW = 'E2e!Passw0rd-2026x';
export const iso = (offset: number) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
export const state: Record<string, any> = {};

export async function loginUI(page: Page, email: string, password = PW) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).last().click();
  await expect(page.getByRole('link', { name: 'Overview' }).first()).toBeVisible();
}
export async function roleContext(browser: Browser, email: string, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true });
  const page = await ctx.newPage();
  await loginUI(page, email);
  return { ctx, page };
}
/** Admin helper: create an invited user through the real invitation flow (API calls; the invitation UI is exercised separately). */
export async function inviteUser(adminPage: Page, email: string, role: string, plantIds: string[], name: string) {
  const me = await (await adminPage.request.get('/api/auth/me')).json();
  const inv = await adminPage.request.post('/api/users/invitations', { headers: { 'X-CSRF-Token': me.csrfToken }, data: { email, role, plantIds, allPlants: role !== 'sales' && role !== 'viewer' } });
  expect(inv.status()).toBe(201);
  const token = new URL((await inv.json()).link).searchParams.get('token')!;
  const fresh = await (await import('@playwright/test')).request.newContext({ baseURL: 'http://localhost:4100' });
  const acc = await fresh.post('/api/auth/invitations/accept', { data: { token, name, password: PW } });
  expect(acc.status()).toBe(200);
  await fresh.dispose();
}
export async function pricesXlsx(rows: (string | number | null)[][]) {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Prices');
  ws.addRow(['Plant Code', 'Material Code', 'Material Name', 'Purchase Unit', 'Price (JOD per purchase unit)', 'Price Basis (ex_source | delivered_plant)', 'Freight (JOD per purchase unit)', 'Effective From (YYYY-MM-DD)']);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
export const dialog = (page: Page) => page.getByRole('dialog');
export async function nav(page: Page, name: string) { await page.getByRole('link', { name, exact: true }).first().click(); }
export async function expectNoHScroll(page: Page, label: string) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(over, `horizontal overflow on ${label}`).toBeLessThanOrEqual(1);
}
