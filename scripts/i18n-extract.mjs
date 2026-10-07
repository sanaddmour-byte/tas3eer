// Extracts every literal passed to t('...') / tr('...') and strings used as t(literalVar) labels; reports those missing from ar.ts.
import fs from 'node:fs'; import path from 'node:path';
const root = 'apps/web/src';
const files = []; (function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); fs.statSync(p).isDirectory() ? walk(p) : /\.(tsx?|ts)$/.test(f) && !/^ar\d?\.ts$/.test(f) && files.push(p); } })(root);
const found = new Set();
const re = /\bt\(\s*(['"`])((?:\\.|(?!\1).)*?)\1/g;
for (const f of files) { const s = fs.readFileSync(f, 'utf8'); let m; while ((m = re.exec(s))) found.add(m[2].replace(/\\'/g, "'")); }
// label tables referenced through t(variable): collect quoted strings inside known maps
const extra = [...fs.readFileSync(path.join(root, 'components/ui.tsx'), 'utf8').matchAll(/\['(?:|ok|warn|err|info)', '([^']+)'\]/g)].map((m) => m[1]);
extra.forEach((x) => found.add(x));
// label maps looked up dynamically via t(map[key])
const maps = [['components/Totals.tsx', /approvalLabel = [^\n]*?\(\{([^}]*)\}/s], ['components/ui.tsx', /actionLabel = [^\n]*?\(\{([^}]*)\}/s], ['components/Shell.tsx', /roleLabel = [^\n]*?\(\{([^}]*)\}/s], ['pages/QuotationList.tsx', /statusLabel = [^\n]*?\(\{([^}]*)\}/s]];
for (const [f, rx] of maps) { const src = fs.readFileSync(path.join(root, f), 'utf8'); const m = rx.exec(src); if (m) for (const x of m[1].matchAll(/:\s*'([^']+)'/g)) found.add(x[1]); }
for (const f of files) { const src = fs.readFileSync(f, 'utf8'); for (const x of src.matchAll(/\[\s*'[a-z_]+',\s*'([A-Z][^']{2,60})'\s*\]/g)) found.add(x[1]); for (const x of src.matchAll(/label: '([A-Z][^']{2,50})'/g)) found.add(x[1]); }
for (const f of files) { const src = fs.readFileSync(f, 'utf8'); for (const x of src.matchAll(/\b(?:title|empty)="([A-Z][^"]+)"/g)) found.add(x[1]); }
const STEPS = ['Client & project', 'Concrete & services', 'Commercial terms', 'Review & issue']; STEPS.forEach((x) => found.add(x));
for (const x of ['Grade', 'Characteristic strength', 'Slump', 'Max aggregate size', 'Cement type', 'Exposure class', 'Materials', 'Production variable', 'Allocated fixed (per forecast)', 'Corporate overhead', 'Risk / finance provision', 'Delivery & pumping (estimated)', 'Per m³ rate', 'By zone', 'By trips', 'Offline estimate', 'wages', 'depreciation', 'utilities', 'maintenance', 'consumables', 'other', 'cement', 'aggregate', 'sand', 'water', 'admixture', 'additive', 'fibre', 'concrete', 'delivery', 'pumping', 'Selling price (pre-tax)', 'Overview', 'Quotations', 'Mix Library', 'Price Book', 'Plant Costs', 'Approvals', 'Clients & Projects', 'Users', 'Audit History', 'Company Settings', 'per visit', 'per pour', 'per pump', 'per quotation', 'visits', 'pours', 'pumps', 'quotations']) found.add(x);
const { ar } = await import('../apps/web/src/lib/ar.ts');
const have = new Set(Object.keys(ar));
const missing = [...found].filter((x) => !have.has(x) && /[A-Za-z]/.test(x)).sort();
if (process.argv[2] === '--list') console.log(JSON.stringify(missing, null, 0)); else { console.log(`strings: ${found.size}, translated: ${found.size - missing.length}, missing: ${missing.length}`); missing.slice(0, 20).forEach((m) => console.log('  -', m)); process.exit(missing.length ? 1 : 0); }
