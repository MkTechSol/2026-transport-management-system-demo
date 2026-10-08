export type LatLng = [number, number];

const R = 6371;
const rad = (d: number) => (d * Math.PI) / 180;

export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** Approximate public coordinates of Pakistani cities / landmarks, used only for synthetic routes & checkpoint names. */
export const LANDMARKS: { name: string; at: LatLng }[] = [
  { name: 'Peshawar', at: [34.0151, 71.5249] }, { name: 'Mardan', at: [34.1986, 72.0404] },
  { name: 'Nowshera', at: [34.0153, 71.9747] }, { name: 'Attock', at: [33.766, 72.3609] },
  { name: 'Kohat', at: [33.5869, 71.4414] }, { name: 'Rawalpindi', at: [33.5651, 73.0169] },
  { name: 'Islamabad', at: [33.6844, 73.0479] }, { name: 'Haripur', at: [33.9946, 72.9333] },
  { name: 'Abbottabad', at: [34.1688, 73.2215] }, { name: 'Mansehra', at: [34.3333, 73.2] },
  { name: 'Jhelum', at: [32.934, 73.731] }, { name: 'Gujrat', at: [32.5731, 74.0789] },
  { name: 'Lahore', at: [31.5204, 74.3587] }, { name: 'Sargodha', at: [32.074, 72.6861] },
  { name: 'Fateh Jang', at: [33.5597, 72.6385] }, { name: 'Swabi', at: [34.12, 72.47] },
  { name: 'Bannu', at: [32.9889, 70.6056] }, { name: 'Mirpur', at: [33.1478, 73.7518] },
  { name: 'Kohala', at: [34.0953, 73.4797] }, { name: 'Besham', at: [34.9277, 72.8759] },
  { name: 'Chilas', at: [35.4128, 74.0958] }, { name: 'Faisalabad', at: [31.4504, 73.135] },
  { name: 'Multan', at: [30.1575, 71.5249] }, { name: 'Sialkot', at: [32.4945, 74.5229] },
  { name: 'Mingora', at: [34.7717, 72.36] }, { name: 'Thakot', at: [34.8, 72.93] },
  { name: 'Chakwal', at: [32.9328, 72.8630] }, { name: 'Talagang', at: [32.9266, 72.4150] },
  { name: 'Pindi Gheb', at: [33.2407, 72.2663] }, { name: 'Hassan Abdal', at: [33.8193, 72.6891] },
];

function nearestLandmark(p: LatLng): { name: string; km: number } {
  let best = { name: LANDMARKS[0].name, km: Infinity };
  for (const l of LANDMARKS) {
    const km = haversineKm(p, l.at);
    if (km < best.km) best = { name: l.name, km };
  }
  return best;
}

/**
 * Builds a deterministic, synthetic road-like polyline between two points (DEMO ONLY - not real road geometry).
 * Real deployments replace this with a routing provider (OSRM / Google / HERE) behind the same Route shape.
 */
export function buildSyntheticRoute(origin: LatLng, dest: LatLng, seed: number) {
  const straight = haversineKm(origin, dest);
  const distanceKm = Math.max(2, Math.round(straight * 1.28 * 10) / 10);
  const n = Math.max(8, Math.min(40, Math.round(straight / 6)));
  const path: LatLng[] = [];
  const dLat = dest[0] - origin[0];
  const dLng = dest[1] - origin[1];
  const len = Math.hypot(dLat, dLng) || 1;
  const nx = -dLng / len; // perpendicular
  const ny = dLat / len;
  const amp = Math.min(0.12, len * 0.07);
  const phase = (seed % 7) * 0.9;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const wob = Math.sin(t * Math.PI * 2 + phase) * amp * Math.sin(t * Math.PI) + Math.sin(t * Math.PI * 5 + phase) * amp * 0.25 * Math.sin(t * Math.PI);
    path.push([round(origin[0] + dLat * t + nx * wob, 5), round(origin[1] + dLng * t + ny * wob, 5)]);
  }
  const checkpoints: { name: string; at: number }[] = [];
  for (const at of [0.3, 0.62]) {
    const p = pointAt(path, at).point;
    const l = nearestLandmark(p);
    if (l.km < 35 && !checkpoints.some((c) => c.name === l.name)) checkpoints.push({ name: `${l.name} bypass checkpoint`, at });
  }
  return { distanceKm, estDurationMin: Math.round((distanceKm / 46) * 60), path, checkpoints };
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

/** Point + heading at fraction t (0..1) along polyline. */
export function pointAt(path: LatLng[], t: number): { point: LatLng; heading: number } {
  const clamped = Math.min(1, Math.max(0, t));
  const segs: number[] = [];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const d = haversineKm(path[i - 1], path[i]);
    segs.push(d);
    total += d;
  }
  let target = clamped * total;
  for (let i = 0; i < segs.length; i++) {
    if (target <= segs[i] || i === segs.length - 1) {
      const f = segs[i] === 0 ? 0 : Math.min(1, target / segs[i]);
      const a = path[i];
      const b = path[i + 1];
      const point: LatLng = [round(a[0] + (b[0] - a[0]) * f, 5), round(a[1] + (b[1] - a[1]) * f, 5)];
      const heading = Math.round((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI);
      return { point, heading: (90 - heading + 360) % 360 };
    }
    target -= segs[i];
  }
  return { point: path[path.length - 1], heading: 0 };
}

/** Projects a GPS point onto a polyline and returns completion fraction 0..1 (nearest vertex based; adequate for demo). */
export function progressOnPath(path: LatLng[], p: LatLng): number {
  let bestI = 0;
  let bestD = Infinity;
  for (let i = 0; i < path.length; i++) {
    const d = haversineKm(path[i], p);
    if (d < bestD) {
      bestD = d;
      bestI = i;
    }
  }
  let before = 0;
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const d = haversineKm(path[i - 1], path[i]);
    total += d;
    if (i <= bestI) before += d;
  }
  return total === 0 ? 0 : before / total;
}

/** Demo freight tariff (PKR per MT per km) used to seed route rates; real rates come from GasMan's route definitions. */
export const DEMO_FREIGHT_PER_MT_KM = 23;
export const demoFreightPerMt = (distanceKm: number, jitter = 0) => Math.max(1500, Math.round(((distanceKm * DEMO_FREIGHT_PER_MT_KM + 400) * (1 + jitter)) / 50) * 50);
