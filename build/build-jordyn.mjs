// build-jordyn.mjs — build the standalone, shareable browser for Jordyn's car search.
//
// Sibling of build-cars.mjs: encrypts build/jordyn.json into data/jordyn.enc.json
// with an INDEPENDENT "jordyn key" so the link you text grants access to ONLY
// Jordyn's car list — never the itinerary, tickets, contacts, or Kate's list.
//
// The key lives in the URL fragment  jordyn.html#k=<key>  (the #fragment is never
// sent to the server, so it stays client-side) and is persisted to
// build/jordyn-key.txt (GITIGNORED) so the shared URL stays STABLE across rebuilds.
//
// Usage (PowerShell), from the repo root:
//   node build/build-jordyn.mjs            # reuse/create the key, print the URL
//   node build/build-jordyn.mjs --rotate   # generate a BRAND-NEW key (old links die)
//   $env:TRIP_JORDYN_KEY="..."; node build/build-jordyn.mjs   # force a specific key
//
// Crypto matches the app: PBKDF2(SHA-256, 250000) -> AES-GCM-256.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { webcrypto as crypto } from 'node:crypto';
import { buildUnlockBlob, newPassphrase, newToken, resolveSecret, writeFeed } from './car-access.mjs';
import { rosterMarkdown } from './feed-markdown.mjs';
import { rosterFeed, feedText } from './feed-json.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC_JSON = join(__dirname, 'jordyn.json');
const OUT_DIR = join(ROOT, 'data');
const OUT_FILE = join(OUT_DIR, 'jordyn.enc.json');
const UNLOCK_FILE = join(OUT_DIR, 'jordyn.unlock.json');
const KEY_FILE = join(__dirname, 'jordyn-key.txt');
const PASS_FILE = join(__dirname, 'jordyn-pass.txt');
const FEED_FILE = join(__dirname, 'jordyn-feed.txt');

const ITERATIONS = 250000;
const subtle = crypto.subtle;
const enc = new TextEncoder();
const b64 = (u8) => Buffer.from(u8).toString('base64');
const argv = process.argv.slice(2);
const ROTATE = argv.includes('--rotate');
const ROTATE_PASS = ROTATE || argv.includes('--rotate-pass');
const ROTATE_FEED = ROTATE || argv.includes('--rotate-feed');
const PUBLIC_BASE = 'https://jonathancarlson.github.io/family-cars';

function newKey() {
  const raw = crypto.getRandomValues(new Uint8Array(24));
  return Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

let jKey;
let keySource;
if (process.env.TRIP_JORDYN_KEY && process.env.TRIP_JORDYN_KEY.trim().length >= 16) {
  jKey = process.env.TRIP_JORDYN_KEY.trim();
  keySource = 'env TRIP_JORDYN_KEY';
} else if (existsSync(KEY_FILE) && !ROTATE) {
  jKey = readFileSync(KEY_FILE, 'utf8').trim();
  keySource = 'build/jordyn-key.txt (existing)';
} else {
  jKey = newKey();
  writeFileSync(KEY_FILE, jKey + '\n', 'utf8');
  keySource = ROTATE ? 'build/jordyn-key.txt (ROTATED — old links now dead)' : 'build/jordyn-key.txt (new)';
}
if (jKey.length < 16) {
  console.error('❌ Jordyn key too short. Delete build/jordyn-key.txt and re-run, or set TRIP_JORDYN_KEY.');
  process.exit(1);
}

async function deriveKey(salt, usage) {
  const km = await subtle.importKey('raw', enc.encode(jKey), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    km, { name: 'AES-GCM', length: 256 }, false, [usage],
  );
}

async function encryptJsonPayload(obj) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(salt, 'encrypt');
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj))));
  return {
    v: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS },
    salt: b64(salt), iv: b64(iv), ct: b64(ct),
  };
}

if (!existsSync(SRC_JSON)) {
  console.error('❌ build/jordyn.json not found — nothing to build the page from.');
  process.exit(1);
}
const data = JSON.parse(readFileSync(SRC_JSON, 'utf8'));
if (!Array.isArray(data.cars)) {
  console.error('❌ build/jordyn.json has no cars[] array.');
  process.exit(1);
}
data.built = new Date().toISOString();

mkdirSync(OUT_DIR, { recursive: true });
const payload = await encryptJsonPayload(data);
writeFileSync(OUT_FILE, JSON.stringify(payload));

// ── Alternate way in #1: a sayable passphrase ────────────────────────────────
// Wraps the SAME key, so this is additive — every link already texted still works.
const pass = resolveSecret({
  file: PASS_FILE, env: 'TRIP_JORDYN_PASS', rotate: ROTATE_PASS,
  generate: () => newPassphrase(5), minLength: 8, label: 'build/jordyn-pass.txt',
});
writeFileSync(UNLOCK_FILE, JSON.stringify(await buildUnlockBlob(jKey, pass.value)));

// ── Alternate way in #2: a plaintext feed for non-browser clients ────────────
const feed = resolveSecret({
  file: FEED_FILE, env: 'TRIP_JORDYN_FEED', rotate: ROTATE_FEED,
  generate: () => newToken(16), minLength: 16, label: 'build/jordyn-feed.txt',
});
const feedDoc = rosterFeed(data);
writeFeed({
  root: ROOT, token: feed.value, name: 'jordyn',
  files: {
    json: feedDoc,                    // application/json — the canonical contract
    txt: feedText(feedDoc),           // text/plain — same data, rendered from the JSON
    md: rosterMarkdown(data, 'jordyn'),
  },
});

const shareUrl = `${PUBLIC_BASE}/jordyn.html#k=${jKey}`;
const feedUrl = `${PUBLIC_BASE}/feed/${feed.value}/jordyn`;

console.log('');
console.log('🚗  Jordyn\'s car page — bundle built');
console.log(`    key source : ${keySource}`);
console.log(`    cars       : ${data.cars.length}`);
console.log(`    bundle     : data/jordyn.enc.json  (${payload.ct.length} b64 chars)`);
console.log('');
console.log('    SHAREABLE LINK (grants Jordyn\'s car list only):');
console.log(`    ${shareUrl}`);
console.log('');
console.log(`    PASSPHRASE (type it into the page if the link has no #k=) — ${pass.source}:`);
console.log(`    ${pass.value}`);
console.log('');
console.log('    MACHINE-READABLE FEED — plaintext, no JS needed, for server-side fetchers:');
console.log(`    ${feedUrl}.json    ← give THIS to an LLM (application/json)`);
console.log(`    ${feedUrl}.txt     (text/plain — same data, if JSON is rejected)`);
console.log(`    ${feedUrl}.md      (text/markdown — some fetchers refuse this type)`);
console.log('');
