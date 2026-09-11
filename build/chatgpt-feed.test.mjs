import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHATGPT_FEED_FILES,
  MAX_MARKDOWN_BYTES,
  buildChatGptMarkdownFiles,
  compatibilityMarkdown,
} from './chatgpt-feed.mjs';

function car(index, over = {}) {
  return {
    vin: `TESTVIN${String(index).padStart(10, '0')}`,
    label: `2023 Test Model ${index % 50}`,
    year: 2023,
    make: 'Test',
    model: `Model ${index % 50}`,
    trim: 'Premium',
    price: 20000 + index,
    miles: 30000 + index,
    power: index % 2 ? 'BEV' : 'ICE',
    evRange: index % 2 ? 260 : null,
    matchScore: 90 - (index % 20),
    bargain: { score: 85 - (index % 20), riskGate: null },
    byDriver: {
      jordyn: { sixYearUsd: 30000 + index },
      kate: { sixYearUsd: 34000 + index },
    },
    location: 'Test Dealer, Bellevue WA',
    distanceMi: 5,
    url: `https://example.test/${index}`,
    accidents: false,
    salvage: false,
    ...over,
  };
}

test('split feed emits every requested Markdown file below 2 MiB', () => {
  const cars = Array.from({ length: 120 }, (_, index) => car(index));
  const result = buildChatGptMarkdownFiles({
    data: { cars: cars.slice(0, 30) },
    allCars: { count: cars.length, cars },
    feed: {
      feed: {
        generatedAt: '2026-09-10T00:00:00Z',
        rosterUpdated: '2026-09-10',
        listingCount: 30,
        discovery: 'PNW first.',
        budget: { note: 'Budget note.' },
      },
    },
    publicBase: 'https://example.test',
    token: 'token',
  });
  assert.deepEqual(Object.keys(result.files).sort(), [...CHATGPT_FEED_FILES].sort());
  assert.equal(result.counts['shortlist.md'], 80);
  for (const body of Object.values(result.files)) assert.ok(Buffer.byteLength(body) < MAX_MARKDOWN_BYTES);
});

test('listing export contains the requested decision fields and omits photos', () => {
  const target = car(1, {
    label: '2023 Polestar Polestar 2',
    make: 'Polestar',
    model: 'Polestar 2',
    awd: true,
    inventoryScope: 'national-fallback',
    shippingUsd: 2000,
    localCandidateCount: 1,
  });
  const result = buildChatGptMarkdownFiles({
    data: { cars: [target] },
    allCars: { count: 1, cars: [target] },
    feed: {
      feed: {
        generatedAt: '2026-09-10T00:00:00Z',
        rosterUpdated: '2026-09-10',
        listingCount: 1,
        discovery: 'PNW first.',
        budget: { note: 'Budget note.' },
      },
    },
    publicBase: 'https://example.test',
    token: 'token',
  });
  const markdown = result.files['polestar-2.md'];
  for (const label of ['Price', 'Mileage', 'Location / distance', 'Dealer', 'VIN', 'Direct listing', 'Scores', '6-year TCO', 'Drivetrain / range', 'Important options', 'Accident / title history', 'Recall / service flags', 'Risk notes']) {
    assert.ok(markdown.includes(`**${label}:**`), `missing ${label}`);
  }
  assert.match(markdown, /\$2,000 shipping/);
  assert.match(markdown, /### 1\. 2023 Polestar 2 Premium/);
  assert.match(markdown, /Long Range Dual Motor/);
  assert.doesNotMatch(markdown, /Polestar Polestar/);
  assert.doesNotMatch(markdown, /photo/i);
});

test('legacy Markdown URL is a small pointer to the split index', () => {
  const markdown = compatibilityMarkdown('https://example.test', 'token');
  assert.match(markdown, /feed\/token\/index\.md/);
  assert.ok(Buffer.byteLength(markdown) < 2048);
});
