# Ready Mix Pricing & Quotation

Multi-tenant pricing and quotation application for concrete producers in Jordan (JOD, English/Arabic, RTL).
Workflow: **configure company → maintain material prices & plant costs → approve mix revisions → calculate prices → prepare quotation → obtain approval → issue customer PDF → revise or record outcome.**

> **Read [`docs/ASSUMPTIONS.md`](docs/ASSUMPTIONS.md) first.** The app ships no company-approved costs, tax rules, legal wording or
> certifications. The demo tenant is illustrative only, and tax policies must be *verified* by an authorised user before a quotation can be issued.

## Stack
| Layer | Choice |
|---|---|
| Language | TypeScript throughout (npm workspaces) |
| Web | React 18 + Vite, TanStack Query, React Router, hand-written CSS (tokens, RTL via logical properties), IndexedDB (`idb`) for offline drafts, small service worker for the app shell |
| API | Express, Zod validation (schemas shared with the web app), Drizzle ORM + SQL migrations, PostgreSQL 16 |
| Pricing | `packages/engine` — pure, deterministic, `decimal.js`; no I/O; React-Native-safe (reusable by a future Expo app) |
| Shared | `packages/shared` — capabilities/roles, Zod request schemas, state-machine rules |
| PDF | Chromium (Playwright) renders the **frozen** customer snapshot with embedded Inter + Noto Sans Arabic |
| Excel | `exceljs` template + validated import |
| Auth | argon2id, server-side revocable sessions in HttpOnly cookies, CSRF header + Origin check, rate limits, one-time expiring invitations |
| OpenAPI | `docs/openapi.json` generated from the Zod schemas (`npx tsx scripts/gen-openapi.ts`) |

```
packages/engine   pricing engine, units, tax, services, plant costing      (38+ unit tests)
packages/shared   capabilities, roles, Zod schemas
apps/api          Express API, Drizzle schema + migrations, demo seed, PDF   (27 integration tests, real PostgreSQL)
apps/web          React app (EN/AR), offline store, builder, price book …
e2e/              Playwright end-to-end, mobile, Arabic, a11y, offline specs
docs/             ASSUMPTIONS.md, openapi.json, screenshots
```

## Setup
Requirements: Node ≥ 20, PostgreSQL 16 (Docker or local), Chromium for PDFs (`CHROMIUM_PATH`; Playwright's browser works).

```bash
cp .env.example .env              # adjust DATABASE_URL / CHROMIUM_PATH
docker compose up -d db           # or: npm run db:dev:start   (local postgres 16, no Docker)
npm install
npm run db:migrate                # Drizzle migrations (incl. exclusion constraints + immutability triggers)
npm run db:seed:demo              # optional: clearly labelled DEMO tenant
npm run dev                       # API :4000 + Vite :5173  (Vite proxies /api)
```

Production-style run (API serves the built web app):
```bash
npm run build && WEB_DIST=apps/web/dist NODE_ENV=production npm start      # or scripts/run-prod-local.sh
```
Migrations also run automatically when the API starts.

### Onboarding is closed by default
* **No public signup** (`ALLOW_TENANT_SIGNUP=false`).
* **First-run setup** (`/setup`) works only when `SETUP_TOKEN` is set, the database has **no** company, and the token matches; creation is atomic (advisory lock).
* Users join through **one-time, expiring invitation links** created by an administrator (no email is sent — the link is shown once).

### Demo tenant (`npm run db:seed:demo`)
Company “DEMO Ready Mix Co.” (slug `demo-readymix`), password `Demo!Passw0rd2026` (override with `DEMO_PASSWORD`):
`admin@`, `pricing@`, `finance@`, `technical@`, `qa@`, `sales@`, `sales2@`, `viewer@demo.example`.
Plants Marka / Sahab / Aqaba (editable), 6 materials, mixes C25/C30/C35/C40 (approved), a draft C30 revision 2, an incomplete C50, a submitted and a draft
price-update proposal, quotations in several statuses (draft, pending approval with an override, auto-approved, returned) and a demo tax policy that is **unverified**.
To issue in the demo, verify the demo tax policy (`pricing@`) and approve the demo terms (`admin@`) — exactly as production requires.

## Roles (presets; capabilities can be granted/revoked per user)
Admin · Pricing/Finance · Technical/QA · Sales · Viewer (read-only, plant-scoped). “See costs” (`cost.view`) and “see selling prices”
(`price.view`) are separate capabilities enforced **in the API and in response fields**: users without `cost.view` never receive recipes’ costs,
margins, plant costs, price books or the internal part of calculation results/snapshots.

## Commands
| | |
|---|---|
| `npm test` | engine unit tests + API integration tests (needs `TEST_DATABASE_URL`, default `readymix_test`) |
| `npm run typecheck` | all workspaces |
| `npm run build` | web (Vite) + API (tsup) |
| `npm run test:e2e` | Playwright against a fresh `readymix_e2e` database and the production build (build first) |
| `npx tsx scripts/i18n-extract.mjs` | verifies every UI string has an Arabic translation |
| `npx tsx scripts/gen-openapi.ts` | regenerates `docs/openapi.json` |

## Offline behaviour (web)
Per tenant+user IndexedDB holds a **customer-facing** reference snapshot (mix rates, delivery/pumping charge rate card, tax policy, clients/projects, terms)
and the draft outbox. Drafts autosave locally first (“Offline draft — saved on this device”), sync through an idempotent
`POST /sync/operations` (unique key per operation), use optimistic concurrency with a visible conflict dialog, never overwrite unsynced drafts on
refresh, and never submit/approve/issue offline. Sign-out wipes the store. See `docs/ASSUMPTIONS.md` for revocation limits. The Expo app is **not** built
(deferred); the engine and shared packages are structured for reuse and the same snapshot/outbox/idempotency/conflict rules apply to a SQLite store.
