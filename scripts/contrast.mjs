// WCAG contrast check for the actual foreground/background pairs used in apps/web/src/styles.css
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const L = (h) => { const [r, g, b] = hex(h).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const cr = (a, b) => { const [x, y] = [L(a), L(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const pairs = [
  ['body text', '#182437', '#F4F6F9', 4.5], ['body text on surface', '#182437', '#FFFFFF', 4.5], ['secondary text on surface', '#57667A', '#FFFFFF', 4.5], ['secondary text on page bg', '#57667A', '#F4F6F9', 4.5],
  ['primary button text', '#FFFFFF', '#B9470B', 4.5], ['primary button hover', '#FFFFFF', '#9A3A08', 4.5], ['orange accent vs white (non-text)', '#B9470B', '#FFFFFF', 3],
  ['nav text on navy', '#FFFFFF', '#101E32', 4.5], ['nav muted on navy', '#B8C4D6', '#101E32', 4.5], ['nav muted on navy (active bg)', '#FFFFFF', '#243248', 4.5], ['active marker on navy (non-text)', '#F59E0B', '#101E32', 3],
  ['link', '#1F5FA8', '#FFFFFF', 4.5], ['success badge', '#1B6E3C', '#E4F4EA', 4.5], ['warning badge', '#7A4F00', '#FFF1CF', 4.5], ['error badge', '#B42318', '#FDE8E6', 4.5], ['info badge', '#1F5FA8', '#E6F0FB', 4.5],
  ['error text on surface', '#B42318', '#FFFFFF', 4.5], ['success text on surface', '#1B6E3C', '#FFFFFF', 4.5], ['warning text on surface', '#7A4F00', '#FFFFFF', 4.5], ['alert info', '#123F72', '#E6F0FB', 4.5], ['alert warn', '#5C3B00', '#FFF1CF', 4.5], ['alert err', '#86190F', '#FDE8E6', 4.5], ['alert ok', '#145230', '#E4F4EA', 4.5],
  ['unit suffix text', '#57667A', '#EDF0F4', 4.5], ['table header text', '#57667A', '#FAFBFC', 4.5], ['focus ring vs white (non-text)', '#1F5FA8', '#FFFFFF', 3], ['focus ring on navy (non-text)', '#FBBF24', '#101E32', 3],
];
let bad = 0;
for (const [n, f, b, min] of pairs) { const r = cr(f, b); const ok = r >= min; if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.toFixed(2).padStart(5)}:1  (min ${min})  ${n}  ${f} on ${b}`); }
process.exit(bad ? 1 : 0);
