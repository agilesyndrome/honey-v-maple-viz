# skill.md — making the Honey ✕ Maple map

Design notes, conventions, and the regeneration workflow for this
visualization. Read this before editing anything; it explains *why* the map
is shaped the way it is, so future changes stay coherent.

---

## 1. The concept

**Two homes become one dot.** The chart's whole rhetorical trick: instead of
two boring maps side by side, both front doors are condensed into a single
`Home` at the centre of one compass. Toronto's stops live in the **north
half** ("Maple" 🍁, coral `#ff6f5d`), Raleigh's in the **south half**
("Honey" 🍯, amber `#ffb45c`). The equator line between them is the border
between two lives.

Because both cities share the same scale and centerpoint, distances become
*directly comparable across cities* — you can hold Raleigh's coffee run
against Toronto's without any mental conversion.

**The map is a live world, not a fixed drawing.** All geometry lives in
km-space (Home at 0,0) inside `<g id="hm-world">`; one transform zooms and
pans it, and a scope badge reports the current radius.

- **Rings double outward** (0.5 · 1 · 2 · 4 · 8 · 16 · 32 km). The visible
  ladder re-derives from the current scope: tiny rings hide under Home's
  halo, huge ones only appear when you zoom out.
- **The category picker rescopes the map.** Coffee / Everyday Essentials /
  Work & Volunteering / Date Night / All stops. Choosing one *hides* every
  other stop (`hm-hid`, they disappear entirely) and tweens the view to the
  smallest "nice" scope that fits the selection (×1.15 padding, snapped to
  the `chart.viewStops` ladder). "All stops" fits the widest stop — which is
  why one 16.6 km date-night restaurant can make the overview look tiny.
  That's honest: it's the argument for picking a category or zooming.
- **Zoom & pan:** wheel (about the cursor), pinch, +/−/⤢ buttons, drag to
  roam. Home never leaves the disc (centre clamped to 0.92 × radius).
- **Labels declutter themselves.** Stop labels are placed greedily
  (widest-radius stops first), may flip sides or hide when they would
  collide, and reappear as you zoom in. Ring labels yield to stop labels.

**Mode is the encoding, not decoration.**
- Toronto walking stops: paths are **dotted, gently curved** — the amble of a
  sidewalk route.
- Toronto transit stops: **paired straight lines** with a moving centre dash.
- Raleigh (we drive): paths are **ruled case lines with flowing dashes** —
  highway texture.

**The story the real numbers tell** (this is why the chart exists):
- The **essentials circles are nearly identical** — Walmart 1.13 km vs Food
  Lion 1.06 km (and Raleigh's Target run is still 4.5 km).
- The **coffee run is an order of magnitude apart** — Misc 0.70 km vs a
  Raleigh coffee scene that starts at 6.7 km and reaches 10.2 km (×11.6 on
  average).
- Harbourfront Centre (Elijah's volunteer post) is a **Toronto-only ring**.
- **Date night inverts the clock:** Toronto strolls 0.9 km to dinner in
  13 minutes; Raleigh drove 26 minutes to Mandolin — ×18.8, and the
  restaurant has since closed (kept on the map as a historical ring).

Hover / tab / click any stop: its **true radius ring** lights up as a dashed
ghost ring (in km-space, so it zooms with the world), everything else dims,
and a tooltip compares it to its counterpart. Clicking **pins** the
comparison; Esc or clicking outside releases it.

**The metrics at the bottom recompute** for whatever is displayed: the
cross-city gap (×ratio of average radius), the widest ring, and average
minutes door to door. Per-category story prose lives in the data file
(`categories[].metric` and `allMetric`).

## 2. Privacy rules (non-negotiable)

- **No addresses, ever.** Not in the data file, not in the DOM, not in
  tooltips, not in comments. Coordinates are stored in the JSON (needed for
  math) but *never rendered as text*.
- Display names only: `Home`, `Walmart`, `Misc Coffee`, `Harbourfront
  Centre`, `And/Ore`, `IKEA`, `Food Lion`, `Jubala Coffee`, `Sola Coffee`,
  `Black & White`, `Target`, `Mandolin`. Town-level descriptors
  ("Wake Forest") are fine; street-level fragments are not.
- The `tools/diag.html` test suite greps the live DOM for address fragments
  as a regression guard — extend that regex whenever you add stops.
- No trackers, no network calls at runtime (fonts are the only external
  request, and they degrade to system fonts gracefully).

## 3. The pipeline

```
data/honey-maple.json     ← the only file you edit for content
        │
        ▼  python3 tools/build.py
        │   (stdlib only; computes every number: haversine distances,
        │    bearings, aggregates; prints them for sanity-checking)
        ▼
index.html               ← generated; never hand-edit
```

```
assets/app.css           ← styles (injected into <style>)
assets/app.js            ← runtime world renderer + interactions (injected)
tools/build.py           ← the generator
tools/diag.html          ← headless test harness (open in Chrome, read #out)
data/honey-maple.json    ← source of truth: coordinates, minutes, angles, prose
```

Why Python + static instead of npm/React: WordPress embeds want **one static
file** with zero build infrastructure on the host. A single deterministic
stdlib script regenerates that file from data in ~50ms. The interactivity
(chips, rescoping, zoom/pan, pinning, unit toggle, tooltips, live metrics)
all lives in `assets/app.js` and needs no framework.

### Regenerate

```bash
python3 tools/build.py            # writes index.html + prints derived stats
python3 tools/build.py --check    # validate only
python3 tools/build.py --out /tmp/preview.html
```

The build prints every derived distance and aggregate — skim that output;
it's the fastest sanity check that the data edit did what you think.

### Test (headless, no npm needed)

```bash
CHROME=~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome

$CHROME --headless=new --no-sandbox --allow-file-access-from-files \
  --window-size=1440,2800 --virtual-time-budget=25000 --dump-dom \
  "file://$PWD/tools/diag.html?src=file://$PWD/index.html%3Freveal%3Dnow" \
  | grep -o 'ALL OK'
```

`?reveal=now` skips the intro choreography (headless virtual time doesn't
advance CSS transitions), landing instantly on the final state.

The harness asserts: 11 stops + 11 paths drawn; chips rescope to exact
scopes (coffee→12 km, essentials→6, work→5, date-night→20) and non-matching
stops disappear; zoom buttons, wheel and drag-pan move the view; hover →
tooltip + ghost ring at the exact km radius; click → pin (persists through
mouseleave, released by outside click / Esc); unit toggle flips every
string; live metrics land exact values (×4.0 / ×11.6 / ×18.8 …);
**no label overlaps at five scopes**; no label escapes the chart box;
**no address fragments in the DOM**. Run it again at
`--window-size=430,3300` for mobile, and once *without* `?reveal=now` to
exercise the intro path.

## 4. How to add a stop (worked example)

1. **Geocode it once** (off-repo, or via your favourite tool — Nominatim /
   OSRM were used for the current numbers):

   ```
   https://nominatim.openstreetmap.org/search?format=jsonv2&q=Sola+Coffee,+Raleigh
   → 35.8853, -78.6601
   https://router.project-osrm.org/route/v1/driving/HOME;STOP   → route km
   ```

2. **Add a category** if needed (here: `date-night`, glyph `date`). Glyphs
   live in `assets/app.js` → `ICONS`, chips in `tools/build.py` →
   `CHIP_ICONS_HTML`. Keep them in sync. Give the category a `metric`
   block (`title`, `scope`, `flavor`, `widestFlavor`, `minutesFlavor`,
   `soloFlavor` if it's one-city) — the bottom cards render that prose
   around the derived numbers.

3. **Add the stop to `data/honey-maple.json`:**

   ```json
   {
     "key": "sola",                   // unique, lowercase
     "city": "raleigh",               // toronto → north half, raleigh → south
     "name": "Sola Coffee",           // display name; NO addresses
     "category": "coffee",
     "lat": 35.88532, "lon": -78.66010,
     "routeKm": 13.0,                 // real route length (walk or drive)
     "travel": {"mode": "drive", "drivingMinutes": 18}, // per-stop mode + estimate
     "angle": 250,                    // visual bearing, see §5
     "labelDir": "left",              // preferred label side (runtime may flip)
     "status": "closed",              // optional: historical venue
     "note": "editorial tooltip line — the cross-city comparison"
   }
   ```

4. **Regenerate + test.** `build.py` validates angles vs hemispheres and
   required fields, and recomputes every derived number automatically.
   City cards show the **nearest** stop per category per city with a
   `+N more` count; closed stops get a "now closed" suffix.

Conventions:
- `angle`: 0 = up (north), clockwise, in *visual* degrees. Toronto stops
  must fall in `[270..360] ∪ [0..90]` (north half), Raleigh in `[90..270]`.
  Real compass bearings go in the tooltip automatically (computed from
  lat/lon — never hand-typed).
- The runtime picks each category's scope: smallest `viewStops` value ≥
  widest stop × 1.15. If a stop is absurdly far out, "All stops" zooms out
  to accommodate it — that's the design, not a bug.

## 5. Angle easing + label decluttering (the licensed dishonesties)

Stop positions use **true straight-line distance** (radius is sacred) but
**eased angles**: real bearings are squashed so each city's stops stay in
its half and labels don't collide. E.g. Harbourfront's real bearing is
ESE (112°) but it's drawn at 70° so it stays north of the equator; Black &
White's real bearing is north-east (55°) but it's drawn at 108° to stay
south of it. The **tooltip always shows the real bearing** ("east-south-east
of home"), and the caption admits angles are eased.

On top of that, `app.js → declutter()` runs on every view change: stop
labels are placed greedily (widest radius first) on their preferred side,
flipped to the other side, or hidden entirely when estimated boxes would
collide (with each other, with dots, or with the HOME label). Ring labels
hide when they'd collide with a stop label. If you add stops, nudge `angle`
/ `labelDir` by hand until the five-scope collision sweep in `diag.html`
stays green.

## 6. Design system

| Token | Value | Use |
|---|---|---|
| Maple (Toronto) | `#ff6f5d` / soft `#ff9078` | north half, walked paths |
| Honey (Raleigh) | `#ffb45c` / soft `#ffd08a` | south half, driven paths |
| Home | `#f4ecdc` (cream) | the centre dot |
| Background | `#090c12 → #121a2b` radial gradient + grain overlay | page |
| Ink | `#eef1f8` / `#aeb6c9` / `#79819a` | text tiers |
| Serif | Fraunces (opsz axis, italics for editorial voice) | headline, stat numerals, notes |
| Sans | Inter | UI, labels, data |
| Radii | 10px zoom buttons / 14px pills / 20px cards / 999px chips | consistent softness |

Motion: one intro choreography (staggered fades, ring bloom, path draw,
count-ups), all collapsed by `prefers-reduced-motion` and by `?reveal=now`.
View changes tween in log-space (zoom feels linear to the eye), ~700 ms.
Ambient animations: dash-flow on driven paths, dash-step on walked paths,
pulse halo on Home — durations rescale with zoom so the pace stays constant
on screen.

## 7. Distance / Time and stored travel modes

`travel.mode` on each stop is authoritative. Toronto initially assigns walks
inside the original overview's first visible 2 km ring and transit outside;
Raleigh is driving. Never infer mode from the current zoom or category.
`travelDefaults.initialTorontoWalkingRadiusKm` documents the original assignment,
not a rule that overrides edits. `walkingMinutes`, `drivingMinutes`, and
`transitMinutes` are independent optional mode-specific estimates.

Stored map-provider `transitMinutes` take precedence. Current transit estimates
are rounded Google Maps trips from a public neighbourhood landmark; provenance
lives in `travel.source`. Never imply that a proxy is an exact home itinerary.
For stops without a stored map estimate, the build computes a fallback: total walking
access + wait + riding. Editable assumptions and per-stop overrides are documented
in README.md. This is a labelled offline model, not live routing or TTC schedules.
Keep no network calls at runtime. After editing a mode, regenerate the static page.

The global Distance/Time toggle updates all measurement strings and metrics.
Time uses minutes, hides distance units, and compares both cities on the same
scale. Animate per-stop radii, path endpoints, and rings together with the fitted
scope, without rebuilding SVG nodes or dropping focus/pins. Reduced motion skips
the morph. Distance restores the chosen km/mile unit. Run the diagnostic harness
at desktop and mobile sizes; its checks must fail on false assertion values.

## 8. Trade-offs & future ideas

- Straight-line radius + eased angle = honest *distance*, eased *position*.
  If that ever bothers us, a "true bearings" toggle would be more literal
  but less legible.
- The overview will always be dominated by the widest stop (currently
  Mandolin at 16.6 km — closed, kept for the story). Decluttering hides
  near-home labels at that scope; zoom or pick a category to read them.
- Drive times are free-flow; real traffic would widen Raleigh's times.
- Natural next steps: per-category URL hash (shareable scopes), a "tour"
  mode that visits each category in sequence, and a print/poster export
  mode (white background).
