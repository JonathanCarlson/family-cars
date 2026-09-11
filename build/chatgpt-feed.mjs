// Compact, model-focused Markdown exports for ChatGPT and other text readers.
//
// The encrypted app data is not touched here. These files are projections of
// the already-built current inventory, with the decision-relevant fields kept
// and photos, dealer boilerplate, duplicate prose and long feature dumps left
// out. Every file is bounded below 2 MiB so a client can download it reliably.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const CHATGPT_FEED_FILES = [
  'index.md',
  'shortlist.md',
  'mach-e.md',
  'polestar-2.md',
  'audi-etron.md',
  'ipace.md',
  'volvo.md',
  'ioniq5-ev6.md',
  'other-interesting.md',
];

export const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;
const SHORTLIST_SIZE = 80;

const money = (value) => value == null ? 'unknown' : `$${Math.round(Number(value)).toLocaleString('en-US')}`;
const miles = (value) => value == null ? 'unknown' : `${Math.round(Number(value)).toLocaleString('en-US')} mi`;
const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const nameOf = (car) => {
  const make = clean(car.make);
  const rawModel = clean(car.model);
  const model = rawModel.toLowerCase().startsWith(`${make.toLowerCase()} `)
    ? rawModel.slice(make.length).trim()
    : rawModel;
  return clean([car.year, make, model || rawModel, car.trim].filter(Boolean).join(' '));
};
const identity = (car) => clean(`${car.make ?? ''} ${car.model ?? ''} ${car.trim ?? ''}`).toLowerCase();
const modelKey = (car) => clean(`${car.make ?? ''}|${car.model ?? ''}`).toLowerCase();
const scoreOf = (car) => car.kateFit?.score ?? car.kateMatchScore ?? car.matchScore ?? 0;
const bargainOf = (car) => car.bargain?.score ?? null;
const isRejected = (car) => ['REJECT', 'HOLD_RECALL_LOOKUP_FAILED'].includes(car.kateResearch?.riskGate || car.bargain?.riskGate);

function currentCars(data, allCars) {
  const rich = new Map((data.cars || []).map((car) => [car.vin, car]));
  const out = new Map();
  for (const slim of allCars?.cars || []) out.set(slim.vin, rich.get(slim.vin) || slim);
  for (const car of data.cars || []) out.set(car.vin, car);
  return [...out.values()].filter((car) => car.vin && car.stale !== true && !/^fisker$/i.test(String(car.make || '')));
}

function locationOf(car) {
  return car.cityState || (() => {
    const match = /,\s*([^,]+,\s*[A-Z]{2})\s*$/.exec(car.location || '');
    return match ? match[1] : '';
  })();
}

function dealerOf(car) {
  if (car.dealerName) return car.dealerName;
  const location = clean(car.location);
  if (!location) return 'unknown';
  const parts = location.split(',').map((part) => part.trim());
  return parts.length > 1 ? parts.slice(0, -1).join(', ') : location;
}

function historyOf(car) {
  const history = car.history || {};
  const value = (rich, slim) => rich ?? car[slim] ?? null;
  const tri = (v) => v === true ? 'yes' : v === false ? 'no' : 'not reported';
  return [
    `accident reported: ${tri(value(history.accidentsReported, 'accidents'))}`,
    `salvage title: ${tri(value(history.salvageTitle, 'salvage'))}`,
    `branded title: ${tri(value(history.brandedTitle, 'brandedTitle'))}`,
    `lemon/buyback: ${tri(value(history.lemonBuyback, 'lemonBuyback'))}`,
    `frame damage: ${tri(history.frameDamage)}`,
    `flood damage: ${tri(history.floodDamage)}`,
  ].join(' · ');
}

function tcoOf(car, driver) {
  const rich = driver === 'Kate' ? car.tco6Kate : car.tco6;
  if (rich && typeof rich === 'object') return rich.total ?? null;
  return car.byDriver?.[driver.toLowerCase()]?.sixYearUsd
    ?? (driver === 'Jordyn' && typeof car.tco6 === 'number' ? car.tco6 : null);
}

function drivetrainOf(car) {
  if (car.driveType) return clean(car.driveType);
  if (car.awd === true) return 'AWD';
  if (car.awd === false) return 'FWD/RWD';
  return 'unknown';
}

function optionSummary(car) {
  const options = new Set();
  const research = car.kateResearch;
  const id = identity(car);
  if (research?.variant) options.add(research.variant);
  if (research?.packages) {
    for (const [key, value] of Object.entries(research.packages)) {
      if (value === 'YES' || value === 'LIKELY') options.add(`${key.replace(/([A-Z])/g, ' $1').toLowerCase()}: ${value.toLowerCase()}`);
    }
  }
  if (car.cert === 'Certified') options.add('certified pre-owned');
  if (car.bluecruise === 'yes') options.add('BlueCruise');
  if (car.glassRoof === 'yes' || car.glassRoof === 'likely') options.add('panoramic glass roof');
  if (/polestar.*2/.test(id)) {
    if (car.awd === true || /awd|all-wheel/i.test(car.driveType || '')) options.add('Long Range Dual Motor');
    else if (car.awd === false || /fwd|rwd|front-wheel|rear-wheel/i.test(car.driveType || '')) options.add('Single Motor');
    options.add('Plus/Pilot/Performance packs require build-sheet verification');
  }
  if (/audi e-?tron/.test(id) && car.trim) options.add(`${clean(car.trim)} trim`);
  if (/jaguar.*i-?pace/.test(id) && car.trim) options.add(`${clean(car.trim)} trim`);
  if (/volvo.*(?:xc40|c40)/.test(id) && car.trim) options.add(`${clean(car.trim)} trim`);
  if (/(?:ioniq ?5|kia.*ev6|mustang mach-?e)/.test(id) && car.trim) options.add(`${clean(car.trim)} trim`);
  for (const value of [...(car.confirmedExtras || []), ...(car.comfort || [])]) {
    if (/plus pack|pilot pack|bluecruise|panoramic|glass roof|360|heated|harman|bowers|bang & olufsen|memory seat|adaptive cruise/i.test(value)) {
      options.add(clean(value));
    }
  }
  return options.size ? [...options].slice(0, 8).join(' · ') : 'not reported; verify the build sheet/window sticker';
}

function recallServiceFlags(car) {
  const research = car.kateResearch;
  const recalls = (research?.hvBatteryRecalls || [])
    .filter((recall) => recall.status !== 'NOT_OPEN_IN_CURRENT_OEM_LOOKUP')
    .map((recall) => `${recall.nhtsaCampaign}/${(recall.oemCampaigns || []).join('+')}: ${recall.status}`);
  if (recalls.length) return `${recalls.join(' · ')} · ${research.riskGate}`;

  const id = identity(car);
  if (/polestar.*2/.test(id)) return 'Verify latest applicable rear-camera/vehicle-software campaigns; Bellevue-area Polestar service, with long-term US-network risk.';
  if (/audi e-?tron/.test(id) && !/q4|gt/.test(id)) return 'Verify 93U9/93V2 closed; require Audi-capable battery/drive-unit/cooling PPI; Audi Bellevue/Seattle service.';
  if (/mustang mach-?e/.test(id)) return 'Verify applicable 23V-687/23S56 HVBJB hardware remedy; broad local Ford service.';
  if (/volvo.*(?:xc40|c40)/.test(id)) return 'Verify applicable BECM/camera campaigns; Volvo Cars Bellevue service.';
  if (/ioniq ?5/.test(id)) return 'Verify current ICCU campaigns; broad local Hyundai service.';
  if (/kia.*ev6/.test(id)) return 'VIN-gate current ICCU and battery campaigns; broad local Kia service.';
  return `Check NHTSA/OEM campaigns by VIN; local serviceability score ${car.bargain?.components?.localServiceability?.score ?? 'unknown'}/100.`;
}

function riskNotes(car) {
  const notes = [];
  const history = car.history || {};
  if (history.salvageTitle === true || car.salvage === true) notes.push('salvage title');
  if (history.brandedTitle === true || car.brandedTitle === true) notes.push('branded title');
  if (history.lemonBuyback === true || car.lemonBuyback === true) notes.push('lemon/manufacturer buyback');
  if (history.frameDamage === true) notes.push('frame damage');
  if (history.floodDamage === true) notes.push('flood damage');
  if (history.accidentsReported === true || car.accidents === true) notes.push('accident reported');
  for (const caution of car.kateResearch?.cautions || []) notes.push(clean(caution));
  if (car.reliability?.band) notes.push(`model-year reliability: ${car.reliability.band}`);
  else if (car.reliability) notes.push(`model-year reliability: ${car.reliability}`);
  const tail = car.repairs6?.tail;
  if (tail?.amount) {
    const probability = (tail.probability ?? 0) * 100;
    notes.push(`largest modeled repair: ${money(tail.amount)} at ${probability > 0 && probability < 1 ? '<1%' : `about ${Math.round(probability)}%`}`);
  }
  if (!notes.length) notes.push('No specific red flag in the listing summary; still require VIN history, recall lookup and pre-purchase inspection.');
  return [...new Set(notes)].slice(0, 6);
}

function listingMarkdown(car, index) {
  const shipping = Number(car.shippingUsd) || 0;
  const scope = car.inventoryScope === 'national-fallback'
    ? `national fallback; ${money(shipping)} shipping included`
    : 'PNW (within 250 miles)';
  const overall = car.matchScore ?? 'unknown';
  const kate = car.kateFit?.score ?? car.kateMatchScore ?? 'not scored';
  const bargain = bargainOf(car) ?? 'not scored';
  const jTco = tcoOf(car, 'Jordyn');
  const kTco = tcoOf(car, 'Kate');
  const risks = riskNotes(car);
  return [
    `### ${index}. ${nameOf(car)}`,
    '',
    `- **Price:** ${money(car.price)}${shipping ? ` + ${money(shipping)} shipping` : ''}`,
    `- **Mileage:** ${miles(car.miles)}`,
    `- **Location / distance:** ${locationOf(car) || 'unknown'}${car.distanceMi != null ? ` · ${Math.round(car.distanceMi).toLocaleString('en-US')} mi from Bellevue` : ''}`,
    `- **Dealer:** ${clean(dealerOf(car))}`,
    `- **VIN:** \`${car.vin}\``,
    `- **Direct listing:** ${car.url || 'unavailable'}`,
    `- **Scores:** best match ${overall}/100 · Kate fit ${kate}${kate === 'not scored' ? '' : '/100'} · Bargain ${bargain}${bargain === 'not scored' ? '' : '/100'}`,
    `- **6-year TCO:** Jordyn ${money(jTco)} · Kate ${money(kTco)}${shipping ? ' (shipping included in both)' : ''}`,
    `- **Drivetrain / range:** ${drivetrainOf(car)} · ${car.evRange != null ? `${Math.round(car.evRange)} mi` : 'range not reported'}`,
    `- **Important options:** ${optionSummary(car)}`,
    `- **Accident / title history:** ${historyOf(car)}`,
    `- **Recall / service flags:** ${recallServiceFlags(car)}`,
    `- **Inventory scope:** ${scope}`,
    `- **Risk notes:** ${risks.join(' · ')}`,
    '',
  ].join('\n');
}

function sorted(cars) {
  return [...cars].sort((a, b) => scoreOf(b) - scoreOf(a)
    || (bargainOf(b) ?? 0) - (bargainOf(a) ?? 0)
    || modelKey(a).localeCompare(modelKey(b))
    || (a.price ?? Infinity) - (b.price ?? Infinity));
}

function shortlist(cars) {
  const selected = [];
  const seen = new Set();
  const add = (car) => {
    if (!car?.vin || seen.has(car.vin) || isRejected(car)) return;
    seen.add(car.vin);
    selected.push(car);
  };

  // Guarantee representation for each named-interest model before filling by
  // score. Two examples per model gives GPT enough contrast without letting one
  // plentiful model dominate the file.
  for (const filter of [
    (c) => /mustang mach-?e/.test(identity(c)),
    (c) => /polestar.*2/.test(identity(c)),
    (c) => /audi e-?tron/.test(identity(c)) && !/q4|gt/.test(identity(c)),
    (c) => /jaguar.*i-?pace/.test(identity(c)),
    (c) => /volvo.*(?:xc40|c40)/.test(identity(c)),
    (c) => /(?:ioniq ?5|kia.*ev6)/.test(identity(c)),
  ]) {
    sorted(cars.filter(filter)).slice(0, 2).forEach(add);
  }

  const perModel = new Map();
  for (const car of sorted(cars)) {
    if (selected.length >= SHORTLIST_SIZE) break;
    const key = modelKey(car);
    if ((perModel.get(key) || 0) >= 2) continue;
    add(car);
    if (seen.has(car.vin)) perModel.set(key, (perModel.get(key) || 0) + 1);
  }
  return selected.slice(0, SHORTLIST_SIZE);
}

const GROUPS = [
  ['mach-e.md', 'Mustang Mach-E', (c) => /mustang mach-?e/.test(identity(c))],
  ['polestar-2.md', 'Polestar 2', (c) => /polestar.*2/.test(identity(c))],
  ['audi-etron.md', 'Audi e-tron SUV', (c) => /audi e-?tron/.test(identity(c)) && !/q4|gt/.test(identity(c))],
  ['ipace.md', 'Jaguar I-PACE', (c) => /jaguar.*i-?pace/.test(identity(c))],
  ['volvo.md', 'Volvo XC40 / C40 Recharge', (c) => /volvo.*(?:xc40|c40)/.test(identity(c))],
  ['ioniq5-ev6.md', 'Hyundai Ioniq 5 / Kia EV6', (c) => /(?:hyundai.*ioniq ?5|kia.*ev6)/.test(identity(c))],
];

function fileMarkdown(title, note, cars, generatedAt) {
  const ordered = sorted(cars);
  const lines = [
    `# ${title}`,
    '',
    `**Generated:** ${generatedAt}  `,
    `**Current listings:** ${ordered.length}`,
    '',
    `> ${note}`,
    '> Current inventory only. Confirm availability and all VIN-level facts with the seller before acting.',
    '',
    ...ordered.map((car, index) => listingMarkdown(car, index + 1)),
  ];
  return lines.join('\n');
}

function otherInteresting(cars, excludedVins) {
  const selected = [];
  const perModel = new Map();
  for (const car of sorted(cars.filter((c) => c.power === 'BEV'
    && !excludedVins.has(c.vin)
    && !isRejected(c)
    && (bargainOf(c) ?? 0) >= 65))) {
    const key = modelKey(car);
    if ((perModel.get(key) || 0) >= 5) continue;
    perModel.set(key, (perModel.get(key) || 0) + 1);
    selected.push(car);
    if (selected.length >= 200) break;
  }
  return selected;
}

export function buildChatGptMarkdownFiles({ data, allCars, feed, publicBase, token, generatedAt = new Date().toISOString() }) {
  const cars = currentCars(data, allCars);
  const grouped = {};
  const categorized = new Set();
  for (const [file, title, filter] of GROUPS) {
    grouped[file] = { title, cars: cars.filter(filter) };
    for (const car of grouped[file].cars) categorized.add(car.vin);
  }
  grouped['shortlist.md'] = { title: `Top ${Math.min(SHORTLIST_SIZE, cars.length)} candidates`, cars: shortlist(cars) };
  grouped['other-interesting.md'] = {
    title: 'Other interesting depreciation values',
    cars: otherInteresting(cars, categorized),
  };

  const notes = {
    'shortlist.md': 'A model-diverse top set across both drivers and all makes. Named Kate interests are guaranteed representation; the rest rank by their strongest applicable fit score.',
    'mach-e.md': 'All current Mustang Mach-E examples in the export.',
    'polestar-2.md': 'All current Polestar 2 examples; Long Range Dual Motor is preferred and Plus/Pilot equipment must be verified where unknown.',
    'audi-etron.md': 'Original 2019-22 Audi e-tron SUVs only; Q4 and GT models are excluded from this file.',
    'ipace.md': 'All current I-PACE examples. National fallback appears only because fewer than three qualifying PNW cars were found; recall status is VIN-specific where available.',
    'volvo.md': 'All current Volvo XC40 Recharge and C40 Recharge examples.',
    'ioniq5-ev6.md': 'All current Hyundai Ioniq 5 and Kia EV6 examples.',
    'other-interesting.md': 'Up to 200 other clean-title battery EVs with Bargain score >=65, capped at five examples per model.',
  };

  const files = {};
  for (const [file, group] of Object.entries(grouped)) {
    files[file] = fileMarkdown(group.title, notes[file], group.cars, generatedAt);
  }

  const links = CHATGPT_FEED_FILES.filter((file) => file !== 'index.md')
    .map((file) => `- [${file}](${publicBase}/feed/${token}/${file}) — ${grouped[file]?.cars.length ?? 0} listings`);
  files['index.md'] = [
    '# Family car feed for ChatGPT',
    '',
    `**Generated:** ${generatedAt}  `,
    `**Roster date:** ${feed.feed.rosterUpdated}  `,
    `**Current market rows analyzed:** ${allCars?.count ?? cars.length}  `,
    `**Detailed app records:** ${feed.feed.listingCount}  `,
    `**ChatGPT shortlist:** ${grouped['shortlist.md'].cars.length}`,
    '',
    '## Search and scoring assumptions',
    '',
    `- ${feed.feed.discovery}`,
    `- ${feed.feed.budget.note}`,
    '- Unavailable listings are removed from every current feed and retained in the private Vault history.',
    '- Fisker is excluded.',
    '- National fallback triggers only when an explicitly named model has fewer than 3 qualifying PNW examples; each fallback car includes $2,000 shipping.',
    '- Six-year TCO includes purchase, shipping, sales tax, energy, maintenance, insurance, registration, expected major-repair reserve and resale recovery.',
    '- Bargain score: 25% original-MSRP discount; 20% reliability/catastrophic risk; 15% local serviceability; 15% driving character/performance; 10% premium features; 10% range/charging; 5% rarity.',
    '- Unknown is not false. Verify VIN history, recalls, battery health and options before purchase.',
    '',
    '## Files',
    '',
    ...links,
    `- [jordyn.json](${publicBase}/feed/${token}/jordyn.json) — canonical structured feed`,
    '',
  ].join('\n');

  for (const [file, body] of Object.entries(files)) {
    const bytes = Buffer.byteLength(body, 'utf8');
    if (bytes >= MAX_MARKDOWN_BYTES) {
      throw new Error(`${file} is ${bytes} bytes; every ChatGPT Markdown file must stay below ${MAX_MARKDOWN_BYTES}`);
    }
  }
  return { files, counts: Object.fromEntries(Object.entries(grouped).map(([file, group]) => [file, group.cars.length])) };
}

export function compatibilityMarkdown(publicBase, token) {
  return `# Family car feed moved\n\nThe ChatGPT-friendly feed is now split into smaller files. Start here:\n\n- [index.md](${publicBase}/feed/${token}/index.md)\n- [shortlist.md](${publicBase}/feed/${token}/shortlist.md)\n- [jordyn.json](${publicBase}/feed/${token}/jordyn.json)\n`;
}

export function writeChatGptMarkdownFiles({ root, token, files }) {
  const dir = join(root, 'feed', token);
  mkdirSync(dir, { recursive: true });
  for (const file of CHATGPT_FEED_FILES) {
    if (typeof files[file] !== 'string') throw new Error(`missing ChatGPT feed file: ${file}`);
    writeFileSync(join(dir, file), files[file], 'utf8');
  }
  return CHATGPT_FEED_FILES.map((file) => join(dir, file));
}

export default {
  CHATGPT_FEED_FILES,
  MAX_MARKDOWN_BYTES,
  buildChatGptMarkdownFiles,
  compatibilityMarkdown,
  writeChatGptMarkdownFiles,
};
