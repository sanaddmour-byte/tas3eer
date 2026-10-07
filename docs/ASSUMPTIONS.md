# Business assumptions and items that need company confirmation

Nothing in this list is a company-approved value. The application deliberately ships **no production
costs, tax rules, legal wording or certifications**; the demo tenant contains clearly labelled
illustrative figures only.

## Not provided / not invented
| Area | What the application does | What the company must supply |
|---|---|---|
| Tax | Effective-dated tax policy versions (rate, taxable components, deduction + basis, non-negative base, exemptions, source, verifier). Quotations cannot be **issued** until the policy used is `verified` by a user with `tax.verify`. The demo "16 %" policy is labelled *DEMO – NOT verified*; the "16 JOD per m³ deduction" exists only as an unverified draft that demonstrates the mechanism. | The real Jordanian rule, its source reference and who verifies it. |
| Terms & conditions | Versioned clause lists. A version must be approved (`terms.manage`) before a quotation using it can be issued. The seeded terms are two empty placeholders. | The approved wording (the baseline's unspecified 13 terms were **not** invented). |
| Costs / prices | Material prices, plant cost versions, forecast volumes, margins are all data entered per tenant. Demo values are assumptions. | Real prices, fixed/variable costs, forecast volumes, margin policy. |
| Payment terms | Free text per quotation (required before submission). | Standard payment terms. |
| Certifications | Mix specifications carry only fields users enter (strength, slump, aggregate size, cement type, exposure). No standard or certificate is asserted. | Applicable standards/certificates. |
| Integrations | None (no email, ERP, WhatsApp, e-invoicing). Sharing = PDF download. | Which integrations, if any. |
| Baseline summary | The attached "Ready Mix Pricing App — Full Summary" was **not available** in the workspace. Plant names use *Marka* (named in the brief) plus illustrative *Sahab* and *Aqaba*; materials are generic. Both catalogs are editable. | Real plant and material lists. |

## Calculation conventions (documented, testable, configurable where noted)
* **Decimal arithmetic** everywhere (`decimal.js`, 40 digits, half-up). Inputs and outputs are decimal strings.
* **Rounding stages**: each material line is rounded to the *internal precision* (default 4 dp, configurable 3–6);
  the proposed unit price is rounded to 3 dp; each customer line amount = round₃(quantity × displayed unit rate);
  service rows are rounded to 3 dp; tax is rounded to 3 dp (once per document, or per line for the per-line scenarios); totals are sums of
  rounded displayed lines, so printed lines always reconcile to printed totals.
* **Materials**: `cost/m³ = dosage ÷ (dosage units per purchase unit) × (price + procurement freight if ex-source) × (1 + wastage%)`.
  Mass↔volume conversions require a density; bag/drum require an explicit factor; a missing price, freight,
  density or conversion is an **error**, never zero.
* **Fixed-cost allocation** = approved monthly fixed costs ÷ approved monthly forecast volume. Zero/negative/missing forecast is an error.
  Forecast sensitivity is read-only and never alters published prices.
* **Margin vs markup** are separate named modes. Actual margin is always `(final pre-tax price − cost) ÷ final pre-tax price`.
  "Contribution before fixed-cost allocation" and "margin after full configured cost" are shown instead of EBITDA.
* **Double-counting guards**: one cost item name across all categories; wages / depreciation / utilities / maintenance
  may appear only once per plant cost version; delivery/overhead/pumping natures are rejected inside production costs;
  at most one delivery and one pumping charge per quotation; supply-only quotations cannot carry delivery/pumping rows.
* **Pumping minimum**: applies per visit / pour / pump / quotation as configured on the plant cost version. When the minimum is
  per visit/pour/pump the pumped volume is **split evenly** across the entered number of units unless explicit per-visit quantities are supplied
  (assumption to confirm). Mobilization is charged per unit (or once per quotation) and shown as its own row.
* **Trip delivery**: trips = ⌈volume ÷ truck capacity⌉; requires capacity, per-trip charge, fixed cost per trip, cost per km and the round-trip distance.
* **Company tax scenarios (pending finance sign-off)**: *Exempt 0 %*, *8 %* and *16 %* on the amount above JOD 16, i.e. `tax = max(line subtotal − 16, 0) × rate`, computed **separately per line** and summed
  (JOD 100 → 6.72 at 8 %, 13.44 at 16 %; ≤ 16 → 0). A line subtotal is its concrete amount plus its quantity-proportional share of the taxable delivery/pumping/other charges, because those are entered once per quotation.
  Lines with the same mix revision *and* rate count as one line, so splitting a line cannot change tax. For a single mix price the same formula is shown on one m³ at the selling price.
  **Difference from the reference code:** the reference implementation assigns *no* tax to a line with a manual price override; this app taxes overridden lines like any other (silently untaxed lines would understate tax) — confirm with finance.
  All three are seeded as *unverified demo* policies (quotations can't be issued until a user with tax-verify rights verifies the chosen one); tax is rounded per line to 3 dp.
* **Tax-inclusive entry** is supported only for a quotation with exactly one concrete line (otherwise ambiguous and rejected).
* **Approval triggers** (all need `quote.approve`): price override, cost override, service-rate override, margin below the policy's
  threshold, price below full configured cost. No trigger ⇒ the frozen revision is approved automatically. Maker/checker
  separation (submitter ≠ approver) is configurable per tenant and on by default.
* **Revision semantics**: *Create revision* keeps the earlier (pinned) prices; *Reprice as new revision* uses current prices.
  Editing a submitted revision always creates a new draft and invalidates the old approval.
* **Validity/expiry**: validity starts at issue; expiry is applied lazily when quotations are listed or the dashboard is read.
* **Dashboard "projected" figures** are summed from open (pending/approved/issued) quotations and are labelled as projections.

## Security / offline notes
* Sessions are HttpOnly, SameSite=Lax cookies (Secure in production) backed by a server-side session table (revocable; idle + absolute expiry);
  CSRF uses a per-session header token plus Origin checks; passwords use argon2id; login errors are generic; accounts lock for 15 min after 10 failures.
* **Offline limitation**: the browser keeps only customer-facing rates, rate cards and the user's own drafts (per tenant + user IndexedDB, wiped on sign-out).
  Access revoked while a device stays offline is not enforced until the device reconnects; cached customer rates remain readable on that device until then.
* Quotation approval, issuing and submission always require a connection; the server re-prices with current data on submit and returns a
  `reference_changed` conflict if prices/policies moved since the user last looked.
