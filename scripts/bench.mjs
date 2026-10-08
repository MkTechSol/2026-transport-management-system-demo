/**
 * Latency benchmark against a running API (use the load-test database: `npm run db:seed-load` into a scratch DB).
 * Usage: API=http://127.0.0.1:4100/api/v1 node scripts/bench.mjs
 * Prints p50 / p95 per endpoint over N sequential requests (single client; concurrency is covered by `autocannon` if you want it).
 */
const API = process.env.API ?? 'http://127.0.0.1:4000/api/v1';
const N = Number(process.env.N ?? 25);
const PASSWORD = 'GasMan@Demo2026';
async function login(email) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
  return (await r.json()).accessToken;
}
const tok = { admin: await login('superadmin@gasman-demo.local'), acc: await login('accountant@gasman-demo.local'), store: await login('store.manager@gasman-demo.local'), hr: await login('hr.manager@gasman-demo.local'), disp: await login('dispatcher@gasman-demo.local') };
const cases = [
  ['dashboard (admin)', 'admin', '/dashboard'], ['trips list p1', 'disp', '/trips?page=1&pageSize=20'], ['trips search', 'disp', '/trips?q=TRP-2026&pageSize=20'], ['vehicles list', 'disp', '/vehicles?pageSize=50'], ['drivers list', 'disp', '/drivers?pageSize=50'],
  ['vouchers list p1', 'acc', '/finance/vouchers?page=1&pageSize=20'], ['vouchers by type + dates', 'acc', '/finance/vouchers?type=CASH_RECEIPT&from=2026-07-01&to=2026-12-31&pageSize=20'],
  ['trial balance', 'acc', '/finance/reports/trial-balance'], ['balance sheet', 'acc', '/finance/reports/balance-sheet'], ['profit & loss', 'acc', '/finance/reports/profit-loss'], ['bowzer P&L (all bowzers)', 'acc', '/finance/reports/bowzer-pnl'], ['bowzer ledger', 'acc', '/finance/reports/ledger?vehicleId=5'],
  ['customer ledger', 'acc', '/finance/reports/ledger?partyId=3&partyType=CUSTOMER'], ['receivable aging', 'acc', '/finance/reports/receivable-aging'], ['invoices list', 'acc', '/sales/invoices?pageSize=20'], ['inventory items', 'store', '/inventory/items?pageSize=20'],
  ['stock navigation matrix', 'store', '/inventory/reports/stock-navigation'], ['exceptions', 'admin', '/exceptions'], ['hr attendance month', 'hr', '/hr/attendance'], ['setup integrity', 'admin', '/setup/integrity'],
];
const pct = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
console.log('endpoint'.padEnd(34), 'p50 ms'.padStart(8), 'p95 ms'.padStart(8), 'status');
for (const [name, who, path] of cases) {
  const ts = []; let status = 0;
  for (let i = 0; i < N; i++) { const t0 = performance.now(); const r = await fetch(API + path, { headers: { authorization: `Bearer ${tok[who]}` } }); await r.arrayBuffer(); ts.push(performance.now() - t0); status = r.status; }
  ts.sort((a, b) => a - b);
  console.log(name.padEnd(34), pct(ts, 0.5).toFixed(0).padStart(8), pct(ts, 0.95).toFixed(0).padStart(8), String(status));
}

// ---- concurrency: CONC virtual users issuing a realistic mix for DURATION seconds ----
const CONC = Number(process.env.CONC ?? 0);
if (CONC > 0) {
  const DURATION = Number(process.env.DURATION ?? 15) * 1000;
  const mix = [['disp', '/dashboard'], ['disp', '/trips?page=1&pageSize=20'], ['disp', '/vehicles?pageSize=50'], ['acc', '/finance/vouchers?pageSize=20'], ['acc', '/sales/invoices?pageSize=20'], ['store', '/inventory/items?pageSize=20'], ['disp', '/tracking/live']];
  const lat = []; let errors = 0; const end = Date.now() + DURATION;
  await Promise.all(Array.from({ length: CONC }, async (_, i) => {
    while (Date.now() < end) {
      const [who, path] = mix[(i + lat.length) % mix.length]; const t0 = performance.now();
      try { const r = await fetch(API + path, { headers: { authorization: `Bearer ${tok[who]}` } }); await r.arrayBuffer(); if (r.status >= 500 || r.status === 429) errors++; } catch { errors++; }
      lat.push(performance.now() - t0);
    }
  }));
  lat.sort((a, b) => a - b);
  console.log(`\nconcurrency ${CONC} for ${DURATION / 1000}s: ${lat.length} requests (${(lat.length / (DURATION / 1000)).toFixed(0)} req/s), errors/429 ${errors}, p50 ${pct(lat, 0.5).toFixed(0)} ms, p95 ${pct(lat, 0.95).toFixed(0)} ms, p99 ${pct(lat, 0.99).toFixed(0)} ms`);
}
