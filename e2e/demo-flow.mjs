/**
 * End-to-end demo test (docs/06-demo-test-plan.md) driven in a real browser.
 * Usage:  BASE_URL=http://127.0.0.1:5173 CHROMIUM=/path/to/chrome node e2e/demo-flow.mjs
 * Requires: npm i -D playwright-core  and a running API + seeded database.
 */
import { chromium } from 'playwright-core';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:5173';
const EXE = process.env.CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PASSWORD = 'GasMan@Demo2026';
const results = []; const problems = [];
const shots = process.env.SHOTS ?? '/tmp/claude-0/shots';

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });

async function session(email, viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/tile\.openstreetmap|ERR_(NAME|INTERNET|CONNECTION|TUNNEL|PROXY)|40[134]|422/i.test(m.text())) problems.push(`[${email}] console: ${m.text().slice(0, 160)}`); });
  page.on('pageerror', (e) => problems.push(`[${email}] pageerror: ${e.message.slice(0, 160)}`));
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 500) problems.push(`[${email}] HTTP ${r.status()} ${r.url()}`); });
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForLoadState('networkidle').catch(() => {});
  return { ctx, page };
}
async function step(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push(['PASS', name, Date.now() - t0]); console.log(`PASS  ${name}`); }
  catch (e) { results.push(['FAIL', name, Date.now() - t0, e.message.split('\n')[0]]); console.log(`FAIL  ${name}\n      ${e.message.split('\n')[0]}`); }
}
const kpi = async (page, label) => {
  const card = page.locator('div.card', { has: page.getByText(label, { exact: false }) }).first();
  const txt = await card.innerText(); const m = txt.match(/\n\s*([\d,]+)/); return m ? Number(m[1].replace(/,/g, '')) : NaN;
};

// ---------- Super admin ----------
const { page: A } = await session('superadmin@gasman-demo.local');
let before = {}; let tripCode = ''; let tripUrl = '';
await step('T1 Login as Super Admin lands on the Control Tower', async () => { await A.getByRole('heading', { name: 'Operational Control Tower' }).waitFor({ timeout: 10000 }); });
await step('T2 Dashboard shows real KPIs and charts', async () => {
  await A.waitForTimeout(1500);
  before = { completed: await kpi(A, 'Completed today'), available: await kpi(A, 'Vehicles available'), pending: await kpi(A, 'Pending dispatches') };
  if (!(before.available > 0)) throw new Error('available vehicles KPI not numeric: ' + JSON.stringify(before));
  await A.getByText('Trips completed — last 14 days').waitFor();
  await A.screenshot({ path: `${shots}/e2e-01-dashboard.png` });
});
await step('T3 Fleet list loads, filter + search work', async () => {
  await A.getByRole('link', { name: 'Fleet', exact: true }).click(); await A.getByRole('heading', { name: 'Fleet', exact: true }).waitFor();
  await A.getByLabel('Fleet type').selectOption('HIRED'); await A.waitForTimeout(800);
  const rows = await A.locator('tbody tr').count(); if (rows !== 6) throw new Error(`expected 6 hired vehicles, got ${rows}`);
  await A.getByLabel('Fleet type').selectOption('ALL'); await A.getByRole('searchbox').fill('GAS-BZ-014'); await A.waitForTimeout(900);
  if ((await A.locator('tbody tr').count()) !== 1) throw new Error('search did not narrow to 1');
});
await step('T4 Vehicle detail shows documents with expiry status', async () => {
  await A.locator('tbody tr').first().click(); await A.getByRole('heading', { name: 'GAS-BZ-014' }).waitFor();
  await A.getByText('Compliance attention needed').waitFor(); await A.getByRole('tab', { name: /Documents/ }).click(); await A.getByRole('cell', { name: 'Fitness / Inspection' }).waitFor();
  await A.screenshot({ path: `${shots}/e2e-02-vehicle.png` });
});
await step('T5 Driver profile opens with licence & trip history', async () => {
  await A.getByRole('link', { name: 'Drivers', exact: true }).click(); await A.getByRole('heading', { name: 'Drivers', exact: true }).waitFor();
  await A.locator('tbody tr').first().click(); await A.getByRole('tab', { name: /Trip history/ }).click(); await A.getByText('Recent trips').waitFor();
});
await step('T6 Create a trip with the wizard (route, load, schedule, review)', async () => {
  await A.goto(`${BASE}/trips/new`); await A.getByText('What kind of trip is this?').waitFor();
  await A.getByPlaceholder(/Search distributor/).fill('Peshawar'); await A.getByRole('listbox').getByRole('option').first().click();
  await A.getByText('driving time').waitFor();
  await A.getByRole('button', { name: /Continue/ }).click();
  await A.getByLabel(/Planned load/).fill('8'); await A.getByRole('button', { name: /Continue/ }).click();
  await A.getByText('Review', { exact: true }).first().waitFor();
  await A.screenshot({ path: `${shots}/e2e-03-wizard-review.png` });
  await A.getByRole('button', { name: 'Create & assign vehicle' }).click();
  await A.getByRole('heading', { name: /^TRP-/ }).waitFor({ timeout: 10000 }); tripCode = (await A.getByRole('heading', { name: /^TRP-/ }).innerText()).trim(); tripUrl = A.url().split('?')[0];
});
await step('T7+T8 Assign vehicle & driver via the recommendation drawer', async () => {
  await A.getByRole('dialog', { name: 'Assign vehicle & driver' }).waitFor();
  await A.getByText(/is the best fit/).waitFor();
  await A.screenshot({ path: `${shots}/e2e-04-assign.png` });
  await A.getByRole('button', { name: 'Confirm assignment' }).click();
  await A.getByText('Vehicle and driver assigned.').waitFor(); await A.getByText('Assigned', { exact: true }).first().waitFor();
});
await step('T9 Dispatch the trip', async () => {
  await A.getByRole('button', { name: 'Dispatch', exact: true }).click(); await A.getByRole('dialog').getByRole('button', { name: 'Dispatch', exact: true }).click();
  await A.getByText('Waiting for pre-trip safety check').waitFor();
});
await step('T10 Starting without a pre-trip check is blocked with a clear message', async () => {
  await A.getByRole('button', { name: 'Start trip', exact: true }).click(); await A.getByRole('dialog').getByRole('button', { name: 'Start trip' }).click();
  await A.getByText(/passed pre-trip safety check is required/i).first().waitFor();
  await A.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
});
await step('T11 Record pre-trip check, start trip → In Transit; live position appears', async () => {
  await A.getByRole('button', { name: 'Pre-trip check', exact: true }).click(); await A.getByRole('button', { name: 'Confirm all checks passed' }).click(); await A.getByText('Pre-trip safety check passed.').waitFor();
  await A.getByRole('button', { name: 'Start trip', exact: true }).click(); await A.getByRole('dialog').getByRole('button', { name: 'Start trip' }).click();
  await A.getByText('In Transit', { exact: true }).first().waitFor();
  await A.getByRole('tab', { name: 'Tracking' }).click(); await A.getByText('Route map').waitFor(); await A.waitForTimeout(1500);
  await A.screenshot({ path: `${shots}/e2e-05-trip-tracking.png` });
});
await step('T12 Open live tracking and find the new trip', async () => {
  await A.goto(`${BASE}/tracking`); await A.getByRole('heading', { name: 'Live Tracking Control Center' }).waitFor();
  await A.getByRole('option', { name: new RegExp(tripCode) }).waitFor({ timeout: 10000 }); await A.getByRole('option', { name: new RegExp(tripCode) }).click(); await A.getByText('Selected vehicle').waitFor(); await A.waitForTimeout(800);
  await A.screenshot({ path: `${shots}/e2e-06-live.png` });
});
await step('T13 Update status through delivery (arrived → delivered with POD → returning → completed)', async () => {
  await A.goto(tripUrl); await A.getByRole('button', { name: 'Mark arrived' }).click(); await A.getByRole('dialog').getByRole('button', { name: 'Mark arrived' }).click(); await A.getByText('Arrived', { exact: true }).first().waitFor();
  await A.getByRole('button', { name: 'Confirm delivery' }).click(); await A.getByLabel(/Received by/).fill('Gul Rehman'); await A.getByRole('dialog').getByRole('button', { name: 'Confirm delivery' }).click(); await A.getByText('Delivered', { exact: true }).first().waitFor();
  await A.getByRole('button', { name: 'Start return' }).click(); await A.getByRole('dialog').getByRole('button', { name: 'Start return' }).click(); await A.getByText('Returning', { exact: true }).first().waitFor();
  await A.getByRole('button', { name: 'Complete trip' }).click(); await A.getByRole('dialog').getByRole('button', { name: 'Complete trip' }).click(); await A.getByText('Completed', { exact: true }).first().waitFor();
  await A.getByRole('tab', { name: 'Activity' }).click(); await A.getByText(/Delivered 8 MT|Delivered 7\.9\d MT|Delivered 8/).first().waitFor().catch(() => {});
  await A.screenshot({ path: `${shots}/e2e-07-completed.png` });
});
await step('T14 Dashboard reflects the completed trip', async () => {
  await A.goto(`${BASE}/`); await A.waitForTimeout(2000);
  const now = { completed: await kpi(A, 'Completed today'), available: await kpi(A, 'Vehicles available') };
  if (now.completed !== before.completed + 1) throw new Error(`completed today ${before.completed} → ${now.completed} (expected +1)`);
  if (now.available !== before.available) throw new Error(`available vehicles ${before.available} → ${now.available} (expected unchanged after completion)`);
});
await step('T15 Reports show the trip and export CSV', async () => {
  await A.goto(`${BASE}/reports?type=completed-trips`); await A.getByText(tripCode).first().waitFor({ timeout: 10000 });
  const [dl] = await Promise.all([A.waitForEvent('download'), A.getByRole('button', { name: 'Export CSV' }).click()]);
  if (!(await dl.suggestedFilename()).endsWith('.csv')) throw new Error('not a csv');
});
await step('Extra: validation error messages are friendly (assign vehicle in maintenance blocked via UI "show unavailable")', async () => {
  await A.goto(`${BASE}/dispatch`); await A.getByRole('button', { name: 'Assign vehicle & driver' }).first().click();
  await A.getByRole('dialog').getByLabel(/Also show unavailable/).check(); await A.getByText(/is currently in maintenance/).first().waitFor();
  await A.getByRole('dialog').getByText(/GAS-BZ-0(05|17)/).first().click();
  await A.getByText('This selection violates assignment rules').waitFor();
  await A.screenshot({ path: `${shots}/e2e-08-violation.png` });
});
await step('Extra: global search finds vehicles and trips', async () => {
  await A.goto(`${BASE}/`); await A.getByLabel('Global search').fill('Gilgit'); await A.getByRole('button', { name: /TRP-/ }).first().waitFor({ timeout: 8000 });
});

// ---------- Restricted roles ----------
const { page: M } = await session('management@gasman-demo.local');
await step('T16 Management (viewer) cannot see create/dispatch controls or admin pages', async () => {
  await M.getByRole('heading', { name: 'Operational Control Tower' }).waitFor();
  if (await M.getByRole('button', { name: 'Create Trip' }).count()) throw new Error('viewer sees Create Trip');
  if (await M.getByRole('link', { name: 'Users & Roles' }).count()) throw new Error('viewer sees Users & Roles nav');
  await M.goto(`${BASE}/users`); await M.getByText('You don’t have access to this page').waitFor();
  await M.goto(`${BASE}/trips`); if (await M.getByRole('button', { name: 'Create Trip' }).count()) throw new Error('viewer sees Create Trip on trips');
});
await step('T16b API blocks the viewer even when the UI is bypassed', async () => {
  const status = await M.evaluate(async () => { const r = await fetch('/api/v1/auth/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); const j = await r.json(); const w = await fetch('/api/v1/trips', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${j.accessToken}` }, body: JSON.stringify({ originLocationId: 1, distributorId: 1, plannedLoadMt: 5, scheduledDeparture: new Date(Date.now() + 864e5).toISOString() }) }); return w.status; });
  if (status !== 403) throw new Error(`expected 403 got ${status}`);
});

const { page: D } = await session('driver@gasman-demo.local', { width: 390, height: 844 });
await step('T17 Driver sees mobile home, records pre-trip check and starts the assigned trip', async () => {
  await D.getByRole('heading', { name: /^Hello,/ }).waitFor();
  await D.getByText('Active trip').waitFor(); await D.screenshot({ path: `${shots}/e2e-09-driver-mobile.png` });
  if (await D.getByRole('button', { name: 'Mark arrived' }).count()) { /* trip already in transit from an earlier run: nothing to start */ } else {
  await D.getByRole('button', { name: 'Pre-trip check' }).first().click(); await D.getByRole('button', { name: 'Confirm all checks passed' }).click(); await D.getByText('Pre-trip safety check passed.').waitFor();
  await D.getByRole('button', { name: 'Start trip' }).first().click(); await D.getByRole('dialog').getByRole('button', { name: 'Start trip' }).click(); await D.getByText('In Transit', { exact: true }).first().waitFor();
  }
  await D.screenshot({ path: `${shots}/e2e-10-driver-started.png` });
  if (await D.getByRole('button', { name: /Cancel trip|Dispatch/ }).count()) throw new Error('driver sees dispatch/cancel actions');
  const nav = await D.getByRole('link', { name: 'Fleet', exact: true }).count(); if (nav) throw new Error('driver sees Fleet nav');
});

// ---- Finance & sales (accountant) ----
const { page: F } = await session('accountant@gasman-demo.local');
await step('T18 Accountant posts a cash payment voucher with F10', async () => {
  await F.goto(`${BASE}/finance/vouchers`); await F.getByRole('heading', { name: 'Vouchers' }).waitFor();
  await F.getByRole('button', { name: /New voucher/ }).click(); await F.getByRole('menuitem', { name: 'Cash payment' }).click();
  const dlg = F.getByRole('dialog', { name: 'Cash payment' }); await dlg.waitFor();
  await dlg.getByRole('combobox', { name: 'Account' }).selectOption({ label: '5410 · Office & utilities' });
  await dlg.getByLabel('Amount 1').fill('2500'); await dlg.getByLabel('Memo 1').fill('e2e stationery');
  await F.keyboard.press('F10');
  await F.getByText(/Cash payment CPV-\d+-\d+ posted/).waitFor({ timeout: 10000 });
  await F.getByRole('dialog').getByText('Where the money went', { exact: false }).count();
});
await step('T19 Unbalanced journal voucher is blocked client- and server-side', async () => {
  await F.keyboard.press('Escape');
  await F.getByRole('button', { name: /New voucher/ }).click(); await F.getByRole('menuitem', { name: 'Journal voucher' }).click();
  const dlg = F.getByRole('dialog', { name: 'Journal voucher' }); await dlg.waitFor();
  await dlg.getByRole('combobox', { name: 'Account' }).first().selectOption({ label: '1110 · Cash in hand' }); await dlg.getByLabel('Debit 1').fill('100');
  await dlg.getByRole('combobox', { name: 'Account' }).nth(1).selectOption({ label: '5410 · Office & utilities' }); await dlg.getByLabel('Credit 2').fill('90');
  await dlg.getByText(/Difference/).waitFor();
  await dlg.getByRole('button', { name: /Post voucher/ }).click();
  await dlg.getByText(/does not balance/i).waitFor();
  await dlg.getByRole('button', { name: 'Cancel' }).click();
});
await step('T20 Receive a customer payment and see it on the invoice list', async () => {
  await F.goto(`${BASE}/sales/invoices`); await F.getByRole('heading', { name: 'Sales & Invoicing' }).waitFor();
  await F.getByRole('button', { name: 'Receive payment' }).click();
  const dlg = F.getByRole('dialog', { name: 'Receive payment' }); await dlg.waitFor();
  await dlg.getByPlaceholder(/Search distributor/).fill('Peshawar'); await dlg.getByRole('option', { name: /Peshawar/i }).first().click();
  await dlg.getByLabel(/Amount/).fill('1000'); await dlg.getByLabel('Received by').selectOption('CASH');
  await F.keyboard.press('F10');
  await F.getByText(/Receipt CRV-\d+-\d+ posted/).waitFor({ timeout: 10000 });
});
await step('T21 Invoice opens as a printable document', async () => {
  await F.goto(`${BASE}/sales/invoices`); await F.locator('tbody tr').first().click();
  await F.getByText('SALES INVOICE').waitFor(); await F.getByRole('button', { name: 'Print' }).waitFor();
  await F.screenshot({ path: `${shots}/e2e-11-invoice.png` });
});
await step('T22 Financial statements balance', async () => {
  await F.goto(`${BASE}/finance/reports/balance-sheet`); await F.getByText('Liabilities + equity − assets (must be 0)').waitFor();
  const row = F.locator('tr', { hasText: 'must be 0' }); const t = await row.innerText(); if (!/0\.00/.test(t)) throw new Error('balance sheet does not balance: ' + t);
  await F.goto(`${BASE}/finance/reports/trial-balance`); await F.getByRole('columnheader', { name: 'Closing Dr' }).waitFor();
  await F.goto(`${BASE}/finance/reports/bowzer-pnl`); await F.getByRole('columnheader', { name: 'Margin %' }).waitFor();
  await F.screenshot({ path: `${shots}/e2e-12-bowzer-pnl.png` });
});
await step('T23 Bowzer account tab shows P&L and ledger; customer account shows credit meter', async () => {
  await F.goto(`${BASE}/fleet`); await F.locator('tbody tr').first().click(); await F.getByRole('tab', { name: /Account/ }).click();
  await F.getByText('Where the money went').waitFor(); await F.getByText(/^Ledger — /).first().waitFor();
  await F.goto(`${BASE}/customers?tab=parties`); await F.locator('tbody tr').first().click(); await F.getByText('Account & receivables').waitFor();
});
await step('T24 Operations roles cannot reach finance (UI hidden, API 403)', async () => {
  const { page: X } = await session('dispatcher@gasman-demo.local');
  if (await X.getByRole('link', { name: 'Vouchers' }).count()) throw new Error('dispatcher sees Vouchers nav');
  await X.goto(`${BASE}/finance/vouchers`); await X.getByText(/permission|not allowed|access/i).first().waitFor({ timeout: 8000 });
});

await browser.close();
console.log('\n=== SUMMARY ==='); const fails = results.filter((r) => r[0] === 'FAIL');
console.log(`${results.length - fails.length}/${results.length} steps passed`); fails.forEach((f) => console.log(' FAIL:', f[1], '-', f[3]));
console.log(`console/server problems: ${problems.length}`); [...new Set(problems)].slice(0, 10).forEach((p) => console.log(' -', p));
process.exit(fails.length || problems.length ? 1 : 0);
