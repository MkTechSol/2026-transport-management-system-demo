import { q, q1, exec, sequelize } from '../db/sequelize';
import { requestApproval } from '../services/approvals';
import { postStockDoc, type StockDocInput } from '../services/stock';
import type { Rng } from './rng';

const DAY = 86400000;

// [code, name, category, subcategory, brand, madeIn, unit, cost, min, reorder, serialized]
type ItemDef = [string, string, string, string | null, string | null, string, string, number, number, number, boolean];
const CATS: [string, string, string[]][] = [
  ['Cameras & Surveillance', 'CAMERA', ['Dash cameras', 'Side & rear cameras', 'DVR / recorders']],
  ['Tracking & Telematics', 'ACCESSORY', ['GPS trackers', 'Fuel level sensors']],
  ['Tyres & Tubes', 'TYRE', ['Truck tyres 11.00R20', 'Truck tyres 10.00R20']],
  ['Batteries & Electrical', 'SPARE', ['Batteries', 'Lighting', 'Wiring']],
  ['Brakes & Suspension', 'SPARE', ['Brake pads & shoes', 'Air system', 'Suspension']],
  ['Engine & Filters', 'SPARE', ['Filters', 'Belts & hoses']],
  ['LPG Tank Equipment', 'SPARE', ['Valves', 'Gauges & hoses']],
  ['Safety Equipment', 'SAFETY', ['Fire safety', 'First aid & signage']],
  ['Lubricants & Fluids', 'LUBRICANT', ['Engine oil', 'Gear & hydraulic oil', 'Coolant & fluids']],
  ['Workshop Tools', 'TOOL', ['Hand tools']],
];
const BRANDS: [string, string][] = [['VisionCam', 'China'], ['NavTrack', 'Turkey'], ['TyreMax', 'China'], ['RoadKing', 'Pakistan'], ['VoltCell', 'Pakistan'], ['TruckPro', 'Japan'], ['GasTech', 'Italy'], ['SafeGuard', 'Pakistan'], ['ProLube', 'Germany'], ['FilterWorks', 'India'], ['BrakeLine', 'Turkey'], ['ToolCraft', 'Germany']];
const ITEMS: ItemDef[] = [
  ['CAM-DASH', 'Dash camera HD 1080p', 'Cameras & Surveillance', 'Dash cameras', 'VisionCam', 'China', 'PCS', 18500, 6, 10, false],
  ['CAM-REAR', 'Rear-view camera waterproof', 'Cameras & Surveillance', 'Side & rear cameras', 'VisionCam', 'China', 'PCS', 9500, 8, 12, false],
  ['CAM-SIDE', 'Side blind-spot camera', 'Cameras & Surveillance', 'Side & rear cameras', 'VisionCam', 'China', 'PCS', 8700, 6, 10, false],
  ['CAM-DVR4', 'Mobile DVR 4-channel with SD card', 'Cameras & Surveillance', 'DVR / recorders', 'VisionCam', 'China', 'PCS', 32000, 4, 6, false],
  ['TRK-GPS', 'GPS vehicle tracker 4G', 'Tracking & Telematics', 'GPS trackers', 'NavTrack', 'Turkey', 'PCS', 14000, 6, 10, false],
  ['TRK-FUEL', 'Fuel level sensor 600 mm', 'Tracking & Telematics', 'Fuel level sensors', 'NavTrack', 'Turkey', 'PCS', 22000, 3, 4, false],
  ['TYR-1100', 'Truck tyre 11.00R20 16PR', 'Tyres & Tubes', 'Truck tyres 11.00R20', 'TyreMax', 'China', 'PCS', 78000, 6, 12, true],
  ['TYR-1000', 'Truck tyre 10.00R20 16PR', 'Tyres & Tubes', 'Truck tyres 10.00R20', 'RoadKing', 'Pakistan', 'PCS', 69000, 4, 8, true],
  ['BAT-150', 'Battery 12V 150Ah heavy duty', 'Batteries & Electrical', 'Batteries', 'VoltCell', 'Pakistan', 'PCS', 27500, 4, 6, false],
  ['LGT-HEAD', 'Headlight assembly LED', 'Batteries & Electrical', 'Lighting', 'TruckPro', 'Japan', 'PCS', 11800, 4, 6, false],
  ['LGT-BULB', 'Headlight bulb H4 24V', 'Batteries & Electrical', 'Lighting', 'TruckPro', 'Japan', 'PCS', 650, 20, 40, false],
  ['WIR-HARN', 'Trailer wiring harness 7-pin', 'Batteries & Electrical', 'Wiring', 'TruckPro', 'Japan', 'PCS', 3900, 6, 10, false],
  ['BRK-PAD', 'Brake pad set (axle)', 'Brakes & Suspension', 'Brake pads & shoes', 'BrakeLine', 'Turkey', 'SET', 14500, 8, 16, false],
  ['BRK-CHAM', 'Brake chamber 24"', 'Brakes & Suspension', 'Air system', 'BrakeLine', 'Turkey', 'PCS', 8200, 4, 8, false],
  ['AIR-DRYER', 'Air dryer cartridge', 'Brakes & Suspension', 'Air system', 'BrakeLine', 'Turkey', 'PCS', 6400, 4, 6, false],
  ['SUS-SPRG', 'Leaf spring assembly', 'Brakes & Suspension', 'Suspension', 'TruckPro', 'Japan', 'PCS', 46000, 2, 4, false],
  ['FLT-AIR', 'Air filter element', 'Engine & Filters', 'Filters', 'FilterWorks', 'India', 'PCS', 6800, 10, 20, false],
  ['FLT-OIL', 'Oil filter', 'Engine & Filters', 'Filters', 'FilterWorks', 'India', 'PCS', 2400, 20, 40, false],
  ['FLT-FUEL', 'Fuel filter', 'Engine & Filters', 'Filters', 'FilterWorks', 'India', 'PCS', 3200, 16, 30, false],
  ['BLT-FAN', 'Fan belt', 'Engine & Filters', 'Belts & hoses', 'FilterWorks', 'India', 'PCS', 2900, 6, 12, false],
  ['LPG-RELIEF', 'Safety relief valve (LPG tank)', 'LPG Tank Equipment', 'Valves', 'GasTech', 'Italy', 'PCS', 38000, 4, 6, false],
  ['LPG-EXCESS', 'Excess flow valve', 'LPG Tank Equipment', 'Valves', 'GasTech', 'Italy', 'PCS', 22000, 4, 6, false],
  ['LPG-GAUGE', 'Pressure gauge 0–25 bar', 'LPG Tank Equipment', 'Gauges & hoses', 'GasTech', 'Italy', 'PCS', 4500, 6, 10, false],
  ['LPG-HOSE', 'LPG delivery hose assembly 4 m', 'LPG Tank Equipment', 'Gauges & hoses', 'GasTech', 'Italy', 'PCS', 17500, 6, 10, false],
  ['LPG-FLAME', 'Flame arrestor', 'LPG Tank Equipment', 'Valves', 'GasTech', 'Italy', 'PCS', 9000, 4, 8, false],
  ['SAF-EXT9', 'Fire extinguisher 9 kg DCP', 'Safety Equipment', 'Fire safety', 'SafeGuard', 'Pakistan', 'PCS', 7500, 12, 20, false],
  ['SAF-AID', 'First-aid kit (vehicle)', 'Safety Equipment', 'First aid & signage', 'SafeGuard', 'Pakistan', 'PCS', 3200, 10, 16, false],
  ['SAF-TRI', 'Reflective warning triangle', 'Safety Equipment', 'First aid & signage', 'SafeGuard', 'Pakistan', 'PCS', 1900, 12, 20, false],
  ['SAF-CHOCK', 'Wheel chock pair', 'Safety Equipment', 'First aid & signage', 'SafeGuard', 'Pakistan', 'SET', 2600, 8, 12, false],
  ['OIL-ENG20', 'Engine oil 15W-40 (20 L)', 'Lubricants & Fluids', 'Engine oil', 'ProLube', 'Germany', 'DRUM', 24000, 10, 20, false],
  ['OIL-GEAR', 'Gear oil 85W-140 (20 L)', 'Lubricants & Fluids', 'Gear & hydraulic oil', 'ProLube', 'Germany', 'DRUM', 21500, 6, 12, false],
  ['OIL-BRAKE', 'Brake fluid DOT4 (5 L)', 'Lubricants & Fluids', 'Coolant & fluids', 'ProLube', 'Germany', 'CAN', 4800, 8, 12, false],
  ['OIL-COOL', 'Coolant concentrate (20 L)', 'Lubricants & Fluids', 'Coolant & fluids', 'ProLube', 'Germany', 'CAN', 7200, 6, 10, false],
  ['TOL-JACK', 'Hydraulic bottle jack 30 t', 'Workshop Tools', 'Hand tools', 'ToolCraft', 'Germany', 'PCS', 24500, 1, 2, false],
  ['TOL-WRENCH', 'Torque wrench 1/2"', 'Workshop Tools', 'Hand tools', 'ToolCraft', 'Germany', 'PCS', 18500, 1, 2, false],
];

interface Ev { date: string; doc: StockDocInput }

export async function seedInventory(c: { rng: Rng; NOW: number; log?: (m: string) => void }) {
  const { rng, NOW } = c;
  const dayStr = (off: number) => new Date(NOW + off * DAY).toISOString().slice(0, 10);
  const start = (await q1<any>('SELECT min(voucher_date)::text AS d FROM vouchers'))!.d as string;
  const clamp = (d: string) => (d < start ? start : d);

  // masters
  let cid = 1; let sid = 1;
  const catId = new Map<string, number>(); const subId = new Map<string, number>();
  for (const [name, kind, subs] of CATS) {
    await exec(`INSERT INTO item_categories (id, name, kind) VALUES (:i, :n, :k)`, { i: cid, n: name, k: kind }); catId.set(name, cid);
    for (const s of subs) { await exec(`INSERT INTO item_subcategories (id, category_id, name) VALUES (:i, :c, :n)`, { i: sid, c: cid, n: s }); subId.set(`${name}|${s}`, sid++); }
    cid++;
  }
  const brandId = new Map<string, number>(); let bid = 1;
  for (const [n] of BRANDS) { await exec(`INSERT INTO brands (id, name) VALUES (:i, :n)`, { i: bid, n }); brandId.set(n, bid++); }
  let iid = 1; const itemId = new Map<string, number>();
  for (const [code, name, cat, sub, brand, made, unit, , min, reorder, ser] of ITEMS) {
    await exec(`INSERT INTO items (id, code, name, category_id, subcategory_id, brand_id, made_in, unit, min_level, reorder_qty, serialized) VALUES (:i, :c, :n, :cat, :sub, :b, :m, :u, :min, :re, :s)`,
      { i: iid, c: code, n: name, cat: catId.get(cat), sub: sub ? subId.get(`${cat}|${sub}`) : null, b: brand ? brandId.get(brand) : null, m: made, u: unit, min, re: reorder, s: ser });
    itemId.set(code, iid++);
  }
  const cost = new Map(ITEMS.map((i) => [i[0], i[7]]));
  const plants = await q<any>(`SELECT id, name FROM locations WHERE type = 'PLANT' ORDER BY id LIMIT 3`);
  const whDefs = [['WH-01', 'Osakai Central Store', plants[0]?.id ?? null], ['WH-02', 'Kotal Plant Store', plants[1]?.id ?? null], ['WH-03', 'Peshawar Yard Workshop Store', plants[2]?.id ?? null]] as const;
  for (const [i, [code, name, loc]] of whDefs.entries()) await exec(`INSERT INTO warehouses (id, code, name, location_id) VALUES (:i, :c, :n, :l)`, { i: i + 1, c: code, n: name, l: loc });
  await exec(`SELECT setval(pg_get_serial_sequence('items','id'), ${iid - 1}), setval(pg_get_serial_sequence('item_categories','id'), ${cid - 1}), setval(pg_get_serial_sequence('item_subcategories','id'), ${sid - 1}), setval(pg_get_serial_sequence('brands','id'), ${bid - 1}), setval(pg_get_serial_sequence('warehouses','id'), 3)`);

  const vendors = await q<any>(`SELECT id, name, category FROM vendors ORDER BY id`);
  const vend = (frag: string) => vendors.find((v: any) => v.name.includes(frag))?.id as number;
  const sup = { tyre: vend('Tyre House'), parts: vend('Auto Parts'), elec: vend('Electronics'), lube: vend('Lubricants') };
  const banks = await q<any>('SELECT id FROM banks ORDER BY id');
  const vehicles = await q<any>(`SELECT id, code, wheels, odometer_km FROM vehicles WHERE archived_at IS NULL ORDER BY id`);
  const it = (code: string) => itemId.get(code)!;
  const W = (id: number) => ({ type: 'WAREHOUSE' as const, id });
  const V = (id: number) => ({ type: 'VEHICLE' as const, id });
  const post = (doc: StockDocInput) => postStockDoc(null, undefined, doc);

  // 1) opening stock in the three stores (nothing negative, everything costed)
  for (const [w, factor] of [[1, 1.0], [2, 0.5], [3, 0.35]] as const) {
    const lines = ITEMS.filter((i) => !i[10]).map((i) => ({ itemId: it(i[0]), qty: Math.max(1, Math.round(i[8] * factor * rng.float(1.2, 2.6))), unitCost: i[7] }));
    await post({ type: 'OPENING', date: start, to: W(w), narration: 'Opening stock carried forward (demo)', lines });
  }
  // spare tyres in store
  let serial = 10000;
  const tyreSerial = () => `TY${String(++serial)}`;
  const spareTyreLines = Array.from({ length: 18 }, (_, k) => ({ itemId: it(k % 3 === 2 ? 'TYR-1000' : 'TYR-1100'), qty: 1, unitCost: k % 3 === 2 ? 69000 : 78000, serialNo: tyreSerial() }));
  await post({ type: 'OPENING', date: start, to: W(1), narration: 'Opening spare tyres', lines: spareTyreLines.slice(0, 12) });
  await post({ type: 'OPENING', date: start, to: W(3), narration: 'Opening spare tyres', lines: spareTyreLines.slice(12) });

  // 2) opening fitments: each bowzer carries its own kit (e.g. 5 cameras on one, 3 on another) and a full set of tyres
  const cameraPlan = [5, 3, 4, 2, 3, 5, 1, 4, 3, 2];
  for (const [i, v] of vehicles.entries()) {
    const cams = cameraPlan[i % cameraPlan.length];
    const lines: any[] = [
      { itemId: it('CAM-DASH'), qty: 1, unitCost: 18500 },
      ...(cams > 1 ? [{ itemId: it('CAM-REAR'), qty: Math.min(2, cams - 1), unitCost: 9500 }] : []),
      ...(cams > 3 ? [{ itemId: it('CAM-SIDE'), qty: cams - 3, unitCost: 8700 }] : []),
      ...(cams > 2 ? [{ itemId: it('CAM-DVR4'), qty: 1, unitCost: 32000 }] : []),
      { itemId: it('TRK-GPS'), qty: 1, unitCost: 14000 }, { itemId: it('SAF-EXT9'), qty: 2, unitCost: 7500 }, { itemId: it('SAF-AID'), qty: 1, unitCost: 3200 }, { itemId: it('SAF-TRI'), qty: 2, unitCost: 1900 },
      { itemId: it('LPG-RELIEF'), qty: 2, unitCost: 38000 }, { itemId: it('LPG-GAUGE'), qty: 2, unitCost: 4500 }, { itemId: it('LPG-HOSE'), qty: 2, unitCost: 17500 }, { itemId: it('LPG-FLAME'), qty: 1, unitCost: 9000 }, { itemId: it('BAT-150'), qty: 2, unitCost: 27500 },
      ...Array.from({ length: v.wheels ?? 10 }, (_, k) => ({ itemId: it('TYR-1100'), qty: 1, unitCost: 78000, serialNo: tyreSerial(), position: `W${k + 1}` })),
    ];
    await post({ type: 'OPENING', date: start, to: V(v.id), narration: `Fleet fitments carried forward — ${v.code}`, lines });
  }
  // age the fitted tyres so km-on-tyre figures look real
  await exec(`UPDATE tyres t SET odometer_fit = GREATEST(0, v.odometer_km - (4000 + (t.id * 7919) % 70000)), fitted_on = (CURRENT_DATE - (200 + (t.id * 31) % 500)) FROM vehicles v WHERE t.vehicle_id = v.id`);
  await exec(`UPDATE tyre_events e SET odometer = t.odometer_fit, event_date = t.fitted_on FROM tyres t WHERE e.tyre_id = t.id AND e.event_type = 'PURCHASED' AND t.status = 'FITTED'`);
  c.log?.(`opening stock and fitments posted for ${vehicles.length} bowzers`);

  // 3) activity over the period, generated then executed in date order
  const evs: Ev[] = [];
  const buy = (off: number, vendorId: number, lines: [string, number][], mode: 'CREDIT' | 'BANK' | 'CASH', wh = 1, narr?: string) => evs.push({ date: clamp(dayStr(off)), doc: { type: 'PURCHASE', date: clamp(dayStr(off)), to: W(wh), vendorId, payMode: mode, bankId: mode === 'BANK' ? rng.pick(banks).id : undefined, narration: narr, lines: lines.map(([c, qty]) => ({ itemId: it(c), qty, unitCost: Math.round((cost.get(c) ?? 0) * rng.float(0.97, 1.05) / 50) * 50 })) } });
  buy(-62, sup.parts, [['FLT-AIR', 20], ['FLT-OIL', 40], ['FLT-FUEL', 30], ['BRK-PAD', 12]], 'CREDIT');
  buy(-58, sup.lube, [['OIL-ENG20', 14], ['OIL-GEAR', 8], ['OIL-COOL', 8], ['OIL-BRAKE', 10]], 'CREDIT');
  buy(-51, sup.elec, [['CAM-DASH', 6], ['CAM-REAR', 10], ['TRK-GPS', 8]], 'BANK', 1, 'Camera and tracker refresh');
  buy(-44, sup.parts, [['BAT-150', 6], ['LGT-BULB', 40], ['LGT-HEAD', 6], ['WIR-HARN', 8]], 'CREDIT');
  buy(-37, sup.lube, [['OIL-ENG20', 12], ['OIL-BRAKE', 8]], 'CASH', 3);
  buy(-30, sup.parts, [['BRK-CHAM', 8], ['AIR-DRYER', 6], ['BLT-FAN', 12]], 'BANK');
  buy(-23, sup.parts, [['FLT-AIR', 16], ['FLT-OIL', 30], ['FLT-FUEL', 24]], 'CREDIT', 2);
  buy(-16, sup.elec, [['CAM-SIDE', 6], ['CAM-DVR4', 4]], 'BANK');
  buy(-9, sup.lube, [['OIL-ENG20', 10], ['OIL-GEAR', 6]], 'CREDIT');
  for (const [off, n] of [[-47, 6], [-21, 6]] as const) evs.push({ date: clamp(dayStr(off)), doc: { type: 'PURCHASE', date: clamp(dayStr(off)), to: W(1), vendorId: sup.tyre, payMode: 'CREDIT', narration: 'Tyre purchase', lines: Array.from({ length: n }, () => ({ itemId: it('TYR-1100'), qty: 1, unitCost: 78000 + rng.int(-2, 3) * 500, serialNo: tyreSerial() })) } });
  evs.push({ date: clamp(dayStr(-28)), doc: { type: 'PURCHASE_RETURN', date: clamp(dayStr(-28)), from: W(1), vendorId: sup.parts, narration: 'Wrong grade supplied', lines: [{ itemId: it('FLT-AIR'), qty: 2, unitCost: 6800, reason: 'Wrong size supplied' }] } });
  // restock transfers between stores
  evs.push({ date: clamp(dayStr(-40)), doc: { type: 'NAVIGATION', date: clamp(dayStr(-40)), from: W(1), to: W(2), narration: 'Restock Kotal store', lines: [{ itemId: it('FLT-OIL'), qty: 12 }, { itemId: it('FLT-AIR'), qty: 6 }, { itemId: it('OIL-ENG20'), qty: 4 }, { itemId: it('SAF-EXT9'), qty: 4 }] } });
  evs.push({ date: clamp(dayStr(-26)), doc: { type: 'NAVIGATION', date: clamp(dayStr(-26)), from: W(1), to: W(3), narration: 'Workshop store replenishment', lines: [{ itemId: it('BRK-PAD'), qty: 4 }, { itemId: it('BAT-150'), qty: 2 }, { itemId: it('LGT-BULB'), qty: 10 }] } });
  // consumables issued to bowzers and parts replaced during workshop visits
  const pick = () => rng.pick(vehicles);
  for (let k = 0; k < 22; k++) { const v = pick(); const off = -rng.int(2, 55); evs.push({ date: clamp(dayStr(off)), doc: { type: 'ISSUE', date: clamp(dayStr(off)), from: W(rng.pick([1, 1, 2, 3])), vehicleId: v.id, narration: 'Service consumables', lines: [{ itemId: it('OIL-ENG20'), qty: 1 }, { itemId: it('FLT-OIL'), qty: 1 }, { itemId: it(rng.pick(['FLT-AIR', 'FLT-FUEL'])), qty: 1 }, ...(rng.chance(0.35) ? [{ itemId: it(rng.pick(['BRK-PAD', 'LGT-BULB', 'BLT-FAN'])), qty: 1 }] : [])] } }); }
  const REPL: [string, string, string, string][] = [
    ['BAT-150', 'BAT-150', 'SCRAP', 'Battery would not hold charge'], ['CAM-DASH', 'CAM-DASH', 'SCRAP', 'Dash camera failed'], ['LPG-HOSE', 'LPG-HOSE', 'SCRAP', 'Hose abrasion found at inspection'], ['TRK-GPS', 'TRK-GPS', 'RETURN', 'Tracker sent for reflash'],
    ['LPG-GAUGE', 'LPG-GAUGE', 'SCRAP', 'Gauge reading unstable'], ['SAF-EXT9', 'SAF-EXT9', 'SCRAP', 'Extinguisher past service date'],
  ];
  for (let k = 0; k < 14; k++) { const v = pick(); const [n, o, d, why] = rng.pick(REPL); const off = -rng.int(3, 50); const wh = 3;
    evs.push({ date: clamp(dayStr(off)), doc: { type: 'PARTS_REPLACEMENT', date: clamp(dayStr(off)), vehicleId: v.id, from: W(wh), narration: `Replace ${why.toLowerCase()}`, lines: [{ itemId: it(n), qty: 1, removeItemId: it(o), removeQty: 1, removeDisposition: d as any, reason: why }] } }); }
  // camera moved between bowzers, extinguisher returned to store
  const [va, vb] = [vehicles[0], vehicles[1]];
  evs.push({ date: clamp(dayStr(-12)), doc: { type: 'NAVIGATION', date: clamp(dayStr(-12)), from: V(va.id), to: V(vb.id), narration: 'Rear camera moved to GAS-BZ-002', lines: [{ itemId: it('CAM-REAR'), qty: 1 }] } });
  evs.push({ date: clamp(dayStr(-6)), doc: { type: 'NAVIGATION', date: clamp(dayStr(-6)), from: V(vehicles[2].id), to: W(1), narration: 'Spare extinguisher returned to store', lines: [{ itemId: it('SAF-EXT9'), qty: 1 }] } });
  evs.push({ date: clamp(dayStr(-18)), doc: { type: 'ADJUSTMENT', date: clamp(dayStr(-18)), from: W(2), narration: 'Stock count correction — Kotal store', lines: [{ itemId: it('LGT-BULB'), qty: -3 }, { itemId: it('SAF-TRI'), qty: 2 }] } });
  evs.sort((a, b) => a.date.localeCompare(b.date));
  let skipped = 0;
  for (const e of evs) {
    try { await sequelize.transaction((tx) => postStockDoc(null, undefined, e.doc, tx)); } catch (err: any) { skipped++; c.log?.(`seed stock doc skipped: ${err.message}`); }
  }
  // tyre changes on the road: swap worn tyres at the workshop (retread/scrap) using the register
  const swapCandidates = await q<any>(`SELECT t.id, t.item_id, t.serial_no, t.vehicle_id, t.position FROM tyres t WHERE t.status = 'FITTED' ORDER BY t.km_run, t.id LIMIT 60`);
  const spare = await q<any>(`SELECT serial_no, item_id, warehouse_id FROM tyres WHERE status = 'IN_STORE' ORDER BY id`);
  for (let k = 0; k < Math.min(8, spare.length); k++) {
    const old = swapCandidates[(k * 7) % swapCandidates.length]; const nu = spare[k]; const off = -rng.int(4, 45);
    try { await sequelize.transaction((tx) => postStockDoc(null, undefined, { type: 'PARTS_REPLACEMENT', date: clamp(dayStr(off)), vehicleId: old.vehicle_id, from: W(nu.warehouse_id), narration: `Tyre change at ${old.position}`, lines: [{ itemId: nu.item_id, qty: 1, serialNo: nu.serial_no, position: old.position, removeItemId: old.item_id, removeQty: 1, removeSerialNo: old.serial_no, removeDisposition: k % 3 === 0 ? 'SCRAP' : 'RETREAD', reason: k % 3 === 0 ? 'Sidewall damage' : 'Worn to retread limit' }] }, tx)); } catch (err: any) { skipped++; c.log?.(`seed tyre swap skipped: ${err.message}`); }
  }

  // 4) procurement story: requisitions in every state, a quotation comparison, a part-received PO
  const mgr = (await q1<any>(`SELECT id FROM users WHERE role = 'STORE_MANAGER'`))?.id ?? null;
  const mkPr = async (off: number, lines: [string, number][], status: string, vehicleId?: number, notes?: string) => {
    const seq = await q1<any>(`SELECT nextval('pr_no_seq')::int AS n`); const date = clamp(dayStr(off));
    const est = lines.reduce((s, [cde, n]) => s + n * (cost.get(cde) ?? 0), 0);
    const pr = await q1<any>(`INSERT INTO purchase_requests (pr_no, pr_date, needed_by, vehicle_id, requested_by, status, est_value, notes) VALUES (:no, :d, :nb, :v, :u, :st, :e, :n) RETURNING *`,
      { no: `PR-${date.slice(2, 4)}-${String(seq.n).padStart(5, '0')}`, d: date, nb: dayStr(off + 12), v: vehicleId ?? null, u: mgr, st: status, e: est, n: notes ?? null });
    let n = 1; for (const [cde, qty] of lines) await exec(`INSERT INTO purchase_request_lines (pr_id, line_no, item_id, qty) VALUES (:p, :n, :i, :q)`, { p: pr.id, n: n++, i: it(cde), q: qty });
    return pr;
  };
  const pr1 = await mkPr(-3, [['TYR-1100', 8], ['TYR-1000', 4]], 'SUBMITTED', undefined, 'Tyre stock below minimum');
  await requestApproval({ entityType: 'PURCHASE_REQUISITION', entityId: pr1.id, title: `${pr1.pr_no} · 2 item(s)`, amount: Math.round(pr1.est_value), requestedBy: mgr });
  const pr2 = await mkPr(-8, [['CAM-DASH', 6], ['CAM-REAR', 8], ['CAM-DVR4', 3]], 'APPROVED', undefined, 'Camera programme — remaining bowzers');
  const prl = await q<any>(`SELECT id, item_id, qty::float AS qty FROM purchase_request_lines WHERE pr_id = :p ORDER BY line_no`, { p: pr2.id });
  for (const [vi, factor, days] of [[sup.elec, 1.0, 7], [sup.parts, 1.06, 5], [vend('Workshop'), 1.12, 10]] as const) {
    if (!vi) continue;
    const qt = await q1<any>(`INSERT INTO rfq_quotes (pr_id, vendor_id, quoted_on, valid_until, delivery_days, total) VALUES (:p, :v, :d, :vu, :dd, 0) RETURNING id`, { p: pr2.id, v: vi, d: dayStr(-6), vu: dayStr(10), dd: days });
    let total = 0; for (const l of prl) { const code = ITEMS.find((x) => itemId.get(x[0]) === l.item_id)![0]; const rate = Math.round((cost.get(code) ?? 0) * factor / 50) * 50; total += rate * l.qty; await exec('INSERT INTO rfq_quote_lines (quote_id, pr_line_id, rate) VALUES (:q, :l, :r)', { q: qt.id, l: l.id, r: rate }); }
    await exec('UPDATE rfq_quotes SET total = :t WHERE id = :id', { t: total, id: qt.id });
  }
  const pr3 = await mkPr(-30, [['BAT-150', 6], ['BRK-PAD', 10]], 'ORDERED', undefined, 'Quarterly workshop restock');
  const po1 = await q1<any>(`INSERT INTO purchase_orders (po_no, po_date, vendor_id, pr_id, expected_on, total, created_by, status) VALUES (:no, :d, :v, :pr, :e, :t, :u, 'OPEN') RETURNING *`,
    { no: `PO-${dayStr(-28).slice(2, 4)}-00001`, d: clamp(dayStr(-28)), v: sup.parts, pr: pr3.id, e: dayStr(-14), t: 6 * 27500 + 10 * 14500, u: mgr });
  await exec(`INSERT INTO purchase_order_lines (po_id, line_no, item_id, qty, rate) VALUES (:p, 1, :i, 6, 27500), (:p, 2, :j, 10, 14500)`, { p: po1.id, i: it('BAT-150'), j: it('BRK-PAD') });
  await post({ type: 'PURCHASE', date: clamp(dayStr(-19)), to: W(1), vendorId: sup.parts, poId: po1.id, payMode: 'CREDIT', narration: `Part receipt against ${po1.po_no}`, lines: [{ itemId: it('BAT-150'), qty: 6, unitCost: 27500 }, { itemId: it('BRK-PAD'), qty: 4, unitCost: 14500 }] });
  await exec(`SELECT setval('po_no_seq', 1)`);
  void skipped;

  // 5) make the low-stock list interesting
  await exec(`UPDATE items i SET min_level = CEIL(COALESCE((SELECT sum(qty) FROM stock_balances b WHERE b.item_id = i.id AND b.holder_type = 'WAREHOUSE'), 0)) + 2, reorder_qty = 12
               WHERE i.code IN ('FLT-FUEL', 'LGT-BULB', 'OIL-BRAKE', 'CAM-SIDE', 'TRK-FUEL')`);
  c.log?.(`inventory seed complete (${evs.length} stock documents, ${skipped} skipped)`);
}
