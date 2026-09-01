'use strict';

// jordyn.js — Jordyn's first-car roster.
//
// The shell (crypto, access gate, remembered key, votes/notes, share link,
// toast) lives in car-common.js, shared with Kate's cars.js. This file is only
// the part that is genuinely different: how the roster is RANKED and rendered.
//
// The teen brief, in three rules:
//   1. SAFETY FIRST — cars are GROUPED by whether automatic emergency braking is
//      CONFIRMED standard for that model year, or was optional and needs a
//      per-VIN check. We never claim a feature a car merely could have had.
//   2. TOTAL COST TO OWN over 2 years (Jordyn) and 6 (through Emma) at
//      130 mi/week, with every line item disclosed so the model is auditable.
//   3. EVs/PHEVs get NO thumb on the scale — where they win, they win on cost.

const JORDYN_PUBLIC_URL = 'https://jonathancarlson.github.io/family-cars/jordyn.html';

let DATA = null;

const APP = createCarApp({
  dataUrl: 'data/jordyn.enc.json',
  unlockUrl: 'data/jordyn.unlock.json',
  storagePrefix: 'jordyn-cars',
  publicUrl: JORDYN_PUBLIC_URL,
  shareTitle: "Jordyn's first car",
  shareText: 'Safe, cheap-to-own first cars — 👍/👎 the ones you like:',
  onReady: (data) => { DATA = data; render(); },
});
APP.boot();

// Thin aliases so the render code below reads naturally.
const VOTES = APP.VOTES;
const COMMENTS = APP.COMMENTS;
let SORT = 'match-desc';
let HORIZON = 6; // cost window on the cards: 2 (Jordyn) or 6 (through Emma)
const FACETS = {};
const setComment = (vin, t) => APP.setComment(vin, t);
// ---------- formatting ----------
// `$`, `esc` and `b64ToU8` come from car-common.js; formatters stay per-page.
const money = (n) => (n == null ? '—' : '$' + Number(n).toLocaleString('en-US'));
const milesFmt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US') + ' mi');
const POWER_LABEL = { BEV: '⚡ Electric', PHEV: '🔌 Plug-in hybrid', HYB: '🍃 Hybrid', ICE: '⛽ Gas' };

/**
 * The safety headline. Never claims a trim-gated feature is actually present.
 *
 * Wording note: vPIC records equipment against the VIN's TRIM as the maker
 * submitted it, not against a physical inspection of that individual car. So we
 * say "standard on this trim", not "this car definitely has it" — the honest
 * claim, and still far stronger than a model-year guess.
 */
function safetyBadge(c) {
  const vin = c.safety?.aebSource === 'vin';
  if (c.tier === 'confirmed') {
    return vin
      ? '<span class="sb sb-ok" title="Manufacturer reports this as standard for this VIN\'s trim">🔎 AEB standard — this trim</span>'
      : '<span class="sb sb-ok">✅ AEB standard this year</span>';
  }
  if (c.tier === 'verify') return '<span class="sb sb-warn">⚠️ AEB optional — verify VIN</span>';
  return '<span class="sb sb-bad">❌ No AEB</span>';
}
function bsmBadge(c) {
  const b = c.safety?.bsm;
  const vin = c.safety?.bsmSource === 'vin';
  if (b === 'standard') {
    return vin
      ? '<span class="sb sb-ok" title="Manufacturer reports this as standard for this VIN\'s trim">🔎 Blind-spot standard — this trim</span>'
      : '<span class="sb sb-ok">✅ Blind-spot standard</span>';
  }
  if (b === 'trim') return '<span class="sb sb-warn">⚠️ Blind-spot — verify trim</span>';
  return '<span class="sb sb-bad">❌ No blind-spot</span>';
}

/** Extras NHTSA confirms for this specific VIN — shown only when present. */
function vinExtras(c) {
  const v = c.vinSafety;
  const out = [];
  // Powertrain provenance first — range and running costs all hang off it, and
  // getting it from the model name instead of the VIN is what produced a 1.6 L
  // Ioniq Hybrid advertised as a 170-mile battery EV.
  if (c.powerEvidence) {
    const icon = c.powerSource === 'model-default' ? '⚠️' : '⚡';
    out.push(`<p class="fineprint">${icon} <b>Powertrain</b> — ${esc(c.powerEvidence)}</p>`);
  }
  if (v) {
    const bits = [];
    if (v.trim) bits.push(`Trim <b>${esc(v.trim)}</b>`);
    const std = [];
    if (v.lka === 'standard') std.push('lane-keep');
    if (v.acc === 'standard') std.push('adaptive cruise');
    if (v.rcta === 'standard') std.push('rear cross-traffic alert');
    if (v.fcw === 'standard') std.push('forward-collision warning');
    if (std.length) bits.push(`also standard: ${std.join(', ')}`);
    if (bits.length) out.push(`<p class="fineprint">🔎 <b>From this VIN</b> — ${bits.join(' · ')}.</p>`);
  }
  return out.join('');
}

const REL_LABEL = {
  clean: ['🟢', 'Clean record'],
  ok: ['🟢', 'No red flags'],
  watch: ['🟡', 'Worth asking about'],
  concern: ['🔴', 'Known problem pattern'],
  // Deliberately NOT a reassuring label. "Not enough data" reads as mild good
  // news; a lookup that failed to find the car is not good news at all, and
  // dressing it up as such is how a 2018 Clarity with 134 complaints was shown
  // as "clean".
  unknown: ['⚪', 'No record retrieved'],
};

/**
 * Reliability panel — evidence and its source, never a bare score.
 *
 * Two things are kept deliberately separate, per the brief: what's known about
 * the MODEL YEAR (NHTSA complaints/recalls) and what's true of THIS CAR (battery
 * warranty remaining, pack age/mileage). A good model with an out-of-warranty
 * pack is not the same risk as a good model with five years of coverage left.
 */
function reliabilityBlock(c) {
  const r = c.reliability;
  const w = c.batteryWarranty;
  if (!r && !w) return '';
  const parts = [];

  if (r) {
    const [icon, label] = REL_LABEL[r.band] || REL_LABEL.unknown;
    const conf = r.confidence === 'high' ? 'strong evidence'
      : r.confidence === 'medium' ? 'moderate evidence'
        : r.confidence === 'none' ? 'no evidence retrieved' : 'thin evidence';
    // When nothing was retrieved, show no counts at all. Printing "0 complaints ·
    // 0 recalls" for a failed lookup states a fact we do not have.
    const stats = r.complaints == null
      ? '<div class="rel-stats">No NHTSA record was retrieved for this vehicle — treat it as unchecked, not as clean.</div>'
      : `<div class="rel-stats">${r.complaints} complaint${r.complaints === 1 ? '' : 's'} · ${r.recalls} recall campaign${r.recalls === 1 ? '' : 's'}${r.topComponents?.length ? ` · most cited: ${esc(r.topComponents[0].component.toLowerCase())}` : ''}${r.queriedAs ? ` · NHTSA lists this as “${esc(r.queriedAs)}”` : ''}</div>`;
    parts.push(`
      <div class="rel-head">${icon} <b>${label}</b> <span class="rel-conf">${conf}</span></div>
      <ul class="rel-list">${r.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      ${stats}`);
  }

  if (w) {
    parts.push(`<div class="rel-batt">${w.covered ? '🔋' : '⚠️'} <b>Battery warranty</b> — ${esc(w.note)}</div>`);
  }

  if (r) {
    parts.push(`<p class="rel-caveat">${esc(r.caveat)} <a href="${esc(r.source)}" target="_blank" rel="noopener">Check the NHTSA record ↗</a></p>`);
  }

  return `
    <details class="rel">
      <summary>🔧 Reliability &amp; battery <span class="tco-mo">what the public record says</span></summary>
      <div class="rel-body">${parts.join('')}</div>
    </details>`;
}

const tcoOf = (c) => (HORIZON === 2 ? c.tco2 : c.tco6);

/** The cost panel — shows its work so the model can be argued with. */
function tcoBlock(c) {
  const t = tcoOf(c);
  if (!t) return '';
  const it = t.items;
  const rows = [
    ['Sales tax', it.salesTax],
    ['Fuel / charging', it.energy],
    ['Insurance (teen driver)', it.insurance],
    ['Maintenance', it.maintenance],
    ['Tabs + WA EV fee', it.registration],
    ['Major repairs (expected)', it.majorRepairReserve],
    ['Depreciation', it.depreciation],
  ].filter(([, v]) => v > 0);
  const r = c.repairs6;
  const tail = r?.tail
    ? `<p class="tco-note">The repair line is a <b>budget</b>: probability × cost across everything this powertrain can break.
         Separately, the worst single bill is <b>${money(r.tail.amount)}</b> at roughly ${Math.round(r.tail.probability * 100)}% —
         that is the exposure, not the budget, and the two are deliberately not averaged together.</p>`
    : '';
  return `
    <details class="tco">
      <summary><b>${money(t.total)}</b> to own over ${t.years} yr <span class="tco-mo">≈ ${money(t.perMonth)}/mo</span></summary>
      <table class="tco-tbl">
        ${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${money(v)}</td></tr>`).join('')}
        <tr class="tco-total"><td>Total</td><td>${money(t.total)}</td></tr>
      </table>
      <p class="tco-note">Running cost on top of the ${money(it.purchase)} purchase price, at ${DATA.assumptions?.milesPerWeek ?? 130} mi/week.</p>
      ${tail}
    </details>`;
}

/**
 * Battery health and the 2032 outlook.
 * Capacity loss is shown as range and resale, never as a repair bill — the
 * repair reserve above covers catastrophic failure separately, and showing both
 * as one number would charge the same risk twice.
 */
function outlookBlock(c) {
  const h = c.batteryHealth;
  const v = c.viability;
  if (!h && !v) return '';
  const parts = [];

  if (h) {
    const now = Math.round(h.sohNow * 100);
    const end = Math.round(h.sohAtEndOfWindow * 100);
    parts.push(`
      <p class="fineprint">🔋 <b>Battery health</b> — about <b>${now}%</b> of original capacity now, roughly <b>${end}%</b> by 2032 (${esc(h.sohUncertainty)}).
      ${h.estimatedRangeNowMi ? `That is ~${h.estimatedRangeNowMi} mi of range today, ~${h.estimatedRangeAtEndMi} mi by 2032, against a ~19 mi/day need.` : ''}
      ${h.packReplacedUnderRecall ? '<b>Pack was replaced under the recall</b> — newer hardware than the model year suggests. ' : ''}
      ${esc(h.thermalManagement)}. Capacity loss costs you range and resale, not a repair bill — get a state-of-health readout before buying.</p>`);
  }
  if (v) {
    parts.push(`
      <p class="fineprint">🔮 <b>Still worth owning in ${v.throughYear}?</b> ${esc(v.band)} (~${Math.round(v.probabilityStillEconomic * 100)}%) —
      about ${v.expectedMilesAtEnd.toLocaleString()} mi and ${v.expectedAgeAtEnd} years old by then.
      ${esc((v.reasons || [])[0] || '')}</p>`);
  }
  return parts.join('');
}

function carCard(c) {
  const vote = VOTES[c.vin];
  const note = COMMENTS[c.vin] || '';
  const chips = [safetyBadge(c), bsmBadge(c)];
  if (/Top Safety Pick/.test(c.safety?.iihs || '')) chips.push('<span class="sb sb-ok">🏆 IIHS Top Safety Pick</span>');
  else if (c.safety?.iihsNotRated) chips.push('<span class="sb" title="IIHS did not separately test this powertrain">🏆 IIHS — not this variant</span>');
  chips.push(`<span class="sb">${POWER_LABEL[c.power] || esc(c.power)}</span>`);
  if (c.evRange) chips.push(`<span class="sb">${c.evRange} mi electric</span>`);
  // For a plug-in hybrid the interesting number isn't the battery size, it's how
  // much of THIS family's driving actually happens on it — ~19 mi/day means a
  // 50-mile battery is effectively an EV.
  if (c.power === 'PHEV') {
    const pct = Math.round(electricShareOf(c) * 100);
    if (pct >= 90) chips.push(`<span class="sb sb-ok" title="At 130 mi/week your daily trips fit inside the battery">⚡ ~${pct}% electric driving</span>`);
    else if (pct > 0) chips.push(`<span class="sb">⚡ ~${pct}% electric driving</span>`);
  }
  if (c.powerSource === 'model-default') chips.push('<span class="sb sb-warn">⚠️ Powertrain unverified</span>');
  if (c.cert === 'Certified') chips.push('<span class="sb sb-ok">Certified</span>');
  // Title history rides at the front of the chip row. A rebuilt total-loss car is
  // not a footnote on a first car for a teenager.
  const h = c.history || {};
  if (h.salvageTitle === true) chips.unshift('<span class="sb sb-bad" title="Declared a total loss and rebuilt — repair quality unverifiable">🚨 Salvage title</span>');
  if (h.frameDamage === true) chips.unshift('<span class="sb sb-bad" title="Frame damage on the vehicle history report">🚨 Frame damage</span>');
  if (h.floodDamage === true) chips.unshift('<span class="sb sb-bad" title="Flood/water damage on the vehicle history report">🚨 Flood damage</span>');
  if (h.accidentsReported === true) chips.push('<span class="sb sb-warn">Accident reported</span>');
  else if (h.accidentsReported === false) chips.push('<span class="sb sb-ok">No accidents reported</span>');
  if (h.oneOwner === true) chips.push('<span class="sb sb-ok">One owner</span>');

  return `
  <article class="car${c.standout ? ' standout' : ''}" data-vin="${esc(c.vin)}">
    ${c.new ? '<div class="ribbon">🆕 Just added</div>' : ''}
    ${c.photo
      ? `<img class="car-photo" loading="lazy" src="${esc(c.photo)}" alt="${esc(c.label)}">`
      : `<div class="car-photo car-photo-none" role="img" aria-label="No photo provided for ${esc(c.label)}">
           <span class="cpn-glyph">🚗</span>
           <span class="cpn-text">${esc(c.label)}</span>
           <span class="cpn-sub">Dealer hasn’t posted photos</span>
         </div>`}
    <div class="car-body">
      <div class="car-head">
        <h3>${esc(c.label)}${c.trim ? ` <span class="trim">${esc(c.trim)}</span>` : ''}</h3>
        <div class="price">${money(c.price)}</div>
      </div>
      <div class="car-sub">${milesFmt(c.miles)}${c.location ? ` · ${esc(c.location)}` : ''}${c.distanceMi != null ? ` · ${c.distanceMi} mi away` : ''}</div>
      ${c.priceNote ? `<div class="pricenote">${esc(c.priceNote)}</div>` : ''}
      <div class="chips">${chips.join('')}</div>
      ${c.note ? `<p class="standout-note">⭐ ${esc(c.note)}</p>` : ''}
      ${tcoBlock(c)}
      ${reliabilityBlock(c)}
      ${outlookBlock(c)}
      ${vinExtras(c)}
      ${c.safety?.note ? `<p class="fineprint">🛡️ ${esc(c.safety.note)}</p>` : ''}
      ${c.safety?.iihsNotRated ? `<p class="fineprint">🏆 ${esc(c.safety.iihsNotRated)}</p>` : ''}
      ${c.batteryNote ? `<p class="fineprint">🔋 ${esc(c.batteryNote)}</p>` : ''}
      ${h.salvageTitle === true ? '<p class="fineprint fineprint-bad">🚨 <b>Salvage title</b> — this car was declared a total loss and rebuilt. Repair quality can’t be judged from a listing, crash and airbag performance may be compromised, full coverage can be hard to get, and resale is far below a clean-title car — so the resale credit in the cost figures above is optimistic here.</p>' : ''}
      ${h.frameDamage === true ? '<p class="fineprint fineprint-bad">🚨 <b>Frame damage reported</b> — affects the crash structure.</p>' : ''}
      ${h.floodDamage === true ? '<p class="fineprint fineprint-bad">🚨 <b>Flood/water damage reported</b> — long-term electrical and corrosion risk, worse on a hybrid or EV.</p>' : ''}
      <div class="actions">
        <button class="vote up${vote === 'up' ? ' on' : ''}" data-v="up" type="button" aria-label="Thumbs up">👍</button>
        <button class="vote down${vote === 'down' ? ' on' : ''}" data-v="down" type="button" aria-label="Thumbs down">👎</button>
        <a class="listing" href="${esc(c.url)}" target="_blank" rel="noopener">View listing ↗</a>
      </div>
      <input class="note-input" type="text" placeholder="Add a note…" value="${esc(note)}" aria-label="Note about this car">
    </div>
  </article>`;
}

// ---------- filters / sort ----------
const FACET_DEFS = [
  { id: 'safety', label: 'Safety', opts: [['confirmed', '✅ AEB standard'], ['vin', '🔎 Confirmed by VIN'], ['verify', '⚠️ Verify AEB']], test: (c, v) => (v === 'vin' ? c.safety?.aebSource === 'vin' || c.safety?.bsmSource === 'vin' : c.tier === v) },
  { id: 'power', label: 'Power', opts: [['BEV', '⚡ Electric'], ['PHEV', '🔌 Plug-in'], ['HYB', '🍃 Hybrid'], ['ICE', '⛽ Gas']], test: (c, v) => c.power === v },
  { id: 'bsm', label: 'Blind-spot', opts: [['any', 'Available']], test: (c) => c.safety?.bsm === 'standard' || c.safety?.bsm === 'trim' },
  { id: 'price', label: 'Price', opts: [['u10', 'Under $10k'], ['u13', 'Under $13k']], test: (c, v) => (v === 'u10' ? (c.price ?? 9e9) < 10000 : (c.price ?? 9e9) < 13000) },
  { id: 'miles', label: 'Miles', opts: [['u80', 'Under 80k']], test: (c) => (c.miles ?? 9e9) < 80000 },
];

function passesFacets(c) {
  for (const def of FACET_DEFS) {
    const active = FACETS[def.id];
    if (!active || !active.size) continue;
    let ok = false;
    for (const v of active) if (def.test(c, v)) { ok = true; break; }
    if (!ok) return false;
  }
  return true;
}

const SORTS = [
  { id: 'match-desc', label: '⭐ Best overall' },
  { id: 'electric-desc', label: '⚡ Most electric driving' },
  { id: 'tco-asc', label: '💸 Cheapest to own' },
  { id: 'price-asc', label: '🏷️ Lowest price' },
  { id: 'miles-asc', label: '🛣️ Fewest miles' },
  { id: 'year-desc', label: '📅 Newest' },
];

/**
 * Share of miles this car would actually cover on electricity at 130 mi/week.
 *
 * This is the honest way to express "primarily electric drive". A plug-in hybrid
 * is not half-measure here: the daily need is about 19 miles, so a Volt's 53-mile
 * battery covers essentially every trip and it runs as a de-facto EV — while a
 * short-range PHEV does not. Ranking on battery presence would flatten that
 * distinction; ranking on electric miles preserves it.
 */
function electricShareOf(c) {
  if (c.power === 'BEV') return 1;
  const s = tcoOf(c)?.evShare;
  return typeof s === 'number' ? s : 0;
}

function sortCars(list) {
  const a = [...list];
  if (SORT === 'tco-asc') a.sort((x, y) => (tcoOf(x)?.total ?? 9e9) - (tcoOf(y)?.total ?? 9e9));
  else if (SORT === 'price-asc') a.sort((x, y) => (x.price ?? 9e9) - (y.price ?? 9e9));
  else if (SORT === 'miles-asc') a.sort((x, y) => (x.miles ?? 9e9) - (y.miles ?? 9e9));
  else if (SORT === 'year-desc') a.sort((x, y) => (y.year ?? 0) - (x.year ?? 0));
  else if (SORT === 'electric-desc') {
    // Electric share first, then the normal ranking inside each band, so this
    // stays "best electric cars" rather than "any electric car, in any order".
    a.sort((x, y) => (electricShareOf(y) - electricShareOf(x)) || ((y.matchScore ?? 0) - (x.matchScore ?? 0)));
  } else a.sort((x, y) => (y.matchScore ?? 0) - (x.matchScore ?? 0));
  return a;
}

// ---------- render ----------
function render() {
  $('#cars-status').hidden = true;
  $('#tabbar').hidden = false;
  renderIntro();
  renderControls();
  renderList();
  renderGuide();
  renderTally();
  wireDelegates();
}

function renderIntro() {
  const s = DATA.stats || {};
  const a = DATA.assumptions || {};
  $('#intro').innerHTML = `
    <div class="card">
      <p class="lede">${esc(DATA.intro || '')}</p>
      <div class="stat-grid">
        <div class="stat"><div class="n">${s.count ?? '—'}</div><div class="l">cars found</div></div>
        <div class="stat"><div class="n">${s.confirmedAeb ?? '—'}</div><div class="l">AEB standard</div></div>
        <div class="stat"><div class="n">${s.plugCount ?? '—'}</div><div class="l">electric / plug-in</div></div>
      </div>
      ${assumptionsBlock(a)}
    </div>`;
}

/**
 * Every input to the cost model, spelled out.
 *
 * These numbers decide the whole ranking, and several are genuinely uncertain —
 * teen insurance alone is over half the six-year total. Burying them in a
 * sentence would make the model look more authoritative than it is, so they get
 * a table you can argue with.
 */
function assumptionsBlock(a) {
  const rows = [
    ['Driving', `${a.milesPerWeek ?? 130} mi/week — ${(a.milesPerYear ?? 6760).toLocaleString()} mi/yr`,
      'The barn is 16 mi away, four round trips a week, plus local driving. A 32-mi round trip is the number that matters for electric range.'],
    ['Cost windows', `${a.jordynYears ?? 2} years, then ${a.emmaYears ?? 6}`,
      'Two years is Jordyn\u2019s window and the bar a car must clear. Six years is the bonus case — still a good car when Emma drives.'],
    ['Electricity', `${money(a.electricityPerKwh)}/kWh`, 'PSE residential blended rate.'],
    ['Gasoline', `${money(a.gasPerGallon)}/gal`,
      'Bellevue pump price, not a national or state average — Washington\u2019s fuel tax and cap-and-invest costs land on top, and the Eastside runs above the state average again. This is the single biggest lever on gas-vs-electric.'],
    ['Insurance', `${money(a.insuranceTeenBase)}/yr + ${((a.insuranceValueRate ?? 0.045) * 100).toFixed(1)}% of the car\u2019s value`,
      '⚠️ The biggest and least certain input — over half the six-year total, and the reason a cheaper car really is cheaper to run. Worth checking against a real quote.'],
    ['Maintenance', 'Electric $0.04/mi · hybrid $0.06 · gas $0.09',
      'EVs skip oil, plugs, belts, exhaust and most brake wear (regen). This is where much of the EV advantage lives at this price.'],
    ['WA registration', `$85/yr + ${money(a.waEvFeePerYear)}/yr for electric (${money(a.waPhevFeePerYear)} plug-in hybrid)`,
      'Washington\u2019s EV fee claws back a large share of the fuel savings — which is why the electrics don\u2019t run away with it.'],
    ['Sales tax', `${((a.salesTaxRate ?? 0.101) * 100).toFixed(1)}% of the purchase price`, 'Bellevue combined rate.'],
    ['Major repairs', 'Probability × cost, for every powertrain',
      'This used to charge electric cars a battery allowance and gas cars nothing — billing EVs for a risk their rivals also carried but were never charged for. Now one framework covers all of them, with each hazard attached only to parts that powertrain actually has: an EV has no engine, transmission, exhaust or catalytic converter to fail; a plug-in hybrid has both an engine and a high-voltage system, so it carries both sets. Fixing this moved the electrics up about 24 places on average.'],
    ['Worst case vs budget', 'Kept separate, never averaged',
      'A 3% chance of a $6,500 battery is $195 to budget — but the exposure is still $6,500. Blending those into one number hides both facts, so each car shows the reserve and the worst single bill separately.'],
    ['Battery wear', 'Range and resale — not a repair bill',
      'Capacity loss makes the car shorter-legged and worth less; it does not present an invoice. Charging it again as a repair would count the same risk twice. Projected for Seattle\u2019s mild climate and overnight home charging, the two conditions that most slow degradation.'],
    ['Depreciation', 'Residual decay, faster for electric, adjusted for pack health',
      'New long-range EVs keep landing underneath these, so they shed value quicker than an equivalent gas car. A more degraded pack lowers resale further; a recall-replaced pack raises it.'],
  ];
  return `
    <details class="assump">
      <summary>📐 What the cost figures assume <span class="tco-mo">tap to check the math</span></summary>
      <table class="assump-tbl">
        ${rows.map(([k, v, why]) => `<tr><th>${esc(k)}</th><td><b>${esc(v)}</b><div class="why">${esc(why)}</div></td></tr>`).join('')}
      </table>
      <p class="tco-note">Not modelled: Washington's used-EV sales-tax exemption (up to $16,000 off the taxable price) ran
      2019&ndash;2025 and appears to have <b>lapsed</b>. Assuming a discount that no longer exists would tilt every ranking,
      so it is deliberately excluded &mdash; re-check before buying; if it is renewed it only helps the electrics.</p>
    </details>`;
}

function renderControls() {
  $('#sortbar').innerHTML = `
    <label class="sortlbl">Sort <select id="sort-sel">${SORTS.map((s) => `<option value="${s.id}"${s.id === SORT ? ' selected' : ''}>${s.label}</option>`).join('')}</select></label>
    <div class="horizon" role="group" aria-label="Cost window">
      <button type="button" class="hz${HORIZON === 2 ? ' on' : ''}" data-hz="2">2 yr · Jordyn</button>
      <button type="button" class="hz${HORIZON === 6 ? ' on' : ''}" data-hz="6">6 yr · thru Emma</button>
    </div>`;
  $('#filterbar').innerHTML = FACET_DEFS.map((d) => `
    <div class="fgroup"><span class="flabel">${d.label}</span>
      ${d.opts.map(([v, l]) => `<button type="button" class="facet${FACETS[d.id]?.has(v) ? ' on' : ''}" data-g="${d.id}" data-v="${v}">${l}</button>`).join('')}
    </div>`).join('');
  $('#filterbar').hidden = false;
}

// Grouped by safety tier so a "verify" car is never presented as equivalent to
// one where AEB is genuinely standard.
const TIER_GROUPS = [
  ['confirmed', '✅ Automatic emergency braking is standard', 'The safest starting point — every car of this model year has AEB. Blind-spot may still depend on trim.'],
  ['verify', '⚠️ AEB was optional — check the specific car', 'Good cars, but in these years automatic braking came in a package. Confirm it on the window sticker before trusting it.'],
  ['no', '❌ No automatic emergency braking', 'Shown for completeness — these fall short of the teen-safety bar.'],
];

function renderList() {
  const shown = sortCars((DATA.cars || []).filter(passesFacets));
  const grid = $('#cars-grid');
  if (!shown.length) {
    grid.innerHTML = '<p class="empty">No cars match those filters. Loosen one above.</p>';
    return;
  }
  grid.innerHTML = TIER_GROUPS.map(([tier, title, blurb]) => {
    const list = shown.filter((c) => c.tier === tier);
    if (!list.length) return '';
    return `<section class="tier tier-${tier}">
      <h2 class="tier-h">${title} <span class="tier-n">${list.length}</span></h2>
      <p class="tier-blurb">${blurb}</p>
      ${list.map(carCard).join('')}
    </section>`;
  }).join('');
}

/** The buyer's guide tab — what to look for, by model. */
function renderGuide() {
  const g = DATA.guide;
  const w = DATA.wants;
  const parts = [];
  if (w) {
    parts.push(`<div class="card">
      <h3>What we're looking for</h3>
      <p class="glabel">Must have</p><ul class="glist">${(w.mustHaves || []).map((x) => `<li>✅ ${esc(x)}</li>`).join('')}</ul>
      <p class="glabel">Nice to have</p><ul class="glist">${(w.niceToHaves || []).map((x) => `<li>➕ ${esc(x)}</li>`).join('')}</ul>
      <p class="glabel">Avoid</p><ul class="glist">${(w.avoid || []).map((x) => `<li>🚫 ${esc(x)}</li>`).join('')}</ul>
    </div>`);
  }
  if (g) {
    parts.push(`<div class="card"><h3>${esc(g.headline || 'By model')}</h3><p class="fineprint">${esc(g.note || '')}</p></div>`);
    for (const m of g.models || []) {
      parts.push(`<div class="card gmodel">
        <div class="car-head"><h3>${esc(m.model)} <span class="trim">${esc(m.years || '')}</span></h3><div class="price">${esc(m.priceBand || '')}</div></div>
        <div class="chips"><span class="sb">${esc(m.powertrain || '')}</span>${m.range ? `<span class="sb">${esc(m.range)}</span>` : ''}</div>
        ${m.aeb ? `<p class="fineprint"><b>AEB:</b> ${esc(m.aeb)}</p>` : ''}
        ${m.bsm ? `<p class="fineprint"><b>Blind-spot:</b> ${esc(m.bsm)}</p>` : ''}
        ${m.tco ? `<p class="fineprint"><b>Cost to own:</b> ${esc(m.tco)}</p>` : ''}
      </div>`);
    }
  }
  if (DATA.resources?.length) {
    parts.push(`<div class="card"><h3>Reference</h3><div class="resource-row">${DATA.resources.map((r) => `<a href="${esc(r.url)}" target="_blank" rel="noopener">🔎 ${esc(r.label)} ↗</a>`).join('')}</div></div>`);
  }
  $('#guide').innerHTML = parts.join('');
}

function renderTally() {
  const up = Object.values(VOTES).filter((v) => v === 'up').length;
  const down = Object.values(VOTES).filter((v) => v === 'down').length;
  const notes = Object.keys(COMMENTS).length;
  $('#tally').textContent = `${up} 👍  ${down} 👎  ${notes} 📝`;
  $('#send-btn').disabled = up + down + notes === 0;
  $('#sendbar').hidden = false;
}

// ---------- tabs ----------
function switchTab(name) {
  $('#panel-cars').hidden = name !== 'cars';
  $('#panel-guide').hidden = name !== 'guide';
  document.querySelectorAll('#tabbar .tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $('#sendbar').hidden = name !== 'cars';
  window.scrollTo(0, 0);
}

// ---------- interaction ----------
let wired = false;
function wireDelegates() {
  if (wired) return;
  wired = true;

  document.querySelectorAll('#tabbar .tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  document.addEventListener('click', (e) => {
    const facet = e.target.closest('.facet');
    if (facet) {
      const g = facet.dataset.g;
      const v = facet.dataset.v;
      FACETS[g] = FACETS[g] || new Set();
      if (FACETS[g].has(v)) FACETS[g].delete(v); else FACETS[g].add(v);
      renderControls();
      renderList();
      return;
    }
    const hz = e.target.closest('.hz');
    if (hz) { HORIZON = Number(hz.dataset.hz); renderControls(); renderList(); return; }
    const vote = e.target.closest('.vote');
    if (vote) {
      const vin = vote.closest('.car')?.dataset.vin;
      if (!vin) return;
      APP.setVote(vin, vote.dataset.v);
      vote.closest('.actions').querySelectorAll('.vote').forEach((b) => b.classList.toggle('on', VOTES[vin] === b.dataset.v));
      renderTally();
      return;
    }
    if (e.target.closest('#send-btn')) sendPicks();
  });

  document.addEventListener('change', (e) => {
    if (e.target.id === 'sort-sel') { SORT = e.target.value; renderList(); }
  });
  document.addEventListener('input', (e) => {
    const ni = e.target.closest('.note-input');
    if (ni) { setComment(ni.closest('.car')?.dataset.vin, ni.value); renderTally(); }
  });
}

function sendPicks() {
  const byVin = new Map((DATA.cars || []).map((c) => [c.vin, c]));
  const line = (vin, mark) => {
    const c = byVin.get(vin);
    if (!c) return null;
    const n = COMMENTS[vin] ? ` — "${COMMENTS[vin]}"` : '';
    return `${mark} ${c.label} · ${money(c.price)} · ${milesFmt(c.miles)} · ${money(tcoOf(c)?.total)}/${HORIZON}yr${n}\n  ${c.url}`;
  };
  const ups = Object.entries(VOTES).filter(([, v]) => v === 'up').map(([vin]) => line(vin, '👍')).filter(Boolean);
  const downs = Object.entries(VOTES).filter(([, v]) => v === 'down').map(([vin]) => line(vin, '👎')).filter(Boolean);
  const orphan = Object.keys(COMMENTS).filter((vin) => !VOTES[vin]).map((vin) => line(vin, '📝')).filter(Boolean);
  const text = ["Jordyn's car picks:", '', ...ups, ...(downs.length ? ['', ...downs] : []), ...(orphan.length ? ['', ...orphan] : [])].join('\n');
  if (navigator.share) navigator.share({ text }).catch(() => { /* cancelled */ });
  else navigator.clipboard?.writeText(text).then(() => {
    $('#send-btn').textContent = 'Copied ✓';
    setTimeout(() => { $('#send-btn').textContent = 'Send my picks'; }, 1800);
  });
}
