// Generates docs/openapi.json from the shared Zod schemas (single source of truth for request validation).
import { zodToJsonSchema } from 'zod-to-json-schema';
import fs from 'node:fs';
import * as s from '../packages/shared/src/schemas';

type R = [method: string, path: string, summary: string, cap: string | null, body?: any];
const routes: R[] = [
  ['post', '/auth/login', 'Sign in (sets HttpOnly session cookie)', null, s.loginInput], ['post', '/auth/logout', 'Sign out and revoke the session', null], ['get', '/auth/me', 'Current user, capabilities, CSRF token', null],
  ['post', '/auth/invitations/accept', 'Accept a one-time invitation', null, s.acceptInviteInput], ['get', '/setup/status', 'Is first-run setup available?', null], ['post', '/setup', 'First-run setup (needs SETUP_TOKEN, empty database)', null, s.setupInput],
  ['get', '/users', 'List users and invitations', 'user.manage'], ['post', '/users/invitations', 'Create a one-time invitation link', 'user.manage', s.inviteInput],
  ['get', '/materials', 'List materials', null], ['post', '/materials', 'Create material', 'material.manage', s.materialInput],
  ['get', '/price-book', 'Active prices by plant (+ pending proposals)', 'cost.view'], ['get', '/plant-costs', 'Plant cost versions and forecasts', 'cost.view'], ['post', '/plant-costs', 'Create draft plant cost version', 'plantcost.manage', s.plantCostInput],
  ['post', '/plant-costs/{id}/publish', 'Approve and publish a draft cost version', 'plantcost.approve'], ['post', '/forecasts', 'Publish a forecast volume', 'forecast.manage', s.forecastInput], ['post', '/plant-costs/sensitivity', 'Read-only forecast sensitivity', 'cost.view'],
  ['get', '/mixes', 'List mixes and revisions', null], ['post', '/mixes', 'Create mix (draft revision 1)', 'mix.create', s.mixInput], ['post', '/mix-revisions/{id}/approve', 'Technical approval', 'mix.approve'], ['get', '/mix-revisions/{id}/pricing', 'Price (and, with cost.view, cost breakdown) per plant', 'price.view'],
  ['post', '/pricing-policies', 'Publish a commercial pricing policy version', 'policy.manage', s.policyInput], ['post', '/tax-policies', 'Create draft tax policy version', 'tax.manage', s.taxPolicyInput], ['post', '/tax-policies/{id}/verify', 'Verify a tax policy', 'tax.verify'], ['post', '/terms', 'Create terms version', 'terms.manage', s.termsInput],
  ['get', '/clients', 'List clients', null], ['post', '/clients', 'Create client', 'client.manage', s.clientInput], ['post', '/projects', 'Create project', 'client.manage', s.projectInput],
  ['get', '/quotations', 'List quotations (plant + ownership scoped)', null], ['post', '/quotations', 'Create draft quotation (server-side number)', 'quote.create', s.quoteDocument],
  ['put', '/quotations/{id}/revisions/{revNo}', 'Save draft with optimistic concurrency', 'quote.create', s.saveDraftInput], ['get', '/quotations/{id}', 'Quotation with latest revision (cost fields stripped without cost.view)', null],
  ['post', '/quotations/{id}/revisions/{revNo}/submit', 'Freeze revision and request approval', 'quote.create'], ['post', '/quotations/{id}/revisions/{revNo}/approve', 'Approve the exact frozen revision', 'quote.approve', s.decisionInput], ['post', '/quotations/{id}/revisions/{revNo}/return', 'Return for changes', 'quote.approve', s.decisionInput],
  ['post', '/quotations/{id}/revisions/{revNo}/issue', 'Issue and store the PDF', 'quote.issue'], ['get', '/quotations/{id}/revisions/{revNo}/pdf', 'Download PDF of the frozen revision (?lang=en|ar)', 'price.view'], ['post', '/quotations/{id}/revisions/{revNo}/outcome', 'Record accepted/declined/expired', null, s.outcomeInput],
  ['post', '/quotations/{id}/revise', 'New draft revision at the same (pinned) prices', 'quote.create'], ['post', '/quotations/{id}/reprice', 'New draft revision at current prices', 'quote.create'], ['post', '/quotations/{id}/duplicate', 'Duplicate as a new draft', 'quote.create'],
  ['get', '/reference/sales', 'Customer-facing reference snapshot for offline drafting (no costs)', 'price.view'], ['post', '/sync/operations', 'Idempotent offline draft sync', 'quote.create', s.syncOperationInput],
  ['get', '/price-batches', 'List price batches', 'cost.view'], ['post', '/price-batches', 'Create draft price batch', 'pricebatch.propose'], ['put', '/price-batches/{id}/items', 'Replace draft items (validated, all-or-nothing)', 'pricebatch.propose'], ['post', '/price-batches/{id}/upload', 'Upload .xlsx (multipart, ≤2 MB)', 'pricebatch.propose'],
  ['get', '/price-batches/template', 'Download Excel template', 'cost.view'], ['post', '/price-batches/{id}/submit', 'Freeze batch revision', 'pricebatch.propose'], ['post', '/price-batches/{id}/approve', 'Approve + publish atomically (stale check)', 'pricebatch.approve'],
  ['get', '/approvals', 'Pending quotation approvals', null], ['get', '/dashboard', 'Role-specific working queue', null], ['get', '/audit', 'Audit log', 'audit.view'],
];
const paths: any = {};
for (const [m, p, summary, cap, body] of routes) {
  (paths[p] ??= {})[m] = { summary, ...(cap ? { description: `Requires capability \`${cap}\`.` } : {}), ...(body ? { requestBody: { required: true, content: { 'application/json': { schema: zodToJsonSchema(body, { target: 'openApi3', $refStrategy: 'none' }) } } } } : {}),
    parameters: [...(p.match(/\{(\w+)\}/g) ?? []).map((x) => ({ name: x.slice(1, -1), in: 'path', required: true, schema: { type: 'string' } }))], responses: { '200': { description: 'OK' }, '401': { description: 'Not authenticated' }, '403': { description: 'Forbidden or CSRF failure' }, '409': { description: 'Conflict (state, concurrency or overlap)' }, '422': { description: 'Validation / business-rule failure' } } };
}
const doc = { openapi: '3.0.3', info: { title: 'Ready Mix Pricing API', version: '0.1.0', description: 'Cookie session auth (HttpOnly) + X-CSRF-Token header on unsafe methods. Monetary values are decimal strings.' }, servers: [{ url: '/api' }], paths };
fs.writeFileSync('docs/openapi.json', JSON.stringify(doc, null, 2));
console.log(`openapi: ${routes.length} operations`);
