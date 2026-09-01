// car-access.test.mjs — run: node --test build/car-access.test.mjs
//
// The passphrase path has a failure mode with no symptom: if the browser's
// normalizePass() and the build's normalizePass() ever disagree, the `#k=` link
// keeps working perfectly while the passphrase silently stops. Nobody notices
// until someone is standing at a dealership unable to open the list. So these
// tests pin BOTH sides — the build-side function directly, and the browser-side
// copy by extracting it out of car-common.js and running it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { webcrypto as crypto } from 'node:crypto';
import { buildUnlockBlob, newPassphrase, newToken, normalizePass } from './car-access.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const b64ToU8 = (b64) => Uint8Array.from(Buffer.from(b64, 'base64'));

/** Decrypt the unlock blob the same way car-common.js does. */
async function unwrap(blob, phrase) {
  const km = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(normalizePass(phrase)), 'PBKDF2', false, ['deriveKey'],
  );
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: b64ToU8(blob.salt), iterations: blob.kdf.iterations, hash: blob.kdf.hash },
    km, { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
  );
  const buf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToU8(blob.iv) }, key, b64ToU8(blob.ct));
  return new TextDecoder().decode(buf);
}

test('the right passphrase unwraps the real roster key', async () => {
  const key = newToken(24);
  const phrase = newPassphrase(5);
  assert.equal(await unwrap(await buildUnlockBlob(key, phrase), phrase), key);
});

test('a wrong passphrase fails closed rather than returning garbage', async () => {
  const blob = await buildUnlockBlob(newToken(24), 'otter-cedar-rapid-blue-north');
  await assert.rejects(() => unwrap(blob, 'otter-cedar-rapid-blue-south'));
});

test('passphrase is forgiving about case, spacing and punctuation', async () => {
  const key = newToken(24);
  const blob = await buildUnlockBlob(key, 'otter-cedar-rapid-blue-north');
  for (const variant of [
    'otter-cedar-rapid-blue-north',
    'Otter Cedar Rapid Blue North',
    '  OTTER   cedar,rapid; blue.north  ',
    'otter_cedar_rapid_blue_north',
  ]) {
    assert.equal(await unwrap(blob, variant), key, `variant failed: ${JSON.stringify(variant)}`);
  }
});

test('normalizePass does not collapse distinct phrases together', () => {
  assert.notEqual(normalizePass('otter-cedar'), normalizePass('ottercedar'));
  assert.notEqual(normalizePass('otter-cedar'), normalizePass('otter-cedars'));
});

test('the browser copy of normalizePass matches the build copy exactly', async () => {
  // Pull the function out of car-common.js and evaluate it, so a hand-edit to
  // either file that changes behaviour fails here instead of in the field.
  const src = readFileSync(join(ROOT, 'car-common.js'), 'utf8');
  const m = /function normalizePass\(s\) \{[\s\S]*?\n\}/.exec(src);
  assert.ok(m, 'normalizePass() not found in car-common.js');
  const browserNormalize = new Function(`${m[0]}; return normalizePass;`)();

  const cases = [
    'otter-cedar-rapid-blue-north', 'Otter Cedar Rapid', '  MIXED   Case,Here; ok  ',
    'ünïcodé-café', 'trailing---', '---leading', 'a1b2-c3', '', '   ', 'ALLCAPS',
  ];
  for (const c of cases) {
    assert.equal(browserNormalize(c), normalizePass(c), `drift on ${JSON.stringify(c)}`);
  }
});

test('generated passphrases are 5 lowercase words with real entropy', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const p = newPassphrase(5);
    assert.match(p, /^[a-z]+(-[a-z]+){4}$/);
    assert.equal(normalizePass(p), p, 'a generated phrase must already be normalized');
    seen.add(p);
  }
  assert.equal(seen.size, 200, 'generated passphrases repeated — entropy is broken');
});

test('published unlock blobs actually open their published rosters', async (t) => {
  // End-to-end against the real build output: passphrase -> key -> roster.
  for (const [name, passFile] of [['jordyn', 'jordyn-pass.txt'], ['cars', 'cars-pass.txt']]) {
    let phrase, blob, bundle;
    try {
      phrase = readFileSync(join(__dirname, passFile), 'utf8').trim();
      blob = JSON.parse(readFileSync(join(ROOT, 'data', `${name}.unlock.json`), 'utf8'));
      bundle = JSON.parse(readFileSync(join(ROOT, 'data', `${name}.enc.json`), 'utf8'));
    } catch {
      t.diagnostic(`${name}: not built locally, skipping`);
      continue;
    }
    const key = await unwrap(blob, phrase);

    const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), 'PBKDF2', false, ['deriveKey']);
    const dk = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: b64ToU8(bundle.salt), iterations: bundle.kdf.iterations, hash: bundle.kdf.hash },
      km, { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
    );
    const buf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToU8(bundle.iv) }, dk, b64ToU8(bundle.ct));
    const data = JSON.parse(new TextDecoder().decode(buf));
    assert.ok(Array.isArray(data.cars) && data.cars.length > 0, `${name}: roster came back empty`);
  }
});

test("one roster's passphrase cannot open the other roster", async (t) => {
  let jPhrase, cBlob;
  try {
    jPhrase = readFileSync(join(__dirname, 'jordyn-pass.txt'), 'utf8').trim();
    cBlob = JSON.parse(readFileSync(join(ROOT, 'data', 'cars.unlock.json'), 'utf8'));
  } catch {
    t.diagnostic('both rosters not built locally, skipping');
    return;
  }
  await assert.rejects(() => unwrap(cBlob, jPhrase), 'Jordyn\'s passphrase must not unwrap Kate\'s key');
});
