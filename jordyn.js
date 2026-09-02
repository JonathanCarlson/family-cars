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
  onReady: (data) => { DATA = data; loadHidden(); render(); },
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
  // Broad discovery surfaces models we have no curated profile for. Saying
  // "No AEB" about a car nobody has checked would be a claim we cannot support,
  // and would bury perfectly good cars for the crime of being unfamiliar.
  if (c.tier === 'unchecked') return '<span class="sb">🔍 AEB not verified — worth checking</span>';
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

/**
 * Cost total for the current horizon, from either record shape.
 *
 * Shortlist cars carry the full tco object; browse rows carry a plain number to
 * keep the payload small. Reading `.total` off a number yields undefined, which
 * sorted every browse row to the bottom — "cheapest to own" quietly stopped
 * working in exactly the view with the most cars in it.
 */
function totalOf(c) {
  const t = tcoOf(c);
  if (t == null) return null;
  return typeof t === 'number' ? t : (t.total ?? null);
}

/** The cost panel — shows its work so the model can be argued with. */
function tcoBlock(c) {
  const t = tcoOf(c);
  if (!t || typeof t !== 'object') return '';
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
  // Over the preferred budget: not a rejection, just a flag. The whole point of
  // raising the cap is to let cost-to-own argue for a dearer car, so the card
  // states the stretch and shows the running cost right underneath it.
  if (c.overPreferredBudget) chips.push('<span class="sb sb-warn" title="Above the $15k target — see whether the 6-year cost justifies it">💰 Over $15k target</span>');
  if (c.econEstimated) chips.push('<span class="sb" title="No EPA figures on this listing; running costs use a class-average estimate">≈ Estimated running cost</span>');

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
        <button class="hide-btn" data-hide="1" type="button" title="Hide this car from the list — affects nothing else">${HIDDEN.has(c.vin) ? '↩︎ Unhide' : '🙈 Not for me'}</button>
      </div>
      <input class="note-input" type="text" placeholder="Add a note…" value="${esc(note)}" aria-label="Note about this car">
    </div>
  </article>`;
}

// ---------- filters / sort ----------
// Shortlist cars nest safety under `c.safety`; browse rows carry it flat to keep
// the payload small. Reading only the nested shape meant every safety filter
// silently matched nothing in the browse view — no error, just an empty list.
const aebOf = (c) => c.safety?.aeb ?? c.aeb ?? null;
const bsmOf = (c) => c.safety?.bsm ?? c.bsm ?? null;
const vinConfirmed = (c) => (c.safety ? c.safety.aebSource === 'vin' || c.safety.bsmSource === 'vin'
  : c.aebSource === 'vin' || c.bsmSource === 'vin');

const FACET_DEFS = [
  { id: 'safety', label: 'Safety', opts: [['confirmed', '✅ AEB standard'], ['vin', '🔎 Confirmed by VIN'], ['verify', '⚠️ Verify AEB']], test: (c, v) => (v === 'vin' ? vinConfirmed(c) : c.tier === v) },
  { id: 'power', label: 'Power', opts: [['BEV', '⚡ Electric'], ['PHEV', '🔌 Plug-in'], ['HYB', '🍃 Hybrid'], ['ICE', '⛽ Gas']], test: (c, v) => c.power === v },
  { id: 'bsm', label: 'Blind-spot', opts: [['any', 'Available']], test: (c) => bsmOf(c) === 'standard' || bsmOf(c) === 'trim' },
  // Budget is now a range rather than a wall: $15k is the target, but the search
  // runs to $22k so cost-to-own can argue for a pricier car that's cheaper to
  // live with. These let you see whether that argument holds.
  {
    id: 'price',
    label: 'Budget',
    opts: [['u10', 'Under $10k'], ['pref', '🎯 At/under $15k'], ['stretch', 'Over $15k'], ['u20', 'Under $20k']],
    test: (c, v) => {
      const p = c.price ?? 9e9;
      if (v === 'u10') return p < 10000;
      if (v === 'pref') return p <= 15000;
      if (v === 'stretch') return p > 15000;
      return p < 20000;
    },
  },
  { id: 'miles', label: 'Miles', opts: [['u80', 'Under 80k'], ['u50', 'Under 50k']], test: (c, v) => (c.miles ?? 9e9) < (v === 'u50' ? 50000 : 80000) },
  { id: 'body', label: 'Shape', opts: [['small', 'Small car'], ['suv', 'SUV / crossover']], test: (c, v) => {
    const s = `${c.model} ${c.trim || ''}`.toLowerCase();
    const isSuv = /suv|crossover|rav4|cr-v|crv|equinox|rogue|escape|tucson|sportage|forester|crosstrek|hr-v|trax|encore|kona|niro|bolt euv|seltos|venue|soul/.test(s);
    return v === 'suv' ? isSuv : !isSuv;
  } },
];

// ---------- Jordyn's shortlist (subjective, and deliberately inert) ----------
//
// A car she simply won't drive is a real constraint, but it is a matter of taste
// and must never leak into the safety or cost-to-own maths. So this is stored
// separately from votes, applied ONLY as a view filter at render time, and read
// by nothing else. Hiding a car changes what you see; it changes no number
// anywhere, and un-hiding restores it exactly.
const K_HIDDEN = 'jordyn-cars-hidden-v1';
let HIDDEN = new Set();
let SHOW_HIDDEN = false;
function loadHidden() {
  try { HIDDEN = new Set(JSON.parse(localStorage.getItem(K_HIDDEN) || '[]')); } catch { HIDDEN = new Set(); }
}
function saveHidden() {
  try { localStorage.setItem(K_HIDDEN, JSON.stringify([...HIDDEN])); } catch { /* private mode */ }
}
function toggleHidden(vin) {
  if (HIDDEN.has(vin)) HIDDEN.delete(vin); else HIDDEN.add(vin);
  saveHidden();
}

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
  const t = tcoOf(c);
  const s = t && typeof t === 'object' ? t.evShare : c.evShare;
  return typeof s === 'number' ? s : 0;
}

function sortCars(list) {
  const a = [...list];
  if (SORT === 'tco-asc') a.sort((x, y) => (totalOf(x) ?? 9e9) - (totalOf(y) ?? 9e9));
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
// Two views over the same data: a shortlist of cars to react to, and the long
// tail to browse. The insights tab holds the answers those cars are evidence for.
let VIEW = 'shortlist';

function render() {
  $('#cars-status').hidden = true;
  $('#tabbar').hidden = false;
  renderIntro();
  renderControls();
  renderList();
  renderFamily();
  renderInsights();
  renderPicks();
  renderGuide();
  renderTally();
  wireDelegates();
}

/**
 * Line-by-line cost for ONE car at Kate's mileage, plus a jump to its full card.
 *
 * The headline number invites exactly one question — why is this one $32k and
 * that one $28k? Answering "trust the model" would defeat the purpose, so the
 * lines are here and the deeper safety/reliability detail is one tap away
 * rather than duplicated.
 */
function kateCostBreakdown(c) {
  const it = c.kateItems;
  if (!it) return '';
  const LABEL = {
    purchase: 'Purchase price',
    salesTax: 'Sales tax',
    energy: 'Fuel / charging',
    maintenance: 'Maintenance',
    insurance: 'Insurance',
    registration: 'Tabs + fees',
    majorRepairReserve: 'Major repairs (expected)',
    resaleValueRecovered: 'Resale recovered',
  };
  const rows = Object.entries(it).filter(([, v]) => v !== 0);
  const sum = rows.reduce((s, [, v]) => s + v, 0);
  return `<details class="tco">
    <summary><b>${money(c.thisCarOnlyIfKate)}</b> for this car alone, if Kate drives it — see why</summary>
    <table class="tco-tbl">
      ${rows.map(([k, v]) => `<tr><td>${esc(LABEL[k] || k)}</td><td>${money(v)}</td></tr>`).join('')}
      <tr class="tco-total"><td>Total</td><td>${money(sum)}</td></tr>
    </table>
    <p class="tco-note">At Kate's ${(DATA.family?.milesPerYear?.kate ?? 13520).toLocaleString('en-US')} mi/yr over six years.
    ${c.kwhPer100mi ? `Charging assumes <b>${c.kwhPer100mi} kWh/100mi</b>${c.kwhSource === 'epa' ? ' (EPA measured)' : ' <i>(class default — not measured for this model)</i>'}. ` : ''}
    Resale is shown as a negative because it comes back to you — the car is not written down to zero.</p>
    <p><a href="#" class="listing" data-goto-vin="${esc(c.vin)}">Full safety, reliability and repair detail ↓</a></p>
  </details>`;
}

function renderFamily() {
  const f = DATA.family;
  const el = $('#family-body');
  if (!el) return;
  if (!f) { el.innerHTML = '<div class="card"><p class="tco-note">Family comparison not available in this build.</p></div>'; return; }

  const h = f.highlander;
  const ref = f.referencePlan;
  const parts = [];

  // The baseline goes FIRST — every number below is relative to it, so reading
  // them in any other order means holding a comparison against an unknown.
  parts.push(`<div class="card">
    <h2 class="ins-h">📏 The plan to beat</h2>
    <p class="ins-verdict"><b>${esc(ref.car)}</b> → Jordyn, Kate keeps the Highlander · household <b>${money(ref.familyTotal)}</b></p>
    <p class="tco-note">${esc(ref.note)}</p>
    <p class="fineprint">Cash cap ${money(f.cashCapUsd)} — ${esc(f.cashCapNote)}</p>
  </div>`);

  parts.push(`<div class="card">
    <h2 class="ins-h">👨‍👩‍👧 One car, two drivers</h2>
    <p class="ins-verdict">${esc(f.what)}</p>
    <p class="tco-note"><b>Why the answer isn't obvious:</b> ${esc(f.whyItMatters)}</p>
  </div>`);

  // The crossover IS the answer, so it goes first.
  const x = f.crossover;
  if (x?.cars?.length) {
    parts.push(`<div class="card">
      <h2 class="ins-h">🎯 The sweet spot <span class="tier-n">${x.count} car${x.count === 1 ? '' : 's'}</span></h2>
      <p class="ins-verdict">${esc(x.what)}</p>
      <p class="tco-note">Cost alone would tell you to buy a $5,000 smart fortwo. Nobody is swapping a Highlander for
      that, so it is filtered out here: a car only appears if Kate would genuinely rather drive it.</p>
      ${x.cars.map((c) => `<div class="opp">
        <div class="opp-h">${esc(c.name)} <span class="tier-n">${esc(c.upgrade.verdict.replace('-', ' '))}</span></div>
        <div class="opp-s">${money(c.priceUsd)} · ${milesFmt(c.odometerMiles)} · ${esc(POWER_LABEL[c.powertrain] || c.powertrain)}${c.evRangeMi ? ` · ${c.evRangeMi} mi range` : ''}</div>
        <div class="tscroll"><table class="assump-tbl band-tbl">
          <tr><th>If this car goes to…</th><th>This car alone</th><th>Both cars together</th></tr>
          <tr><td>👩 Kate <span class="why">(Jordyn takes the Highlander)</span></td>
              <td>${money(c.thisCarOnlyIfKate)}</td><td><b>${money(c.familyTotalIfKate)}</b></td></tr>
          <tr><td>👧 Jordyn <span class="why">(Kate keeps the Highlander)</span></td>
              <td>${money(c.thisCarOnlyIfJordyn)}</td><td><b>${money(c.familyTotalIfJordyn)}</b></td></tr>
        </table></div>
        <div class="opp-s">${c.vsReferencePlan > 0 ? `<b>${money(c.vsReferencePlan)} less</b> than buying the reference car for Jordyn` : `${money(Math.abs(c.vsReferencePlan))} more than the plan to beat`}</div>
        ${kateCostBreakdown(c)}
        <ul class="rel-list">
          ${c.upgrade.gains.map((g) => `<li>✅ <b>${esc(g.dim)}</b> — ${esc(g.detail)}</li>`).join('')}
          ${c.upgrade.losses.map((l) => `<li>⚠️ <b>${esc(l.dim)}</b> — ${esc(l.detail)}</li>`).join('')}
        </ul>
      </div>`).join('')}
    </div>`);
  } else {
    parts.push(`<div class="card">
      <h2 class="ins-h">🎯 The sweet spot</h2>
      <p class="ins-verdict">No car currently clears both tests at once — a genuine upgrade on the Highlander for Kate
      <i>and</i> cheaper for the household than buying the reference car for Jordyn.</p>
      <p class="tco-note">That is a real answer, not a gap: it means the Highlander is doing its job well enough that
      swapping it does not pay yet. The table below shows how close the near misses are.</p>
    </div>`);
  }

  // What she actually asked about, answered directly — even when it's over cap.
  const si = f.statedInterests || [];
  if (si.length) {
    parts.push(`<div class="card">
      <h2 class="ins-h">⭐ The two Kate asked about</h2>
      <p class="tier-blurb">Shown whatever they cost, because "why isn't the car I asked about here?" deserves an
      answer rather than silence.</p>
      ${si.map((s) => {
    if (!s.best) return `<div class="opp"><div class="opp-h">${esc(s.label)}</div><div class="opp-s">${esc(s.verdict)}</div></div>`;
    const b = s.best;
    return `<div class="opp">
        <div class="opp-h">${esc(b.name)} ${s.overCashCap ? '<span class="tier-n">over cash cap</span>' : '<span class="tier-n">in budget</span>'}</div>
        <div class="opp-s">${money(b.priceUsd)} · ${milesFmt(b.odometerMiles)}${b.evRangeMi ? ` · ${b.evRangeMi} mi range` : ''} · ${s.found} found</div>
        <div class="opp-s"><b>Household ${money(b.familyTotalIfKate)}</b> if Kate drives it${b.vsReferencePlan > 0 ? ` — ${money(b.vsReferencePlan)} less than the plan to beat` : ''}</div>
        <div class="opp-s">${esc(s.verdict)}</div>
        ${kateCostBreakdown(b)}
      </div>`;
  }).join('')}
    </div>`);
  }

  // Why the household number looks big. Without this the totals read as
  // implausible, and they should — most of it isn't caused by this decision.
  const w = (f.ranked || []).find((r) => r.whatTheTotalIs)?.whatTheTotalIs;
  if (w) {
    parts.push(`<div class="card">
      <h2 class="ins-h">🧾 Why that number looks big</h2>
      <p class="tier-blurb">It covers <b>two cars for six years</b>, and most of it is not caused by buying anything.</p>
      <ul class="rel-list">
        <li><b>${money(w.teenInsuranceAddition)}</b> — ${esc(w.teenInsuranceNote)}</li>
        <li><b>${money(w.highlanderShare)}</b> — ${esc(w.highlanderNote)}</li>
        <li><b>${money(w.capitalNotCash)}</b> — ${esc(w.capitalNote)}</li>
      </ul>
      <p class="tco-note">So the figure to compare between plans is the <b>difference</b>, not the total. The
      total is there so the difference can be checked, not because the household is about to write that cheque.</p>
    </div>`);
  }

  parts.push(`<div class="card">
    <h2 class="ins-h">🚙 The bar it has to clear</h2>
    <p class="ins-verdict"><b>${esc(h.label)}</b> · ${esc(String(h.mpg))} mpg · ${milesFmt(h.odometerMiles)} (est.)</p>
    <p class="tco-note">${esc(h.note)}</p>
    <ul class="rel-list">
      <li>Automatic braking, blind-spot, forward-collision, lane-keep and rear-cross-traffic all <b>confirmed standard</b> against this VIN.</li>
      <li>${esc(h.curbWeightLb.toLocaleString('en-US'))} lb, 3 rows, ${esc(String(h.seats))} seats, AWD — mass is protective, and IIHS is consistent that heavier is safer for a teen.</li>
      <li>${esc(h.mpgBasis)}</li>
    </ul>
    <p class="fineprint fineprint-bad">⚠️ ${esc(h.odometerBasis)} ${esc(h.valueBasis)}</p>
  </div>`);

  // Which Highlander costs actually move with the driver. The intuition is only
  // half right, so it is worth showing rather than asserting.
  const split = (f.ranked || []).find((r) => r.highlanderSplit)?.highlanderSplit;
  if (split?.length) {
    const LABEL = {
      energy: 'Fuel', maintenance: 'Maintenance', insurance: 'Insurance',
      majorRepairReserve: 'Major repairs', registration: 'Tabs + fees',
      resaleValueRecovered: 'Resale recovered', salesTax: 'Sales tax', purchase: 'Purchase (owned)',
    };
    parts.push(`<div class="card">
      <h2 class="ins-h">🔀 What changes on the Highlander</h2>
      <p class="tier-blurb">The Highlander is on both sides of every comparison, but it does not cost the same
      on each. Tabs are genuinely fixed. Fuel, maintenance and repairs scale with miles — and <b>insurance is the
      biggest swing of all</b>, because a teen rated on it costs far more than an adult. Resale moves too: whoever
      drives it puts twice the miles on the clock.</p>
      <div class="tscroll"><table class="assump-tbl band-tbl">
        <tr><th>Line</th><th>Kate drives it</th><th>Jordyn drives it</th><th>Swing</th></tr>
        ${split.map((s) => `<tr>
          <td>${esc(LABEL[s.line] || s.line)}</td>
          <td>${money(s.highlanderWithKate)}</td>
          <td>${money(s.highlanderWithJordyn)}</td>
          <td>${s.fixed ? '<span class="why">fixed</span>' : `${money(Math.abs(s.delta))}`}</td>
        </tr>`).join('')}
      </table></div><p class="tscroll-hint">← swipe the table sideways for the rest →</p>
    </div>`);
  }

  const rows = (f.ranked || []).filter((r) => r.priceUsd <= f.cashCapUsd).slice(0, 16);
  if (rows.length) {
    parts.push(`<div class="card">
      <h2 class="ins-h">📊 Everything under ${money(f.cashCapUsd)}, both ways round</h2>
      <p class="tier-blurb">"Upgrade?" is judged against Kate's Highlander. "vs plan" is the household total with the car
      given to Kate, against buying the reference car for Jordyn.</p>
      <div class="tscroll"><table class="assump-tbl band-tbl">
        <tr><th>Car</th><th>Price</th><th>Upgrade?</th><th>Give it to</th><th>vs plan</th></tr>
        ${rows.map((r) => {
    const better = (r.vsReferencePlan ?? 0) > 0;
    const v = r.upgrade?.verdict ?? '?';
    const icon = v === 'clear-upgrade' ? '✅' : v === 'trade-off' ? '🟡' : v === 'sidegrade' ? '➖' : '❌';
    return `<tr>
          <td>${esc(r.name)}</td>
          <td>${money(r.priceUsd)}</td>
          <td>${icon} ${esc(v.replace('-', ' '))}</td>
          <td>${r.bestAssignment === 'kate' ? '👩 Kate' : '👧 Jordyn'}</td>
          <td class="${better ? 'dlt-good' : 'dlt-bad'}">${better ? '−' : '+'}${money(Math.abs(r.vsReferencePlan ?? 0))}</td>
        </tr>`;
  }).join('')}
      </table></div><p class="tscroll-hint">← swipe the table sideways for the rest →</p>
    </div>`);
  }

  parts.push(`<div class="card">
    <h2 class="ins-h">⚠️ What would change this</h2>
    <p class="tco-note">${esc(f.caveat)}</p>
  </div>`);

  el.innerHTML = parts.join('');
}

function renderIntro() {
  const s = DATA.stats || {};
  const a = DATA.assumptions || {};
  // The header subtitle was hardcoded to "under $15k", which stopped being true
  // when the search widened to $22k. Drive it from the data so the two can't
  // drift again.
  const sub = $('#head-sub');
  if (sub && DATA.subtitle) sub.textContent = DATA.subtitle;
  $('#intro').innerHTML = `
    <div class="card">
      <p class="lede">${esc(DATA.intro || '')}</p>
      <div class="stat-grid">
        <div class="stat"><div class="n">${s.count ?? '—'}</div><div class="l">cars shown</div></div>
        <div class="stat"><div class="n">${s.discovered ?? '—'}</div><div class="l">searched</div></div>
        <div class="stat"><div class="n">${s.underPreferred ?? '—'}</div><div class="l">at/under $15k</div></div>
        <div class="stat"><div class="n">${s.plugCount ?? '—'}</div><div class="l">electric / plug-in</div></div>
      </div>
      ${bandBlock(DATA.priceBands, DATA.budget)}
      ${assumptionsBlock(a)}
    </div>`;
}

/**
 * Does spending more actually buy a better car?
 *
 * The honest answer isn't obvious, so it gets shown rather than asserted. Median
 * cost-to-own by band, next to what that band buys in age and mileage, lets the
 * trade be read directly instead of taken on trust.
 */
function bandBlock(bands, budget) {
  if (!Array.isArray(bands) || !bands.length) return '';
  const rows = bands.map((b) => `
    <tr${b.preferred ? ' class="band-pref"' : ''}>
      <th>${esc(b.label)}${b.preferred ? ' 🎯' : ''}</th>
      <td>${b.found}</td>
      <td>${b.aebStandard}</td>
      <td>${b.electrified}</td>
      <td>${b.medianTco6 ? money(b.medianTco6) : '—'}</td>
      <td>${b.medianYear ?? '—'} · ${b.medianMiles != null ? Math.round(b.medianMiles / 1000) + 'k' : '—'}</td>
    </tr>`).join('');
  return `
    <details class="assump">
      <summary>💰 Is a bigger budget worth it? <span class="tco-mo">tap for the comparison</span></summary>
      <div class="tscroll"><table class="assump-tbl band-tbl">
        <tr><th>Band</th><th>Found</th><th>AEB std</th><th>Electric</th><th>Median 6-yr cost</th><th>Median yr · mi</th></tr>
        ${rows}
      </table></div><p class="tscroll-hint">← swipe the table sideways for the rest →</p>
      <p class="tco-note">$${((budget?.preferred ?? 15000) / 1000).toFixed(0)}k is still the target; the search runs to
      $${((budget?.searchedTo ?? 22000) / 1000).toFixed(0)}k so cost-to-own can argue for a pricier car rather than a rule
      excluding it. Spending more buys a newer car with fewer miles — but the median 6-year cost <b>rises</b> with price,
      because purchase price and the insurance that scales with it outweigh the lower running costs. A dearer car has to
      earn its place on this table, and most don't.</p>
    </details>`;
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
    ['WA tabs', 'Base fees + 1.1% Sound Transit excise tax',
      'Bellevue sits inside the Sound Transit district, so tabs are not a flat fee. The RTA excise tax is assessed on 85% of the car\u2019s ORIGINAL list price, depreciated by a 1990-era statutory schedule \u2014 not on what you paid. That schedule was written when cars held value far better than they do now, so it over-values older cars, and because it follows original MSRP an expensive car stays expensive to register long after its market value has fallen. Plug-ins with 30+ miles of electric range add $150/yr; a shorter-range plug-in adds nothing. We have to estimate original MSRP because listings don\u2019t publish it \u2014 this is the least certain input in the model.'],
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
      <div class="tscroll"><table class="assump-tbl">
        ${rows.map(([k, v, why]) => `<tr><th>${esc(k)}</th><td><b>${esc(v)}</b><div class="why">${esc(why)}</div></td></tr>`).join('')}
      </table></div>
      <p class="tco-note">Not modelled: Washington's used-EV sales-tax exemption (up to $16,000 off the taxable price) ran
      2019&ndash;2025 and appears to have <b>lapsed</b>. Assuming a discount that no longer exists would tilt every ranking,
      so it is deliberately excluded &mdash; re-check before buying; if it is renewed it only helps the electrics.</p>
    </details>`;
}

function renderControls() {
  // The sort control only means something in the browse view — the shortlist is
  // grouped by category, each already ordered by its own criterion. Showing the
  // dropdown in both views while it only worked in one is why sorting "didn't
  // work": it was being changed on a list that ignores it.
  const sortSel = VIEW === 'browse'
    ? `<label class="sortlbl">Sort <select id="sort-sel">${SORTS.map((s) => `<option value="${s.id}"${s.id === SORT ? ' selected' : ''}>${s.label}</option>`).join('')}</select></label>`
    : '<span class="sortlbl">Grouped by what you might be optimising for</span>';
  $('#sortbar').innerHTML = `
    ${sortSel}
    <div class="horizon" role="group" aria-label="Cost window">
      <button type="button" class="hz${HORIZON === 2 ? ' on' : ''}" data-hz="2">2 yr · Jordyn</button>
      <button type="button" class="hz${HORIZON === 6 ? ' on' : ''}" data-hz="6">6 yr · thru Emma</button>
    </div>`;
  $('#filterbar').innerHTML = FACET_DEFS.map((d) => `
    <div class="fgroup"><span class="flabel">${d.label}</span>
      ${d.opts.map(([v, l]) => `<button type="button" class="facet${FACETS[d.id]?.has(v) ? ' on' : ''}" data-g="${d.id}" data-v="${v}">${l}</button>`).join('')}
    </div>`).join('')
    + `<div class="fgroup"><span class="flabel">Jordyn</span>
        <button type="button" class="facet${SHOW_HIDDEN ? ' on' : ''}" id="show-hidden"
          title="Your hidden cars are only hidden from view — no cost or safety figure changes">
          🙈 Show hidden${HIDDEN.size ? ` (${HIDDEN.size})` : ''}</button>
      </div>`;
  $('#filterbar').hidden = VIEW !== 'browse';
}

// Grouped by safety tier so a "verify" car is never presented as equivalent to
// one where AEB is genuinely standard.
const TIER_GROUPS = [
  ['confirmed', '✅ Automatic emergency braking is standard', 'The safest starting point — every car of this model year has AEB. Blind-spot may still depend on trim.'],
  ['verify', '⚠️ AEB was optional — check the specific car', 'Good cars, but in these years automatic braking came in a package. Confirm it on the window sticker before trusting it.'],
  // Broad discovery means most cars now have no curated safety profile. "We
  // haven't checked" is a different statement from "it doesn't have it", and
  // collapsing the two would quietly rebuild the old model whitelist as a
  // rejection.
  ['unchecked', '🔍 Not yet verified — worth a look', 'No curated profile for these models yet, and the VIN decode was silent. They may well have AEB; nobody has confirmed it either way.'],
  ['no', '❌ No automatic emergency braking', 'Shown for completeness — these fall short of the teen-safety bar.'],
];

/**
 * The insights tab — the answers, before the cars.
 *
 * Scrolling hundreds of listings tells you nothing about whether electric beats
 * hybrid or whether spending more helps. Those are population questions, so the
 * page leads with the population and treats individual cars as evidence for a
 * conclusion rather than as the product.
 */
function renderInsights() {
  const ins = DATA.insights;
  const el = $('#insights-body');
  if (!el) return;
  if (!ins) { el.innerHTML = '<p class="empty">No analysis in this build.</p>'; return; }
  const parts = [];

  // --- the budget question ------------------------------------------------
  const bs = ins.buyStrategy;
  if (bs?.verdict) {
    parts.push(`<div class="card">
      <h2 class="ins-h">💰 Does spending more help?</h2>
      <p class="ins-verdict">${esc(bs.verdict)}</p>
      <div class="tscroll"><table class="assump-tbl band-tbl">
        <tr><th>Budget</th><th>n</th><th>Median 6-yr</th><th>Median yr · mi</th><th>AEB std</th><th>Electric</th></tr>
        ${bs.rows.map((r) => `<tr${r.preferred ? ' class="band-pref"' : ''}>
          <th>${esc(r.label)}${r.preferred ? ' 🎯' : ''}</th>
          <td>${r.n}</td><td>${money(r.medianTco6)}</td>
          <td>${r.medianYear} · ${r.medianMiles != null ? Math.round(r.medianMiles / 1000) + 'k' : '—'}</td>
          <td>${r.aebStandardShare}%</td><td>${r.electrifiedShare}%</td></tr>`).join('')}
      </table></div><p class="tscroll-hint">← swipe the table sideways for the rest →</p>
      <p class="tco-note">Where the money goes changes with the budget: cheap cars spend it on fuel and repairs,
      dear ones on purchase price and the insurance that scales with value.</p>
    </div>`);
  }

  // --- powertrain, with the confound made visible -------------------------
  const pw = ins.powertrain;
  if (pw) {
    const bandRows = pw.withinBand.map((b) => {
      const cells = ['BEV', 'PHEV', 'HYB', 'ICE'].map((p) => {
        const v = b.powertrains[p];
        if (!v) return '<td>—</td>';
        if (v.tooFew) return `<td class="thin">n=${v.n}<br><span class="why">too few</span></td>`;
        return `<td>${money(v.medianTco6)}<br><span class="why">n=${v.n}</span></td>`;
      }).join('');
      return `<tr><th>${esc(b.label)}</th>${cells}</tr>`;
    }).join('');
    parts.push(`<div class="card">
      <h2 class="ins-h">⚡ Electric, hybrid or petrol?</h2>
      <p class="ins-verdict">Compared <b>within the same budget</b>, so the answer isn't just "electric cars here are newer".</p>
      <div class="tscroll"><table class="assump-tbl band-tbl">
        <tr><th>Budget</th><th>Electric</th><th>Plug-in</th><th>Hybrid</th><th>Petrol</th></tr>
        ${bandRows}
      </table></div><p class="tscroll-hint">← swipe the table sideways for the rest →</p>
      <p class="tco-note">Median 6-year cost to own. ${pw.confound ? esc(pw.confound) : ''}</p>
    </div>`);
  }

  // --- model leaderboard --------------------------------------------------
  // Cohorts, not model names. A "Nissan Leaf" row averages a 2013 24 kWh car
  // with 70 miles of range against a 2024 40 kWh car with 150 and describes
  // neither. Same for Ioniq, which is sold as a hybrid, a plug-in AND an EV.
  const ma = DATA.marketAnalysis;
  const cohorts = ma?.topCohorts;
  if (cohorts?.length) {
    parts.push(`<div class="card">
      <h2 class="ins-h">🏅 Which cars actually hold up</h2>
      <p class="ins-verdict">Grouped by generation and battery, not just by name — a 24&nbsp;kWh Leaf and a 40&nbsp;kWh Leaf are different cars.
      Only groups that clear the safety floor for at least half their listings appear here.</p>
      <div class="tscroll"><table class="assump-tbl band-tbl">
        <tr><th>Car</th><th>n</th><th>6-yr cost</th><th>AEB std</th><th>2032</th></tr>
        ${cohorts.slice(0, 14).map((c) => `<tr>
          <th>${esc(c.label)}<div class="why">${esc((c.modelYears || []).join(', '))}</div></th>
          <td>${c.n}</td>
          <td>${money(c.medianTco6)}</td>
          <td>${c.safetyQualifiedPct}%${c.aebUnknown ? `<div class="why">${c.aebUnknown} unverified</div>` : ''}</td>
          <td>${c.viability2032 != null ? `${Math.round(c.viability2032 * 100)}%` : '—'}</td></tr>`).join('')}
      </table></div><p class="tscroll-hint">← swipe the table sideways for the rest →</p>
      <p class="tco-note">“AEB std” is the share with automatic braking confirmed standard. Unverified is shown separately and is
      <b>not</b> counted as a failure — plenty of these cars have it, nobody has checked.</p>
    </div>`);
  }

  // --- opportunities: what the data thinks is underrated ------------------
  if (ma?.opportunities?.length) {
    parts.push(`<div class="card">
      <h2 class="ins-h">💡 Where the value is</h2>
      <p class="ins-verdict">Groups that combine a real cost advantage with a genuine safety record and a future. Nothing here is
      hand-picked — a car appears because the numbers put it here.</p>
      ${ma.opportunities.slice(0, 6).map((o) => `<div class="opp">
        <div class="opp-h">${esc(o.label)} <span class="tier-n">${o.n}</span></div>
        <div class="opp-s">${money(o.medianPrice)} typical · ${money(o.medianTco6)} over six years · ${o.safetyQualifiedPct}% with AEB standard</div>
        <ul class="rel-list">${(o.reasons || []).slice(0, 3).map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
      </div>`).join('')}
    </div>`);
  }

  // --- the bargains that aren't ------------------------------------------
  if (ma?.cheapButCompromised?.length) {
    parts.push(`<div class="card">
      <h2 class="ins-h">⚠️ Cheap for a reason</h2>
      <p class="ins-verdict">These are genuinely low-cost to own, and that is exactly why they need a caveat next to them rather
      than a place at the top of a list.</p>
      ${ma.cheapButCompromised.slice(0, 5).map((o) => `<div class="opp">
        <div class="opp-h">${esc(o.label)} <span class="tier-n">${o.n}</span></div>
        <div class="opp-s">${money(o.medianTco6)} over six years · only ${o.safetyQualifiedPct}% have AEB standard</div>
        <ul class="rel-list">${(o.why || []).slice(0, 2).map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
      </div>`).join('')}
    </div>`);
  }

  const md = ins.models;
  if (md?.ranked?.length) {
    parts.push(`<div class="card">
      <details class="assump">
        <summary>📋 All models, aggregated by name <span class="tco-mo">the cruder view</span></summary>
        <div class="tscroll"><table class="assump-tbl band-tbl">
          <tr><th>Model</th><th>n</th><th>Median 6-yr</th><th>Safety</th><th>AEB std</th></tr>
          ${md.ranked.slice(0, 15).map((m) => `<tr>
            <th>${esc(m.model)}<div class="why">${esc(m.powertrains.join(' / '))}</div></th>
            <td>${m.n}</td>
            <td>${money(m.tco6.median)}</td>
            <td>${m.safetyScore == null ? '<span class="why">not assessed</span>' : `${m.safetyScore}/5`}</td>
            <td>${m.aebStandardShare}%</td></tr>`).join('')}
        </table></div><p class="tscroll-hint">← swipe the table sideways for the rest →</p>
        <p class="tco-note">${esc(md.note)}</p>
      </details>
    </div>`);
  }

  if (ins.caveats?.length) {
    parts.push(`<div class="card">
      <h2 class="ins-h">How to read all this</h2>
      <ul class="rel-list">${ins.caveats.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
      <p class="tco-note">Computed over all ${ins.generatedFrom.toLocaleString()} cars found, before any shortlisting.</p>
    </div>`);
  }

  el.innerHTML = parts.join('');
}

/**
 * Jordyn's own picks, with the analysis they deserve.
 *
 * The point of this tab is NOT to overrule her. It is to put her taste and the
 * cost model side by side and quantify the gap, so the conversation is about a
 * number rather than about who is right. Her picks never touch the ranking or
 * any cost figure — they are analysed by exactly the same model as every other
 * car, which is the only reason the comparison means anything.
 */
function renderPicks() {
  const el = $('#picks-body');
  if (!el) return;
  const p = DATA.picks;
  if (!p) { el.innerHTML = '<p class="empty">No picks recorded yet.</p>'; return; }
  const byVin = new Map((DATA.cars || []).map((c) => [c.vin, c]));
  const parts = [];

  // --- the reference car everything is measured against -------------------
  const base = p.baseline;
  if (base) {
    parts.push(`<div class="card">
      <h2 class="ins-h">📏 The yardstick: ${esc(base.name)}</h2>
      <p class="ins-verdict"><b>${money(base.sixYearTco)}</b> over six years · ${money(base.perMonth)}/month · ${money(base.priceUsd)} to buy · ${milesFmt(base.odometerMiles)}</p>
      <p class="tco-note">${esc(base.why)} Everything below is priced as a difference from this car, because
      “${money(base.sixYearTco)}” on its own doesn’t help anyone decide — “${money(3000)} more than the Leaf” does.</p>
      <p class="tco-note">⚠️ Teen insurance is still an estimate rather than a real quote, and it is the largest single line.
      That makes these <b>differences</b> more trustworthy than the totals — insurance is roughly common across cars, so it
      largely cancels out of a comparison.</p>
    </div>`);
  }

  // --- what stepping up actually costs ------------------------------------
  if (p.ladder?.length) {
    parts.push(`<div class="card">
      <h2 class="ins-h">🪜 What more money actually buys</h2>
      <p class="ins-verdict">Three options at each step up from the baseline, ranked by how close they are to what Jordyn
      picked. Every one has automatic braking confirmed standard and a clean title — the step up buys taste, not safety.</p>
    </div>`);
    for (const band of p.ladder) {
      const cars = band.cars.map((b) => byVin.get(b.vin)).filter(Boolean);
      if (!cars.length) continue;
      parts.push(`<div class="card">
        <h2 class="ins-h">${esc(band.label)} <span class="tier-n">${band.candidateCount} to choose from</span></h2>
        <p class="tier-blurb">${esc(band.blurb)}</p>
        ${band.cars.map((b) => `<div class="opp">
          <div class="opp-h">${esc(b.name)}</div>
          <div class="opp-s">${money(b.priceUsd)} · ${milesFmt(b.odometerMiles)} · ${esc(POWER_LABEL[b.powertrain] || b.powertrain)}</div>
          <div class="opp-s"><b>${esc(b.delta?.costVerdict || '')}</b> · ${esc(b.delta?.safetyVerdict || '')}</div>
          ${(b.delta?.safetyNotes || []).length ? `<ul class="rel-list">${b.delta.safetyNotes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
        </div>`).join('')}
      </div>${cars.map(carCard).join('')}`);
    }
  }

  const cmp = p.comparison;
  if (cmp?.headline) {
    const h = cmp.hers; const a = cmp.algorithm; const d = cmp.deltas;
    const row = (label, hv, av, dv, invert = false) => {
      const worse = invert ? dv < 0 : dv > 0;
      return `<tr><th>${esc(label)}</th><td>${money(hv)}</td><td>${money(av)}</td>
        <td class="${Math.abs(dv) < 200 ? '' : worse ? 'dlt-bad' : 'dlt-good'}">${dv > 0 ? '+' : ''}${money(dv)}</td></tr>`;
    };
    parts.push(`<div class="card">
      <h2 class="ins-h">👤 What Jordyn's taste costs</h2>
      <p class="ins-verdict">${esc(cmp.headline)}</p>
      <div class="tscroll"><table class="assump-tbl band-tbl">
        <tr><th></th><th>Her picks</th><th>The numbers'</th><th>Difference</th></tr>
        ${row('6-year cost to own', h.medianTco6, a.medianTco6, d.tco6)}
        ${row('2-year cost (Jordyn only)', h.medianTco2, a.medianTco2, d.tco2)}
        ${row('Fuel / charging', h.fuel, a.fuel, d.fuel)}
        ${row('Maintenance', h.maintenance, a.maintenance, d.maintenance)}
        ${row('Major repairs (expected)', h.repairs, a.repairs, d.repairs)}
        ${row('Insurance', h.insurance, a.insurance, d.insurance)}
        ${row('Resale lost', h.depreciation, a.depreciation, d.depreciation)}
      </table></div><p class="tscroll-hint">← swipe the table sideways for the rest →</p>
      <div class="tscroll"><table class="assump-tbl band-tbl">
        <tr><th>Safety</th><th>Her picks</th><th>The numbers'</th></tr>
        <tr><th>AEB standard</th><td>${h.aebStandard}/${h.n}</td><td>${a.aebStandard}/${a.n}</td></tr>
        <tr><th>IIHS Top Safety Pick</th><td>${h.topSafetyPick}/${h.n}</td><td>${a.topSafetyPick}/${a.n}</td></tr>
        <tr><th>Electric or plug-in</th><td>${h.electrified}/${h.n}</td><td>${a.electrified}/${a.n}</td></tr>
        <tr><th>Reliability flagged</th><td>${h.reliabilityConcern}/${h.n}</td><td>${a.reliabilityConcern}/${a.n}</td></tr>
      </table></div><p class="tscroll-hint">← swipe the table sideways for the rest →</p>
      <p class="tco-note">${esc(p.disclaimer)}</p>
    </div>`);
  }

  // The actionable half. Criticising her picks without offering an alternative
  // is not much use, so this is what to look at instead — closest to her taste
  // that still keeps cost down and safety up.
  const recs = DATA.recommendations;
  if (recs?.vins?.length) {
    const cars = recs.vins.map((v) => byVin.get(v)).filter(Boolean);
    if (cars.length) {
      const prem = recs.premiumOverMarket;
      parts.push(`<div class="card">
        <h2 class="ins-h">✅ ${esc(recs.title)}</h2>
        <p class="ins-verdict">${esc(recs.why)}</p>
        ${prem != null ? `<p class="tco-note">These run <b>${money(Math.abs(prem))} ${prem > 0 ? 'more' : 'less'}</b> over six years than the typical car in the whole search —
        so wanting a small SUV ${prem > 0 ? 'costs something, but far less than her current picks do' : 'costs nothing at all; it is the premium petrol badges that do'}.</p>` : ''}
      </div>${cars.map(carCard).join('')}`);
    }
  }

  // Her individual picks, grouped by how strong a signal each group is.
  const entries = p.entries || [];
  const tiers = p.tiers || {};
  const order = ['stated', 'thumbed'];
  const groups = order.filter((t) => entries.some((e) => (e.tier || 'stated') === t));
  const cards = groups.map((tierId) => {
    const meta = tiers[tierId] || {};
    const rows = entries.filter((e) => (e.tier || 'stated') === tierId).map((e) => {
      const c = e.vin ? byVin.get(e.vin) : null;
      const title = `${e.year} ${e.make} ${e.model}${e.trim ? ` ${e.trim}` : ''}`;
      if (!c) {
        return `<div class="card"><div class="brow-t">${esc(title)}</div>
          <p class="fineprint">Nothing like this is in the current search — it may have sold, or it sits outside the price, year or mileage limits.</p></div>`;
      }
      const matchNote = e.match === 'exact-listing'
        ? 'This is the exact car she sent.'
        : e.match === 'same-model-year'
          ? 'Her exact listing is no longer in the sweep; this is the closest same-year example currently for sale.'
          : 'Her exact listing is gone; this is the closest equivalent currently for sale.';
      // The delta is the point of this page: what does wanting THIS one cost,
      // against the yardstick, in money and in safety.
      const d = e.delta;
      const deltaLine = d ? `<p class="fineprint ${d.sixYearDelta > 3000 ? 'fineprint-bad' : ''}">
          📊 <b>vs the ${esc(p.baseline?.name || 'baseline')}:</b> ${esc(d.costVerdict)} · ${esc(d.safetyVerdict)}
          ${(d.safetyNotes || []).length ? `<br>${d.safetyNotes.map(esc).join(' ')}` : ''}
          ${(d.safetyUnverified || []).length ? `<br><i>Unverified on this car: ${d.safetyUnverified.map(esc).join(', ')} — worth checking, not a failure.</i>` : ''}
        </p>` : '';
      return `<div class="pick-wrap">
        <p class="fineprint">📌 <b>${esc(title)}</b> — ${esc(matchNote)}</p>
        ${deltaLine}
        ${carCard(c)}
      </div>`;
    }).join('');
    return `<div class="card">
        <h2 class="ins-h">${esc(meta.label || tierId)} <span class="tier-n">${entries.filter((e) => (e.tier || 'stated') === tierId).length}</span></h2>
        <p class="tier-blurb">${esc(meta.note || '')}</p>
        ${meta.weight != null ? `<p class="tco-note">Counted at <b>${meta.weight}×</b> weight when working out what to recommend.</p>` : ''}
      </div>${rows}`;
  }).join('');
  parts.push(cards);

  // The overlap: premium badges that are also cheap to run.
  const lux = DATA.luxuryEvs;
  if (lux?.vins?.length) {
    const cars = lux.vins.map((v) => byVin.get(v)).filter(Boolean);
    if (cars.length) {
      parts.push(`<div class="card"><h2 class="ins-h">${esc(lux.title)}</h2>
        <p class="tier-blurb">${esc(lux.why)}</p></div>${cars.map(carCard).join('')}`);
    }
  }

  el.innerHTML = parts.join('');
}
/** The shortlist tab — a few cars per question, for the family to vote on. */
function renderShortlist() {
  const grid = $('#cars-grid');
  const cats = DATA.shortlist || [];
  const byVin = new Map((DATA.cars || []).map((c) => [c.vin, c]));
  if (!cats.length) { grid.innerHTML = '<p class="empty">No shortlist in this build.</p>'; return; }
  grid.innerHTML = cats.map((cat) => {
    const cars = cat.vins.map((v) => byVin.get(v)).filter(Boolean)
      .filter((c) => SHOW_HIDDEN || !HIDDEN.has(c.vin));
    if (!cars.length) return '';
    return `<section class="tier">
      <h2 class="tier-h">${esc(cat.title)} <span class="tier-n">${cars.length}</span></h2>
      <p class="tier-blurb">${esc(cat.why)}</p>
      ${cars.map(carCard).join('')}
    </section>`;
  }).join('');
}
/**
 * The browse tab — the long tail, in slim form.
 *
 * These records carry only what's needed to scan and filter. The full repair,
 * reliability and battery detail lives on the shortlist cars, because attaching
 * it to every car produced a 6.8 MB encrypted bundle — not something to hand
 * someone on a phone.
 */
function browseRow(c) {
  const hidden = HIDDEN.has(c.vin);
  const vote = VOTES[c.vin];
  const note = COMMENTS[c.vin] || '';
  const tags = [];
  if (aebOf(c) === 'standard') tags.push('<span class="sb sb-ok">AEB</span>');
  else if (aebOf(c) === 'trim') tags.push('<span class="sb sb-warn">AEB?</span>');
  if (bsmOf(c) === 'standard') tags.push('<span class="sb sb-ok">BSM</span>');
  if (c.salvage === true) tags.push('<span class="sb sb-bad">🚨 Salvage</span>');
  if (c.reliability === 'concern') tags.push('<span class="sb sb-warn">Reliability</span>');
  if (c.overPreferredBudget) tags.push('<span class="sb sb-warn">Over $15k</span>');
  return `<article class="brow${hidden ? ' is-hidden' : ''}" data-vin="${esc(c.vin)}">
    <div class="brow-top">
      <div class="brow-main">
        <div class="brow-t">${esc(c.label)}${c.trim ? ` <span class="trim">${esc(c.trim)}</span>` : ''}</div>
        <div class="brow-s">${money(c.price)} · ${milesFmt(c.miles)} · ${POWER_LABEL[c.power] || esc(c.power)}${c.distanceMi != null ? ` · ${c.distanceMi} mi away` : ''}</div>
        <div class="chips">${tags.join('')}</div>
      </div>
      <div class="brow-r">
        <div class="brow-tco">${money(totalOf(c))}</div>
        <div class="why">${HORIZON}-yr cost</div>
      </div>
    </div>
    <div class="actions">
      <button class="vote up${vote === 'up' ? ' on' : ''}" data-v="up" type="button" aria-label="Thumbs up">👍</button>
      <button class="vote down${vote === 'down' ? ' on' : ''}" data-v="down" type="button" aria-label="Thumbs down">👎</button>
      <a class="listing" href="${esc(c.url)}" target="_blank" rel="noopener">Listing ↗</a>
      <button class="hide-btn" data-hide="1" type="button" title="Hide this car from the list — affects nothing else">${hidden ? '↩︎ Unhide' : '🙈 Not for me'}</button>
    </div>
    <input class="note-input" type="text" placeholder="Add a note…" value="${esc(note)}" aria-label="Note about this car">
  </article>`;
}

function renderBrowse() {
  const grid = $('#cars-grid');
  let shown = (DATA.browse || []).filter(passesFacets);
  // Jordyn's hidden list is applied HERE and nowhere else — it is a view filter,
  // not an input to anything.
  if (!SHOW_HIDDEN) shown = shown.filter((c) => !HIDDEN.has(c.vin));
  shown = sortCars(shown);
  if (!shown.length) {
    grid.innerHTML = HIDDEN.size && !SHOW_HIDDEN
      ? `<p class="empty">Nothing left after your filters — you have ${HIDDEN.size} car(s) hidden. Tap “Show hidden” to bring them back.</p>`
      : '<p class="empty">No cars match those filters. Loosen one above.</p>';
    return;
  }
  grid.innerHTML = `<p class="tier-blurb">${shown.length} of ${(DATA.browse || []).length} cars · full detail lives on the shortlist</p>`
    + shown.map(browseRow).join('');
}

function renderList() {
  if (VIEW === 'shortlist') renderShortlist();
  else renderBrowse();
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
  const empty = up + down + notes === 0;
  $('#send-btn').disabled = empty;
  // Nothing to clear when nothing is marked — and once something is, there has
  // to be a way out. Picks used to live in localStorage forever with no control
  // to reset them, so a second round of voting started on top of the first.
  $('#clear-btn').hidden = empty && HIDDEN.size === 0;
  $('#sendbar').hidden = false;
}

/**
 * Wipe this device's marks.
 *
 * Deliberately confirms first — someone who has worked through 500 cars should
 * not lose it to a stray tap — and clears hidden cars too, because "start again"
 * that leaves a third of the list invisible isn't starting again.
 */
function clearPicks() {
  const up = Object.values(VOTES).filter((v) => v === 'up').length;
  const down = Object.values(VOTES).filter((v) => v === 'down').length;
  const notes = Object.keys(COMMENTS).length;
  const bits = [];
  if (up) bits.push(`${up} 👍`);
  if (down) bits.push(`${down} 👎`);
  if (notes) bits.push(`${notes} note${notes === 1 ? '' : 's'}`);
  if (HIDDEN.size) bits.push(`${HIDDEN.size} hidden`);
  if (!bits.length) return;
  if (!window.confirm(`Clear ${bits.join(', ')} from this phone?\n\nThis only affects this device — anything already sent stays sent.`)) return;

  for (const k of Object.keys(VOTES)) delete VOTES[k];
  for (const k of Object.keys(COMMENTS)) delete COMMENTS[k];
  HIDDEN.clear();
  APP.saveVotes();
  APP.saveComments();
  saveHidden();
  renderControls();
  renderList();
  renderPicks();
  renderTally();
  toast('Cleared — start fresh');
}

// ---------- tabs ----------
function switchTab(name) {
  // Derived from the tab bar, NOT a hardcoded list. The previous version named
  // four panels explicitly; adding the family tab therefore left #panel-family
  // permanently visible, sitting on top of whichever panel you selected. Every
  // tab looked dead because the content never appeared to change.
  //
  // The layout audit missed it because it measured the document after clicking
  // rather than asserting the right panel became visible — so it now checks
  // that too.
  document.querySelectorAll('#tabbar .tab').forEach((b) => {
    const t = b.dataset.tab;
    const panel = document.getElementById(`panel-${t}`);
    if (panel) panel.hidden = t !== name;
    b.classList.toggle('active', t === name);
  });
  // The send bar follows the votable views — her picks are votable too.
  $('#sendbar').hidden = !(name === 'cars' || name === 'picks');
  window.scrollTo(0, 0);
}

/**
 * Jump from a car in the family plan to its full card.
 *
 * The family tab answers "what does this cost the household"; the detail card
 * answers "why". Rather than duplicate the card, switch to the cars tab and
 * scroll to it — and fall back to the browse view first, since the shortlist
 * only renders a curated subset and the car may not be in it.
 */
function gotoCar(vin) {
  const find = () => document.querySelector(`#cars-grid .car[data-vin="${CSS.escape(vin)}"]`);
  switchTab('cars');

  // Try the current view, then the other one. The family candidates live in the
  // shortlist and the long tail lives in browse, so which view holds a given
  // car depends on the car — guessing one and giving up silently would send you
  // to an empty page with no explanation.
  let el = find();
  if (!el) {
    for (const v of ['shortlist', 'browse']) {
      if (VIEW === v) continue;
      VIEW = v;
      document.querySelectorAll('#viewbar .vw').forEach((b) => b.classList.toggle('on', b.dataset.view === VIEW));
      renderControls();
      renderList();
      el = find();
      if (el) break;
    }
  }
  if (!el) return false;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 2200);
  return true;
}

// ---------- interaction ----------
let wired = false;
function wireDelegates() {
  if (wired) return;
  wired = true;

  document.querySelectorAll('#tabbar .tab').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  // "Why does this cost what it costs?" — jump to the car's full card.
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-goto-vin]');
    if (!g) return;
    e.preventDefault();
    gotoCar(g.dataset.gotoVin);
  });

  document.addEventListener('click', (e) => {
    const vw = e.target.closest('.vw');
    if (vw) {
      VIEW = vw.dataset.view;
      document.querySelectorAll('#viewbar .vw').forEach((b) => b.classList.toggle('on', b.dataset.view === VIEW));
      // Filters and sort only make sense over the long tail; the shortlist is
      // curated and grouped.
      renderControls();
      renderList();
      return;
    }
    if (e.target.closest('#show-hidden')) {
      SHOW_HIDDEN = !SHOW_HIDDEN;
      renderControls();
      renderList();
      return;
    }
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
    const hide = e.target.closest('.hide-btn');
    if (hide) {
      // `[data-vin]` rather than `.car`: shortlist cards and browse rows are
      // different markup but the same action. Keying on the card class meant
      // 👍/👎/hide silently did nothing in the browse view.
      const vin = hide.closest('[data-vin]')?.dataset.vin;
      if (!vin) return;
      toggleHidden(vin);
      renderControls();
      renderList();
      return;
    }
    const vote = e.target.closest('.vote');
    if (vote) {
      const vin = vote.closest('[data-vin]')?.dataset.vin;
      if (!vin) return;
      APP.setVote(vin, vote.dataset.v);
      vote.closest('.actions').querySelectorAll('.vote').forEach((b) => b.classList.toggle('on', VOTES[vin] === b.dataset.v));
      renderTally();
      return;
    }
    if (e.target.closest('#send-btn')) sendPicks();
    if (e.target.closest('#clear-btn')) clearPicks();
  });

  document.addEventListener('change', (e) => {
    if (e.target.id === 'sort-sel') { SORT = e.target.value; renderList(); }
  });
  document.addEventListener('input', (e) => {
    const ni = e.target.closest('.note-input');
    if (ni) { setComment(ni.closest('[data-vin]')?.dataset.vin, ni.value); renderTally(); }
  });
}

function sendPicks() {
  // Votes can come from either view, so the lookup has to span both. Building it
  // from DATA.cars alone silently dropped every pick made while browsing — the
  // vote registered, the tally counted it, and then it vanished from the message.
  // Shortlist entries take precedence: same VIN, richer record.
  const byVin = new Map();
  for (const c of DATA.browse || []) byVin.set(c.vin, c);
  for (const c of DATA.cars || []) byVin.set(c.vin, c);

  const costOf = (c) => {
    // Shortlist cars carry the full tco objects; browse rows carry plain totals.
    const full = tcoOf(c);
    if (full && typeof full.total === 'number') return full.total;
    return HORIZON === 2 ? c.tco2 : c.tco6;
  };
  const line = (vin, mark) => {
    const c = byVin.get(vin);
    if (!c) return null;
    const n = COMMENTS[vin] ? ` — "${COMMENTS[vin]}"` : '';
    return `${mark} ${c.label} · ${money(c.price)} · ${milesFmt(c.miles)} · ${money(costOf(c))}/${HORIZON}yr${n}\n  ${c.url}`;
  };
  const ups = Object.entries(VOTES).filter(([, v]) => v === 'up').map(([vin]) => line(vin, '👍')).filter(Boolean);
  const downs = Object.entries(VOTES).filter(([, v]) => v === 'down').map(([vin]) => line(vin, '👎')).filter(Boolean);
  const orphan = Object.keys(COMMENTS).filter((vin) => !VOTES[vin]).map((vin) => line(vin, '📝')).filter(Boolean);
  const text = ["Jordyn's car picks:", '', ...ups, ...(downs.length ? ['', ...downs] : []), ...(orphan.length ? ['', ...orphan] : [])].join('\n');
  if (navigator.share) navigator.share({ text }).then(offerClear).catch(() => { /* cancelled */ });
  else navigator.clipboard?.writeText(text).then(() => {
    $('#send-btn').textContent = 'Copied ✓';
    setTimeout(() => { $('#send-btn').textContent = 'Send my picks'; }, 1800);
    offerClear();
  });
}

/**
 * Offer to reset after a successful send.
 *
 * The moment right after sending is the only one where clearing is obviously
 * safe, and it is exactly when people put the phone down and forget. Without it
 * the next round of voting starts on top of the last one and the two get sent
 * together.
 */
function offerClear() {
  setTimeout(() => {
    if (!Object.keys(VOTES).length && !Object.keys(COMMENTS).length) return;
    if (!window.confirm('Picks sent. Clear them from this phone so the next round starts fresh?')) return;
    for (const k of Object.keys(VOTES)) delete VOTES[k];
    for (const k of Object.keys(COMMENTS)) delete COMMENTS[k];
    APP.saveVotes();
    APP.saveComments();
    renderList();
    renderPicks();
    renderTally();
    toast('Cleared — ready for the next round');
  }, 700);
}
