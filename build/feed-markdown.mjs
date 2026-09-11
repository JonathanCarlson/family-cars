// feed-markdown.mjs — render a roster as Markdown for machine readers.
//
// The audience is a program (an LLM tool, a script) that fetched a URL and got
// bytes. It cannot click, scroll, or open a modal, so everything the page shows
// progressively — the powertrain evidence, the TCO breakdown, the reliability
// caveats — has to be inline and self-describing here.
//
// The rule that matters most: this must never state more than the page does.
// The whole point of the VIN work is that "Ioniq" tells you nothing about the
// powertrain; a feed that flattened that back into a confident label would
// re-introduce the exact bug through a side door. So every powertrain line
// carries its evidence, and unverified ones say so.

import { npvOfTco } from './feed-json.mjs';

const money = (n) => (n == null ? '—' : `$${Math.round(n).toLocaleString('en-US')}`);
const num = (n) => (n == null ? '—' : Math.round(n).toLocaleString('en-US'));

const POWER = { BEV: 'Battery electric', PHEV: 'Plug-in hybrid', HYB: 'Hybrid', ICE: 'Gasoline' };

function tcoLines(t) {
  if (!t || !t.items) return [];
  const order = [
    ['purchase', 'Purchase price'],
    ['shipping', 'Shipping'],
    ['salesTax', 'Sales tax'],
    ['energy', 'Fuel / electricity'],
    ['maintenance', 'Maintenance'],
    ['insurance', 'Insurance'],
    ['registration', 'Registration'],
    ['batteryAllowance', 'Battery risk allowance'],
    ['majorRepairReserve', 'Major-repair reserve (expected)'],
    ['depreciation', 'Less resale value'],
  ];
  const out = order
    .filter(([k]) => t.items[k])
    .map(([k, label]) => `  - ${label}: ${money(k === 'depreciation' ? -t.items[k] : t.items[k])}`);
  out.push(`  - **${t.years}-year total: ${money(t.total)}** (${money(t.perMonth)}/mo over ${num(t.miles)} mi)`);
  const npv = npvOfTco(t);
  if (npv != null) out.push(`  - **NPV (5%/yr): ${money(npv)}** — same costs discounted to today; later dollars weigh less, so it runs a little under the nominal total`);
  return out;
}

function carSection(c, i) {
  const L = [];
  const name = `${c.year} ${c.make} ${c.model}${c.trim ? ` ${c.trim}` : ''}`;
  L.push(`### ${i}. ${name} — ${money(c.price)}`);
  L.push('');
  L.push(`- VIN: \`${c.vin}\``);
  L.push(`- Mileage: ${num(c.miles)} mi${c.color ? ` · Color: ${c.color}` : ''}${c.cert ? ' · Certified pre-owned' : ''}`);
  if (c.location) L.push(`- Location: ${c.location}${c.distanceMi != null ? ` (${Math.round(c.distanceMi)} mi away)` : ''}`);
  if (c.daysOnLot != null) L.push(`- Days on lot: ${c.daysOnLot}`);
  if (c.url) L.push(`- Listing: ${c.url}`);
  if ((c.shippingUsd ?? 0) > 0) {
    L.push(`- Shipping: **${money(c.shippingUsd)} estimate included in every TCO** — national fallback because only ${c.localCandidateCount ?? 0} qualifying PNW examples were found.`);
  }
  if (c.bargain) {
    L.push(`- Bargain score: **${c.bargain.score}/100 — ${c.bargain.label}**`);
    const discount = c.bargain.components?.purchaseDiscount;
    if (discount) L.push(`  - MSRP discount (25% weight): ${discount.detail}`);
    for (const [key, label] of [
      ['reliabilityRisk', 'Reliability / catastrophic risk'],
      ['localServiceability', 'Local manufacturer serviceability'],
      ['drivingCharacter', 'Driving character / performance'],
      ['premiumFeatures', 'Premium interior / features'],
      ['rangeCharging', 'Range / charging suitability'],
      ['interestingness', 'Rarity / interestingness'],
    ]) {
      const component = c.bargain.components?.[key];
      if (component) L.push(`  - ${label} (${Math.round(component.weight * 100)}%): ${component.score}/100 — ${component.detail}`);
    }
  }
  if (c.kateResearch) {
    const k = c.kateResearch;
    L.push(`- Kate fit: **${c.kateFit?.score ?? '—'}/100** · risk gate \`${k.riskGate || 'VERIFY'}\``);
    if (k.hvPackStatus) L.push(`  - HV pack: ${k.hvPackStatus}${k.hvPackEvidence ? ` — ${k.hvPackEvidence}` : ''}`);
    for (const item of k.highlights || []) L.push(`  - ${item}`);
    for (const item of k.cautions || []) L.push(`  - ⚠️ ${item}`);
    if (k.packages) {
      L.push(`  - Equipment: Plus ${k.packages.plusPack}; Pilot ${k.packages.pilotPack}; performance hardware ${k.packages.performanceHardware}; performance software ${k.packages.performanceSoftware}.`);
    }
    for (const recall of k.hvBatteryRecalls || []) {
      L.push(`  - HV recall ${recall.nhtsaCampaign} / ${(recall.oemCampaigns || []).join(', ')}: **${recall.status}**${recall.restriction ? ` — ${recall.restriction}` : ''}`);
    }
    for (const check of k.requiredChecks || []) L.push(`  - Required: ${check}`);
  }

  // Powertrain — always with provenance. See the note at the top of this file.
  if (c.power) {
    const verified = c.powerSource === 'vin';
    L.push(`- Powertrain: **${POWER[c.power] || c.power}**${c.evRange ? ` · ${c.evRange} mi electric range` : ''}`);
    L.push(`  - ${verified ? 'Determined from the VIN' : '⚠️ NOT VIN-verified'}: ${c.powerEvidence || 'no evidence recorded'}`);
    if (!verified) L.push('  - Treat the range, fuel cost and battery notes below as unconfirmed for this car.');
  }

  if (c.safety) {
    const s = c.safety;
    const bits = [];
    if (s.aeb) bits.push(`AEB ${s.aeb}${s.aebSource === 'vin' ? ' (VIN-confirmed)' : ''}`);
    if (s.bsm) bits.push(`blind-spot ${s.bsm}${s.bsmSource === 'vin' ? ' (VIN-confirmed)' : ''}`);
    if (bits.length) L.push(`- Safety: ${bits.join(' · ')}`);
    if (s.iihs) L.push(`  - IIHS: ${s.iihs}`);
    if (s.iihsNotRated) L.push(`  - ⚠️ IIHS: ${s.iihsNotRated}`);
    if (s.note) L.push(`  - ${s.note}`);
    if (c.vinSafety && c.vinSafety.trim) {
      const extra = ['fcw', 'lka', 'acc', 'rcta', 'backupCam']
        .filter((k) => c.vinSafety[k] === 'standard');
      if (extra.length) L.push(`  - Also standard on this trim (${c.vinSafety.trim}): ${extra.join(', ')}`);
    }
  }

  if (c.reliability) {
    const r = c.reliability;
    L.push(`- Reliability (model-year level): **${r.band}** — confidence ${r.confidence}`);
    L.push(`  - NHTSA: ${r.complaints ?? 0} complaints, ${r.recalls ?? 0} recalls for the ${r.year} ${r.make} ${r.model}`);
    for (const reason of r.reasons || []) L.push(`  - ${reason}`);
    if (r.source) L.push(`  - Source: ${r.source}`);
    if (r.caveat) L.push(`  - Caveat: ${r.caveat}`);
  }

  if (c.batteryWarranty) {
    const b = c.batteryWarranty;
    L.push(`- Traction battery warranty: ${b.summary || JSON.stringify(b)}`);
  }
  if (c.batteryNote) L.push(`- Battery: ${c.batteryNote}`);
  if (c.history) {
    const h = c.history;
    const tri = (v) => (v === null || v === undefined ? 'not reported' : v ? 'yes' : 'no');
    L.push(`- Vehicle history: ${h.reportAvailable ? h.badges.join(', ') : 'no report attached to this listing'}`);
    L.push(`  - Salvage title: ${tri(h.salvageTitle)} · Accidents reported: ${tri(h.accidentsReported)} · One owner: ${tri(h.oneOwner)}`);
    if (h.lemonBuyback != null || h.brandedTitle != null) {
      L.push(`  - Lemon/manufacturer buyback: ${tri(h.lemonBuyback)} · Other branded title: ${tri(h.brandedTitle)}`);
    }
    if (h.salvageTitle === true) {
      L.push('  - ⚠️ **SALVAGE TITLE** — declared a total loss and rebuilt. Repair quality is unverifiable from a listing, crash/airbag performance may be compromised, insurance is harder, and resale is far below a clean-title car (so the resale figure in the cost model is optimistic here).');
    }
    if (h.frameDamage === true) L.push('  - ⚠️ **Frame damage reported.**');
    if (h.floodDamage === true) L.push('  - ⚠️ **Flood/water damage reported.**');
    L.push('  - `not reported` means neither badge was present — it is absence of data, not a clean record.');
  }
  if (c.tco6) {
    L.push('- Cost to own (Jordyn — ~6,760 mi/yr):');
    L.push(...tcoLines(c.tco6));
    if (c.tco2) L.push(`  - 2-year total (Jordyn only): ${money(c.tco2.total)}`);
  }
  // The same car costed at Kate's mileage (she drives exactly double Jordyn), so
  // the assignment question is answerable from the feed, not just the page. NPV
  // is shown for her scenario too.
  if (c.tco6Kate && typeof c.tco6Kate === 'object') {
    const kNpv = npvOfTco(c.tco6Kate);
    const kMiles = (c.tco6Kate.miles && c.tco6Kate.years) ? c.tco6Kate.miles / c.tco6Kate.years : 13520;
    L.push(`- Cost to own (Kate — ~${num(kMiles)} mi/yr): ${c.tco6Kate.years}-year total ${money(c.tco6Kate.total)}${kNpv != null ? ` · NPV (5%/yr) ${money(kNpv)}` : ''}`);
  }
  if (c.standout) L.push(`- Standout: ${c.standout}`);
  if (c.note) L.push(`- Note: ${c.note}`);
  L.push('');
  return L.join('\n');
}

function assumptionsSection(a) {
  if (!a) return '';
  const L = ['## Cost assumptions', ''];
  L.push(`- Driving: ${a.milesPerWeek} mi/week (${num(a.milesPerYear)} mi/year)`);
  L.push(`- Horizon: ${a.jordynYears} years for Jordyn, ${a.emmaYears} years if Emma inherits it`);
  L.push(`- Gasoline: $${a.gasPerGallon.toFixed(2)}/gal (Bellevue, WA)${a.premiumPerGallon ? `, premium $${a.premiumPerGallon.toFixed(2)}/gal where the engine requires it` : ''}`);
  // Averaged over the hold, not a single flat rate: PSE prices are rising fast
  // enough that Jordyn's two years and the six-year through-Emma case are
  // genuinely different numbers.
  if (a.electricityRateByYear) {
    const yrs = Object.keys(a.electricityRateByYear).map(Number).sort((x, y) => x - y);
    const mean = (n) => yrs.slice(0, n).reduce((s, y) => s + a.electricityRateByYear[y], 0) / n;
    L.push(`- Electricity: $${mean(a.jordynYears).toFixed(3)}/kWh over ${a.jordynYears} yr, $${mean(a.emmaYears).toFixed(3)}/kWh over ${a.emmaYears} yr`);
    L.push(`  (PSE Schedule 7 **Tier-2 marginal** rate — the cost of the next kWh, excluding the fixed $7.49/mo basic charge, which is paid whether or not you own an EV. Rising from $${a.electricityRateByYear[yrs[0]]}/kWh in ${yrs[0]}.)`);
  } else if (a.electricityPerKwh) {
    L.push(`- Electricity: $${a.electricityPerKwh.toFixed(2)}/kWh`);
  }
  // These read waEvFeePerYear/waPhevFeePerYear for months — key names the model
  // does not define — so the markdown feed rendered a literal "undefined/yr".
  // Registration is not a flat fee in Bellevue anyway; it is mostly value-based.
  if (a.waEvSurchargePerYear) {
    L.push(`- WA EV surcharge: $${a.waEvSurchargePerYear}/yr for plug-ins with ${a.waEvSurchargeMinRangeMi}+ mi of electric range (shorter-range plug-ins owe nothing)`);
  }
  if (a.rtaMvetRate) {
    L.push(`- WA tabs: ${(a.rtaMvetRate * 100).toFixed(1)}% Sound Transit RTA excise on 85% of ORIGINAL MSRP (not the price paid), depreciated by the 1990 statutory schedule, plus base/weight fees`);
  }
  L.push(`- Sales tax: ${(a.salesTaxRate * 100).toFixed(1)}%`);
  L.push(`- Teen insurance: $${num(a.insuranceTeenBase)}/yr + ${(a.insuranceValueRate * 100).toFixed(1)}% of vehicle value`);
  const m = a.maintPerMile || {};
  L.push(`- Maintenance per mile: BEV $${m.BEV} · PHEV $${m.PHEV} · hybrid $${m.HYB} · gas $${m.ICE}`);
  L.push('');
  L.push('> Insurance is the largest single line and is an estimate, not a quote.');
  L.push('> It has not been checked against a real teen-driver policy.');
  L.push('');
  return L.join('\n');
}

/**
 * @param {object} data  the decrypted roster
 * @param {'jordyn'|'cars'} kind
 */
export function rosterMarkdown(data, kind) {
  const cars = data.cars || [];
  const L = [];
  L.push(`# ${data.title || 'Car roster'}`);
  if (data.subtitle) L.push(`_${data.subtitle}_`);
  L.push('');
  L.push(`**${cars.length} listings** · updated ${data.updated || data.built || 'unknown'}`);
  L.push('');
  L.push('> This is a plaintext export of a private family car roster, generated');
  L.push('> nightly from live dealer inventory. Prices and availability change daily;');
  L.push('> always confirm against the listing URL before acting on anything here.');
  L.push('');
  if (data.intro) { L.push(String(data.intro).replace(/<[^>]+>/g, '')); L.push(''); }

  if (kind === 'jordyn') {
    L.push('## How to read this');
    L.push('');
    L.push('- Powertrain is resolved from the **VIN** via the NHTSA vPIC database, never');
    L.push('  from the model name. Model names lie: a "Hyundai Ioniq" may be a hybrid, a');
    L.push('  plug-in hybrid, or a battery EV, and only the VIN distinguishes them.');
    L.push('- Any car whose powertrain could not be VIN-verified is marked ⚠️. Its range');
    L.push('  and fuel costs are assumptions, not facts.');
    L.push('- Reliability is model-year level, triangulated from free public NHTSA data.');
    L.push('  It is NOT a purchased J.D. Power or Consumer Reports score, and it says');
    L.push('  nothing about the condition of the specific car — get a pre-purchase inspection.');
    L.push('');
    L.push(assumptionsSection(data.assumptions));
  }

  L.push('## Listings');
  L.push('');
  L.push('| # | Vehicle | Price | Miles | Powertrain | 6-yr cost | Bargain | Safety | Reliability |');
  L.push('|---|---------|-------|-------|-----------|-----------|---------|--------|-------------|');
  cars.forEach((c, i) => {
    const p = c.power ? `${POWER[c.power] || c.power}${c.powerSource === 'vin' ? '' : ' ⚠️'}` : '—';
    const safety = c.safety ? [c.safety.aeb === 'standard' ? 'AEB' : null, c.safety.bsm === 'standard' ? 'BSM' : null].filter(Boolean).join('+') || '—' : '—';
    const rel = c.reliability ? c.reliability.band : '—';
    L.push(`| ${i + 1} | ${c.year} ${c.make} ${c.model}${c.trim ? ` ${c.trim}` : ''} | ${money(c.price)} | ${num(c.miles)} | ${p} | ${c.tco6 ? money(c.tco6.total) : '—'} | ${c.bargain?.score ?? '—'} | ${safety} | ${rel} |`);
  });
  L.push('');
  L.push('## Detail');
  L.push('');
  cars.forEach((c, i) => L.push(carSection(c, i + 1)));

  return L.join('\n');
}
