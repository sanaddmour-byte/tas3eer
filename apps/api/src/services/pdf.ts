import { chromium, type Browser } from 'playwright-core';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import { config } from '../config.js';

const require = createRequire(import.meta.url);
const fontB64 = (pkg: string, file: string) => fs.readFileSync(require.resolve(`${pkg}/files/${file}`)).toString('base64');
let fontCss: string | null = null;
function fonts() {
  if (fontCss) return fontCss;
  const f = (family: string, weight: number, b64: string, range: string) => `@font-face{font-family:'${family}';font-weight:${weight};font-style:normal;src:url(data:font/woff2;base64,${b64}) format('woff2');unicode-range:${range};}`;
  const latin = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
  const arabic = 'U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0898-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC';
  fontCss = [400, 600, 700].map((w) => f('Inter', w, fontB64('@fontsource/inter', `inter-latin-${w}-normal.woff2`), latin)).join('') +
    [400, 700].map((w) => f('Noto Sans Arabic', w, fontB64('@fontsource/noto-sans-arabic', `noto-sans-arabic-arabic-${w}-normal.woff2`), arabic)).join('');
  return fontCss;
}

const L = {
  en: { quotation: 'Quotation', rev: 'Revision', date: 'Date', valid: 'Valid until', client: 'Client', project: 'Project', site: 'Site', plant: 'Supplying plant', mix: 'Concrete mix', grade: 'Grade', qty: 'Quantity', rate: 'Rate', amount: 'Amount', item: 'Item', unit: 'Unit', services: 'Delivery & pumping', subtotal: 'Subtotal (before tax)', tax: 'Tax', total: 'Total', payment: 'Payment terms', scope: 'Scope', schedule: 'Expected supply schedule', notes: 'Notes', terms: 'Terms & conditions', sign1: 'Authorised signatory', sign2: 'Client acceptance', name: 'Name', signature: 'Signature', dt: 'Date', jod: 'JOD', per: 'JOD/m³', taxBasis: 'Taxable amount', deduction: 'Deduction', taxPolicy: 'Tax policy', notIssued: 'NOT ISSUED — pre-issue copy', page: 'Page', of: 'of', taxNo: 'Tax no.', fromIssue: (n: number) => `${n} days from the issue date`,
    scopes: { supply_only: 'Supply of ready-mix concrete only. Delivery and pumping are not included in this quotation.', supply_delivery: 'Supply and delivery of ready-mix concrete to site. Pumping is not included in this quotation.', supply_delivery_pumping: 'Supply and delivery of ready-mix concrete to site, including concrete pumping as itemised below.' } as Record<string, string> },
  ar: { quotation: 'عرض سعر', rev: 'المراجعة', date: 'التاريخ', valid: 'صالح حتى', client: 'العميل', project: 'المشروع', site: 'الموقع', plant: 'المحطة الموردة', mix: 'الخلطة الخرسانية', grade: 'الرتبة', qty: 'الكمية', rate: 'السعر', amount: 'المبلغ', item: 'البند', unit: 'الوحدة', services: 'التوصيل والضخ', subtotal: 'المجموع قبل الضريبة', tax: 'الضريبة', total: 'الإجمالي', payment: 'شروط الدفع', scope: 'نطاق العمل', schedule: 'جدول التوريد المتوقع', notes: 'ملاحظات', terms: 'الشروط والأحكام', sign1: 'المفوض بالتوقيع', sign2: 'موافقة العميل', name: 'الاسم', signature: 'التوقيع', dt: 'التاريخ', jod: 'دينار', per: 'دينار/م³', taxBasis: 'المبلغ الخاضع للضريبة', deduction: 'الخصم', taxPolicy: 'سياسة الضريبة', notIssued: 'غير صادر — نسخة ما قبل الإصدار', page: 'صفحة', of: 'من', taxNo: 'الرقم الضريبي', fromIssue: (n: number) => `${n} يوماً من تاريخ الإصدار`,
    scopes: { supply_only: 'توريد الخرسانة الجاهزة فقط. التوصيل والضخ غير مشمولين في عرض السعر هذا.', supply_delivery: 'توريد الخرسانة الجاهزة وتوصيلها إلى الموقع. الضخ غير مشمول في عرض السعر هذا.', supply_delivery_pumping: 'توريد الخرسانة الجاهزة وتوصيلها إلى الموقع شاملاً ضخ الخرسانة كما هو مبين أدناه.' } as Record<string, string> },
};
export type PdfLang = 'en' | 'ar';
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const money = (v: string | null | undefined) => (v === null || v === undefined ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 }));
const qty = (v: string) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 3 });

/** Customer-facing HTML from the FROZEN customer snapshot only (never recipes, costs, margins or approval notes). */
export function quotationHtml(snap: any, meta: { number: string; issuedAt: Date | null; validUntil: string | null; issued: boolean }, lang: PdfLang): string {
  const t = L[lang], rtl = lang === 'ar';
  const c = snap.customer ?? snap;
  const tot = c.totals;
  const mixName = (m: any) => (rtl && m.nameAr ? m.nameAr : m.nameEn);
  const dateStr = (meta.issuedAt ?? new Date(c.frozenAt)).toISOString().slice(0, 10);
  const lineRows = c.lines.map((l: any) => {
    const m = c.mixes.find((x: any) => x.lineId === l.id);
    return `<tr><td><b dir="ltr">${esc(l.mixCode)}</b><div>${esc(m ? mixName(m) : l.mixName)}</div>${m?.spec?.strengthMpa ? `<div class="sub">${esc(t.grade)} ${esc(m.grade)} · ${esc(m.spec.strengthMpa)} MPa${m.spec.slumpMm ? ` · ${esc(m.spec.slumpMm)} mm` : ''}</div>` : `<div class="sub">${esc(t.grade)} ${esc(m?.grade)}</div>`}</td>
      <td class="n">${qty(l.quantityM3)}</td><td class="u">m³</td><td class="n">${money(l.customerRatePerM3)}</td><td class="n">${money(l.amount)}</td></tr>`;
  }).join('');
  const svcRows = c.services.flatMap((s: any) => s.rows.map((r: any) => `<tr><td>${esc(r.label)}</td><td class="n">${qty(r.quantity)}</td><td class="u">${esc(r.unit)}</td><td class="n">${money(r.rate)}</td><td class="n">${money(r.amount)}</td></tr>`)).join('');
  const taxRow = tot.tax ? `<tr><td colspan="4">${esc(t.tax)} (${esc(tot.tax.ratePct)}%)${Number(tot.tax.deduction) > 0 ? ` — ${esc(t.taxBasis)} ${money(tot.tax.taxableBase)} (${esc(t.deduction)} ${money(tot.tax.deduction)})` : ''}</td><td class="n">${money(tot.tax.tax)}</td></tr>` : '';
  const clauses = (c.terms?.clauses ?? []).map((cl: any) => { const title = rtl && cl.titleAr ? cl.titleAr : cl.title; const text = rtl && cl.textAr ? cl.textAr : cl.text; return `<li>${title ? `<b>${esc(title)}.</b> ` : ''}${esc(text)}</li>`; }).join('');
  const co = c.company ?? {};
  return `<!doctype html><html lang="${lang}" dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><title>${esc(meta.number)}</title><style>${fonts()}
  @page{size:A4;margin:16mm 14mm 18mm}
  *{box-sizing:border-box} body{font-family:${rtl ? "'Noto Sans Arabic','Inter'" : "'Inter','Noto Sans Arabic'"},sans-serif;color:#182437;font-size:10.5pt;line-height:1.45;margin:0}
  .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #B9470B;padding-bottom:10px;margin-bottom:14px}
  .brand{font-size:20pt;font-weight:700;color:#101E32}.co{color:#57667A;font-size:9pt}
  h1{font-size:16pt;margin:0;color:#101E32}.meta{text-align:${rtl ? 'left' : 'right'}}.meta div{font-size:9.5pt}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px}.box{border:1px solid #E0E6EE;border-radius:6px;padding:8px 10px}
  .lbl{font-size:8.5pt;color:#57667A;text-transform:uppercase;letter-spacing:.04em}
  table{width:100%;border-collapse:collapse;margin:8px 0 12px}thead{display:table-header-group}tfoot{display:table-footer-group}
  th{background:#101E32;color:#fff;font-weight:600;font-size:9pt;text-align:${rtl ? 'right' : 'left'};padding:6px 8px}td{padding:6px 8px;border-bottom:1px solid #E0E6EE;vertical-align:top}
  tr{break-inside:avoid;page-break-inside:avoid}.n{text-align:${rtl ? 'left' : 'right'};font-variant-numeric:tabular-nums;white-space:nowrap}th.n{text-align:${rtl ? 'left' : 'right'}}.u{white-space:nowrap;color:#57667A;width:44px}.sub{font-size:8.5pt;color:#57667A}
  .tot td{font-weight:600;border-bottom:none}.grand td{font-size:12pt;font-weight:700;background:#F4F6F9;border-top:2px solid #101E32}
  h2{font-size:11.5pt;margin:14px 0 4px;color:#101E32}.notes{white-space:pre-wrap}ol{padding-${rtl ? 'right' : 'left'}:18px;margin:4px 0}li{margin-bottom:4px;break-inside:avoid}
  .sign{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:28px;break-inside:avoid}.sig{border-top:1px solid #182437;padding-top:4px;margin-top:46px;font-size:9pt;color:#57667A}
  .stamp{color:#B42318;font-weight:700;border:2px solid #B42318;display:inline-block;padding:2px 10px;border-radius:4px;margin-bottom:8px}
  .num{direction:ltr;unicode-bidi:isolate;display:inline-block}</style></head><body>
  ${meta.issued ? '' : `<div class="stamp">${esc(t.notIssued)}</div>`}
  <div class="head"><div><div class="brand">${esc(co.logoText || co.name)}</div><div class="co">${esc(co.name)}<br>${esc(co.address)}<br><span class="num">${esc(co.phone)}</span> <span class="num">${esc(co.email)}</span>${co.taxNumber ? `<br>${esc(t.taxNo)} <span class="num">${esc(co.taxNumber)}</span>` : ''}</div></div>
  <div class="meta"><h1>${esc(t.quotation)}</h1><div><span class="num">${esc(meta.number)}</span></div><div>${esc(t.rev)} <span class="num">${c.revNo}</span></div><div>${esc(t.date)}: <span class="num">${dateStr}</span></div><div>${esc(t.valid)}: <span class="${meta.validUntil ? 'num' : ''}">${esc(meta.validUntil ?? t.fromIssue(c.validityDays))}</span></div></div></div>
  <div class="grid"><div class="box"><div class="lbl">${esc(t.client)}</div><b>${esc(c.client.name)}</b>${c.client.taxNumber ? `<div class="sub">${esc(t.taxNo)} <span class="num">${esc(c.client.taxNumber)}</span></div>` : ''}</div>
  <div class="box"><div class="lbl">${esc(t.project)}</div><b>${esc(c.project.name)}</b><div class="sub">${esc(c.project.siteAddress)}</div><div class="sub">${esc(t.plant)}: ${esc(rtl && c.plant.nameAr ? c.plant.nameAr : c.plant.nameEn)}</div></div></div>
  <p><span class="lbl">${esc(t.scope)}</span><br>${esc(t.scopes[c.scope])}</p>
  <table><thead><tr><th>${esc(t.mix)}</th><th class="n">${esc(t.qty)}</th><th>${esc(t.unit)}</th><th class="n">${esc(t.rate)} (${esc(t.per)})</th><th class="n">${esc(t.amount)} (${esc(t.jod)})</th></tr></thead><tbody>${lineRows}${svcRows ? `<tr><td colspan="5" class="lbl" style="background:#F4F6F9">${esc(t.services)}</td></tr>${svcRows}` : ''}</tbody>
  <tfoot><tr class="tot"><td colspan="4">${esc(t.subtotal)}</td><td class="n">${money(tot.subtotalExTax)}</td></tr>${taxRow}<tr class="grand"><td colspan="4">${esc(t.total)} (${esc(t.jod)})</td><td class="n">${money(tot.total)}</td></tr></tfoot></table>
  ${tot.tax ? `<div class="sub">${esc(t.taxPolicy)}: ${esc(tot.tax.policyName)}</div>` : ''}
  <h2>${esc(t.payment)}</h2><div class="notes">${esc(c.paymentTerms)}</div>
  ${c.supplySchedule ? `<h2>${esc(t.schedule)}</h2><div class="notes">${esc(c.supplySchedule)}</div>` : ''}
  ${c.customerNotes ? `<h2>${esc(t.notes)}</h2><div class="notes">${esc(c.customerNotes)}</div>` : ''}
  ${clauses ? `<h2>${esc(t.terms)} <span class="sub">(${esc(c.terms.name)} v${c.terms.version})</span></h2><ol>${clauses}</ol>` : ''}
  <div class="sign"><div><div class="sig">${esc(t.sign1)} — ${esc(t.name)} / ${esc(t.signature)} / ${esc(t.dt)}</div></div><div><div class="sig">${esc(t.sign2)} — ${esc(t.name)} / ${esc(t.signature)} / ${esc(t.dt)}</div></div></div>
  </body></html>`;
}

let browserP: Promise<Browser> | null = null;
function getBrowser() {
  browserP ??= chromium.launch({ executablePath: config.chromiumPath || process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox', '--disable-dev-shm-usage'] }).catch((e) => { browserP = null; throw e; });
  return browserP;
}
export async function renderPdf(html: string, lang: PdfLang, number: string): Promise<Buffer> {
  const b = await getBrowser();
  const page = await b.newPage();
  try {
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => (document as any).fonts.ready);
    const t = L[lang];
    const buf = await page.pdf({
      format: 'A4', printBackground: true, displayHeaderFooter: true, headerTemplate: '<span></span>',
      footerTemplate: `<div style="width:100%;font-size:8px;color:#57667A;padding:0 14mm;display:flex;justify-content:space-between;font-family:sans-serif"><span>${esc(number)}</span><span>${esc(t.page)} <span class="pageNumber"></span> ${esc(t.of)} <span class="totalPages"></span></span></div>`,
      margin: { top: '16mm', bottom: '18mm', left: '14mm', right: '14mm' },
    });
    return Buffer.from(buf);
  } finally { await page.close(); }
}
export const sha256Hex = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
export async function closeBrowser() { if (browserP) { const b = await browserP; await b.close(); browserP = null; } }
