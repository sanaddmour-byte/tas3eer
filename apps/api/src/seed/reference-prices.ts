/**
 * Reference raw-material prices supplied by the company (1 May 2026), JOD per purchase unit.
 * NOT loaded automatically into any tenant. `importReferencePrices` creates any missing plants/materials and a DRAFT price batch
 * that must be verified, submitted and approved like any other price update. A value of 0.000 in the source means "not configured"
 * (e.g. Project Batch Plant, Jiza water) and is skipped — a missing price is never treated as zero.
 * ASSUMPTION to verify: every price is entered as "delivered to plant" (no separate procurement freight).
 */
export const EFFECTIVE_FROM = '2026-05-01';
export const plantDefs = [
  ['IRB', 'Irbid'], ['SWL', 'Sweileh'], ['MRK', 'Marka'], ['DGR', 'Dogara'], ['MQB', 'Muqabalein'], ['GHR', 'Ghor'], ['JIZ', 'Jiza'], ['QTR', 'Qatraneh'],
  ['MAN', 'Maan'], ['AQS', 'Aqaba South'], ['AQN', 'Aqaba North'], ['PBP', 'Project Batch Plant'],
] as const;
const U = { Ton: 'tonne', 'm³': 'm3', Liter: 'L', kg: 'kg' } as const;
// code, name, category, unit
export const materialDefs: [string, string, string, keyof typeof U][] = [
  ['AGG-SAMSAMI', 'Aggregate – Samsami (3/8")', 'aggregate', 'Ton'], ['AGG-ADASI', 'Aggregate – Adasi (3/4")', 'aggregate', 'Ton'], ['AGG-HOMSSI', 'Aggregate – Homssi (1.5")', 'aggregate', 'Ton'],
  ['SAND', 'Sand', 'sand', 'Ton'], ['OPC', 'OPC Cement', 'cement', 'Ton'], ['PPC', 'PPC Cement', 'cement', 'Ton'], ['SRC', 'SRC Cement', 'cement', 'Ton'], ['MSRC', 'MSRC Cement', 'cement', 'Ton'],
  ['FLYASH', 'Fly Ash', 'additive', 'Ton'], ['MICROSILICA', 'Microsilica', 'additive', 'Ton'], ['WATER', 'Water', 'water', 'm³'], ['ADMIX', 'Admixture', 'admixture', 'Liter'],
  ['FIBER', 'Fiber', 'fibre', 'kg'], ['PC-PLAST', 'PC / Plasticizer', 'admixture', 'Liter'], ['CRETE-FILLER', 'Crete Filler', 'additive', 'Ton'], ['CRYSTALLINE', 'Crystalline', 'additive', 'kg'],
];
const order = plantDefs.map((p) => p[0]);
const rows = (plants: string[], data: Record<string, number[]>) => Object.entries(data).flatMap(([m, v]) => v.map((price, i) => ({ plant: plants[i]!, material: m, price })));
const A = rows(['IRB', 'SWL', 'MRK', 'DGR'], {
  'AGG-SAMSAMI': [3.744, 6.19, 6.16, 6.28], 'AGG-ADASI': [3.744, 6.19, 6.16, 6.28], 'AGG-HOMSSI': [3.744, 7.73, 5.55, 6.28], SAND: [6.35, 4.31, 4.28, 5.97],
  OPC: [78.87, 77.71, 77.71, 79.3], PPC: [78.87, 77.71, 77.71, 79.3], SRC: [87, 86, 86, 88], MSRC: [85, 84, 84, 86], FLYASH: [262.36, 262.36, 262.36, 262.36], MICROSILICA: [303.33, 303.33, 303.33, 303.33],
  WATER: [1.75, 2.5, 1.35, 1.65], ADMIX: [0.47, 0.47, 0.47, 0.47], FIBER: [3.333, 3.333, 3.333, 3.333], 'PC-PLAST': [0.67, 0.67, 0.67, 0.67], 'CRETE-FILLER': [31.341, 30.21, 30.21, 31.771], CRYSTALLINE: [0.65, 0.65, 0.65, 0.65] });
const B = rows(['MQB', 'GHR', 'JIZ', 'QTR'], {
  'AGG-SAMSAMI': [5.371, 3.5, 5.98, 7.34], 'AGG-ADASI': [5.371, 3.5, 5.98, 7.34], 'AGG-HOMSSI': [5.371, 3.5, 5.98, 7.34], SAND: [3.871, 1.62, 4.1, 6.93],
  OPC: [69.693, 78.37, 75.59, 73.21], PPC: [68.693, 78.37, 75.59, 73.21], SRC: [77.103, 87, 83, 81], MSRC: [74.693, 85, 81, 79], FLYASH: [262.36, 262.36, 262.36, 273.07], MICROSILICA: [303.33, 303.33, 303.33, 320],
  WATER: [0.55, 1.13, 0, 0.55], ADMIX: [0.47, 0.47, 0.47, 0.47], FIBER: [3.333, 3.333, 3.333, 3.333], 'PC-PLAST': [0.67, 0.67, 0.67, 0.67], 'CRETE-FILLER': [29.693, 30.854, 28.122, 25.78], CRYSTALLINE: [0.65, 0.65, 0.65, 0.65] });
const C = rows(['MAN', 'AQS', 'AQN', 'PBP'], {
  'AGG-SAMSAMI': [6.576, 4.8, 3.8, 0], 'AGG-ADASI': [6.576, 4.8, 3.8, 0], 'AGG-HOMSSI': [6.576, 4.8, 3.8, 0], SAND: [7.515, 5.5, 4.61, 0],
  OPC: [79.86, 86.48, 86.42, 0], PPC: [79.86, 86.48, 86.42, 0], SRC: [87, 95, 95, 0], MSRC: [85, 93, 93, 0], FLYASH: [273.07, 273.07, 273.07, 0], MICROSILICA: [320, 320, 320, 0],
  WATER: [1, 0.75, 0.75, 0], ADMIX: [0.47, 0.47, 0.47, 0], FIBER: [3.333, 3.333, 3.333, 0], 'PC-PLAST': [0.67, 0.67, 0.67, 0], 'CRETE-FILLER': [32.317, 33.846, 33.78, 0], CRYSTALLINE: [0.65, 0.65, 0.65, 0] });
export const referencePrices = [...A, ...B, ...C].sort((a, b) => order.indexOf(a.plant as any) - order.indexOf(b.plant as any));
export const importablePrices = referencePrices.filter((r) => r.price > 0);

export async function importReferencePrices(tenantId: string, actorUserId: string) {
  const { db, schema } = await import('../db/client.js');
  const { and, eq } = await import('drizzle-orm');
  const S = schema;
  const plants = new Map<string, string>(), mats = new Map<string, string>();
  for (const [code, name] of plantDefs) {
    const [p] = await db.select().from(S.plants).where(and(eq(S.plants.tenantId, tenantId), eq(S.plants.code, code)));
    plants.set(code, p?.id ?? (await db.insert(S.plants).values({ tenantId, code, nameEn: name }).returning())[0]!.id);
  }
  for (const [code, name, category, unit] of materialDefs) {
    const [m] = await db.select().from(S.materials).where(and(eq(S.materials.tenantId, tenantId), eq(S.materials.code, code)));
    // dosage unit: kg for mass-purchased items, same unit otherwise (no density needed)
    const du = U[unit] === 'tonne' ? 'kg' : U[unit];
    mats.set(code, m?.id ?? (await db.insert(S.materials).values({ tenantId, code, nameEn: name, category, purchaseUnit: U[unit], dosageUnit: du }).returning())[0]!.id);
  }
  const [batch] = await db.insert(S.priceBatches).values({ tenantId, name: 'Reference prices — 1 May 2026 (UNVERIFIED, from company reference list)', status: 'draft', source: 'manual', effectiveFrom: EFFECTIVE_FROM, createdBy: actorUserId,
    history: [{ at: new Date().toISOString(), by: 'import', byUserId: actorUserId, action: 'created', comment: 'Imported reference list; verify before submitting' }] }).returning();
  let n = 0;
  for (const r of importablePrices) {
    await db.insert(S.priceBatchItems).values({ tenantId, batchId: batch!.id, rowNo: ++n, materialId: mats.get(r.material)!, plantId: plants.get(r.plant)!, proposedPrice: r.price.toFixed(6), proposedBasis: 'delivered_plant', effectiveFrom: EFFECTIVE_FROM });
  }
  return { batchId: batch!.id, items: n, skippedZero: referencePrices.length - n };
}
if (process.argv[1] && /reference-prices\.[tj]s$/.test(process.argv[1])) {
  const slug = process.argv[2];
  const { db, pool, schema } = await import('../db/client.js');
  const { eq } = await import('drizzle-orm');
  const [t] = slug ? await db.select().from(schema.tenants).where(eq(schema.tenants.slug, slug)) : [];
  const [admin] = t ? await db.select().from(schema.memberships).where(eq(schema.memberships.tenantId, t.id)).limit(10) : [];
  if (!t || !admin) { console.error('usage: npm run prices:import -w @rm/api -- <tenant-slug>'); process.exit(1); }
  const adm = (await db.select().from(schema.memberships).where(eq(schema.memberships.tenantId, t.id))).find((m) => m.role === 'admin') ?? admin;
  console.log(await importReferencePrices(t.id, adm.userId)); await pool.end();
}
