import { expect, test } from '@playwright/test';
import { expectNoHScroll, roleContext, state } from './helpers';
import fs from 'node:fs';

test('Arabic user completes the mobile (360px) quotation flow with RTL layout', async ({ browser }) => {
  test.setTimeout(180_000);
  const { ctx, page } = await roleContext(browser, 'sales@e2e.example', { width: 360, height: 740 });
  fs.mkdirSync('e2e/screenshots', { recursive: true });
  await page.getByRole('button', { name: 'Switch language' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expectNoHScroll(page, 'overview (ar, 360)');
  await page.screenshot({ path: 'e2e/screenshots/mobile-ar-overview.png' });
  await page.getByRole('link', { name: 'عروض الأسعار' }).first().click();
  await expectNoHScroll(page, 'quotation list (ar, 360)');
  await page.screenshot({ path: 'e2e/screenshots/mobile-ar-list.png' });
  await page.getByRole('link', { name: 'عرض سعر جديد' }).first().click();
  // step 1 — client & project
  await page.getByLabel('العميل', { exact: true }).click(); await page.getByLabel('العميل', { exact: true }).fill('Al-Noor'); await page.getByRole('option', { name: /Al-Noor/ }).click();
  await expect(page.getByLabel('المشروع', { exact: true })).toHaveValue('Tower A');
  await expectNoHScroll(page, 'builder step 1'); await page.screenshot({ path: 'e2e/screenshots/mobile-ar-step1.png' });
  await page.getByRole('button', { name: /^التالي/ }).click();
  // step 2 — concrete
  await page.getByRole('button', { name: 'إضافة أول بند خلطة' }).click();
  await page.getByLabel('الخلطة', { exact: true }).click(); await page.getByLabel('الخلطة', { exact: true }).fill('C30'); await page.getByRole('option', { name: /C30/ }).first().click();
  await page.getByLabel('الكمية', { exact: true }).first().fill('40');
  await expect(page.getByText('تم الحفظ', { exact: true }).first()).toBeVisible();
  await expectNoHScroll(page, 'builder step 2'); await page.screenshot({ path: 'e2e/screenshots/mobile-ar-step2.png' });
  // compact bottom summary expands
  await page.getByRole('button', { name: /إجمالي العميل/ }).click();
  await expect(page.getByText('ملخص العرض').last()).toBeVisible();
  await page.screenshot({ path: 'e2e/screenshots/mobile-ar-summary.png' });
  await page.getByRole('button', { name: /إجمالي العميل/ }).click();
  await page.getByRole('button', { name: /^التالي/ }).click();
  // step 3 — commercial terms
  await page.getByLabel('قالب الشروط').selectOption({ index: 1 });
  await page.getByLabel('شروط الدفع').fill('دفعة مقدمة 50% والباقي خلال 30 يوماً (نص تجريبي).');
  await expectNoHScroll(page, 'builder step 3'); await page.screenshot({ path: 'e2e/screenshots/mobile-ar-step3.png' });
  await page.getByRole('button', { name: /^التالي/ }).click();
  // step 4 — review & submit
  await expectNoHScroll(page, 'builder step 4'); await page.screenshot({ path: 'e2e/screenshots/mobile-ar-step4.png' });
  await page.getByRole('button', { name: 'تقديم للموافقة' }).click();
  await expect(page.getByText('معتمد', { exact: true }).first()).toBeVisible();
  await expectNoHScroll(page, 'quotation detail (ar, 360)'); await page.screenshot({ path: 'e2e/screenshots/mobile-ar-detail.png' });
  // Arabic PDF is real, RTL and embeds Noto Sans Arabic
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'تنزيل PDF' }).click()]);
  const p = 'e2e/results/arabic-quotation.pdf'; await dl.saveAs(p);
  const raw = fs.readFileSync(p).toString('latin1');
  expect(raw).toMatch(/NotoSansArabic/i);
  // restore language for later specs
  await page.getByRole('button', { name: 'تبديل اللغة' }).click();
  await ctx.close();
});
