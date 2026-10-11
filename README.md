# Honey ✕ Maple — Two Homes, One Circle 🍁🍯

A single-file, zero-dependency data visualization comparing how far everyday
life sits from **our front door in Toronto** (where we walk or take transit) versus
**our front door in Raleigh** (where we drive everywhere).

Both homes are condensed into one dot — **Home** — at the centre of a live,
zoomable compass:

- **North half — Maple (Toronto):** dotted walking paths and paired transit lines.
- **South half — Honey (Raleigh):** ruled, highway-style paths.
- **Rings double outward** from Home (0.5 · 1 · 2 · 4 · 8 · 16 km), and the
  whole map **rescopes and rezooms** to whatever you're looking at.
- **Choose a category** — Coffee, Everyday Essentials, Work & Volunteering,
  Date Night — and every other stop disappears while the map zooms to that
  errand's true circle.
- **Scroll to zoom, drag to roam** (pinch on touch), or use the +/−/⤢ controls;
  a scope badge shows the current radius.
- Hover / **Tab** / **click** any stop to light up its true radius ring in both
  cities, with distance, route, time and bearing.
- The **metrics at the bottom recompute** for whatever is on screen — the
  cross-city gap, the widest ring, and door-to-door minutes.
- Toggle **Distance / Time** to morph dots, paths, and rings together. Time uses
  estimated door-to-door **minutes**; the kilometre/mile toggle hides until
  you return to Distance. Category filters, zoom, and pinned stops still work.

The compact category menu supports arrow keys, Home/End, typeahead, and
Escape. Controls keep comfortable touch targets on mobile.

The real story (all distances straight-line from the front door):

| Category | Toronto (walk/transit) | Raleigh (drive) | Gap |
|---|---|---|---|
| Coffee | Misc Coffee — 0.7 km · ≈10 min | Black & White 6.7 · Jubala 7.5 · Sola 10.2 km | **×11.6** |
| Everyday Essentials | Walmart 1.1 km · IKEA 3.3 km | Food Lion 1.1 km · Target 4.5 km | **×1.3** |
| Work & Volunteering | Harbourfront Centre — 3.6 km · ≈35 min transit | — | Toronto-only ring |
| Date Night | And/Ore — 0.9 km · ≈13 min | Mandolin (now closed) — 16.6 km | **×18.8** |

No addresses are displayed or stored — only names. See `skill.md` for the
full design rationale and conventions.

---

## Run it

It's one static file, regenerated from data:

```bash
python3 tools/build.py     # regenerate index.html from data/honey-maple.json
python3 -m http.server 8000   # → http://localhost:8000/
# or just double-click index.html — no build step, no dependencies
```

## Edit it

Content lives in **`data/honey-maple.json`** (stops, categories, metric
story prose). Styles in `assets/app.css`, behaviour in `assets/app.js`.
Then regenerate:

```bash
python3 tools/build.py            # rebuild + print all derived stats
python3 tools/build.py --check    # validate data without writing
```

The build computes every number — haversine distances, bearings, aggregates —
so nothing is ever hand-typed twice. Pixel geometry, zooming and per-category
rescoping are computed at runtime in `app.js` from the same derived numbers.
`skill.md` §4 has a complete worked example (adding a stop).

## Travel modes and minutes

Each destination has its own `travel.mode`: `walk`, `transit`, or `drive`.
Toronto's initial defaults use the first visible circle in the original
20 km overview: **2 km**. This assignment is stored on each destination;
zooming or filtering never changes how you travel.

| Toronto destination | Stored mode | Estimated minutes |
|---|---|---|
| Walmart | walk | 15 |
| Misc Coffee | walk | 10 |
| Harbourfront Centre | transit | 35 |
| And/Ore | walk | 13 |
| IKEA | transit | 35 |

Raleigh destinations all use `drive` and keep their original estimates.
Walking and driving estimates are stored as `walkingMinutes` and
`drivingMinutes` inside each stop's `travel` object. A mode change uses
that mode's own value, so an old walking time never becomes a transit time.
Add `transitMinutes` for a known typical transit trip; it overrides the model.

Current transit times are **approximate Google Maps lookups**, checked on
11 October 2026 using Trinity Bellwoods Park as a public neighbourhood proxy
rather than sharing exact home coordinates. The suggested journeys were 34
minutes to Harbourfront and 33 to IKEA; both are rounded to **35 minutes**.
Per-stop `travel.source` records provider, lookup date, public origin, and
observed minutes. These are representative snapshots, not live arrivals or
exact trips from the home dot. Departure time and service can change them.

For a new transit stop without a stored `transitMinutes`, an offline fallback
adds walking access, waiting, and riding minutes from the route-length proxy.
The fallback assumptions live in `travelDefaults`; a stop can override
`accessKm`, `waitMinutes`, and `speedKph`. A map-provider time takes precedence.

Time rings use 2.5 · 5 · 10 · 20 · 40 · 80 · 160 minutes. Both cities
share the same minutes scale. The gap, widest ring, category scope, stop
labels, tooltips, and city summaries follow the active measurement.
Reduced-motion preferences switch geometry immediately.

## Test it

Run `python3 -m unittest discover -s tools -p 'test_*.py'` for offline
travel-model regression checks.

`tools/diag.html` is a headless harness that boots the page in a real
(headless) Chrome and asserts the boot, category menu + rescoping (scopes land at
exact km values), stop disappearance/restoration, pinning, tooltips, ghost
rings, unit toggle, zoom buttons + wheel + drag-pan, the live metrics,
label-collision sweeps at five different scopes, Distance/Time geometry, interruption and rapid toggles, stored travel modes,
minute-based metrics, and an address-leak sweep:

```bash
CHROME=~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome
$CHROME --headless=new --no-sandbox --allow-file-access-from-files \
  --window-size=1440,2800 --virtual-time-budget=60000 --dump-dom \
  "file://$PWD/tools/diag.html?src=file://$PWD/index.html%3Freveal%3Dnow" \
  | grep -o 'ALL OK'
```

(Also run at `--window-size=430,3300` for the mobile layout.)

## Embed in WordPress

### Option A — iframe (recommended, always safe)

Upload `index.html` anywhere your site can reach it — e.g. your host's file
manager at `/wp-content/uploads/honey-maple/index.html`, or GitHub Pages —
then add a **Custom HTML block**:

```html
<iframe
  src="https://your-site.example/wp-content/uploads/honey-maple/index.html"
  title="Honey vs Maple — distance from home, Toronto vs Raleigh"
  loading="lazy"
  style="width:100%;height:2500px;border:0;display:block;border-radius:14px"></iframe>
```

- `height` — the page is ≈2450 px at desktop widths; bump toward `2900` on
  narrow themes (the layout stacks and grows on small screens).
- Some hosts strip `.html` uploads from the Media Library — use the file
  manager / FTP route, or host the file off-site (GitHub Pages works free).

### Option B — paste the whole file (admins only)

Copy the entire contents of `index.html` into a **Custom HTML block**.
Everything is self-contained (styles + script inline, all classes prefixed
`hm-`, no assets beyond Google Fonts, which degrade gracefully). WordPress
strips `<script>` tags from non-admin content, so this needs the
`unfiltered_html` capability. If the chart area renders empty — use Option A.

## Data provenance

- Locations geocoded from real coordinates via OpenStreetMap (Nominatim);
  closed venues keep their historical coordinates and are flagged `closed`.
- Road routes & drive times via the open **OSRM** routing engine; walking
  routes estimated along the sidewalk grid. Original walking minutes are retained.
- Current transit minutes come from the Google Maps snapshots documented above.
  No routing API is called at runtime. Unconfigured transit stops use the
  labelled offline fallback model.
- Distances are straight-line unless marked "route". Rounded honestly.
- Privacy-first: names only, never addresses.

## Browser support

Chrome / Edge / Firefox / Safari, current + previous major version.
Uses `color-mix()` (2023+) for one hover nicety — degrades to the base border.
Respects `prefers-reduced-motion`; `?reveal=now` renders the final state
instantly (useful for screenshots & embeds).
