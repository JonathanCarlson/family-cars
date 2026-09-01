# Carlson family cars

Two encrypted, share-by-link car searches, refreshed nightly:

| Page | What it is |
|---|---|
| `cars.html` | **Kate's Mach-E shortlist** — used Ford Mustang Mach-E across a 250-mile corridor, with a price-analysis tab (client-side regression over the live inventory). |
| `jordyn.html` | **Jordyn's first car** — safe, cheap-to-own cars under $15k, grouped by whether automatic emergency braking is *standard for that model year*, then ranked on total cost to own at 130 mi/week over 2 and 6 years. |

Live at **https://jonathancarlson.github.io/family-cars/**

## How access works

The pages are public; the *data* is not. Each roster is encrypted
(PBKDF2-SHA256 250k → AES-GCM-256) into `data/*.enc.json`, and the key lives in
the URL fragment — `cars.html#k=<key>` — which browsers **never send to the
server**. Each page has its own independent key, so a link to one can't open the
other.

The keys live in `build/cars-key.txt` and `build/jordyn-key.txt`, which are
**gitignored**. They are persistent: rebuilding re-encrypts with the same key so
shared links keep working. Never regenerate them, and never commit them — a
committed key would make the bundles readable by anyone who finds this repo.

Every page has a **🔗 Share** button that produces the full link *including* the
key, via the native share sheet or the clipboard.

### Three ways in, and when to use each

| Way in | Looks like | Good for | Not good for |
|---|---|---|---|
| **Key in the fragment** | `jordyn.html#k=<key>` | the normal case — text the link, it just opens | anything that strips the `#fragment` |
| **Passphrase** | `sage-harvest-bishop-cherry-pollen` | reading down a phone line; a link that lost its fragment | programs — it still needs a browser |
| **Plaintext feed** | `feed/<token>/jordyn.md` | programs: LLM tools, `curl`, scripts | anything you'd mind being readable |

**Passphrase.** The roster is *not* re-encrypted under it. A small second blob
(`data/<roster>.unlock.json`) holds the real key encrypted under the phrase; the
page unwraps it and then decrypts normally. So there's still one encrypted
roster under one strong key, the phrase can be rotated without touching the
bundle, and links already shared keep working. Typing is forgiving about case,
spaces and punctuation — `Sage Harvest Bishop` == `sage-harvest-bishop`.

> The normalization that makes that work lives in **two** places —
> `normalizePass()` in `car-common.js` and in `build/car-access.mjs`. They must
> stay identical. If they drift, the passphrase silently stops working while the
> `#k=` link keeps working perfectly, so nobody notices until someone is locked
> out. `build/car-access.test.mjs` pins them together.

**Feed.** This is the only thing that helps a **server-side fetcher**. Such a
client does a plain HTTP GET: it never executes `car-common.js`, never receives
the `#fragment` (browsers don't send fragments to servers), and can't type a
passphrase or run WebCrypto. Hand it the page URL and it gets an empty shell. So
each build also writes a plaintext copy at an unguessable path:

```
feed/<token>/jordyn.md     ← best for an LLM: prose + tables, self-describing
feed/<token>/jordyn.json   ← the full structured roster
```

> ⚠️ **The feed is NOT encrypted.** Its privacy is the unguessable URL alone —
> a capability URL. Anyone who gets the URL can read the roster, and you revoke
> it by *rotating the token* (which changes the URL), not by changing a
> password. That's a fine trade for used-car listings scraped from public
> inventory and a bad one for anything else — never put tickets, contacts or
> documents behind one.
>
> The feed URL is deliberately **not** exposed anywhere in the page UI. Putting
> it there would let anyone you shared the *page* with walk away with permanent
> plaintext access.

Secrets and rotation:

```powershell
node build/build-jordyn.mjs                 # reuse everything; print all three
node build/build-jordyn.mjs --rotate-pass   # new passphrase; links + feed unchanged
node build/build-jordyn.mjs --rotate-feed   # new feed URL; old one deleted
node build/build-jordyn.mjs --rotate        # new key AND passphrase AND feed
node --test build/car-access.test.mjs       # verify all of it round-trips
```

`build/*-pass.txt` and `build/*-feed.txt` are gitignored alongside the keys.

## Layout

```
index.html            landing page linking to both rosters
cars.html   / cars.js     Kate's page
jordyn.html / jordyn.js   Jordyn's page
car-common.js         shared shell: crypto, access gate (key OR passphrase),
                      remembered key, votes/notes, share link, toast
styles.css            shared design tokens and base components
build/build-*.mjs     encrypt build/<roster>.json → data/<roster>.enc.json,
                      write data/<roster>.unlock.json + feed/<token>/
build/car-access.mjs  passphrase wrapping, feed writing, secret rotation
build/feed-markdown.mjs  render a roster as Markdown for machine readers
robots.txt            keep crawlers out of /feed/ and /data/
```

`car-common.js` must load **before** the page script.

## Where the data comes from

The rosters are generated in the `admin-agents` repo, not here:

```powershell
cd ..\admin-agents
node helpers/car-nightly-refresh.mjs --publish      # Kate
node helpers/jordyn-nightly-refresh.mjs --publish   # Jordyn
```

Each scans Autotrader, rewrites `build/<roster>.json` here, re-encrypts, and
pushes. The daemon's `car-inventory-sweep` runs both nightly at 4:15 AM.

> ⚠️ Autotrader/Akamai blocks plain HTTP clients **and** headless browsers, so
> the scan drives a real headed browser via `helpers/autotrader-fetch.mjs`.
> Don't "simplify" that back to a plain fetch — it silently froze Kate's page for
> four days in August 2026.

## History

Both pages previously lived in the `france-2026` trip repo, sharing its Pages
deployment. With the trip over and two active car apps, they moved here
(2026-08-31). The old URLs are kept as **fragment-preserving redirects**, so
links already shared — including their `#k=` keys — continue to work.
