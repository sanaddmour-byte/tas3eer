import { expect, request as pwRequest, test } from '@playwright/test';
import { PW, dialog, inviteUser, iso, loginUI, nav, pricesXlsx, state } from './helpers';

test.describe.configure({ mode: 'serial' });

test('first-run: create company via guarded setup, then configure catalog, prices, costs, policies', async ({ page, browser }) => {
  test.setTimeout(240_000);
  // ---- Create company (first-run setup needs the deployment token) ----
  await page.goto('/setup');
  await page.getByLabel('Setup token').fill('wrong-token');
  await page.getByLabel('Company name').fill('E2E Concrete Co');
  await page.getByLabel('Company short code (URL-safe)').fill('e2e-co');
  await page.getByLabel('Administrator name').fill('Ada Admin');
  await page.getByLabel('Administrator email').fill('admin@e2e.example');
  await page.getByLabel('Password').fill(PW);
  await page.getByRole('button', { name: 'Create company' }).click();
  await expect(page.getByRole('alert').first()).toContainText(/invalid setup token/i); // deployment-controlled authorization
  await page.getByLabel('Setup token').fill('e2e-setup-token-0123456789');
  await page.getByRole('button', { name: 'Create company' }).click();
  await expect(page.getByRole('heading', { name: /Hello, Ada/ })).toBeVisible();
  // second attempt: setup is closed
  const anon = await pwRequest.newContext({ baseURL: 'http://localhost:4100' });
  const again = await anon.post('/api/setup', { data: { token: 'e2e-setup-token-0123456789', companyName: 'Evil', slug: 'evil', adminName: 'x', adminEmail: 'evil@x.example', password: PW } });
  expect(again.status()).toBe(409);

  // ---- Settings: plant + materials (admin) ----
  await nav(page, 'Company Settings');
  await page.getByRole('tab', { name: 'Company' }).click();
  await page.getByLabel('Address').fill('Amman, Jordan'); await page.getByLabel('Phone').fill('+962 6 000 0000'); await page.getByLabel('Email').fill('sales@e2e.example');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Settings saved.')).toBeVisible();
  await page.getByRole('tab', { name: 'Plants' }).click();
  await page.getByRole('button', { name: 'Add plant' }).click();
  await dialog(page).getByLabel('Code', { exact: true }).fill('MRK'); await dialog(page).getByLabel('Name (English)').fill('Marka'); await dialog(page).getByLabel('Name (Arabic)').fill('ماركا');
  await dialog(page).getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: 'Marka', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Materials' }).click();
  for (const m of [{ code: 'CEM', name: 'Cement CEM I', pu: 'tonne', du: 'kg' }, { code: 'SAND', name: 'Washed sand', pu: 'tonne', du: 'kg' }, { code: 'WATER', name: 'Water', pu: 'm3', du: 'L' }]) {
    await page.getByRole('button', { name: 'Add material' }).click();
    const d = dialog(page);
    await d.getByLabel('Code', { exact: true }).fill(m.code); await d.getByLabel('Name (English)').fill(m.name);
    await d.getByLabel('Purchase unit').selectOption(m.pu); await d.getByLabel('Dosage unit (in mixes)').selectOption(m.du);
    await d.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: m.name, exact: true })).toBeVisible();
  }
  // unit validation: admixture in litres dosed in kg needs a density
  await page.getByRole('button', { name: 'Add material' }).click();
  const d = dialog(page);
  await d.getByLabel('Code', { exact: true }).fill('ADM'); await d.getByLabel('Name (English)').fill('Admixture'); await d.getByLabel('Purchase unit').selectOption('L'); await d.getByLabel('Dosage unit (in mixes)').selectOption('kg');
  await d.getByRole('button', { name: 'Save' }).click();
  await expect(d.getByRole('alert')).toContainText(/Density .* is required/);
  await d.getByLabel('Density').fill('1100'); await d.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: 'Admixture', exact: true })).toBeVisible();

  // ---- Users (invitation flow through the UI once, rest via API) ----
  await nav(page, 'Users');
  await page.getByRole('button', { name: 'Invite user' }).click();
  await dialog(page).getByLabel('Email').fill('pricing@e2e.example'); await dialog(page).getByLabel('Role').selectOption('pricing'); await dialog(page).getByLabel('Access to all plants').check();
  await dialog(page).getByRole('button', { name: 'Create invitation link' }).click();
  const link = await page.getByTestId('invite-link').innerText();
  await page.keyboard.press('Escape'); // dialog closes, focus returns to the trigger
  const ctx2 = await browser.newContext(); const p2 = await ctx2.newPage();
  await p2.goto(link.replace(/^https?:\/\/[^/]+/, ''));
  await p2.getByLabel('Your name').fill('Pia Pricing'); await p2.getByLabel('Choose a password').fill(PW); await p2.getByRole('button', { name: 'Activate account' }).click();
  await expect(p2.getByRole('heading', { name: /Hello, Pia/ })).toBeVisible();
  await ctx2.close();
  const ctx3 = await browser.newContext(); const p3 = await ctx3.newPage();
  await p3.goto(link.replace(/^https?:\/\/[^/]+/, '')); // one-time link cannot be reused
  await expect(p3.getByRole('alert')).toContainText(/invalid or has expired/);
  await ctx3.close();
  const plants = await (await page.request.get('/api/plants')).json(); state.plantId = plants[0].id;
  await inviteUser(page, 'finance@e2e.example', 'pricing', [], 'Faris Finance');
  await inviteUser(page, 'tech@e2e.example', 'technical', [], 'Tala Tech');
  await inviteUser(page, 'qa@e2e.example', 'technical', [], 'Qasem QA');
  await inviteUser(page, 'sales@e2e.example', 'sales', [state.plantId], 'Sami Sales');
  await inviteUser(page, 'viewer@e2e.example', 'viewer', [state.plantId], 'Vera Viewer');

  // ---- Terms + tax (admin), clients ----
  await nav(page, 'Company Settings');
  await page.getByRole('tab', { name: 'Terms' }).click();
  await page.getByRole('button', { name: 'New terms version' }).click();
  await dialog(page).getByLabel('Name', { exact: true }).fill('E2E terms v1'); await dialog(page).getByLabel('Clause title 1').fill('Validity'); await dialog(page).getByLabel('Clause text').fill('E2E test clause text — not real legal wording.');
  await dialog(page).getByRole('button', { name: 'Save draft terms' }).click();
  await expect(page.getByText('E2E terms v1')).toBeVisible();
  await page.getByRole('button', { name: 'Approve terms' }).click();
  await expect(page.getByText('Approved').first()).toBeVisible();
  await page.getByRole('tab', { name: 'Tax policies' }).click();
  await page.getByRole('button', { name: 'New policy version' }).click();
  await dialog(page).getByLabel('Policy name').fill('E2E sales tax'); await dialog(page).getByLabel('Effective from').fill(iso(-400));
  await dialog(page).getByLabel('Source / reference').fill('E2E fixture — test reference only');
  await dialog(page).getByRole('button', { name: 'Save draft policy' }).click();
  await expect(page.getByText('E2E sales tax')).toBeVisible();
  await nav(page, 'Clients & Projects');
  await page.getByRole('button', { name: 'Add client' }).click();
  await dialog(page).getByLabel('Client name').fill('Al-Noor Contracting'); await dialog(page).getByLabel('Contact person').fill('Site engineer'); await dialog(page).getByLabel('Phone').fill('+962790000000');
  await dialog(page).getByRole('button', { name: 'Save client' }).click();
  await page.getByRole('button', { name: /project\(s\)/ }).first().click();
  await page.getByRole('button', { name: 'Add project' }).click();
  await dialog(page).getByLabel('Project name').fill('Tower A'); await dialog(page).getByLabel('Site address').fill('Abdali, Amman');
  await dialog(page).getByRole('button', { name: 'Save project' }).click();
  await expect(page.getByText('Tower A')).toBeVisible();
});

test('pricing & finance: tax verification, price batch via Excel (maker/checker), plant costs, forecast, policy', async ({ browser }) => {
  test.setTimeout(240_000);
  const { ctx: pc, page: pricing } = await (await import('./helpers')).roleContext(browser, 'pricing@e2e.example');
  const { ctx: fc, page: finance } = await (await import('./helpers')).roleContext(browser, 'finance@e2e.example');
  // tax policy verification (authorised user records the reference)
  await pricing.goto('/admin/settings'); await pricing.getByRole('tab', { name: 'Tax policies' }).click();
  await pricing.getByRole('button', { name: 'Verify' }).click();
  await dialog(pricing).getByLabel('Verification source / reference').fill('E2E: verified against fixture reference');
  await dialog(pricing).getByRole('button', { name: 'Verify policy' }).click();
  await expect(pricing.getByText('Verified', { exact: true }).first()).toBeVisible();
  // pricing policy
  await pricing.getByRole('tab', { name: 'Pricing policies' }).click();
  await pricing.getByRole('button', { name: 'New policy version' }).click();
  await dialog(pricing).getByLabel('Name', { exact: true }).fill('Default 18% gross margin'); await dialog(pricing).getByLabel('Effective from').fill(iso(-100));
  await dialog(pricing).getByRole('button', { name: 'Publish policy' }).click();
  await expect(pricing.getByText('Default 18% gross margin')).toBeVisible();
  // forecast first (allocation basis)
  await pricing.goto('/plant-costs');
  await pricing.getByRole('button', { name: 'New forecast volume' }).click();
  await dialog(pricing).getByLabel('Monthly forecast volume').fill('10000'); await dialog(pricing).getByLabel('Effective from').fill(iso(-100)); await dialog(pricing).getByLabel('Source / approval reference').fill('E2E budget');
  await dialog(pricing).getByRole('button', { name: 'Publish forecast' }).click();
  // plant cost version (draft → approved by another user)
  await pricing.getByRole('button', { name: 'Create first cost version' }).click();
  const d = dialog(pricing);
  await d.getByLabel('Effective from').first().fill(iso(-100));
  const row = async (i: number, name: string, nature: string, amount: string) => {
    await d.getByLabel('Cost', { exact: true }).nth(i).fill(name); await d.getByLabel(/^Nature/).nth(i).selectOption(nature); await d.getByLabel(/^Amount/).nth(i).fill(amount);
  };
  await d.getByRole('button', { name: 'Add fixed cost' }).click(); await row(0, 'Wages', 'wages', '20000');
  await d.getByRole('button', { name: 'Add fixed cost' }).click(); await row(1, 'Depreciation', 'depreciation', '10000');
  await d.getByRole('button', { name: 'Add variable cost' }).click(); await row(2, 'Electricity', 'utilities', '1');
  await d.getByLabel('Corporate overhead').fill('1.2'); await d.getByLabel('Risk / finance provision').fill('0.5');
  await d.getByLabel('Customer charge (per m³)').fill('4.5'); await d.getByLabel('Estimated cost (per m³)').first().fill('3.6');
  await d.getByLabel('Volume rate').fill('2'); await d.getByLabel('Minimum charge').fill('150'); await d.getByLabel('Mobilization / setup fee').fill('0'); await d.getByLabel('Additional hour rate').fill('30');
  // double counting is rejected: a second "wages" nature
  await d.getByRole('button', { name: 'Add fixed cost' }).click(); await row(2, 'Staff salaries', 'wages', '500');
  await d.getByRole('button', { name: 'Save draft revision' }).click();
  await expect(d.getByRole('alert')).toContainText(/double count/i);
  await d.getByRole('button', { name: 'Remove' }).nth(2).click();
  await d.getByRole('button', { name: 'Save draft revision' }).click();
  await expect(pricing.getByRole('heading', { name: 'Versions' })).toBeVisible();
  await expect(pricing.getByText('Draft', { exact: true }).first()).toBeVisible();
  // proposer cannot approve own version; finance can
  await pricing.getByRole('button', { name: 'Approve & publish' }).click();
  await expect(pricing.getByText(/different user must approve/i)).toBeVisible();
  await finance.goto('/plant-costs');
  await finance.getByRole('button', { name: 'Approve & publish' }).click();
  await finance.reload();
  await expect(finance.getByText('Allocated fixed cost per m³')).toBeVisible();
  await expect(finance.getByText('3.0000 JOD/m³').first()).toBeVisible(); // 30,000 / 10,000 = 3

  // price batch from Excel (maker/checker)
  await pricing.goto('/price-book/updates');
  await pricing.getByRole('button', { name: 'New price update' }).click();
  await dialog(pricing).getByLabel('Name').fill('Initial price list'); await dialog(pricing).getByLabel('Default effective date').fill(iso(-60));
  await dialog(pricing).getByRole('button', { name: 'Create draft' }).click();
  await expect(pricing.getByRole('heading', { name: 'Initial price list' })).toBeVisible();
  // invalid upload first → row errors, nothing changes
  const bad = await pricesXlsx([['MRK', 'CEM', 'Cement', 'tonne', -5, 'delivered_plant', null, iso(-60)], ['NOPE', 'SAND', 'Sand', 'tonne', 10, 'ex_source', null, iso(-60)]]);
  await pricing.locator('input[type=file]').setInputFiles({ name: 'bad.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: bad });
  await expect(pricing.getByText(/problem\(s\) found\. No prices were changed/)).toBeVisible();
  await expect(pricing.getByText('Price cannot be negative.')).toBeVisible();
  await expect(pricing.getByText('Unknown plant "NOPE".')).toBeVisible();
  const good = await pricesXlsx([['MRK', 'CEM', 'Cement', 'tonne', 80, 'delivered_plant', null, iso(-60)], ['MRK', 'SAND', 'Sand', 'tonne', 10, 'ex_source', 3, iso(-60)], ['MRK', 'WATER', 'Water', 'm3', 1.2, 'delivered_plant', null, iso(-60)], ['MRK', 'ADM', 'Admixture', 'L', 1.1, 'delivered_plant', null, iso(-60)]]);
  await pricing.locator('input[type=file]').setInputFiles({ name: 'prices.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: good });
  await expect(pricing.getByText('Current vs proposed')).toBeVisible();
  await expect(pricing.getByText('80.000').first()).toBeVisible();
  await pricing.getByRole('button', { name: 'Submit for approval' }).click();
  await expect(pricing.getByText('Awaiting review').first()).toBeVisible();
  const url = pricing.url();
  await finance.goto(url.replace('http://localhost:4100', ''));
  await finance.getByRole('button', { name: 'Approve & publish' }).first().click();
  await dialog(finance).getByRole('button', { name: 'Approve & publish' }).click();
  await expect(finance.getByText('Published').first()).toBeVisible();
  await pricing.goto('/price-book');
  await expect(pricing.getByText('80.000').first()).toBeVisible();
  await pc.close(); await fc.close();
});

test('technical: create mix, submit, second user approves; recipe immutable afterwards', async ({ browser }) => {
  test.setTimeout(180_000);
  const { roleContext } = await import('./helpers');
  const { ctx: tc, page: tech } = await roleContext(browser, 'tech@e2e.example');
  const { ctx: qc, page: qa } = await roleContext(browser, 'qa@e2e.example');
  await tech.goto('/mixes'); await tech.getByRole('button', { name: 'New mix' }).click();
  await dialog(tech).getByLabel('Code', { exact: true }).fill('C30'); await dialog(tech).getByLabel('Grade').fill('C30/37'); await dialog(tech).getByLabel('Name (English)').fill('C30/37 Pumpable'); await dialog(tech).getByLabel('Name (Arabic)').fill('خرسانة C30');
  await dialog(tech).getByLabel('Marka').check(); await dialog(tech).getByRole('button', { name: 'Create draft mix' }).click();
  await expect(tech.getByRole('heading', { name: /C30/ })).toBeVisible();
  // incomplete draft cannot be submitted
  await tech.getByRole('button', { name: 'Submit for technical approval' }).click();
  await expect(tech.getByRole('alert').first()).toContainText(/missing/i);
  await tech.getByRole('button', { name: 'Edit draft' }).click();
  const d = dialog(tech);
  await d.getByLabel('Characteristic strength').fill('37'); await d.getByLabel('Slump').fill('150'); await d.getByLabel('Max aggregate size').fill('19');
  for (const [mat, dose] of [['Cement CEM I', '350'], ['Washed sand', '800'], ['Water', '180'], ['Admixture', '3']] as const) {
    await d.getByRole('button', { name: 'Add ingredient' }).click();
    await d.getByLabel('Material').last().selectOption({ label: mat }); await d.getByLabel('Dosage per m³').last().fill(dose);
  }
  await d.getByRole('button', { name: 'Save draft' }).click();
  await tech.getByRole('tab', { name: 'Ingredients' }).click();
  await expect(tech.getByText('350 kg/m³')).toBeVisible();
  await tech.getByRole('button', { name: 'Submit for technical approval' }).click();
  await expect(tech.getByText('Awaiting technical approval').first()).toBeVisible();
  await expect(tech.getByRole('button', { name: 'Approve revision' })).toBeDisabled(); // maker/checker: the submitter cannot approve
  await expect(tech.getByText('A different user must approve a revision you submitted.')).toBeVisible();
  await qa.goto(tech.url().replace('http://localhost:4100', ''));
  await qa.getByRole('button', { name: 'Approve revision' }).click();
  await expect(qa.getByText('Approved').first()).toBeVisible();
  // pricing tab shows a transparent calculation for a cost-authorised user (pricing); recipe cannot be edited any more
  await expect(qa.getByRole('button', { name: 'Edit draft' })).toHaveCount(0);
  await tc.close(); await qc.close();
  const { ctx: pc, page: pr } = await roleContext(browser, 'pricing@e2e.example');
  await pr.goto('/mixes'); await pr.getByRole('link', { name: 'C30' }).first().click();
  await pr.getByRole('tab', { name: 'Pricing' }).click();
  await expect(pr.getByText('Full configured cost').first()).toBeVisible();
  await expect(pr.getByText('350 kg/m³ ÷ 1000 kg/tonne × 80 JOD/tonne')).toBeVisible(); // 350 kg × 80 JOD/tonne
  await expect(pr.getByText('28.0000').first()).toBeVisible(); // = 28 JOD/m³ cement (+wastage 0)
  await pc.close();
});
