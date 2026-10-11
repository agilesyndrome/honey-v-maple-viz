#!/usr/bin/env python3
"""
Honey ✕ Maple — build.py
========================
Regenerates index.html from data/honey-maple.json (+ assets/app.css, assets/app.js).

Everything numeric (straight-line distances, bearings, aggregates) is derived
here — never hand-typed. The data file holds only authored facts: coordinates,
route lengths, minutes, angles, prose. Pixel geometry, zoom and the per-
category rescoping are computed at runtime by assets/app.js.

Usage:
    python3 tools/build.py               # writes index.html
    python3 tools/build.py --check       # validate only, no write
    python3 tools/build.py --out PATH    # custom output path

Stdlib only. No network. Deterministic.
"""
import json
import math
import sys
import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_FILE = ROOT / "data" / "honey-maple.json"
CSS_FILE = ROOT / "assets" / "app.css"
JS_FILE = ROOT / "assets" / "app.js"
OUT_FILE = ROOT / "index.html"

KM_PER_MI = 1.609344
R_MAX_PX = 316          # outer ring radius in viewBox units (fills the circle)
EARTH_KM = 6371.0088

COMPASS = ["north", "north-north-east", "north-east", "east-north-east",
           "east", "east-south-east", "south-east", "south-south-east",
           "south", "south-south-west", "south-west", "west-south-west",
           "west", "west-north-west", "north-west", "north-north-west"]
CARDINALS = {0: "north", 4: "east", 8: "south", 12: "west"}

WALK_ICON = ('<svg width="11" height="11" viewBox="0 0 14 14" aria-hidden="true">'
             '<circle cx="7" cy="2.6" r="1.9" fill="none" stroke="currentColor" stroke-width="1.5"/>'
             '<path d="M7 5v3.4l-2.6 4M7 6l2.8 2 1.6-.6M7 8.4l-2.6.8L3 12M9.8 8l-.4 4" '
             'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>')
CAR_ICON = ('<svg width="13" height="11" viewBox="0 0 16 14" aria-hidden="true">'
            '<path d="M1.5 9.5v-2.4c0-.6.3-1.1.8-1.4l1.5-1 1.6-2.6c.3-.5.8-.8 1.4-.8h3c.5 0 1 .3 1.3.7l2 2.7 2.2.9c.7.3 1.2 1 1.2 1.8v2.1h-1.2M4 9.5h8" '
            'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>'
            '<circle cx="4.2" cy="10.6" r="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/>'
            '<circle cx="11.6" cy="10.6" r="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>')

# view scopes the runtime snaps rescopes to (must match data chart.viewStops)
NICE_VIEWS = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 40]


# ----------------------------------------------------------------- helpers
def esc(s: str) -> str:
    """HTML-escape: ampersand first, then angle brackets and quotes."""
    _a = '&'
    return (str(s)
            .replace(_a, _a + "amp;")
            .replace(chr(60), _a + "lt;")
            .replace(chr(62), _a + "gt;")
            .replace(chr(34), _a + "quot;"))


def hav_km(a, b) -> float:
    """Straight-line distance between two {lat, lon} points, km."""
    lat1, lat2 = math.radians(a["lat"]), math.radians(b["lat"])
    dlat, dlon = math.radians(b["lat"] - a["lat"]), math.radians(b["lon"] - a["lon"])
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * EARTH_KM * math.asin(math.sqrt(h))


def stop_km(home, stop) -> float:
    """Use a supplied radius when coordinates are unknown; never invent a location."""
    value = stop.get("distanceKm")
    if value is None:
        return round(hav_km(home, stop), 3)
    if (not isinstance(value, (int, float)) or isinstance(value, bool)
            or not math.isfinite(value) or value <= 0):
        raise ValueError(f"stop {stop['key']}: distanceKm must be finite and positive")
    return value


def bearing_deg(a, b) -> float:
    lat1, lat2 = math.radians(a["lat"]), math.radians(b["lat"])
    dlon = math.radians(b["lon"] - a["lon"])
    y = math.sin(dlon) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def compass_text(brg: float) -> str:
    idx = int(round(brg / 22.5)) % 16
    if idx in CARDINALS and abs(brg - (idx * 22.5)) <= 8:
        return f"due {CARDINALS[idx]} of home"
    return COMPASS[idx] + " of home"


def fkm(k: float) -> str:
    if abs(k - round(k)) < 1e-9:
        return str(round(k))
    return f"{k:.0f}" if k >= 10 else f"{k:.1f}"


def fmi(k: float) -> str:
    return fkm(k / KM_PER_MI)


def u2(k: float) -> dict:
    return {"km": f"{fkm(k)} km · {fmi(k)} mi", "mi": f"{fmi(k)} mi · {fkm(k)} km"}


def fit_view(max_km: float) -> float:
    """Mirror of the runtime fit: smallest nice scope >= max*1.15."""
    t = max_km * 1.15
    for v in NICE_VIEWS:
        if v >= t:
            return v
    return NICE_VIEWS[-1]


def travel_time(s: dict, defaults: dict) -> dict:
    """Estimate offline; mode-specific observed minutes can replace the model.

    Transit splits route length into walking access + riding, then adds wait.
    These are editable assumptions, not a timetable or a live routing result.
    """
    travel = s["travel"]
    mode = travel["mode"]
    if mode not in ("walk", "transit", "drive"):
        raise ValueError(f"stop {s['key']}: travel.mode must be walk, transit or drive")
    def number(value, label, allow_zero=False):
        if (not isinstance(value, (int, float)) or isinstance(value, bool)
                or not math.isfinite(value)
                or (value < 0 if allow_zero else value <= 0)):
            raise ValueError(f"stop {s['key']}: {label} must be a finite {'nonnegative' if allow_zero else 'positive'} number")
        return value
    # A known trip time does not require an invented route length.
    route = number(s["routeKm"], "routeKm") if s.get("routeKm") is not None else None
    override = travel.get({"walk": "walkingMinutes", "drive": "drivingMinutes",
                           "transit": "transitMinutes"}[mode])
    detail = "Stored trip estimate."
    if override is not None:
        minutes = number(override, "mode-specific minutes")
        source = travel.get("source")
        if source:
            detail = (f"Approximate {source['provider']} trip from {source['originLabel']} "
                      f"(neighbourhood proxy), checked {source['checkedOn']}. "
                      "Rounded to 5 minutes; actual departure and service may vary.")
    elif route is None:
        raise ValueError(f"stop {s['key']}: supply routeKm or mode-specific minutes")
    elif mode == "transit":
        access = min(route, number(travel.get("accessKm", defaults["transitAccessKm"]), "accessKm", True))
        wait = number(travel.get("waitMinutes", defaults["transitWaitMinutes"]), "waitMinutes", True)
        speed = number(travel.get("speedKph", defaults["transitSpeedKph"]), "transit speed")
        walk = access / number(defaults["walkingSpeedKph"], "walking speed") * 60
        ride = (route - access) / speed * 60
        minutes = walk + wait + ride
        detail = (f"Model estimate: {walk:.0f} min walking access + {wait:g} min wait "
                  f"+ {ride:.0f} min riding. Service, transfers and traffic may vary.")
    else:
        speed = number(defaults["walkingSpeedKph" if mode == "walk" else "drivingSpeedKph"], "speed")
        minutes = route / speed * 60
        detail = "Model estimate from route length and assumed speed."
    minutes = max(1, math.floor(minutes + 0.5))
    return {"minutes": minutes, "timeNote": f"≈{minutes} min {mode}",
            "timeDetail": detail, "travelMode": mode}


# ----------------------------------------------------------------- geometry
def build_hm(raw: dict) -> dict:
    chart = raw["chart"]
    hm = {
        "chart": {
            "vb": chart["viewBox"], "c": chart["center"], "rMaxPx": R_MAX_PX,
            "ringKm": chart["ringKm"], "viewStops": chart["viewStops"],
            "ringMinutes": chart["ringMinutes"], "timeViewStops": chart["timeViewStops"],
            "aria": ("Distance and time compass around Home: rings double outward as the scope grows; "
                     "Toronto stops in the north half (walking and transit), Raleigh stops in the south half "
                     "(mostly driving, with a walk to school). Scroll to zoom, drag to roam."),
        },
        "meta": raw["meta"],
        "cities": {}, "stops": [], "categories": raw["categories"],
        "allMetric": raw["allMetric"],
    }

    for key, city in raw["cities"].items():
        hm["cities"][key] = {
            **{k: city[k] for k in ("name", "region", "alias", "aliasIcon", "accent",
                                     "soft", "mode", "verb", "badge", "hemisphere",
                                     "tagline", "note")},
            "home": city["home"],
        }

    stops = []
    for s in raw["stops"]:
        city = hm["cities"][s["city"]]
        home = city["home"]
        km = stop_km(home, s)
        cat = next(cat for cat in raw["categories"] if cat["key"] == s["category"])
        timing = travel_time(s, raw["travelDefaults"])
        mode_word = {"walk": "walking", "drive": "driving", "transit": "by public transit"}[timing["travelMode"]]
        stop = {
            "key": s["key"], "city": s["city"], "name": s["name"],
            "category": s["category"], "catLabel": cat["label"], "glyph": cat["glyph"],
            "km": km,
            "angle": s["angle"], "labelDir": s["labelDir"],
            "routeKm": s.get("routeKm"), "travel": s["travel"], **timing,
            "bearingText": compass_text(bearing_deg(home, s)) if "lat" in s and "lon" in s else None,
            "distStr": u2(km),
            "distShort": {"km": f"{fkm(km)} km", "mi": f"{fmi(km)} mi"},
            "routeStr": {"km": f"≈ {fkm(s['routeKm'])} km", "mi": f"≈ {fmi(s['routeKm'])} mi"} if s.get("routeKm") is not None else None,
            "ghostLabel": {"km": f"{fkm(km)} km", "mi": f"{fmi(km)} mi"},
            "aria": esc(f"{s['name']}, {city['name']} — {fkm(km)} km ({fmi(km)} mi) "
                        f"straight-line from home, about {timing['minutes']} minutes {mode_word}."),
            "note": s["note"],
        }
        if s.get("chartName"):
            stop["chartName"] = s["chartName"]
        if s.get("status"):
            stop["status"] = s["status"]
        stops.append(stop)
    hm["stops"] = stops

    for key, city in hm["cities"].items():
        city["stopKeys"] = [s["key"] for s in stops if s["city"] == key]
    return hm


# ----------------------------------------------------------------- aggregates (printout only; page computes live)
def aggregates(raw: dict, hm: dict) -> dict:
    agg = {}
    for key in hm["cities"]:
        ks = [s["km"] for s in hm["stops"] if s["city"] == key]
        agg[f"avg_{key}"] = round(sum(ks) / len(ks), 2) if ks else 0.0

    pairs = {}
    for cat in raw["categories"]:
        ck = cat["key"]
        t = [s for s in hm["stops"] if s["category"] == ck and s["city"] == "toronto"]
        r = [s for s in hm["stops"] if s["category"] == ck and s["city"] == "raleigh"]
        t_avg = sum(s["km"] for s in t) / len(t) if t else None
        r_avg = sum(s["km"] for s in r) / len(r) if r else None
        pairs[ck] = {
            "t_avg": round(t_avg, 2) if t_avg is not None else None,
            "r_avg": round(r_avg, 2) if r_avg is not None else None,
            "ratio": round(r_avg / t_avg, 2) if (t_avg and r_avg) else None,
            "t_min": round(sum(s["minutes"] for s in t) / len(t)) if t else None,
            "r_min": round(sum(s["minutes"] for s in r) / len(r)) if r else None,
            "view": fit_view(max([s["km"] for s in t + r], default=1)),
        }
    agg["pairs"] = pairs
    agg["viewAll"] = fit_view(max(s["km"] for s in hm["stops"]))
    return agg


# ----------------------------------------------------------------- sections
CHIP_ICONS_HTML = {
    "cup":  '<svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3.2,5.2 h5.6 v2.2 a2.8,2.8 0 0 1 -5.6,0 z"/><path d="M8.8,6 h1.4 a1.4,1.4 0 0 1 0,2.8 h-1.6"/></g><path d="M4.9,3 v1.2 M7,3 v1.2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" fill="none"/></svg>',
    "cart": '<svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2,3.5 h9.6 l-1.4,4.2 H4.2 z M4.2,7.7 v2.3 M9.6,7.7 v2.3"/></g></svg>',
    "case": '<svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M2.4,4.8 h9.2 v5.6 a1.4,1.4 0 0 1 -1.4,1.4 h-6.4 a1.4,1.4 0 0 1 -1.4,-1.4 z"/><path d="M5.2,4.8 v-1 a1.2,1.2 0 0 1 1.2,-1.2 h1.2 a1.2,1.2 0 0 1 1.2,1.2 v1"/></g></svg>',
    "date": '<svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3.2,2.8 h7.6 v1.4 a3.8,3.8 0 0 1 -7.6,0 z"/><path d="M7,8 v2.2 M4.4,11.8 h5.2"/></g></svg>',
    "game": '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M4.3,3.5 h5.4 q1.4,0 1.8,1.5 l.9,3.6 q.3,1.7-1.2,1.1 l-2.1-1.5 H4.9 l-2.1,1.5 q-1.5,.6-1.2-1.1 l.9-3.6 q.4-1.5 1.8-1.5z"/><path d="M3.4,6 h2.2 M4.5,4.9 v2.2"/></g><circle cx="9.6" cy="5.8" r=".8" fill="currentColor"/></svg>',
}


def chips_html(raw) -> str:
    # Keep the menu as real buttons: touch targets and keyboard access share one UI.
    out = ['<div class="hm-picker">'
           '<button type="button" class="hm-picker-trigger" id="hm-category" aria-haspopup="menu" '
           'aria-expanded="false" aria-controls="hm-category-menu">'
           '<span class="hm-picker-icon" aria-hidden="true">◈</span>'
           '<span id="hm-category-label">All stops</span>'
           '<svg class="hm-chevron" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">'
           '<path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
           '</button><div class="hm-chips" id="hm-category-menu" role="menu" aria-label="Filter stops by category" hidden>'
           '<span class="hm-picker-heading" aria-hidden="true">Explore your everyday</span>'
           '<button type="button" class="hm-chip" role="menuitemradio" data-cat="all" aria-pressed="true" aria-checked="true">'
           '<span class="hm-option-icon" aria-hidden="true">◈</span>All stops<span class="hm-option-check" aria-hidden="true">✓</span></button>']
    for cat in raw["categories"]:
        icon = CHIP_ICONS_HTML.get(cat["glyph"], "")
        out.append(f'<button type="button" class="hm-chip" data-cat="{cat["key"]}" '
                    f'role="menuitemradio" aria-pressed="false" aria-checked="false">'
                    f'<span class="hm-option-icon">{icon}</span>{esc(cat["label"])}'
                    '<span class="hm-option-check" aria-hidden="true">✓</span></button>')
    out.append("</div></div>")
    return "".join(out)


def city_card(key: str, raw: dict, hm: dict) -> str:
    city = hm["cities"][key]
    card_cls = "hm-maple-card" if key == "toronto" else "hm-honey-card"
    icon = WALK_ICON if city["mode"] == "walk" else CAR_ICON
    alias_svg = ('<path fill="currentColor" d="M7 .6 8.4 3l3.1-1.2-.7 3 3-1.1-2 2.3 3 1.3-3.4 1 .7 3.5-2.6-1.8L7 13.4 5.5 12.9l.6-1.9-2.4 1.7.7-3.5L-1 8.2l3-1.3L-.2 4.6l3 1.1-.7-3L5.6 3z"/>'
                 if key == "toronto" else
                 '<path fill="currentColor" d="M7 0l6 3.5v7L7 14l-6-3.5v-7z"/>')
    rows = []
    for cat in raw["categories"]:
        stops = [s for s in hm["stops"] if s["city"] == key and s["category"] == cat["key"]]
        if stops:
            near = min(stops, key=lambda s: s["km"])
            more = len(stops) - 1
            sub_km = f"{near['distShort']['km']} · {near['timeNote']}"
            sub_mi = f"{near['distShort']['mi']} · {near['timeNote']}"
            sub_time = near['timeNote']
            if more:
                sub_km += f" · +{more} more"
                sub_mi += f" · +{more} more"
                sub_time += f" · +{more} more"
            if near.get("status") == "closed":
                sub_km += " · now closed"
                sub_mi += " · now closed"
                sub_time += " · now closed"
            rows.append(f'<div class="hm-row"><span class="hm-row-k">{esc(cat["label"])}</span>'
                        f'<span class="hm-row-v"><b>{esc(near["name"])}</b>'
                        f'<i class="hm-u" data-km="{esc(sub_km)}" data-mi="{esc(sub_mi)}" data-time="{esc(sub_time)}">{esc(sub_km)}</i></span></div>')
        else:
            rows.append(f'<div class="hm-row"><span class="hm-row-k">{esc(cat["label"])}</span>'
                        f'<span class="hm-row-v"><b class="hm-mute">—</b><i>&nbsp;</i></span></div>')
    return f'''<aside class="hm-city {card_cls}" id="hm-card-{key}" tabindex="0">
      <div class="hm-alias"><svg width="13" height="13" viewBox="0 0 14 14" aria-hidden="true">{alias_svg}</svg> {esc(city["alias"])}</div>
      <h3>{esc(city["name"])} <span>· {esc(city["region"])}</span></h3>
      <div class="hm-mode">{icon} {esc(city["badge"])}</div>
      {''.join(rows)}
    </aside>'''


def metrics_section() -> str:
    return '''<section class="hm-stats" id="hm-metrics" aria-live="polite">
      <div class="hm-stat hm-s1 hm-an" style="--d:1.45s" id="hm-m1">
        <div class="hm-big"><span class="hm-num" id="hm-m1-num">0</span><span class="hm-unit" id="hm-m1-unit"></span></div>
        <div class="hm-lab" id="hm-m1-lab"></div>
        <p id="hm-m1-p"></p>
      </div>
      <div class="hm-stat hm-s2 hm-an" style="--d:1.58s" id="hm-m2">
        <div class="hm-big"><span class="hm-num" id="hm-m2-num">0</span><span class="hm-unit" id="hm-m2-unit"></span></div>
        <div class="hm-lab">The widest ring</div>
        <p id="hm-m2-p"></p>
      </div>
      <div class="hm-stat hm-s3 hm-an" style="--d:1.7s" id="hm-m3">
        <div class="hm-big"><span class="hm-num" id="hm-m3a">0</span><span class="hm-arrow" id="hm-m3-arrow">→</span><span class="hm-num" id="hm-m3b">0</span></div>
        <div class="hm-lab">Minutes · door to door</div>
        <p id="hm-m3-p"></p>
      </div>
    </section>'''


# ----------------------------------------------------------------- page
def render(raw: dict) -> str:
    hm = build_hm(raw)
    css = CSS_FILE.read_text(encoding="utf-8")
    js = JS_FILE.read_text(encoding="utf-8")
    data_js = json.dumps(hm, ensure_ascii=False, separators=(",", ":"))

    html = f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>{esc(raw["meta"]["title"])}</title>
<meta name="description" content="{esc(raw["meta"]["description"])}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..700;1,9..144,300..700&amp;family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
{css}
</style>
</head>
<body>
<div class="hm-app" id="hm-app">

  <!-- ======================= HERO ======================= -->
  <header class="hm-hero">
    <div class="hm-kicker hm-an" style="--d:.05s">
      <svg class="hm-leaf" width="13" height="13" viewBox="0 0 14 14" aria-hidden="true"><path fill="currentColor" d="M7 .6 8.4 3l3.1-1.2-.7 3 3-1.1-2 2.3 3 1.3-3.4 1 .7 3.5-2.6-1.8L7 13.4 5.5 12.9l.6-1.9-2.4 1.7.7-3.5L-1 8.2l3-1.3L-.2 4.6l3 1.1-.7-3L5.6 3z"/></svg>
      HONEY <span class="hm-x">✕</span> MAPLE
      <svg class="hm-hex" width="12" height="12" viewBox="0 0 14 14" aria-hidden="true"><path fill="currentColor" d="M7 0l6 3.5v7L7 14l-6-3.5v-7z"/></svg>
    </div>
    <h1>
      <span class="hm-an" style="--d:.12s; display:block">Two homes,</span>
      <span class="hm-an" style="--d:.22s; display:block"><em class="hm-em-maple">one circle.</em></span>
    </h1>
    <p class="hm-lede hm-an" style="--d:.34s">
      <b class="hm-maple-ink">Toronto on foot or by transit.</b>
      <b class="hm-honey-ink">Raleigh mostly by car.</b>
      Everyday journeys, compared from home.
    </p>
  </header>

  <!-- ======================= CONTROLS ======================= -->
  <div class="hm-controls hm-an" style="--d:.42s">
    <div class="hm-controls-left">
      <div class="hm-seg hm-measure" data-active="distance" role="group" aria-label="Compare distance or travel time">
        <span class="hm-seg-thumb" aria-hidden="true"></span>
        <button type="button" id="hm-btn-distance" aria-pressed="true">Distance</button>
        <button type="button" id="hm-btn-time" aria-pressed="false">Time</button>
      </div>
      <div class="hm-seg" id="hm-units" role="group" aria-label="Primary distance unit">
        <button type="button" id="hm-btn-km" aria-label="Kilometres" aria-pressed="true">km</button>
        <button type="button" id="hm-btn-mi" aria-label="Miles" aria-pressed="false">mi</button>
      </div>
      {chips_html(raw)}
    </div>
  </div>

  <!-- ======================= MAP (center stage) ======================= -->
  <section class="hm-stage">
    <figure class="hm-chartWrap hm-an" style="--d:.3s; margin:0">
      <div class="hm-chart" id="hm-chart" role="group" aria-label="{esc(hm['chart']['aria'])}"></div>
      <div class="hm-zoom" role="group" aria-label="Map zoom">
        <button type="button" id="hm-zin" aria-label="Zoom in" title="Zoom in">+</button>
        <button type="button" id="hm-zout" aria-label="Zoom out" title="Zoom out">−</button>
        <button type="button" id="hm-zfit" aria-label="Rescope to the current selection" title="Rescope to selection">⤢</button>
      </div>
      <div class="hm-scope" id="hm-scope" aria-hidden="true"></div>
      <figcaption class="hm-cap" id="hm-caption">
        <span class="hm-caption-main">Straight-line distance, on one shared scale.</span>
        <span class="hm-caption-hint">Angles eased · Tap a stop to compare · Zoom to explore</span>
      </figcaption>
    </figure>
  </section>

  <!-- ======================= CITIES ======================= -->
  <section class="hm-cities hm-an" style="--d:.5s">
    {city_card("toronto", raw, hm)}
    {city_card("raleigh", raw, hm)}
  </section>

  {metrics_section()}

  <div class="hm-sig hm-an" style="--d:1.85s">two homes · <span class="hm-leaf">one everyday</span> · honey ✕ maple</div>
</div>
<div class="hm-grain" aria-hidden="true"></div>
<noscript><p style="text-align:center;padding:20px;color:#aeb6c9">This visualization needs JavaScript — one static file, no external dependencies beyond web fonts.</p></noscript>

<script id="hm-data">window.HM_DATA = {data_js};</script>
<script>
{js}
</script>
</body>
</html>
'''
    return html


# ----------------------------------------------------------------- main
def validate(raw: dict, hm: dict) -> list:
    issues = []
    for s in hm["stops"]:
        hemi = hm["cities"][s["city"]]["hemisphere"]
        a = s["angle"]
        if hemi == "north" and not (270 <= a or a <= 90):
            issues.append(f"stop {s['key']}: angle {a}° falls in the SOUTH half but {s['city']} is north")
        if hemi == "south" and not (90 <= a <= 270):
            issues.append(f"stop {s['key']}: angle {a}° falls in the NORTH half but {s['city']} is south")
        for req in ("minutes", "timeNote", "note", "travelMode"):
            if s.get(req) in (None, ""):
                issues.append(f"stop {s['key']}: missing {req}")
        if s["km"] > NICE_VIEWS[-1]:
            issues.append(f"stop {s['key']}: {s['km']} km exceeds the widest view ({NICE_VIEWS[-1]} km)")
    for cat in raw["categories"]:
        if not any(s["category"] == cat["key"] for s in hm["stops"]):
            issues.append(f"category {cat['key']}: no stops")
    return issues


def main() -> int:
    ap = argparse.ArgumentParser(description="Regenerate index.html from data")
    ap.add_argument("--check", action="store_true", help="validate only, don't write")
    ap.add_argument("--out", default=str(OUT_FILE))
    args = ap.parse_args()

    raw = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    try:
        hm = build_hm(raw)
    except (KeyError, ValueError) as error:
        print(f"Invalid data: {error}")
        return 1
    agg = aggregates(raw, hm)

    issues = validate(raw, hm)
    for i in issues:
        print("⚠ ", i)

    print("── derived and supplied distances ──")
    for s in hm["stops"]:
        city = hm["cities"][s["city"]]
        print(f"  {s['name']:<20} {city['name']:<9} {s['km']:>6} km ({fmi(s['km'])} mi) "
              + (f"route ≈{s['routeKm']} km · " if s['routeKm'] is not None else "")
              + f"{s['timeNote']}" + (f" · {s['bearingText']}" if s['bearingText'] else "")
              + ("  [closed]" if s.get("status") == "closed" else ""))
    print("── aggregates ──")
    for k in ("toronto", "raleigh"):
        print(f"  avg errand {hm['cities'][k]['name']:<8} {agg[f'avg_{k}']} km")
    for ck, p in agg["pairs"].items():
        line = f"  {ck:<12} view {p['view']:>4} km"
        if p["ratio"]:
            line += f"  ×{p['ratio']} (TO {p['t_avg']} km · RAL {p['r_avg']} km)"
        else:
            side = p["t_avg"] or p["r_avg"]
            line += f"  one-city ring ({side} km)"
        if p["t_min"] is not None and p["r_min"] is not None:
            modes = "/".join(sorted({s["travelMode"] for s in hm["stops"]
                                    if s["category"] == ck and s["city"] == "toronto"}))
            r_modes = "/".join(sorted({s["travelMode"] for s in hm["stops"]
                                      if s["category"] == ck and s["city"] == "raleigh"}))
            line += f"  · {p['t_min']} min {modes} vs {p['r_min']} min {r_modes}"
        print(line)
    print(f"  all-stops view {agg['viewAll']} km")

    if args.check:
        print("CHECK OK" if not issues else f"CHECK: {len(issues)} issue(s)")
        return 1 if issues else 0

    html = render(raw)
    Path(args.out).write_text(html, encoding="utf-8")
    print(f"wrote {args.out} ({len(html):,} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
