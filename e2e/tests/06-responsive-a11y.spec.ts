import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { expectNoHScroll, roleContext, state } from './helpers';

const sizes = [360, 768, 1024, 1440];
const pagesFor: Record<string, string[]> = {
  'pricing@e2e.example': ['/', '/quotations', '/mixes', '/price-book', '/price-book/updates', '/plant-costs', '/approvals', '/clients'],
  'admin@e2e.example': ['/admin/users', '/admin/audit', '/admin/settings'],
  'sales@e2e.example': ['/', '/quotations', '/quotations/new', '/mixes'],
};
test('no page-wide horizontal scroll at 360 / 768 / 1024 / 1440 (tables scroll inside their container)', async ({ browser }) => {
  test.setTimeout(240_000);
  fs.mkdirSync('e2e/screenshots', { recursive: true });
  const report: any[] = [];
  for (const [email, paths] of Object.entries(pagesFor)) {
    const { ctx, page } = await roleContext(browser, email);
    for (const w of sizes) {
      await page.setViewportSize({ width: w, height: 900 });
      for (const p of paths) {
        await page.goto(p); await page.waitForTimeout(350);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        report.push({ role: email.split('@')[0], path: p, width: w, overflowPx: over });
        expect(over, `${email} ${p} @${w}`).toBeLessThanOrEqual(1);
        if ((p === '/' || p === '/quotations/new') && email.startsWith('sales')) await page.screenshot({ path: `e2e/screenshots/${p === '/' ? 'overview' : 'builder'}-${w}.png` });
        if (p === '/price-book' && (w === 360 || w === 1440)) await page.screenshot({ path: `e2e/screenshots/pricebook-${w}.png` });
        if (p === '/plant-costs' && w === 1440) await page.screenshot({ path: 'e2e/screenshots/plantcosts-1440.png' });
      }
    }
    await ctx.close();
  }
  fs.writeFileSync('e2e/results/responsive.json', JSON.stringify(report, null, 1));
});

test('WCAG 2.2 AA automated scan (axe) on key screens in English and Arabic: no serious/critical violations', async ({ browser }) => {
  test.setTimeout(240_000);
  const out: any[] = [];
  const { ctx, page } = await roleContext(browser, 'pricing@e2e.example');
  for (const lang of ['en', 'ar']) {
    if (lang === 'ar') await page.getByRole('button', { name: 'Switch language' }).click();
    for (const p of ['/', '/quotations', '/mixes', '/price-book', '/plant-costs', '/approvals']) {
      await page.goto(p); await page.waitForTimeout(500);
      const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      out.push({ lang, path: p, violations: r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, target: v.nodes[0]?.target })) });
      const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(bad.map((v) => `${v.id}: ${v.nodes[0]?.target}`), `${lang} ${p}`).toEqual([]);
    }
  }
  await ctx.close();
  const s = await roleContext(browser, 'sales@e2e.example');
  await s.page.goto('/quotations/new');
  const r = await new AxeBuilder({ page: s.page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
  out.push({ lang: 'en', path: '/quotations/new', violations: r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })) });
  expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
  await s.ctx.close();
  fs.writeFileSync('e2e/results/axe.json', JSON.stringify(out, null, 1));
});
