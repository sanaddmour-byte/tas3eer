# Verification results (actual runs)

Run on 2026-10-07 in the build sandbox (Node 22, PostgreSQL 16.15, Chromium 1194 from Playwright). Nothing below was run against a deployed environment.

| Suite | Command | Result |
|---|---|---|
| Pricing-engine unit tests | `npm run test:unit` | **39 / 39 passed** |
| API integration tests (real PostgreSQL, migrations applied from scratch) | `npm run test:api` | **29 / 29 passed** (3 files) |
| End-to-end (Playwright, production build, fresh database, real Chromium) | `npm run test:e2e` | **11 / 11 passed** (≈1.4 min) |
| Type-check, all workspaces | `npm run typecheck` | clean |
| Arabic coverage of UI strings | `npx tsx scripts/i18n-extract.mjs` | 814 strings, 0 missing (extraction-based; see limits) |
| Colour contrast of the actual token pairs | `node scripts/contrast.mjs` | 27 pairs, all ≥ their WCAG minimum |

## What each suite proves
**Engine (39):** unit conversion (350 kg × 100 JOD/t = 35 JOD/m³, density, bag/drum factors, wastage, freight, missing/invalid inputs are errors), fixed-cost allocation
(30,000 / 10,000 = 3; zero/negative/missing forecast rejected; double-inclusion guards), gross margin 20 % → 50, markup 20 % → 48, override 45 → 11.111 %, override reasons/approvals,
pumping minimum (2 JOD/m³ × 50 m³, 150/visit → 150; per visit/quotation; mobilization & hours rows), trip delivery, duplicate/out-of-scope services, tax (deduction bases, line-splitting invariance,
non-negative base, unverified policy as a blocker, tax-inclusive inversion incl. ambiguity), reconciliation of displayed lines to totals, offline preview parity with the authoritative engine.

**API (29, real DB):** argon2id storage; generic login errors; HttpOnly/SameSite cookie; CSRF header + Origin enforcement; revocation (logout, admin revoke, disable); signup off by default; first-run setup refused with wrong token or non-empty DB;
one-time/expiring invitations; cross-tenant references rejected through API **and** composite foreign keys; sales cannot reach costs through any endpoint and responses contain no cost fields; plant scope and ownership;
quotation lifecycle (server-side numbers, freeze, hash, auto-approval, price override → approval, edit of a frozen revision → new revision + invalidated approval, submitter ≠ approver, outcomes with lost reason, lazy expiry, unverified tax / unapproved terms block issue);
DB immutability triggers (frozen revisions, verified tax policy, published prices); issued quote unchanged after a published price change; revise (pinned) vs reprice (current); PDF text parsed back to compare totals, no internal data, fonts embedded, Arabic header repeated across pages;
price batches: invalid Excel changes nothing and reports row errors, valid upload → impact → submit → maker/checker → atomic publish with audit, stale proposal rejected with nothing applied, overlap/immutability constraints; plant-cost double counting rejected, forecast sensitivity; idempotent offline sync, visible conflicts, permission/plant revalidation; tax-inclusive solver.

**E2E (11):** company creation through the guarded setup page (wrong token refused; reuse refused) → plant/materials with density validation → invitation links (one-time) → terms approval → tax verification by an authorised user → pricing policy → forecast → plant-cost draft (double counting rejected, proposer cannot approve) → Excel upload (invalid file rejected, valid file published after a second user approves) →
mix creation (incomplete draft refused), second technical user approves, transparent cost calculation (350 kg ÷ 1000 × 80 JOD/t = 28 JOD/m³) → sales quotation with a missing quantity (error summary links to and focuses the field) → privacy of costs (API + UI) →
price override triggers approval → finance approves the exact revision → sales issues → downloaded PDF parsed and compared with the approved total → price change proposed/approved/published → **issued quotation total unchanged** → reprice as a new revision (cost moves 47.3160 → 52.5660 JOD/m³, revision 1 intact) →
offline edit (“Offline draft — saved on this device”), offline reload, reconnect with a concurrent server edit → visible conflict → “Keep my changes” → exactly one quotation (no duplicates); a draft created entirely offline syncs and receives its number →
Arabic RTL 360 px quotation flow incl. Arabic PDF with embedded Noto Sans Arabic → no page-wide horizontal overflow on 60 page × width combinations (360/768/1024/1440, three roles) → axe-core (WCAG 2.0/2.1/2.2 A+AA tags) on 6 screens in English and Arabic plus the quotation builder (13 scans): **0 violations**.

## Measured vs not measured
* **Quotation drafting time.** The Playwright flow *new quotation → submitted* (existing client + approved mix, including one validation round-trip) took **2.5 s of machine time** (`e2e/results/timing.json`). That is *not* evidence of human speed.
  The flow needs: pick client (auto-selects project and plant), add line, pick mix, enter quantity, pick terms, type payment terms, submit — about 8 interactions. A human timing study was **not** performed.
* **Automated accessibility checks cover only part of WCAG 2.2 AA.** No manual screen-reader, keyboard-only or zoom/reflow audit was performed (keyboard support is implemented — combobox, menus, dialogs with focus trap and restoration — but only partly exercised by tests).
* **Arabic copy** was written by the implementer and has not been reviewed by a native-speaking domain reviewer. Server-side messages not mapped to codes (rare validation texts) fall back to English.
* **Docker image** (`Dockerfile`) was not built here (no Docker in the sandbox).
* **Load / concurrency / penetration testing:** not performed. The per-IP login rate limiter is implemented but disabled in tests (`RATE_LIMIT_ENABLED=false`), so it is not covered by automated tests; the 10-failure account lockout is covered.

## Artefacts
`docs/screenshots/` — demo-tenant screenshots (desktop EN, mobile, Arabic, internal pricing, price-update impact, plant costs, forbidden state). `e2e/results/` — timing, axe and responsive reports and the PDFs produced by the run
(`issued-quotation.pdf`, `arabic-quotation.pdf`). Screenshots are of the real running application; they show saved operational data from the demo seed, except where noted in the e2e specs (those create their own data).
