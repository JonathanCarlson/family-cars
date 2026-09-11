import test from 'node:test';
import assert from 'node:assert/strict';
import { feedMarkdown } from './feed-markdown.mjs';

test('Markdown embeds the exact canonical JSON feed without dropping fields', () => {
  const feed = {
    feed: { name: 'test-cars', schemaVersion: '1.8', rosterUpdated: '2026-09-10', listingCount: 1, purpose: 'test' },
    shortlists: { topBargains: { cars: [{ vin: 'A', score: 91 }] } },
    listings: [{ vin: 'A', shippingEstimateUsd: 2000, kateResearch: { riskGate: 'VIN_GATE' } }],
  };
  const markdown = feedMarkdown(feed);
  const payload = markdown.match(/```json\n([\s\S]+)\n```\n?$/);
  assert.ok(payload, 'complete JSON block should be present');
  assert.deepEqual(JSON.parse(payload[1]), feed);
});
