// car-access.mjs — the two alternate ways into a car roster, shared by both builds.
//
// The primary access path is unchanged: a long random key in the URL fragment
// (`cars.html#k=…`). That is what the Share button hands out and it stays the
// default. This module adds the two things a fragment key cannot do:
//
//  1. PASSPHRASE  — a short, sayable phrase you can read down a phone line.
//     We do NOT re-encrypt the roster under it. Instead we publish a tiny second
//     blob (`data/<name>.unlock.json`) that contains the REAL key encrypted under
//     the passphrase. Type the phrase, the page unwraps the key, then decrypts the
//     roster exactly as before. Consequences that make this the right shape:
//       · the roster is still encrypted once, under one strong key
//       · the passphrase can be rotated without touching the roster bundle
//       · every link already shared keeps working
//
//  2. FEED  — a PLAINTEXT copy at an unguessable path, for programs that cannot
//     run JavaScript. This is the only thing that helps a server-side fetcher
//     (an LLM tool, curl, a script): such a client GETs the URL and gets raw
//     bytes. It never executes car-common.js, never receives the `#fragment`
//     (browsers do not send fragments to servers), and cannot type a passphrase
//     or run WebCrypto. Handing it the page URL yields an empty shell.
//
// SECURITY TRADEOFF, stated plainly: the feed is NOT encrypted. Its privacy is
// the unguessable path alone — a capability URL. Anyone who obtains the URL can
// read the roster, and unlike the key you cannot revoke it by leaving the data
// in place; you rotate the token, which changes the URL. That is an acceptable
// trade for used-car listings scraped from public inventory, and a bad one for
// anything genuinely sensitive. Do not put tickets, contacts, or documents here.

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { webcrypto as crypto } from 'node:crypto';

const subtle = crypto.subtle;
const enc = new TextEncoder();
const b64 = (u8) => Buffer.from(u8).toString('base64');

// Deliberately slower than the roster's 250k. This blob guards a passphrase with
// far less entropy than a 192-bit random key, so it buys back the difference by
// making each guess expensive. It is a few hundred bytes decrypted once.
export const UNLOCK_ITERATIONS = 600000;

// Short, unambiguous, easy to say out loud and hard to mishear. No words that
// sound alike (no "bear"/"bare"), nothing that needs spelling.
const WORDS = (
  'amber anchor apple arrow autumn bacon badge bamboo basil beacon birch bishop bison blossom bramble' +
  ' brass bridge bronze butter cactus camel canyon carbon cedar cellar chalk cherry chimney cinder citrus' +
  ' clover cobalt comet copper coral cotton cricket crimson crystal cypress daisy delta denim domino' +
  ' dragon dusty ember fable falcon fennel fern fiddle flannel flint forest fossil garnet ginger glacier' +
  ' granite gravel harbor harvest hazel heron hickory hollow indigo ivory jasmine juniper kettle lantern' +
  ' lemon lily linen lobster lotus lumber maple marble meadow mellow mesa mint mitten mosaic nectar' +
  ' nickel north nutmeg oak olive onyx opal orbit otter oyster paprika pebble pepper pewter pine' +
  ' pistol plum pocket pollen poppy prairie pumpkin quartz quilt radish rapid raven ribbon river rocket' +
  ' rosemary saffron sage salmon sandal sequoia shadow silver spruce sugar summit sunset thistle timber' +
  ' topaz tulip velvet walnut willow window winter'
).split(/\s+/).filter(Boolean);

/**
 * Fold what a human typed onto what we encrypted under, so "Otter Cedar Rapid"
 * and "otter-cedar-rapid" are the same secret. The page MUST apply the identical
 * transform — see normalizePass() in car-common.js. If the two ever drift, the
 * passphrase silently stops working while the key still does, which is exactly
 * the kind of half-broken state that goes unnoticed.
 */
export function normalizePass(s) {
  return String(s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function newPassphrase(words = 5) {
  if (WORDS.length < 128) throw new Error(`wordlist shrank to ${WORDS.length} — entropy assumption broken`);
  const out = [];
  // Rejection-sample so every word is equally likely. Plain `% len` would bias
  // toward the front of the list.
  const limit = 256 - (256 % WORDS.length);
  while (out.length < words) {
    const [b] = crypto.getRandomValues(new Uint8Array(1));
    if (b >= limit) continue;
    out.push(WORDS[b % WORDS.length]);
  }
  return out.join('-');
}

export function newToken(bytes = 16) {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString('hex');
}

/**
 * Read a secret from env → file → generate, and persist it so the value stays
 * STABLE across rebuilds. Same contract as the roster keys: a rebuild must never
 * silently invalidate something already shared.
 */
export function resolveSecret({ file, env, rotate, generate, minLength = 8, label }) {
  const fromEnv = env && process.env[env] && process.env[env].trim();
  if (fromEnv && fromEnv.length >= minLength) {
    return { value: fromEnv, source: `env ${env}`, fresh: false };
  }
  if (existsSync(file) && !rotate) {
    const v = readFileSync(file, 'utf8').trim();
    if (v.length >= minLength) return { value: v, source: `${label} (existing)`, fresh: false };
  }
  const v = generate();
  writeFileSync(file, v + '\n', 'utf8');
  return { value: v, source: rotate ? `${label} (ROTATED — old ones now dead)` : `${label} (new)`, fresh: true };
}

/**
 * Wrap the roster's real key under the passphrase.
 * The plaintext here is the key STRING, so the page can feed it straight into the
 * existing decrypt path without a second code path for "passphrase mode".
 */
export async function buildUnlockBlob(realKey, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const km = await subtle.importKey('raw', enc.encode(normalizePass(passphrase)), 'PBKDF2', false, ['deriveKey']);
  const key = await subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: UNLOCK_ITERATIONS, hash: 'SHA-256' },
    km, { name: 'AES-GCM', length: 256 }, false, ['encrypt'],
  );
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(realKey)));
  return {
    v: 1,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: UNLOCK_ITERATIONS },
    salt: b64(salt), iv: b64(iv), ct: b64(ct),
  };
}

/**
 * Write the plaintext feed under feed/<token>/ and remove any older token
 * directories. Leaving a stale directory behind would keep a rotated — that is,
 * REVOKED — URL serving data, which is the one thing rotation exists to prevent.
 *
 * `files` maps extension → content. Multiple formats exist because fetchers are
 * picky about Content-Type: GitHub Pages serves .md as `text/markdown`, which
 * some readers (ChatGPT's among them) refuse outright. `.json` and `.txt` get
 * `application/json` and `text/plain`, which everything accepts.
 */
export function writeFeed({ root, token, name, files }) {
  const feedRoot = join(root, 'feed');
  mkdirSync(feedRoot, { recursive: true });
  const exts = Object.keys(files);

  for (const entry of readdirSync(feedRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === token) continue;
    const dir = join(feedRoot, entry.name);
    // Only clear OUR roster's files — the other roster keeps its own token dir.
    const mine = readdirSync(dir).filter((f) => f.startsWith(`${name}.`));
    if (!mine.length) continue;
    for (const f of mine) rmSync(join(dir, f), { force: true });
    if (readdirSync(dir).length === 0) rmSync(dir, { recursive: true, force: true });
  }

  const dir = join(feedRoot, token);
  mkdirSync(dir, { recursive: true });
  const written = [];
  for (const ext of exts) {
    const body = typeof files[ext] === 'string' ? files[ext] : JSON.stringify(files[ext], null, 2);
    const p = join(dir, `${name}.${ext}`);
    writeFileSync(p, body, 'utf8');
    written.push(p);
  }
  return { dir, written };
}
