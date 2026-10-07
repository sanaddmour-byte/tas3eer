/**
 * Company-supplied terms & conditions (English wording as provided) with Arabic translations.
 * The Arabic text is a working translation and must be reviewed/approved by the company before use.
 * Clauses carry no titles; they are numbered when printed.
 */
export interface Clause { title: string; text: string; titleAr: string; textAr: string }
const c = (text: string, textAr: string): Clause => ({ title: '', text, titleAr: '', textAr });

export const STANDARD_TERMS_NAME = 'Standard terms & conditions (Manaseer Ready Mix)';
export const standardTerms: Clause[] = [
  c('Prices are valid only through the quotation’s stated “Valid Until” date.', 'الأسعار سارية فقط حتى التاريخ المذكور في عرض السعر ضمن «صالح حتى».'),
  c('Concrete mix designs follow Jordanian standards unless otherwise stated.', 'تتبع تصاميم الخلطات الخرسانية المواصفات الأردنية ما لم يُذكر خلاف ذلك.'),
  c('Waiting more than 60 minutes on site is charged at 15 JOD per hour per truck.', 'يُحتسب الانتظار في الموقع لأكثر من 60 دقيقة بمبلغ 15 ديناراً للساعة لكل شاحنة.'),
  c('The client must provide safe, adequate access for concrete mixers and pumps.', 'يجب على العميل توفير وصول آمن وكافٍ لخلاطات الخرسانة والمضخات.'),
  c('Manaseer Ready Mix is not liable for concrete quality if water or other additives are added on site.', 'لا تتحمل مناصير للخرسانة الجاهزة أي مسؤولية عن جودة الخرسانة في حال إضافة الماء أو أي مضافات أخرى في الموقع.'),
  c('Concrete testing must be conducted by an approved independent laboratory.', 'يجب أن تُجرى فحوصات الخرسانة في مختبر مستقل معتمد.'),
  c('Concrete curing is the contractor’s or client’s responsibility.', 'معالجة (إنضاج) الخرسانة مسؤولية المقاول أو العميل.'),
  c('Payment is due in full according to the agreed terms. Late payments may incur a 2% monthly charge.', 'الدفع مستحق بالكامل وفق الشروط المتفق عليها. وقد تترتب على الدفعات المتأخرة رسوم شهرية بنسبة 2%.'),
  c('The minimum order is 5 m³ per delivery; smaller loads incur a short-load fee.', 'الحد الأدنى للطلب 5 م³ لكل توصيلة؛ وتترتب رسوم حمولة ناقصة على الحمولات الأصغر.'),
  c('The pump setup area must be level, compacted, and clear of overhead hazards.', 'يجب أن تكون منطقة تجهيز المضخة مستوية ومدموكة وخالية من المخاطر العلوية.'),
  c('The client is liable for damage to site roads, curbs, or infrastructure during delivery.', 'يتحمل العميل مسؤولية أي أضرار تلحق بطرق الموقع أو الأرصفة أو البنية التحتية أثناء التوصيل.'),
  c('Orders must be cancelled at least 12 hours before scheduled delivery.', 'يجب إلغاء الطلبات قبل موعد التوصيل المحدد بـ 12 ساعة على الأقل.'),
  c('Ownership of the concrete does not pass to the buyer until it is fully paid for.', 'لا تنتقل ملكية الخرسانة إلى المشتري إلا بعد سداد ثمنها بالكامل.'),
];

export const MOBILE_TERMS_NAME = 'Mobile quotation terms (Manaseer Ready Mix)';
export const mobileTerms: Clause[] = [
  c('Mixes are based on current project specifications. Changes requiring a different mix design may change the price.', 'الخلطات مبنية على مواصفات المشروع الحالية. وقد تؤدي التغييرات التي تتطلب تصميم خلطة مختلفاً إلى تغيير السعر.'),
  c('Fine and coarse aggregates comply with JS 2065:2017 and Ministry of Public Works & Housing standards.', 'الركام الناعم والخشن مطابق للمواصفة الأردنية JS 2065:2017 ومعايير وزارة الأشغال العامة والإسكان.'),
  c('The quotation lists third-party laboratory tests for chloride and sulfate content, concrete absorption and chloride migration, chloride permeability, mortar-bar expansion, and concrete and aggregate shrinkage.', 'يتضمن عرض السعر فحوصات مخبرية من طرف ثالث لمحتوى الكلوريد والكبريتات، وامتصاص الخرسانة وهجرة الكلوريد، ونفاذية الكلوريد، وتمدد قضبان المونة، وانكماش الخرسانة والركام.'),
  c('Prices may change with domestic fuel, cement, or other raw-material price fluctuations.', 'قد تتغير الأسعار تبعاً لتقلبات أسعار الوقود المحلي أو الإسمنت أو المواد الخام الأخرى.'),
  c('Fly ash, silica fume, and macro fibers may take approximately 10–12 weeks to procure after a request is confirmed.', 'قد يستغرق توفير الرماد المتطاير وغبار السيليكا والألياف الكبيرة نحو 10–12 أسبوعاً بعد تأكيد الطلب.'),
  c('Pumping quantities of 20 m³ or less incur a fixed 100 JOD per pour charge. Pumps range from 28 to 65 meters.', 'تترتب على كميات الضخ البالغة 20 م³ أو أقل رسوم ثابتة قدرها 100 دينار لكل صبّة. وتتراوح أطوال المضخات بين 28 و65 متراً.'),
  c('Deliveries without a pump below the standard 8 m³ mixer load incur 10 JOD per cubic meter shortfall.', 'التوصيلات دون مضخة التي تقل عن حمولة الخلاطة القياسية البالغة 8 م³ تترتب عليها رسوم 10 دنانير لكل متر مكعب من النقص.'),
  c('Delays beyond 1 hour and 30 minutes from truck arrival incur 50 JOD per hour.', 'التأخير الذي يتجاوز ساعة و30 دقيقة من وصول الشاحنة تترتب عليه رسوم 50 ديناراً للساعة.'),
  c('Concrete temperature control is not included or guaranteed; temperature depends on ambient conditions and delivery timing.', 'التحكم بدرجة حرارة الخرسانة غير مشمول وغير مضمون؛ إذ تعتمد الحرارة على الظروف المحيطة وتوقيت التوصيل.'),
  c('Prices include delivery within 25 km of the plant. Beyond that, the charge is 0.30 JOD per kilometer per cubic meter.', 'الأسعار شاملة التوصيل ضمن 25 كم من المحطة. وما زاد على ذلك تكون الرسوم 0.30 دينار لكل كيلومتر لكل متر مكعب.'),
  c('Prices apply only to sites accessible by road.', 'تسري الأسعار فقط على المواقع التي يمكن الوصول إليها بالطريق.'),
  c('The offer is valid for 60 calendar days from the quotation date.', 'العرض صالح لمدة 60 يوماً تقويمياً من تاريخ عرض السعر.'),
  c('Payment terms are to be agreed before the contract is signed.', 'يتم الاتفاق على شروط الدفع قبل توقيع العقد.'),
];

/** Adds both sets as DRAFT terms versions for a tenant (an authorised user still approves them in the app). */
export async function importCompanyTerms(tenantId: string) {
  const { db, schema } = await import('../db/client.js');
  const { eq, sql } = await import('drizzle-orm');
  const [{ v }] = (await db.select({ v: sql<number>`coalesce(max(${schema.termsVersions.version}),0)::int` }).from(schema.termsVersions).where(eq(schema.termsVersions.tenantId, tenantId))) as [{ v: number }];
  let n = v;
  for (const [name, clauses] of [[STANDARD_TERMS_NAME, standardTerms], [MOBILE_TERMS_NAME, mobileTerms]] as const) {
    n += 1;
    await db.insert(schema.termsVersions).values({ tenantId, version: n, name, clauses, status: 'draft', isPlaceholder: false });
  }
}
if (process.argv[1] && /terms\.[tj]s$/.test(process.argv[1])) {
  const slug = process.argv[2];
  const { db, pool, schema } = await import('../db/client.js');
  const { eq } = await import('drizzle-orm');
  const [t] = slug ? await db.select().from(schema.tenants).where(eq(schema.tenants.slug, slug)) : [];
  if (!t) { console.error('usage: npm run terms:import -w @rm/api -- <tenant-slug>'); process.exit(1); }
  await importCompanyTerms(t.id); console.log(`Imported 2 draft terms versions into ${t.name}`); await pool.end();
}
