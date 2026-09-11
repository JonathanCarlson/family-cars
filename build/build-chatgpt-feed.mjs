// Rebuild only the plaintext ChatGPT exports. Does not touch encrypted app data.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHATGPT_FEED_FILES,
  buildChatGptMarkdownFiles,
  compatibilityMarkdown,
  writeChatGptMarkdownFiles,
} from './chatgpt-feed.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA = join(__dirname, 'jordyn.json');
const ALL = join(__dirname, 'jordyn-all.json');
const TOKEN = join(__dirname, 'jordyn-feed.txt');
const PUBLIC_BASE = 'https://jonathancarlson.github.io/family-cars';

for (const file of [DATA, ALL, TOKEN]) {
  if (!existsSync(file)) throw new Error(`required feed input is missing: ${file}`);
}

const data = JSON.parse(readFileSync(DATA, 'utf8'));
const allCars = JSON.parse(readFileSync(ALL, 'utf8'));
const token = readFileSync(TOKEN, 'utf8').trim();
if (token.length < 16) throw new Error('jordyn feed token is invalid');
const feedFile = join(ROOT, 'feed', token, 'jordyn.json');
if (!existsSync(feedFile)) throw new Error(`canonical JSON feed is missing: ${feedFile}`);
const feed = JSON.parse(readFileSync(feedFile, 'utf8'));

const chatGpt = buildChatGptMarkdownFiles({
  data,
  allCars,
  feed,
  publicBase: PUBLIC_BASE,
  token,
  generatedAt: new Date().toISOString(),
});
writeFileSync(join(ROOT, 'feed', token, 'jordyn.md'), compatibilityMarkdown(PUBLIC_BASE, token), 'utf8');
writeChatGptMarkdownFiles({ root: ROOT, token, files: chatGpt.files });

console.log(`ChatGPT feed rebuilt: ${allCars.count} current market rows, ${chatGpt.counts['shortlist.md']} shortlisted.`);
for (const file of CHATGPT_FEED_FILES) console.log(`${file}: ${chatGpt.counts[file] ?? 'index'}`);
