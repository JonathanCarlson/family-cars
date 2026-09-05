// feed-json.mjs — the machine-readable contract for a roster.
//
// This is deliberately NOT a dump of the page's internal state. The page object
// carries UI scaffolding, uses short keys whose units are implicit, and changes
// shape whenever the page is refactored. A consumer that parsed it would be
// silently coupled to our render code and would break without warning.
//
// So the feed is an explicit, versioned contract:
//   · every field is named in full, with units in the name or the schema
//   · the schema travels WITH the data, so a reader never has to guess
//   · unknown is `null` and is documented as distinct from `false`
//
// That last rule is the important one. Nearly every data-quality bug in this
// project came from collapsing "we don't know" into a confident value: a
// powertrain inferred from a model name, an IIHS award borrowed from a variant
// that was never tested, a missing safety field read as "not equipped". The feed
// exposes provenance next to each claim so a reader can tell a measured fact
// from an assumption, and so can this project's future self.

const POWER_LABEL = {
  BEV: 'Battery electric',
  PHEV: 'Plug-in hybrid',
  HYB: 'Hybrid (gasoline, self-charging)',
  ICE: 'Gasoline',
};

const round = (n) => (n == null ? null : Math.round(n));

function powertrainOf(c) {
  const verified = c.powerSource === 'vin' || c.powerSource === 'listing';
  return {
    type: c.power || null,
    label: c.power ? POWER_LABEL[c.power] || c.power : null,
    isPlugIn: c.power === 'BEV' || c.power === 'PHEV',
    electricRangeMi: c.evRange ?? null,
    source: c.powerSource || null,
    evidence: c.powerEvidence || null,
    vinVerified: verified,
    // Only emitted when it applies. See fieldNotes.powertrain for the standing rule.
    caution: verified
      ? null
      : 'Powertrain could NOT be established from the VIN. Range, energy cost, battery risk and maintenance rate for this listing are model-level assumptions, not facts about this car.',
  };
}

function equipmentEvidence(state, source) {
  if (!state) return { equipped: null, confidence: 'unknown' };
  const vin = source === 'vin';
  return {
    equipped: state === 'standard' ? true : null,
    rawState: state,
    confidence: vin ? 'vin-trim-confirmed' : 'model-year-typical',
  };
}

function safetyOf(c) {
  const s = c.safety;
  if (!s) return null;
  const v = c.vinSafety || {};
  const alsoStandard = ['fcw', 'lka', 'acc', 'rcta', 'backupCam']
    .filter((k) => v[k] === 'standard')
    .map((k) => ({
      fcw: 'forward-collision-warning',
      lka: 'lane-keeping-assist',
      acc: 'adaptive-cruise-control',
      rcta: 'rear-cross-traffic-alert',
      backupCam: 'backup-camera',
    }[k]));

  return {
    automaticEmergencyBraking: equipmentEvidence(s.aeb, s.aebSource),
    blindSpotMonitoring: equipmentEvidence(s.bsm, s.bsmSource),
    iihsAward: s.iihs || null,
    iihsNotRatedNote: s.iihsNotRated || null,
    vinTrim: v.trim || null,
    alsoStandardOnThisTrim: alsoStandard,
    note: s.note || null,
  };
}

function batteryOf(c) {
  if (c.power !== 'BEV' && c.power !== 'PHEV') {
    return { applicable: false };
  }
  const w = c.batteryWarranty;
  return {
    applicable: true,
    riskFactor: c.batteryRisk ?? null,
    note: c.batteryNote || null,
    federalWarranty: w
      ? {
        summary: w.summary || null,
        yearsTotal: w.years ?? null,
        milesTotal: w.miles ?? null,
        expiresApprox: w.expires || null,
        remaining: w.remaining || null,
      }
      : null,
  };
}

function reliabilityOf(c) {
  const r = c.reliability;
  if (!r) return null;
  return {
    scope: 'model-year',
    appliesTo: `${r.year} ${r.make} ${r.model}`,
    queriedAsNhtsaModel: r.queriedAs ?? null,
    recordRetrieved: r.complaints != null,
    band: r.band || null,
    confidence: r.confidence || null,
    nhtsaComplaints: r.complaints ?? null,
    nhtsaSevereComplaints: r.severeComplaints ?? null,
    nhtsaRecalls: r.recalls ?? null,
    batteryRecall: r.batteryRecall ?? null,
    topComplaintComponents: r.topComponents || [],
    reasons: r.reasons || [],
    sourceUrl: r.source || null,
  };
}

function historyOf(c) {
  const h = c.history;
  if (!h || !h.reportAvailable) {
    return {
      reportAvailable: false,
      salvageTitle: null,
      frameDamage: null,
      floodDamage: null,
      accidentsReported: null,
      oneOwner: null,
      personalUseOnly: null,
      badges: h?.badges || [],
    };
  }
  const out = {
    reportAvailable: true,
    salvageTitle: h.salvageTitle ?? null,
    frameDamage: h.frameDamage ?? null,
    floodDamage: h.floodDamage ?? null,
    accidentsReported: h.accidentsReported ?? null,
    oneOwner: h.oneOwner ?? null,
    personalUseOnly: h.personalUseOnly ?? null,
    badges: h.badges || [],
  };
  const warnings = [];
  if (out.salvageTitle === true) {
    warnings.push('SALVAGE TITLE: declared a total loss and rebuilt. Structural repair quality is unverifiable from a listing, crash and airbag performance may be compromised, some insurers will not write full coverage, and resale is far below a clean-title equivalent — so resaleValueRecovered in costToOwn is optimistic for this car.');
  }
  if (out.frameDamage === true) warnings.push('FRAME DAMAGE reported — affects crash-structure integrity.');
  if (out.floodDamage === true) warnings.push('FLOOD/WATER DAMAGE reported — long-term electrical and corrosion risk, particularly severe in an EV or hybrid.');
  if (warnings.length) out.warnings = warnings;
  return out;
}

function tcoOf(t) {
  if (!t || !t.items) return null;
  const i = t.items;
  return {
    years: t.years,
    milesDriven: t.miles,
    powertrainUsed: t.power,
    electricMilesShare: t.evShare ?? null,
    costs: {
      purchasePrice: round(i.purchase),
      salesTax: round(i.salesTax),
      fuelAndElectricity: round(i.energy),
      maintenance: round(i.maintenance),
      insurance: round(i.insurance),
      registrationAndFees: round(i.registration),
      majorRepairReserve: round(i.majorRepairReserve),
    },
    resaleValueRecovered: round(i.depreciation),
    totalCostOfOwnership: round(t.total),
    averagePerMonth: round(t.perMonth),
  };
}

/**
 * The repair picture, with expected cost and tail exposure kept apart.
 * Averaging a 3% chance of a $6,500 bill into a single "risk" number destroys
 * both pieces of information a buyer needs: what to budget, and what could go
 * catastrophically wrong.
 */
function repairOutlookOf(c) {
  const r = c.repairs6;
  if (!r) return null;
  return {
    window: '6 years',
    expectedReserveUsd: r.expected,
    worstCaseExposure: r.tail ? {
      component: r.tail.label,
      amountUsd: r.tail.amount,
      probability: r.tail.probability,
      note: r.tail.note,
    } : null,
    components: (r.items || []).map((i) => ({
      hazard: i.id,
      component: i.label,
      probability: i.probability,
      costIfItHappensUsd: i.costIfItHappens,
      expectedUsd: i.expected,
    })),
  };
}

function batteryHealthOf(c) {
  const h = c.batteryHealth;
  if (!h) return { applicable: false };
  return {
    applicable: true,
    thermalManagement: h.thermalManagement,
    packReplacedUnderRecall: h.packReplacedUnderRecall,
    stateOfHealthNow: h.sohNow,
    stateOfHealthAtEndOfSixYears: h.sohAtEndOfWindow,
    uncertainty: h.sohUncertainty,
    epaRangeWhenNewMi: h.epaRangeNewMi,
    estimatedRangeNowMi: h.estimatedRangeNowMi,
    estimatedRangeInSixYearsMi: h.estimatedRangeAtEndMi,
    dailyNeedMi: h.dailyNeedMi,
    stillCoversDailyNeed: h.coversDailyNeedAtEnd,
  };
}

/**
 * The hazard definitions, stated once. Per-listing `repairOutlook.components`
 * reference these by `hazard` id. Inlining the basis text on every component of
 * every car added roughly 600 KB of identical prose, which is a good way to get
 * a feed truncated by the client that most needs to read it.
 */
function hazardCatalog(cars) {
  const out = {};
  for (const c of cars) {
    for (const i of c.repairs6?.items || []) {
      if (out[i.id]) continue;
      out[i.id] = { component: i.label, costRangeUsd: i.costRange, basis: i.basis };
    }
  }
  return out;
}

function listingOf(c) {
  return {
    id: c.id,
    vin: c.vin,
    year: c.year,
    make: c.make,
    model: c.model,
    trim: c.trim || null,
    displayName: c.label,

    askingPriceUsd: c.price ?? null,
    priceRecentlyReduced: Boolean(c.priceNote),
    // A price the seller has told us is wrong must never be read as fact by a
    // downstream consumer. When priceStatus is 'disputed', askingPriceUsd is
    // the listing's claim, NOT a price anyone will honour — use
    // priceDispute.dealerSaysUsd and sixYearTcoRangeUsd instead.
    priceStatus: c.priceStatus ?? 'as-listed',
    priceDispute: c.priceFact ? {
      scrapedPriceUsd: c.priceFact.scrapedPriceUsd ?? null,
      dealerSaysUsd: c.priceFact.dealerSaysUsd ?? null,
      confirmedPriceUsd: c.priceFact.confirmedPriceUsd ?? null,
      verifiedOn: c.priceFact.asOf ?? null,
      verifiedVia: c.priceFact.source ?? null,
      note: c.priceFact.note ?? null,
    } : null,
    sixYearTcoRangeUsd: c.tcoRange6 ? { min: c.tcoRange6.minUsd, max: c.tcoRange6.maxUsd } : null,
    rankedAtPriceUsd: c.pricedAtUsd ?? null,
    odometerMiles: c.miles ?? null,
    exteriorColor: c.color || null,
    condition: c.cert || null,

    sourceUrl: c.url || null,
    photoUrl: c.photo || null,
    dealerAndLocation: c.location || null,
    distanceFromBellevueMi: c.distanceMi ?? null,
    daysOnLot: c.daysOnLot ?? null,
    firstSeenInThisFeed: c.firstSeen || null,
    stillListed: c.stale !== true,

    powertrain: powertrainOf(c),
    electricDriveShare: c.power === 'BEV' ? 1 : (c.tco6?.evShare ?? (c.power === 'ICE' || c.power === 'HYB' ? 0 : null)),
    safety: safetyOf(c),
    battery: batteryOf(c),
    // Reliability is a property of the MODEL-YEAR, not of this listing, so it is
    // stored once in reliabilityByModelYear and referenced by key. Inlining it
    // repeated the same paragraphs across every car sharing a model-year (51
    // distinct model-years across 121 listings) for no added information.
    reliabilityKey: c.reliability ? `${c.reliability.year} ${c.reliability.make} ${c.reliability.model}` : null,
    vehicleHistory: historyOf(c),
    costToOwn: { twoYear: tcoOf(c.tco2), sixYear: tcoOf(c.tco6) },
    repairOutlook: repairOutlookOf(c),
    batteryHealth: batteryHealthOf(c),
    viability2032: c.viability
      ? { ...c.viability, reasons: c.viability.reasons, caveat: undefined }
      : null,

    ranking: {
      safetyTier: c.tier || null,
      matchScore: c.matchScore ?? null,
      flags: c.flags || [],
    },
    humanNote: c.note || null,
  };
}

/**
 * Build the full feed document.
 * @param {object} data the decrypted roster (build/jordyn.json)
 */
export function rosterFeed(data, allCars = null) {
  const a = data.assumptions || {};
  const cars = data.cars || [];
  const listings = cars.map(listingOf);

  // Reliability is per model-year; store it once and reference by key.
  const reliabilityByModelYear = {};
  for (const c of cars) {
    const r = reliabilityOf(c);
    if (!r) continue;
    reliabilityByModelYear[r.appliesTo] = r;
  }

  const byScore = [...listings].sort((x, y) => (y.ranking.matchScore ?? 0) - (x.ranking.matchScore ?? 0));
  const brief = (l) => ({
    vin: l.vin,
    name: `${l.displayName}${l.trim ? ` ${l.trim}` : ''}`,
    askingPriceUsd: l.askingPriceUsd,
    odometerMiles: l.odometerMiles,
    powertrain: l.powertrain.label,
    electricDriveShare: l.electricDriveShare,
    sixYearCostUsd: l.costToOwn.sixYear?.totalCostOfOwnership ?? null,
    twoYearCostUsd: l.costToOwn.twoYear?.totalCostOfOwnership ?? null,
    matchScore: l.ranking.matchScore,
    salvageTitle: l.vehicleHistory.salvageTitle,
    accidentsReported: l.vehicleHistory.accidentsReported,
    sourceUrl: l.sourceUrl,
  });

  // Two shortlists, deliberately. The overall ranking is powertrain-neutral —
  // electric cars earn their place on cost, not on a thumb on the scale. But the
  // stated preference is a strong bias toward primarily-electric driving, and
  // burying that in a filter would make it invisible to a reader of this feed.
  // So the bias lives here, as an explicit second list, instead of being smuggled
  // into matchScore where it would silently distort every cost comparison.
  const plugIn = byScore.filter((l) => l.powertrain.isPlugIn && l.powertrain.vinVerified);

  return {
    feed: {
      name: 'jordyn-first-car',
      schemaVersion: '1.5',
      generatedAt: new Date().toISOString(),
      rosterUpdated: data.updated || null,
      listingCount: cars.length,
      purpose: 'Used cars near Bellevue WA for a first-time teen driver, screened for safety and ranked on total cost to own.',
      budget: {
        preferredUsd: data.budget?.preferred ?? 15000,
        searchedToUsd: data.budget?.searchedTo ?? 22000,
        note: '$15k is the preferred target, but discovery runs to the ceiling so cost-to-own can argue for a dearer car rather than a price rule excluding it. Cars above the target carry overPreferredBudget: true.',
      },
      searchRadiusMi: 250,
      discovery: 'No model whitelist and no safety filter at the query — option data in listing feeds is patchy, so filtering on "has AEB" would silently drop qualifying cars. Discovery is broad; safety is verified afterwards from the VIN.',
      refresh: 'Regenerated nightly from live Autotrader inventory. Listings appear and sell quickly — always confirm against sourceUrl before acting.',
      howToReadThis: [
        'null means UNKNOWN and is always distinct from false. Never render a null as a negative.',
        'Powertrain is resolved from the VIN via NHTSA vPIC, never from the model name. Check powertrain.vinVerified before trusting electricRangeMi or energy costs.',
        'Safety equipment carries a confidence level. "vin-trim-confirmed" is manufacturer-reported for that trim; "model-year-typical" is research, not a fact about this car.',
        'reliability lives in reliabilityByModelYear, keyed by listing.reliabilityKey. It is model-year scope and says nothing about the condition of the individual car.',
        'vehicleHistory badges are affirming/negating pairs; null means not reported, NOT the negative.',
        'Start from shortlists.topOverall and shortlists.topElectric — the full listings array is long.',
        'listings[] holds full detail for the shortlisted cars. Every car the sweep found is in the companion file jordyn-all.json (see allCars.url) — use it for market-wide questions.',
        'marketAnalysis is where the population-level answers live: cohorts (model + generation + powertrain + battery, NOT model name), a safety-gated primary ranking, opportunities found from the data, and the methodology needed to challenge any of it.',
        'Safety is a GATE, not a weight. marketAnalysis.safetyFirst excludes a car only when AEB is CONFIRMED ABSENT — never when it is merely unverified.',
        'jordynPicks is what SHE chose, scored with the same model as everything else. It is never a filter on the rankings. Read entries[].delta against jordynPicks.baseline, and weight `stated` picks above `thumbed` ones.',
        'bands is the curated view: start there rather than with listings[] or allCars. bands.kate is BATTERY-ELECTRIC ONLY by rule — the absence of petrol cars there is deliberate, not a gap in the data.',
        'ODOMETER vs ANNUAL MILEAGE: the Highlander\'s odometer is 135,000 (highlanderAndPlans.highlander.odometerMiles). Every field ending in MilesPerYear is annual driving — 17,000 is what Kate drives in a year, NOT a mileage reading.',
        'All money is US dollars, whole units. All distances are miles.',
      ],
      canonicalPage: 'https://jonathancarlson.github.io/family-cars/jordyn.html',
      alternateFormats: { markdown: './jordyn.md', plainText: './jordyn.txt', json: './jordyn.json' },
      privacy: 'Unlisted capability URL. Not encrypted — treat the URL itself as the secret.',
    },

    // Stated ONCE here rather than repeated on all 121 listings. The per-listing
    // objects carry only what actually varies (evidence strings, warnings that
    // apply); these are the standing rules for interpreting those fields.
    fieldNotes: {
      'listing.priceStatus': '"as-listed" = the scraped asking price stands. "disputed" = the SELLER has told us the listed price is wrong — do NOT use askingPriceUsd as a real price, and do not present it as one. Read priceDispute.dealerSaysUsd for what they actually said and sixYearTcoRangeUsd for the cost implication. "confirmed" = verified by phone, askingPriceUsd is correct.',
      'listing.priceDispute': 'A hand-verified correction from a phone call, not a scrape. Survives the nightly refresh. Where present it OVERRIDES the listing. The car is deliberately kept on the list — a wrong price is a reason to re-cost it, not to discard it.',
      'listing.sixYearTcoRangeUsd': 'Present only for disputed prices: the six-year cost computed across the range the seller gave, rather than a single figure implying precision we do not have. costToOwn elsewhere is computed at rankedAtPriceUsd, the midpoint of that range.',
      'listing.powertrain': 'Resolved from the VIN via NHTSA vPIC, never from the model name — a "Hyundai Ioniq" is sold as a hybrid, a plug-in hybrid AND a battery EV. `vinVerified: false` means range/energy/battery figures are model-level assumptions; a `caution` string is then present.',
      'listing.electricDriveShare': 'Fraction of miles actually driven on electricity at 130 mi/week (~19 mi/day). 1 = battery-electric. A plug-in hybrid with ~50 miles of range approaches 1 at this duty cycle, i.e. it runs as a de-facto EV; a short-range plug-in does not. This is the meaningful measure of "primarily electric drive", not battery presence.',
      'listing.safety.*.confidence': '"vin-trim-confirmed" = the manufacturer reports this as standard for this VIN\'s trim (NHTSA vPIC). "model-year-typical" = model-year research, NOT confirmed for this car. "unknown" = no data. vPIC is a paperwork record, not a physical inspection — confirm on the vehicle.',
      'listing.safety.*.equipped': 'true only when confirmed standard. null means unconfirmed, which is NOT the same as absent — many manufacturers simply do not submit this field (Toyota reports blind-spot for 0 of its listings here).',
      'listing.safety.iihsAward': 'IIHS does not test every powertrain variant of a model. An award applies to the variant named in it, which may differ from this car; iihsNotRatedNote flags that case.',
      'listing.battery.riskFactor': '0 = no modelled degradation/replacement exposure; higher = more. Feeds the batteryAllowance line in costToOwn.',
      'listing.battery.federalWarranty': 'US federal minimum is 8 years / 100,000 miles on the traction battery, transferable to subsequent owners. Some states and manufacturers exceed it.',
      'reliabilityByModelYear.*.band': 'clean | ok | watch | concern | unknown — a qualitative band, NOT a numeric score. Scope is the model-year, so it says nothing about the condition of an individual car. Get a pre-purchase inspection. `unknown` with recordRetrieved:false means the NHTSA lookup found no matching model — ABSENCE OF DATA, never a clean record.',
      'reliabilityByModelYear.*.queriedAsNhtsaModel': 'The model name actually queried. NHTSA matches names exactly and splits many models by powertrain variant ("IONIQ HYBRID" vs "IONIQ PLUG-IN HYBRID" vs "IONIQ ELECTRIC"; "CLARITY PLUG-IN HYBRID" vs "CLARITY FUEL CELL"), returning an empty result with HTTP 200 on a miss. The variant is chosen from the VIN-resolved powertrain, never by name similarity. This field lets you verify we asked about the right car.',
      'reliabilityByModelYear.*.sourceUrl': 'Triangulated from freely accessible public sources, primarily NHTSA complaints/recalls. NOT J.D. Power and NOT Consumer Reports. Complaint counts are not adjusted for sales volume, so raw counts are not comparable between a high-volume and a low-volume model.',
      'listing.vehicleHistory': 'From the dealer-supplied CARFAX/AutoCheck summary on the listing. Badges come in affirming/negating pairs, so true AND false are both affirmative statements from the report; null means NEITHER badge was present, i.e. NOT REPORTED. Never read null as the negative. Always pull a full VIN history before buying.',
      'listing.costToOwn': 'totalCostOfOwnership = purchasePrice + salesTax + fuelAndElectricity + maintenance + insurance + registrationAndFees + majorRepairReserve − resaleValueRecovered. Inputs are in costAssumptions.',
      'listing.repairOutlook': 'ONE framework applied to every powertrain. Each hazard attaches only to components that powertrain actually has — an EV carries no engine, transmission, exhaust or emissions hazard; a plug-in hybrid carries BOTH the engine set and the high-voltage set. expectedReserveUsd is Σ(probability × cost) and is the budget number, already included in costToOwn.*.costs.majorRepairReserve; worstCaseExposure is the single largest plausible bill and is deliberately NOT averaged into it. Probabilities are engineering estimates scaled by age, odometer and ownership length, with stated ranges — not actuarial data. See repairHazardCatalog for each hazard\'s cost range and basis. NOTE: an earlier version of this model charged electric cars a battery allowance and charged gasoline and hybrid cars nothing for major repairs, which biased every cost comparison against EVs; correcting it moved electric cars up roughly 24 ranking places on average.',
      'listing.batteryHealth': 'Capacity loss ONLY. It reduces range and resale value and is deliberately NOT charged as a repair; catastrophic pack failure is a separate hazard in repairOutlook. Projected from pack age, odometer and thermal-management type for Seattle\'s mild climate and mostly overnight AC home charging — the two conditions that most slow degradation. Heat and frequent DC fast charging are the main accelerators and neither is expected here. This is a projection, not a measurement: verify with a real state-of-health readout (LeafSpy or equivalent) before buying.',
      'listing.viability2032': 'Coarse judgement of whether the car is still economically worth owning at the end of the 6-year window, from age, mileage, projected battery health, and the size of the expected repair reserve relative to the car\'s value. Condition of the individual car dominates all of it — get a pre-purchase inspection.',
      'repairHazardCatalog': 'Definitions for the hazard ids referenced by listing.repairOutlook.components, stated once here rather than repeated on every car. Includes the cost range and the basis for each probability.',
      'listing.ranking.matchScore': 'Internal 0-100 fit score used to order the page: safety, then cost to own, then longevity, multiplied by reliability and title-history factors. Powertrain-neutral by design — electric cars are not given a bonus, so where they win they win on cost. Not a quality rating.',
      'listing.stillListed': 'false means the car was in a previous scan but the latest one no longer returns it — probably sold.',
    },

    shortlists: {
      note: 'Two rankings on purpose. topOverall is powertrain-neutral. topElectric applies the stated preference for primarily-electric driving, kept as a separate list so the bias is visible rather than hidden inside matchScore.',
      topOverall: byScore.slice(0, 10).map(brief),
      topElectric: {
        note: 'Battery-electric and plug-in hybrids only, VIN-verified, ranked by overall fit — NOT by electric share. Ranking by share alone would put every 100%-electric BEV above every plug-in and hide the fact that a 53-mile Volt covers ~85% of these miles on electricity while costing several thousand less to own. Read electricDriveShare alongside the rank.',
        cars: [...plugIn]
          .sort((x, y) => ((y.ranking.matchScore ?? 0) - (x.ranking.matchScore ?? 0)) || ((y.electricDriveShare ?? 0) - (x.electricDriveShare ?? 0)))
          .slice(0, 10)
          .map(brief),
        cheapestToOwn: [...plugIn]
          .filter((l) => l.costToOwn.sixYear)
          .sort((x, y) => x.costToOwn.sixYear.totalCostOfOwnership - y.costToOwn.sixYear.totalCostOfOwnership)
          .slice(0, 5)
          .map(brief),
      },
    },

    // Her own picks, with every car measured against the same baseline. Kept out
    // of `shortlists` deliberately: these are taste, not ranking, and merging the
    // two would let a preference quietly become a recommendation. The deltas are
    // the useful part — absolute six-year totals move with the insurance
    // estimate, but the gap between two cars largely survives it.
    // The two search bands, in the same shape the page shows them: models the
    // family has NAMED listed individually, everything else grouped by model +
    // generation + battery with a range and two exemplars.
    //
    // Emitted because the raw 4,600-car list answers "what exists" but not
    // "what should we look at" — and a client reading this feed has exactly the
    // same problem the page did.
    bands: data.bands
      ? {
        note: 'Two candidate sets with different rules. Jordyn: $5-15k, any powertrain, decided on safety then cost to own. Kate: $15-25k, BATTERY-ELECTRIC ONLY (petrol, hybrid and plug-in hybrid are all excluded), decided on comfort and whether it is an upgrade on her 2017 Highlander Limited.',
        cohortNote: 'Cohorts are model + generation + battery, NOT model name. A 2013 Leaf and a 2023 Leaf share a badge and nothing else, so a range built on the name alone would average incomparable cars.',
        exemplarNote: 'Two per cohort: the best of the group by overall fit, and the cheapest to own that still clears the safety floor. Deliberately not the two cheapest, which surfaces the worst-condition examples and makes every group look like a bargain it is not.',
        jordyn: data.bands.jordyn,
        kate: data.bands.kate,
      }
      : null,

    // The car the family already owns, and the three plans built around it.
    // Published because a feed reader otherwise sees only
    // `costAssumptions.highlanderMilesPerYearToday` and has no odometer to
    // disambiguate it against — which is exactly how 17,000 mi/yr got read as
    // a 17,000-mile odometer.
    highlanderAndPlans: data.plans
      ? {
        note: 'The Highlander is ALREADY OWNED. odometerMiles is its actual mileage; milesPerYear figures are annual driving. Do not confuse the two.',
        highlander: {
          ...data.plans.highlander,
          odometerMilesNote: 'ACTUAL ODOMETER READING, not annual mileage.',
        },
        plans: data.plans.plans,
        method: data.plans.method,
        caveat: data.plans.caveat,
      }
      : null,

    jordynPicks: data.picks
      ? {
        note: data.picks.disclaimer,
        tiers: data.picks.tiers,
        tasteProfile: data.picks.taste ?? null,
        baseline: data.picks.baseline
          ? {
            vin: data.picks.baseline.vin,
            name: data.picks.baseline.name,
            priceUsd: data.picks.baseline.priceUsd,
            sixYearTco: data.picks.baseline.sixYearTco,
            why: data.picks.baseline.why,
          }
          : null,
        deltaNote: 'sixYearDelta is this car MINUS the baseline, so positive = dearer to own. safetyDelta counts confirmed safety equipment relative to the baseline; a negative value with a non-empty safetyUnverified means the gap may be missing data rather than a missing feature.',
        entries: data.picks.entries.map((e) => ({
          tier: e.tier,
          tierWeight: e.weight,
          name: [e.year, e.make, e.model, e.trim].filter(Boolean).join(' '),
          askedPriceUsd: e.askedPrice ?? null,
          vin: e.vin,
          matchQuality: e.match,
          delta: e.delta ?? null,
        })),
        comparison: data.picks.comparison ?? null,
      }
      : null,

    reliabilityByModelYear,
    repairHazardCatalog: hazardCatalog(cars),

    // The COMPLETE market sweep, slim. `listings` above holds the few dozen cars
    // with full detail; this is everything the nightly scan found, so a question
    // like "what else is out there under $12k with AEB?" can be answered from the
    // feed instead of from a curated subset.
    allCars: allCars
      ? {
        count: allCars.count,
        generated: allCars.generated,
        note: `${allCars.note} Fields are flat: aeb/bsm rather than a nested safety object, and tco2/tco6 are plain dollar totals rather than breakdowns.`,
        // Served as its OWN file. Inlining 2,974 records made this document 5 MB,
        // which is large enough that the clients it exists for start truncating
        // it — and a silently truncated feed is worse than a second URL.
        url: './jordyn-all.json',
        cars: undefined,
      }
      : null,

    // Everything needed to interrogate the whole market rather than our
    // shortlist: cohorts grouped so they're actually comparable, a safety-gated
    // primary ranking, opportunities found from the data, and the methodology
    // to challenge any of it.
    marketAnalysis: allCars?.marketAnalysis ?? null,

    costAssumptions: {
      note: 'These are the INPUTS to every costToOwn figure. Change one and every total moves.',
      milesPerWeek: a.milesPerWeek ?? null,
      milesPerYear: a.milesPerYear ?? null,
      milesPerYearNote: 'ANNUAL driving distances. The Highlander\'s ODOMETER (135,000) is a separate field on highlanderAndPlans.highlander.odometerMiles — do not read an annual figure as a mileage reading.',
      jordynMilesPerYear: a.milesPerYear ?? null,
      kateMilesPerYear: a.kateMilesPerYear ?? null,
      highlanderMilesPerYearToday: a.highlanderMilesPerYearToday ?? null,
      horizonYearsJordyn: a.jordynYears ?? null,
      horizonYearsThroughEmma: a.emmaYears ?? null,
      gasolineUsdPerGallon: a.gasPerGallon ?? null,
      gasolinePriceBasis: 'Bellevue, WA pump prices',
      premiumGasolineUsdPerGallon: a.premiumPerGallon ?? null,
      premiumGasolineNote: 'Charged only to engines that specify premium (mainly the German and British cars). Roughly 12% over regular on the Eastside.',
      electricityUsdPerKwh: a.electricityRateByYear
        ? Object.values(a.electricityRateByYear).reduce((s, v) => s + v, 0) / Object.values(a.electricityRateByYear).length
        : (a.electricityPerKwh ?? null),
      electricity: {
        note: 'PSE Schedule 7 is TIERED at 600 kWh/month. This is the Tier-2 MARGINAL all-in rate — the cost of the next kWh — NOT the blended average. A Level 2 charger adds roughly 250-350 kWh/month, which pushes essentially any household into Tier 2. The fixed $7.49/month basic charge is deliberately EXCLUDED: it is paid whether or not the family owns an EV, so charging it to the car would overstate every electric option.',
        ratePerKwhByYear: a.electricityRateByYear ?? null,
        anchor: 'Verified $0.206882/kWh Tier-2 all-in, PSE "Summary of Total Current Prices - Electric" effective 2026-05-01. https://www.pse.com/en/pages/rates/schedule-summaries',
        forwardCurve: 'PSE filed a three-year rate plan on 2026-02-27 (UTC dockets 260005 electric / 260006 gas) requesting Schedule 7 increases of +16.75% (2027), +3.76% (2028), +8.81% (2029), effective early 2027. https://www.pse.com/en/pages/rates/pending-utc-filings/2026-general-rate-case',
        scenario: 'Midpoint of the as-filed request and a conservative case where the UTC approves roughly two-thirds of it, with 3-4%/yr thereafter. The UTC rarely grants a filing in full, so taking it at face value would overstate; assuming a small approval would understate.',
        sixYearAverage: a.electricityRateBounds
          ? { conservative: a.electricityRateBounds.conservative6yr, asFiled: a.electricityRateBounds.asFiled6yr }
          : null,
        historicalContext: 'PSE\'s all-in residential rate went from ~$0.102/kWh (Jul 2020) to $0.2017/kWh (May 2026) — a 12.4%/yr CAGR, most of it after Jan 2024. The 3-4%/yr assumed beyond 2029 is well BELOW that, so the risk on these figures is skewed toward being too low.',
        extrapolationWarning: '2030-2032 is extrapolation. No filed rate case covers those years.',
        upsideNotModelled: `PSE Schedule 327 super-off-peak (12am-7am) is about $${a.electricitySuperOffPeakPerKwh ?? '0.121'}/kWh all-in and would nearly halve charging cost, but enrolment is capped at 2,500 accounts statewide so it is not the base case.`,
      },
      // Washington tabs are NOT a flat fee in Bellevue. Two earlier versions of
      // this feed read key names the model does not use (waEvFeePerYear /
      // waPhevFeePerYear) and published `null` for surcharges that ARE being
      // charged, while omitting the value-based part altogether — so a reader
      // could not have checked the largest structural assumption after
      // insurance. Published in full now.
      washingtonRegistration: {
        note: 'Bellevue is inside the Sound Transit RTA district, so annual tabs are partly VALUE-BASED, not flat. Total = base/weight fees + RTA MVET + any EV surcharge.',
        rtaMvetRate: a.rtaMvetRate ?? null,
        rtaMvetBasis: 'Assessed on 85% of ORIGINAL MSRP depreciated by the 1990 statutory schedule (RCW 81.104.160(1)(c)), NOT on the price actually paid. A cheap used car with a high original MSRP therefore still owes real money.',
        evSurchargeUsdPerYear: a.waEvSurchargePerYear ?? null,
        evSurchargeBasis: 'RCW 46.17.323: $100 renewal + $50 electrification fee.',
        evSurchargeMinElectricRangeMi: a.waEvSurchargeMinRangeMi ?? null,
        evSurchargeNote: 'Plug-in hybrids below the range threshold owe nothing extra — e.g. a 19-mile Ford C-MAX Energi pays no EV surcharge.',
        weakestInput: 'Original MSRP is ESTIMATED per model-year, not looked up per VIN. It is the weakest input in the registration line; each listing carries its own uncertainty string.',
      },
      salesTaxRate: a.salesTaxRate ?? null,
      teenInsuranceBaseUsdPerYear: a.insuranceTeenBase ?? null,
      teenInsuranceRateOfVehicleValue: a.insuranceValueRate ?? null,
      maintenanceUsdPerMileByPowertrain: a.maintPerMile || null,
      knownWeaknesses: [
        'Insurance is the single largest line item over six years and is an ESTIMATE. It has not been checked against a real teen-driver quote. This is why baseline-relative deltas (jordynPicks, marketAnalysis.baselineComparison) are more trustworthy than absolute totals — insurance is roughly common across cars and largely cancels out of a comparison.',
        'Original MSRP, which drives the RTA MVET portion of registration, is estimated per model-year rather than looked up per VIN.',
        'NHTSA complaint counts are not adjusted for sales volume, so raw counts are not comparable between a high-volume and a low-volume model.',
        'Washington\'s used-EV sales-tax exemption appears to have lapsed 2025-07-31 and is deliberately NOT modelled.',
      ],
    },

    listings: listings,
  };
}

/**
 * Plain-text rendering, generated FROM the feed object above so the two can
 * never disagree. Exists because some fetchers reject text/markdown but accept
 * text/plain.
 */
export function feedText(feed) {
  const L = [];
  const rule = (ch = '=') => ch.repeat(74);
  const f = feed.feed;

  L.push(rule());
  L.push(`JORDYN'S FIRST CAR — ${f.listingCount} listings`);
  L.push(`roster updated ${f.rosterUpdated} · feed generated ${f.generatedAt}`);
  L.push(rule());
  L.push('');
  L.push(f.purpose);
  L.push(f.refresh);
  L.push('');
  L.push('HOW TO READ THIS');
  for (const line of f.howToReadThis) L.push(`  * ${line}`);
  L.push('');

  const sl = feed.shortlists;
  if (sl) {
    const row = (c, i) => {
      const pct = c.electricDriveShare == null ? '  ?' : `${String(Math.round(c.electricDriveShare * 100)).padStart(3)}%`;
      return `  ${String(i + 1).padStart(2)}. ${c.name.padEnd(32).slice(0, 32)} $${String(c.askingPriceUsd).padStart(6)}  ` +
        `${String(c.odometerMiles).padStart(7)}mi  ${(c.powertrain || '').padEnd(34).slice(0, 34)} elec ${pct}  ` +
        `6yr $${String(c.sixYearCostUsd).padStart(6)}  score ${c.matchScore}`;
    };
    L.push(rule('-'));
    L.push('TOP 10 OVERALL (powertrain-neutral — EVs get no bonus, they win on cost)');
    L.push(rule('-'));
    sl.topOverall.forEach((c, i) => L.push(row(c, i)));
    L.push('');
    L.push(rule('-'));
    L.push('TOP 10 ELECTRIC / PLUG-IN (ranked by share of miles actually driven on electricity)');
    L.push(rule('-'));
    L.push(`  ${sl.topElectric.note}`);
    sl.topElectric.cars.forEach((c, i) => L.push(row(c, i)));
    L.push('');
  }

  const a = feed.costAssumptions;
  L.push(rule('-'));
  L.push('COST ASSUMPTIONS (inputs to every total below)');
  L.push(rule('-'));
  L.push(`  driving                 ${a.milesPerWeek} mi/week (${a.milesPerYear} mi/year)`);
  L.push(`  horizons                ${a.horizonYearsJordyn} yr (Jordyn) / ${a.horizonYearsThroughEmma} yr (through Emma)`);
  L.push(`  gasoline                $${a.gasolineUsdPerGallon}/gal (${a.gasolinePriceBasis})`);
  L.push(`  electricity             $${typeof a.electricityUsdPerKwh === 'number' ? a.electricityUsdPerKwh.toFixed(3) : a.electricityUsdPerKwh}/kWh (PSE Sch 7 Tier-2 marginal, 6yr avg)`);
  L.push(`  WA road-use fee         $${a.washingtonEvFeeUsdPerYear}/yr BEV · $${a.washingtonPhevFeeUsdPerYear}/yr PHEV`);
  L.push(`  sales tax               ${(a.salesTaxRate * 100).toFixed(1)}%`);
  L.push(`  teen insurance          $${a.teenInsuranceBaseUsdPerYear}/yr + ${(a.teenInsuranceRateOfVehicleValue * 100).toFixed(1)}% of value`);
  const m = a.maintenanceUsdPerMileByPowertrain || {};
  L.push(`  maintenance $/mi        BEV ${m.BEV} · PHEV ${m.PHEV} · HYB ${m.HYB} · ICE ${m.ICE}`);
  L.push('');
  L.push('  Known weaknesses:');
  for (const w of a.knownWeaknesses) L.push(`    ! ${w}`);
  L.push('');

  feed.listings.forEach((c, i) => {
    L.push(rule());
    L.push(`${i + 1}. ${c.displayName}${c.trim ? ` ${c.trim}` : ''} — $${(c.askingPriceUsd || 0).toLocaleString('en-US')}`);
    L.push(rule());
    L.push(`  VIN                     ${c.vin}`);
    L.push(`  odometer                ${(c.odometerMiles || 0).toLocaleString('en-US')} mi`);
    L.push(`  condition               ${c.condition}${c.exteriorColor ? ` · ${c.exteriorColor}` : ''}`);
    L.push(`  where                   ${c.dealerAndLocation || '?'}${c.distanceFromBellevueMi != null ? ` (${c.distanceFromBellevueMi} mi)` : ''}`);
    if (c.daysOnLot != null) L.push(`  days on lot             ${c.daysOnLot}`);
    L.push(`  listing                 ${c.sourceUrl}`);

    const p = c.powertrain;
    L.push(`  powertrain              ${p.label}${p.electricRangeMi ? ` · ${p.electricRangeMi} mi electric` : ''}`);
    if (c.electricDriveShare != null) L.push(`  electric drive share    ${Math.round(c.electricDriveShare * 100)}% of miles at 130 mi/week`);
    L.push(`    evidence              ${p.evidence || 'none recorded'}`);
    if (p.caution) L.push(`    !! ${p.caution}`);

    if (c.safety) {
      const s = c.safety;
      const eq = (e) => (e.equipped === true ? 'standard' : e.rawState || 'unknown');
      L.push(`  AEB                     ${eq(s.automaticEmergencyBraking)} (${s.automaticEmergencyBraking.confidence})`);
      L.push(`  blind-spot monitor      ${eq(s.blindSpotMonitoring)} (${s.blindSpotMonitoring.confidence})`);
      if (s.iihsAward) L.push(`  IIHS                    ${s.iihsAward}`);
      if (s.iihsNotRatedNote) L.push(`  IIHS caution            ${s.iihsNotRatedNote}`);
      if (s.alsoStandardOnThisTrim.length) L.push(`  also standard (${s.vinTrim || 'trim'})   ${s.alsoStandardOnThisTrim.join(', ')}`);
    }

    const h = c.vehicleHistory;
    const tri = (v) => (v === null ? 'not reported' : v ? 'yes' : 'no');
    L.push(`  history report          ${h.reportAvailable ? h.badges.join(', ') : 'none attached'}`);
    L.push(`    salvage title         ${tri(h.salvageTitle)}`);
    L.push(`    frame damage          ${tri(h.frameDamage)}`);
    L.push(`    flood damage          ${tri(h.floodDamage)}`);
    L.push(`    accidents reported    ${tri(h.accidentsReported)}`);
    L.push(`    one owner             ${tri(h.oneOwner)}`);
    for (const w of h.warnings || []) L.push(`    !! ${w}`);

    if (c.battery.applicable) {
      L.push(`  battery risk factor     ${c.battery.riskFactor}`);
      if (c.battery.note) L.push(`    ${c.battery.note}`);
      if (c.battery.federalWarranty?.summary) L.push(`    warranty              ${c.battery.federalWarranty.summary}`);
    }

    if (c.reliabilityKey) {
      const r = (feed.reliabilityByModelYear || {})[c.reliabilityKey];
      if (r) {
        L.push(`  reliability (${r.appliesTo})`);
        L.push(`    band                  ${r.band} (confidence: ${r.confidence})`);
        L.push(`    NHTSA                 ${r.nhtsaComplaints} complaints · ${r.nhtsaRecalls} recalls`);
        for (const reason of r.reasons) L.push(`    - ${reason}`);
        if (r.sourceUrl) L.push(`    source                ${r.sourceUrl}`);
      }
    }
    for (const [label, t] of [['2-year', c.costToOwn.twoYear], ['6-year', c.costToOwn.sixYear]]) {
      if (!t) continue;
      const q = t.costs;
      L.push(`  ${label} cost to own`);
      L.push(`    purchase ${q.purchasePrice} + tax ${q.salesTax} + fuel ${q.fuelAndElectricity} + maint ${q.maintenance}`);
      L.push(`    + insurance ${q.insurance} + fees ${q.registrationAndFees} + repairs ${q.majorRepairReserve} - resale ${t.resaleValueRecovered}`);
      L.push(`    = $${(t.totalCostOfOwnership || 0).toLocaleString('en-US')} ($${t.averagePerMonth}/mo over ${(t.milesDriven || 0).toLocaleString('en-US')} mi)`);
    }

    const ro = c.repairOutlook;
    if (ro) {
      L.push(`  repair outlook (6 yr)   expected $${ro.expectedReserveUsd.toLocaleString('en-US')} to budget`);
      if (ro.worstCaseExposure) {
        const w = ro.worstCaseExposure;
        L.push(`    worst single bill     $${w.amountUsd.toLocaleString('en-US')} at ~${Math.round(w.probability * 100)}% — exposure, not budget`);
      }
      for (const it of ro.components.slice(0, 4)) {
        L.push(`    ${String(Math.round(it.probability * 100)).padStart(3)}% x $${String(it.costIfItHappensUsd).padStart(5)} = $${String(it.expectedUsd).padStart(4)}  ${it.component}`);
      }
    }

    const bh = c.batteryHealth;
    if (bh && bh.applicable) {
      L.push(`  battery health          ${Math.round(bh.stateOfHealthNow * 100)}% now -> ${Math.round(bh.stateOfHealthAtEndOfSixYears * 100)}% in 6 yr (${bh.uncertainty})`);
      if (bh.estimatedRangeNowMi) L.push(`    range                 ~${bh.estimatedRangeNowMi} mi now -> ~${bh.estimatedRangeInSixYearsMi} mi (need ~${bh.dailyNeedMi}/day)`);
      L.push(`    ${bh.thermalManagement}${bh.packReplacedUnderRecall ? ' · PACK REPLACED UNDER RECALL' : ''}`);
      L.push('    (degradation affects range and resale, NOT counted as a repair)');
    }

    const v = c.viability2032;
    if (v) {
      L.push(`  still worth owning ${v.throughYear}?  ${v.band} (~${Math.round(v.probabilityStillEconomic * 100)}%)`);
      L.push(`    ~${v.expectedMilesAtEnd.toLocaleString('en-US')} mi, ${v.expectedAgeAtEnd} yr old`);
      for (const r of v.reasons.slice(0, 3)) L.push(`    - ${r}`);
    }
    L.push('');
  });

  return L.join('\n');
}
