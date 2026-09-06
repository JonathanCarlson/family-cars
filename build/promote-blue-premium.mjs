// One-off editorial pass requested by Jonathan (2026-09-06 self-chat):
//   "Kate loves the blue Mach-e premium. There was one in Kirkland we were
//   ready to buy but it sold last night. Please promote these on the website"
//
// 1. Removes the specific sold car (Ford of Kirkland, Vapor Blue Metallic
//    Premium AWD, id 785764431 / VIN 3FMTK3SU2PMA22397) — confirmed sold.
// 2. Boosts every remaining Blue-colored Premium-trim Mach-E so it rises to
//    the top of the default "best match" sort and is visually flagged.
//
// Run once from the family-cars repo root: node build/promote-blue-premium.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CARS_JSON = join(import.meta.dirname, 'cars.json');
const SOLD_ID = '785764431';

const data = JSON.parse(readFileSync(CARS_JSON, 'utf8'));

const before = data.cars.length;
const sold = data.cars.find((c) => c.id === SOLD_ID);
data.cars = data.cars.filter((c) => c.id !== SOLD_ID);
console.log(sold
  ? `Removed sold car: ${sold.year} ${sold.trim} ${sold.color} — ${sold.location} ($${sold.price})`
  : `⚠️ Sold car id ${SOLD_ID} not found — nothing removed (already gone?)`);
console.log(`Cars: ${before} -> ${data.cars.length}`);

let promoted = 0;
for (const c of data.cars) {
  const isBluePremium = c.trim === 'Premium' && /blue/i.test(c.color || '');
  if (!isBluePremium) continue;
  c.standout = true;
  if (!Array.isArray(c.highlights)) c.highlights = [];
  if (!c.highlights.includes("Kate's color pick")) c.highlights.unshift("Kate's color pick");
  if (typeof c.matchScore === 'number') {
    c.matchScore = Math.min(100, c.matchScore + 8);
  }
  if (!c.note) {
    c.note = 'Blue Premium — the color/trim combo Kate loves.';
  }
  promoted++;
}
console.log(`Promoted ${promoted} blue Premium car(s).`);

data.updated = new Date().toISOString().slice(0, 10);

writeFileSync(CARS_JSON, JSON.stringify(data, null, 2) + '\n', 'utf8');
console.log('Wrote build/cars.json');
