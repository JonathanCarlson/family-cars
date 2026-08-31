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

## Layout

```
index.html            landing page linking to both rosters
cars.html   / cars.js     Kate's page
jordyn.html / jordyn.js   Jordyn's page
car-common.js         shared shell: crypto, access gate, remembered key,
                      votes/notes, share link, toast
styles.css            shared design tokens and base components
build/build-*.mjs     encrypt build/<roster>.json → data/<roster>.enc.json
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
