/**
 * Synthetic demo data catalogue. EVERYTHING here is fictional or approximate and NOT GasMan operational data.
 * - Plant / city coordinates are approximate public geography, used for map demos only.
 * - Names, phones, CNIC-like IDs, licence numbers and registration numbers are synthetic.
 */
export const DEMO_PASSWORD = 'GasMan@Demo2026';

export const LOCATIONS: { code: string; name: string; type: string; city: string; region: string; lat: number; lng: number; cap: number; address: string }[] = [
  { code: 'PLT-OSK', name: 'Osakai LPG Plant', type: 'PLANT', city: 'Osakai', region: 'KPK', lat: 33.98, lng: 71.84, cap: 3200, address: 'Osakai, Khyber Pakhtunkhwa (approximate demo location)' },
  { code: 'PLT-DHN', name: 'Dhurnal LPG Plant', type: 'PLANT', city: 'Dhurnal', region: 'PUNJAB', lat: 33.3, lng: 72.62, cap: 4500, address: 'Dhurnal, Attock District, Punjab (approximate demo location)' },
  { code: 'TRM-PQI', name: 'Port Qasim Import Terminal (Demo)', type: 'TERMINAL', city: 'Karachi', region: 'SINDH', lat: 24.78, lng: 67.34, cap: 9000, address: 'Port Qasim, Karachi (demo import terminal)' },
  { code: 'DEP-PSH', name: 'Peshawar Depot (Demo)', type: 'DEPOT', city: 'Peshawar', region: 'KPK', lat: 33.99, lng: 71.57, cap: 400, address: 'Ring Road, Peshawar (demo)' },
  { code: 'DEP-LHR', name: 'Lahore Depot (Demo)', type: 'DEPOT', city: 'Lahore', region: 'PUNJAB', lat: 31.55, lng: 74.31, cap: 600, address: 'Ferozepur Road, Lahore (demo)' },
  // Uplift sources and plants named in the legacy system screenshots (coordinates approximate, for the map demo only)
  { code: 'FLD-NSH', name: 'Nashpa Field (uplift point)', type: 'FIELD', city: 'Karak', region: 'KPK', lat: 33.2, lng: 71.2, cap: 0, address: 'Nashpa, Karak District, KPK (approximate demo location)' },
  { code: 'FLD-MKR', name: 'Makori Field (uplift point)', type: 'FIELD', city: 'Karak', region: 'KPK', lat: 33.1, lng: 71.35, cap: 0, address: 'Makori, Karak District, KPK (approximate demo location)' },
  { code: 'PLT-SHP', name: 'Sher Palam Plant', type: 'PLANT', city: 'Kohat', region: 'KPK', lat: 33.62, lng: 71.28, cap: 1800, address: 'Sher Palam, KPK (approximate demo location)' },
  { code: 'PLT-KTL', name: 'Kotal Plant Kohat', type: 'PLANT', city: 'Kohat', region: 'KPK', lat: 33.57, lng: 71.5, cap: 2100, address: 'Kotal, Kohat, KPK (approximate demo location)' },
];

export interface DistSpec { name: string; city: string; region: string; at: [number, number]; contact: string }
export const DISTRIBUTORS: DistSpec[] = [
  { name: 'Khyber Gas Traders', city: 'Peshawar', region: 'KPK', at: [34.015, 71.52], contact: 'Gul Rehman' },
  { name: 'Frontier LPG Supply', city: 'Peshawar', region: 'KPK', at: [34.04, 71.6], contact: 'Hayat Ullah' },
  { name: 'Mardan Energy Hub', city: 'Mardan', region: 'KPK', at: [34.2, 72.04], contact: 'Ikram Khan' },
  { name: 'Pukhtoon LPG Agency', city: 'Mardan', region: 'KPK', at: [34.18, 72.07], contact: 'Fazal Haq' },
  { name: 'Nowshera Gas Agency', city: 'Nowshera', region: 'KPK', at: [34.02, 71.97], contact: 'Ayaz Khan' },
  { name: 'Swat Valley Gas Co.', city: 'Mingora', region: 'KPK', at: [34.77, 72.36], contact: 'Sher Ali' },
  { name: 'Malakand Gas Services', city: 'Mingora', region: 'KPK', at: [34.75, 72.33], contact: 'Zubair Shah' },
  { name: 'Hazara Gas Distributors', city: 'Abbottabad', region: 'KPK', at: [34.17, 73.22], contact: 'Anwar Abbasi' },
  { name: 'Abbottabad LPG Center', city: 'Abbottabad', region: 'KPK', at: [34.15, 73.2], contact: 'Waqar Swati' },
  { name: 'Mansehra Gas House', city: 'Mansehra', region: 'KPK', at: [34.33, 73.2], contact: 'Sajid Tanoli' },
  { name: 'Kohat Energy Traders', city: 'Kohat', region: 'KPK', at: [33.59, 71.44], contact: 'Noman Afridi' },
  { name: 'Bannu LPG Distributors', city: 'Bannu', region: 'KPK', at: [32.99, 70.6], contact: 'Gohar Marwat' },
  { name: 'Margalla Gas Traders', city: 'Haripur', region: 'KPK', at: [33.99, 72.93], contact: 'Akbar Khan' },
  { name: 'Swabi Gas Agency', city: 'Swabi', region: 'KPK', at: [34.12, 72.47], contact: 'Haroon Khan' },
  { name: 'Pothohar LPG Distributors', city: 'Rawalpindi', region: 'PUNJAB', at: [33.57, 73.02], contact: 'Tariq Mehmood' },
  { name: 'Rawal Gas Agency', city: 'Rawalpindi', region: 'PUNJAB', at: [33.6, 73.06], contact: 'Adnan Butt' },
  { name: 'Ravi Gas Traders', city: 'Lahore', region: 'PUNJAB', at: [31.52, 74.36], contact: 'Kamran Malik' },
  { name: 'Lahore Energy Partners', city: 'Lahore', region: 'PUNJAB', at: [31.48, 74.32], contact: 'Faisal Chaudhry' },
  { name: 'Jhelum Gas Company', city: 'Jhelum', region: 'PUNJAB', at: [32.93, 73.73], contact: 'Shahid Raja' },
  { name: 'Gujrat LPG House', city: 'Gujrat', region: 'PUNJAB', at: [32.57, 74.08], contact: 'Nadeem Warraich' },
  { name: 'Sargodha Energy Traders', city: 'Sargodha', region: 'PUNJAB', at: [32.07, 72.69], contact: 'Irfan Bhatti' },
  { name: 'Faisalabad Gas Hub', city: 'Faisalabad', region: 'PUNJAB', at: [31.45, 73.14], contact: 'Waseem Cheema' },
  { name: 'Attock Gas Services', city: 'Attock', region: 'PUNJAB', at: [33.77, 72.36], contact: 'Salman Awan' },
  { name: 'Capital Gas Distributors', city: 'Islamabad', region: 'ISLAMABAD', at: [33.68, 73.05], contact: 'Riaz Ahmed' },
  { name: 'Blue Area LPG Traders', city: 'Islamabad', region: 'ISLAMABAD', at: [33.71, 73.08], contact: 'Asif Mirza' },
  { name: 'Kashmir Valley Gas', city: 'Muzaffarabad', region: 'AJK', at: [34.37, 73.47], contact: 'Jamil Mir' },
  { name: 'Neelum Gas Traders', city: 'Muzaffarabad', region: 'AJK', at: [34.35, 73.5], contact: 'Khalid Butt' },
  { name: 'Mirpur LPG Agency', city: 'Mirpur', region: 'AJK', at: [33.15, 73.75], contact: 'Zahid Chaudhry' },
  { name: 'Kotli Gas Services', city: 'Kotli', region: 'AJK', at: [33.52, 73.9], contact: 'Pervez Mughal' },
  { name: 'Karakoram Gas Distributors', city: 'Gilgit', region: 'GILGIT_BALTISTAN', at: [35.92, 74.31], contact: 'Sultan Baig' },
  { name: 'Gilgit Energy Traders', city: 'Gilgit', region: 'GILGIT_BALTISTAN', at: [35.9, 74.33], contact: 'Hamid Khan' },
  { name: 'Baltistan LPG Supply', city: 'Skardu', region: 'GILGIT_BALTISTAN', at: [35.3, 75.63], contact: 'Ghulam Abbas' },
];

const FIRST = ['Ahmed','Muhammad','Ali','Imran','Usman','Bilal','Tariq','Naveed','Rashid','Saeed','Zahid','Kamran','Faisal','Shahid','Adnan','Waseem','Irfan','Khalid','Hamid','Jamil','Noman','Saad','Salman','Arif','Asif','Sajid','Nadeem','Pervez','Riaz','Sher','Gul','Hayat','Fazal','Ikram','Zubair','Haroon','Ayaz','Gohar','Akbar','Anwar'];
const LAST = ['Khan','Shah','Hussain','Raza','Malik','Butt','Awan','Yousafzai','Afridi','Khattak','Qureshi','Chaudhry','Mughal','Abbasi','Swati','Tanoli','Gilani','Orakzai','Bangash','Ghani','Mirza','Bhatti','Rana','Cheema'];

export function driverNames(count: number): string[] {
  const out: string[] = []; let i = 0;
  while (out.length < count) { const n = `${FIRST[(i * 7) % FIRST.length]} ${LAST[(i * 5 + Math.floor(i / FIRST.length)) % LAST.length]}`; if (!out.includes(n)) out.push(n); i++; }
  return out;
}

export const VEHICLE_MAKES = [
  { make: 'Hino', model: '700 Series' }, { make: 'Isuzu', model: 'GXZ' }, { make: 'Mercedes-Benz', model: 'Actros 3340' },
  { make: 'Volvo', model: 'FM 400' }, { make: 'FAW', model: 'CA 3250' }, { make: 'Hyundai', model: 'HD 320' }, { make: 'Scania', model: 'P360' },
];
export const PARTNER_OWNERS = ['Partner Alpha (Demo)', 'Partner Bravo (Demo)', 'Partner Charlie (Demo)'];
export const HIRED_VENDORS = ['Indus Haulage (Demo)', 'Karakoram Carriers (Demo)', 'Margalla Transport Co. (Demo)'];
export const MAINT_JOBS = [
  { type: 'PREVENTIVE', title: 'Periodic service (engine oil, filters)', cost: [28000, 52000] },
  { type: 'PREVENTIVE', title: 'Brake inspection & pad replacement', cost: [45000, 90000] },
  { type: 'PREVENTIVE', title: 'Tyre rotation and alignment', cost: [12000, 26000] },
  { type: 'INSPECTION', title: 'Tank valve & safety relief inspection', cost: [18000, 35000] },
  { type: 'CORRECTIVE', title: 'Air-brake compressor repair', cost: [65000, 140000] },
  { type: 'CORRECTIVE', title: 'Clutch assembly replacement', cost: [95000, 180000] },
  { type: 'INSPECTION', title: 'Pressure gauge calibration', cost: [8000, 16000] },
] as const;
export const MAINT_VENDORS = ['Frontier Heavy Workshop (Demo)', 'Attock Truck Care (Demo)', 'GM Fleet Workshop (Demo)', 'Highway Auto Services (Demo)'];

export const PRETRIP_ITEMS = [
  { key: 'tank_valves', label: 'Tank valves & fittings leak-free' },
  { key: 'relief_valve', label: 'Safety relief valve tagged & in date' },
  { key: 'gauges', label: 'Pressure / level gauges working' },
  { key: 'earthing', label: 'Earthing strap & static bonding intact' },
  { key: 'fire_ext', label: 'Fire extinguishers (2x) charged' },
  { key: 'brakes_tyres', label: 'Brakes, lights & tyres inspected' },
  { key: 'placards', label: 'Hazard placards & emergency card on board' },
  { key: 'ppe', label: 'Driver PPE and emergency contacts available' },
];
