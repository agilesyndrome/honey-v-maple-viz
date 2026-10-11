/* ============================================================
   HONEY ✕ MAPLE — assets/app.js
   Runtime renderer + interactions. All geometry/numbers come
   from window.HM_DATA, injected by tools/build.py. No network,
   no dependencies. Edit, then rebuild.

   The chart is a live world: a <g id="hm-world"> in km-space
   (Home at 0,0) that is zoomed + panned with one transform.
   Choosing a category hides every other stop and rescopes
   the view to the selection; the bottom metrics recompute.
   ============================================================ */
(function () {
'use strict';

const D = window.HM_DATA;
if (!D) { console.error('HM_DATA missing — regenerate index.html with tools/build.py'); return; }

const VB = D.chart.vb, C = D.chart.c, RMAX = D.chart.rMaxPx;
const RINGS = D.chart.ringKm;
const timeRings = D.chart.ringMinutes;
const views = () => MEASURE === 'time' ? D.chart.timeViewStops : D.chart.viewStops;
const KM_MI = 1.609344;
const minScope = () => views()[0] * 0.4;
const maxScope = () => views()[views().length - 1];

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const SKIP_INTRO = new URLSearchParams(window.location.search).get('reveal') === 'now';

let UNIT = 'km';
let MEASURE = 'distance';
let measureMix = 0; // 0 = km geometry, 1 = minutes; a toggle morphs every radius.
let pinnedKey = null;
let hoverKey = null;
let filterCat = 'all';
let cityEmph = null;

/* view = what the map shows: km = radius of the visible disc,
   In Time view the same coordinates are minutes; km is the legacy scope name.
   cx/cy = world offset of the viewport centre (Home at 0,0). */
const view = { km: 20, cx: 0, cy: 0 };
let tweenReq = 0;

/* ---------- tiny helpers ---------- */
const esc = s => String(s).replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const stopById = k => D.stops.find(s => s.key === k);
const stopsOf = cat => (cat === 'all' ? D.stops : D.stops.filter(s => s.category === cat));
const catOf = cat => D.categories.find(c => c.key === cat);
const metricOf = cat => (cat === 'all' ? D.allMetric : catOf(cat).metric);
const dispName = s => (s.status === 'closed' ? s.name + ' (closed)' : s.name);
const fkm = k => (Math.abs(k - Math.round(k)) < 1e-9 ? String(Math.round(k)) : (k >= 10 ? k.toFixed(0) : k.toFixed(1)));
const fmi = k => fkm(k / KM_MI);
const udist = k => (UNIT === 'km'
  ? fkm(k) + ' km (' + fmi(k) + ' mi)'
  : fmi(k) + ' mi (' + fkm(k) + ' km)');
const scale = () => RMAX / view.km;
const radius = s => s.km + (s.minutes - s.km) * measureMix;
const targetRadius = s => MEASURE === 'time' ? s.minutes : s.km;
const ringRadius = r => r.rk + (timeRings[r.index] - r.rk) * measureMix;
const shortMeasure = s => MEASURE === 'time' ? '≈' + s.minutes + ' min' : s.distShort[UNIT];
const modeLabel = s => ({ walk: 'On foot', transit: 'Public transit', drive: 'By car' }[s.travelMode]);
const modesOf = stops => [...new Set(stops.map(s => ({walk:'walking', transit:'transit', drive:'driving'}[s.travelMode])))].join(' & ');
const fitScope = maxKm => {
  const t = maxKm * 1.15;
  for (const v of views()) if (v >= t) return v;
  return maxScope();
};
/* world (km-space) position: angle 0 = up, clockwise */
const wx = s => radius(s) * Math.sin(s.angle * Math.PI / 180);
const wy = s => -radius(s) * Math.cos(s.angle * Math.PI / 180);
const sX = s => C + (wx(s) - view.cx) * scale();
const sY = s => C + (wy(s) - view.cy) * scale();

/* ---------- small icons (centred on 0,0, ~±6 units) ---------- */
const ICONS = {
  cup:  '<path d="M-2.7,-2.7 h5.4 v2 a2.7,2.7 0 0 1 -5.4,0 z"/>'
       + '<path d="M-1.3,-4.6 v1.3 M1.3,-4.6 v1.3" fill="none" stroke-width="1.1"/>',
  cart: '<path d="M-3.4,-2.6 h6.8 l-1.2,3.1 h-4.4 z"/>'
       + '<circle cx="-2.1" cy="3.2" r="1.05"/><circle cx="2.3" cy="3.2" r="1.05"/>',
  case: '<path d="M-4.2,-1.6 h8.4 v4.6 a1.3,1.3 0 0 1 -1.3,1.3 h-5.8 a1.3,1.3 0 0 1 -1.3,-1.3 z"/>'
       + '<path d="M-1.7,-1.6 v-1 a1.1,1.1 0 0 1 1.1,-1.1 h1.2 a1.1,1.1 0 0 1 1.1,1.1 v1" fill="none" stroke-width="1.2"/>',
  date: '<path d="M-2.8,-4.4 h5.6 v1.7 a2.8,2.8 0 0 1 -5.6,0 z" fill="none" stroke-width="1.1"/>'
       + '<path d="M0,-0.6 v3.4 M-1.8,3.9 h3.6" fill="none" stroke-width="1.1"/>',
};

/* ---------- decorative skylines (pure ornament, presentation-only) ---------- */
function skyPath(x0, dir, arr) {
  let p = 'M' + x0 + ',' + C, x = x0;
  for (const [w, h, g] of arr) { p += ' v' + (dir * h) + ' h' + w + ' v' + (-dir * h) + ' h' + g; x += w + g; }
  return p + ' Z';
}
const SKY = {
  toronto: skyPath(C - 195, -1, [[16,12,6],[22,18,4],[10,24,3],[16,11,5],[26,15,4],[16,20,3],[12,9,5],[16,14,5],[14,10,5],[20,16,0]]),
  raleigh: skyPath(C - 130,  1, [[18,9,7],[14,13,6],[24,10,5],[12,7,6],[20,14,4],[14,11,0]]),
};

/* ---------- build the chart (world geometry in km-space) ---------- */
function buildChart() {
  const p = [];
  p.push('<svg id="hm-svg" viewBox="0 0 ' + VB + ' ' + VB + '" role="group" aria-label="' + esc(D.chart.aria) + '">');

  p.push('<defs>'
    + '<radialGradient id="hm-gM" gradientUnits="userSpaceOnUse" cx="' + C + '" cy="' + (C - 40) + '" r="' + RMAX + '">'
      + '<stop offset="0" stop-color="' + D.cities.toronto.accent + '" stop-opacity=".085"/><stop offset=".55" stop-opacity=".03" stop-color="' + D.cities.toronto.accent + '"/><stop offset="1" stop-color="' + D.cities.toronto.accent + '" stop-opacity="0"/></radialGradient>'
    + '<radialGradient id="hm-gH" gradientUnits="userSpaceOnUse" cx="' + C + '" cy="' + (C + 40) + '" r="' + RMAX + '">'
      + '<stop offset="0" stop-color="' + D.cities.raleigh.accent + '" stop-opacity=".08"/><stop offset=".55" stop-color="' + D.cities.raleigh.accent + '" stop-opacity=".03"/><stop offset="1" stop-color="' + D.cities.raleigh.accent + '" stop-opacity="0"/></radialGradient>'
    + '<radialGradient id="hm-gHome"><stop offset="0" stop-color="#f4ecdc" stop-opacity=".5"/><stop offset="1" stop-color="#f4ecdc" stop-opacity="0"/></radialGradient>'
  + '</defs>');

  /* home-anchored furniture: tints, halo, skylines (screen space, follows Home) */
  p.push('<g id="hm-fixed">'
    + '<path d="M' + (C - RMAX) + ',' + C + ' A' + RMAX + ',' + RMAX + ' 0 0 1 ' + (C + RMAX) + ',' + C + ' Z" fill="url(#hm-gM)"/>'
    + '<path d="M' + (C - RMAX) + ',' + C + ' A' + RMAX + ',' + RMAX + ' 0 0 0 ' + (C + RMAX) + ',' + C + ' Z" fill="url(#hm-gH)"/>'
    + '<circle cx="' + C + '" cy="' + C + '" r="34" fill="none" stroke="#f4ecdc" stroke-opacity=".08"/>'
    + '<g class="hm-sky hm-pre-fade" style="--d:.5s" fill="#dbe2f5">' + SKY.toronto
      + '<path d="M' + (C + 38) + ',' + C + ' v-32" stroke="#dbe2f5" stroke-width="2.6" fill="none"/>'
      + '<ellipse cx="' + (C + 38) + '" cy="' + (C - 25) + '" rx="8" ry="3.4"/>'
      + '<circle cx="' + (C + 38) + '" cy="' + (C - 35) + '" r="1.6"/>'
    + '</g>'
    + '<g class="hm-sky hm-pre-fade" style="--d:.55s" fill="#ffe0b0">' + SKY.raleigh
      + '<path d="M' + (C + 96) + ',' + C + ' l7,-13 l7,13 z M' + (C + 116) + ',' + C + ' l6,-11 l6,11 z M' + (C + 134) + ',' + C + ' l5,-9 l5,9 z"/>'
      + '<path d="M' + (C - 152) + ',' + C + ' a9,9 0 0 0 18,0 z"/>'
    + '</g>'
  + '</g>');

  /* corner tags (chart furniture, fixed) */
  p.push('<text class="hm-tag hm-pre-fade" style="--d:.7s" x="' + C + '" y="46" text-anchor="middle">' + D.cities.toronto.tagline + '</text>');
  p.push('<text class="hm-tag hm-pre-fade" style="--d:.75s" x="' + C + '" y="' + (VB - 30) + '" text-anchor="middle">' + D.cities.raleigh.tagline + '</text>');

  /* ---------- the live world (km-space) ---------- */
  p.push('<g id="hm-world">');

  /* rings: ladder of doubling circles + counter-scaled labels/ticks */
  for (const rk of RINGS) {
    const delay = (0.06 + rk * 0.05).toFixed(2);
    p.push('<circle class="hm-ring hm-pre-ring" data-r="' + rk + '" style="--d:' + delay + 's" cx="0" cy="0" r="' + rk + '"/>');
  }
  for (const rk of RINGS) {
    p.push('<g class="hm-ringwrap hm-pre-fade" data-r="' + rk + '" style="--d:' + (0.1 + rk * 0.05).toFixed(2) + 's" transform="translate(0 ' + (-rk) + ')">'
      + '<g class="hm-fix">'
      + '<text class="hm-ringlab" x="4" y="-8"></text>'
      + '<line class="hm-ringtick" x1="0" y1="-6" x2="0" y2="6" stroke="rgba(255,255,255,.22)" stroke-width="1.4"/>'
      + '</g></g>');
  }

  /* equator */
  p.push('<line class="hm-eq hm-pre-path" style="--len:22;--d:.5s" stroke-dasharray="22" x1="-42" y1="0" x2="-20" y2="0"/>');
  p.push('<line class="hm-eq hm-pre-path" style="--len:22;--d:.5s" stroke-dasharray="22" x1="20" y1="0" x2="42" y2="0"/>');

  /* paths */
  D.stops.forEach(function (s, i) {
    const city = D.cities[s.city];
    const left = s.labelDir === 'left';
    const d = (0.85 + i * 0.09).toFixed(2) + 's';
    const g = '<g class="hm-pathg hm-anf" data-g="' + s.key + '" data-city="' + s.city + '" data-cat="' + s.category + '" style="--d:' + d + '">';
    const x = wx(s).toFixed(3), y = wy(s).toFixed(3);
    if (s.travelMode === 'walk') {
      const dx = wx(s), dy = wy(s), sgn = left ? -1 : 1;
      const cpx = (dx / 2 - sgn * 0.24 * dy).toFixed(3), cpy = (dy / 2 + sgn * 0.24 * dx).toFixed(3);
      p.push(g + '<path class="hm-pathw hm-step" stroke="' + city.soft + '" d="M0,0 Q' + cpx + ',' + cpy + ' ' + x + ',' + y + '"/></g>');
    } else if (s.travelMode === 'transit') {
      p.push(g + '<path class="hm-transitcase" stroke="' + city.accent + '" d="M0,0 L' + x + ',' + y + '"/>'
        + '<path class="hm-transitline hm-flow" stroke="' + city.soft + '" d="M0,0 L' + x + ',' + y + '"/></g>');
    } else {
      p.push(g
        + '<path class="hm-roadcase hm-pre-path" style="--len:' + s.km.toFixed(2) + ';--d:' + d + '" stroke-dasharray="' + s.km.toFixed(2) + '" stroke="' + city.accent + '" d="M0,0 L' + x + ',' + y + '"/>'
        + '<path class="hm-roadline hm-flow hm-pre-fade" style="--d:' + (1.15 + i * 0.09).toFixed(2) + 's" stroke="' + city.soft + '" d="M0,0 L' + x + ',' + y + '"/>'
      + '</g>');
    }
  });

  /* stops */
  D.stops.forEach(function (s, i) {
    const city = D.cities[s.city];
    const left = s.labelDir === 'left';
    const nx = left ? -22 : 22, ny = left ? -2 : 3, anchor = left ? 'end' : 'start';
    const labels = '<text class="hm-stopname" x="' + nx + '" y="' + ny + '" text-anchor="' + anchor + '">' + esc(dispName(s)) + '</text>'
      + '<text class="hm-stopsub hm-u" data-km="' + esc(s.distShort.km) + '" data-mi="' + esc(s.distShort.mi) + '" x="' + nx + '" y="' + (ny + 28) + '" text-anchor="' + anchor + '">' + esc(s.distShort.km) + '</text>';
    p.push('<g class="hm-ptg" data-g="' + s.key + '" data-city="' + s.city + '" data-cat="' + s.category + '" transform="translate(' + wx(s).toFixed(3) + ' ' + wy(s).toFixed(3) + ')" tabindex="0" role="button" aria-label="' + esc(s.aria) + '">'
      + '<g class="hm-anf" style="--d:' + (1.25 + i * 0.09).toFixed(2) + 's">'
      + '<g class="hm-fix">'
      + '<circle class="hm-glow" cx="0" cy="0" r="18" fill="' + city.accent + '" opacity=".14"/>'
      + '<circle class="hm-core" cx="0" cy="0" r="10.5" fill="' + city.accent + '" stroke="rgba(9,12,18,.6)" stroke-width="1.6"/>'
      + '<g transform="scale(1.25)" fill="rgba(9,12,18,.8)" stroke="rgba(9,12,18,.8)" stroke-linecap="round">' + ICONS[s.glyph] + '</g>'
      + labels
      + '</g></g></g>');
  });

  /* ghost comparison ring */
  p.push('<g class="hm-ghost" id="hm-ghost">'
    + '<circle id="hm-ghost-c" cx="0" cy="0" r="1"/>'
    + '<g id="hm-ghost-fix" class="hm-fix"><text id="hm-ghost-lab" class="hm-ghostlab" x="8" y="0"></text></g>'
  + '</g>');

  /* home */
  p.push('<g class="hm-homeg"><g class="hm-fix">'
    + '<circle class="hm-halo hm-pre-fade" style="--d:.1s" cx="0" cy="0" r="22" fill="none" stroke="#f4ecdc" stroke-opacity=".4"/>'
    + '<circle cx="0" cy="0" r="14" fill="url(#hm-gHome)"/>'
    + '<circle class="hm-pre-fade" style="--d:.05s" cx="0" cy="0" r="9" fill="#f4ecdc" stroke="rgba(9,12,18,.55)" stroke-width="1.8"/>'
    + '<text class="hm-home-lab hm-pre-fade" style="--d:.55s" x="-16" y="34" text-anchor="end">HOME</text>'
  + '</g></g>');

  p.push('</g></svg>');
  document.getElementById('hm-chart').innerHTML = p.join('');
}

/* ---------- boot the DOM ---------- */
buildChart();

const svg = document.getElementById('hm-svg');
const world = document.getElementById('hm-world');
const hmFixed = document.getElementById('hm-fixed');
const ghost = document.getElementById('hm-ghost');
const ghostC = document.getElementById('hm-ghost-c');
const ghostLab = document.getElementById('hm-ghost-lab');
const ghostFix = document.getElementById('hm-ghost-fix');
const wrap = document.querySelector('.hm-chartWrap');
const scopeEl = document.getElementById('hm-scope');

const tip = document.createElement('div');
tip.id = 'hm-tip'; tip.className = 'hm-tip'; tip.setAttribute('role', 'status');
wrap.appendChild(tip);

const ringEls = RINGS.map((rk, index) => ({
  rk, index,
  circle: svg.querySelector('.hm-ring[data-r="' + rk + '"]'),
  label: svg.querySelector('.hm-ringwrap[data-r="' + rk + '"] .hm-ringlab'),
  tick: svg.querySelector('.hm-ringwrap[data-r="' + rk + '"] .hm-ringtick'),
  wrapEl: svg.querySelector('.hm-ringwrap[data-r="' + rk + '"]'),
  on: false,
}));

// Reuse nodes throughout the morph so focus, pinned stops and pointer capture survive.
const stopEls = D.stops.map(st => ({
  st,
  dot: svg.querySelector('.hm-ptg[data-g="' + st.key + '"]'),
  paths: [...svg.querySelectorAll('.hm-pathg[data-g="' + st.key + '"] path')],
}));
function updateGeometry() {
  stopEls.forEach(({st, dot, paths}) => {
    const x = wx(st), y = wy(st);
    dot.setAttribute('transform', 'translate(' + x + ' ' + y + ')');
    const sign = st.labelDir === 'left' ? -1 : 1;
    const path = st.travelMode === 'walk'
      ? 'M0,0 Q' + (x / 2 - sign * .24 * y) + ',' + (y / 2 + sign * .24 * x) + ' ' + x + ',' + y
      : 'M0,0 L' + x + ',' + y;
    paths.forEach(el => el.setAttribute('d', path));
  });
  const active = stopById(pinnedKey || hoverKey);
  if (active) ghostC.setAttribute('r', radius(active));
}

function refreshMeasureText() {
  document.querySelectorAll('.hm-u').forEach(el => {
    const value = el.dataset[MEASURE === 'time' ? 'time' : UNIT];
    if (value != null) el.textContent = value;
  });
  stopEls.forEach(({st, dot}) => {
    dot.querySelector('.hm-stopsub').textContent = shortMeasure(st);
    dot.setAttribute('aria-label', MEASURE === 'time'
      ? dispName(st) + ', ' + D.cities[st.city].name + ' — about ' + st.minutes + ' minutes, ' + modeLabel(st)
      : st.aria);
  });
  // The nearest destination per category follows the chosen measurement too.
  Object.keys(D.cities).forEach(city => {
    document.querySelectorAll('#hm-card-' + city + ' .hm-row').forEach((row, i) => {
      const stops = D.stops.filter(st => st.city === city && st.category === D.categories[i].key);
      if (!stops.length) return;
      const near = stops.reduce((a, st) => targetRadius(st) < targetRadius(a) ? st : a);
      row.querySelector('b').textContent = near.name;
      const more = stops.length > 1 ? ' · +' + (stops.length - 1) + ' more' : '';
      const closed = near.status === 'closed' ? ' · now closed' : '';
      row.querySelector('i').textContent = (MEASURE === 'time' ? near.timeNote
        : near.distShort[UNIT] + ' · ' + near.timeNote) + more + closed;
    });
  });
  document.getElementById('hm-caption').innerHTML = '<span class="hm-caption-main">'
    + (MEASURE === 'time' ? 'Approximate travel minutes, on one shared scale.' : 'Straight-line distance, on one shared scale.')
    + '</span><span class="hm-caption-hint">Angles eased · Tap a stop to compare · Zoom to explore</span>';
  const description = (MEASURE === 'time' ? 'Travel time in minutes' : 'Straight-line distance')
    + ' from Home. Toronto above, Raleigh below. Scroll to zoom, drag to roam.';
  svg.setAttribute('aria-label', description);
  document.getElementById('hm-chart').setAttribute('aria-label', description);
}

function setMeasure(next) {
  if (next === MEASURE) return;
  MEASURE = next;
  document.getElementById('hm-btn-distance').setAttribute('aria-pressed', String(next === 'distance'));
  document.getElementById('hm-btn-time').setAttribute('aria-pressed', String(next === 'time'));
  document.getElementById('hm-units').hidden = next === 'time';
  document.getElementById('hm-app').dataset.measure = next;
  document.querySelector('.hm-measure').dataset.active = next;
  refreshMeasureText();
  renderMetrics();
  if (pinnedKey || hoverKey) activateStop(pinnedKey || hoverKey);
  const max = stopsOf(filterCat).reduce((m, st) => Math.max(m, targetRadius(st)), 0);
  // Morph all stop/path/ring radii together with the shared logarithmic zoom.
  tweenView(fitScope(max), 0, 0, 950);
}

/* ---------- view plumbing ---------- */
function clampCenter() {
  const maxOff = RMAX * 0.92 / scale();
  const d = Math.hypot(view.cx, view.cy);
  if (d > maxOff) { view.cx *= maxOff / d; view.cy *= maxOff / d; }
}

function tweenView(km, cx, cy, dur) {
  cancelAnimationFrame(tweenReq);
  km = clamp(km, minScope(), maxScope());
  const targetMix = MEASURE === 'time' ? 1 : 0;
  if (!dur || reduceMotion) { measureMix = targetMix; view.km = km; view.cx = cx; view.cy = cy; clampCenter(); applyView(); return; }
  const f = { km: view.km, cx: view.cx, cy: view.cy, mix: measureMix }, t0 = performance.now();
  const step = function (now) {
    const t = Math.min(1, (now - t0) / dur);
    const e = t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    measureMix = f.mix + (targetMix - f.mix) * e;
    view.km = f.km * Math.pow(km / f.km, e);   /* log-space zoom */
    view.cx = f.cx + (cx - f.cx) * e;
    view.cy = f.cy + (cy - f.cy) * e;
    clampCenter();
    applyView();
    if (t < 1) tweenReq = requestAnimationFrame(step);
  };
  tweenReq = requestAnimationFrame(step);
}

/* keep the km-space point under a viewBox point fixed while zooming */
function zoomTo(km2, vbPt) {
  const s1 = scale();
  const kx = (vbPt.x - C) / s1 + view.cx;
  const ky = (vbPt.y - C) / s1 + view.cy;
  const s2 = RMAX / km2;
  view.km = km2;
  view.cx = kx - (vbPt.x - C) / s2;
  view.cy = ky - (vbPt.y - C) / s2;
  clampCenter();
}

function clientToVb(cx, cy) {
  const r = svg.getBoundingClientRect();
  return { x: (cx - r.left) * VB / r.width, y: (cy - r.top) * VB / r.width };
}

/* ---------- label decluttering (estimated boxes, greedy) ---------- */
const inter = (a, b) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;

function setLabelSide(name, sub, side) {
  const left = side === 'left';
  const ny = left ? -2 : 3;
  name.setAttribute('x', left ? -22 : 22);
  name.setAttribute('y', ny);
  name.setAttribute('text-anchor', left ? 'end' : 'start');
  sub.setAttribute('x', left ? -22 : 22);
  sub.setAttribute('y', ny + 28);
  sub.setAttribute('text-anchor', left ? 'end' : 'start');
}

function declutter() {
  const s = scale();
  const vis = stopsOf(filterCat).slice().sort((a, b) => radius(b) - radius(a));
  const placed = [];
  const hit = box => placed.some(o => inter(o, box));

  /* Home dot + HOME text + every visible stop dot are obstacles */
  const hx = C - view.cx * s, hy = C - view.cy * s;
  placed.push({ x1: hx - 16, y1: hy - 16, x2: hx + 16, y2: hy + 16 });
  placed.push({ x1: hx - 16 - 82, y1: hy + 34 - 13, x2: hx - 16, y2: hy + 34 + 4 });
  vis.forEach(st => {
    const x = sX(st), y = sY(st);
    placed.push({ x1: x - 13, y1: y - 13, x2: x + 13, y2: y + 13 });
  });

  vis.forEach(st => {
    const g = svg.querySelector('.hm-ptg[data-g="' + st.key + '"]');
    if (!g) return;
    const name = g.querySelector('.hm-stopname');
    const sub = g.querySelector('.hm-stopsub');
    const x = sX(st), y = sY(st);
    let done = false;
    const sides = [st.labelDir, st.labelDir === 'left' ? 'right' : 'left'];
    for (const side of sides) {
      setLabelSide(name, sub, side);
      name.style.display = ''; sub.style.display = '';
      // Use real font bounds; character-count estimates missed minute-label collisions.
      const boxOf = el => {
        const b = el.getBBox(), pad = 5;
        return { x1: x + b.x - pad, y1: y + b.y - pad,
          x2: x + b.x + b.width + pad, y2: y + b.y + b.height + pad };
      };
      const nb = boxOf(name), sb = boxOf(sub);
      const inside = nb.x1 >= 4 && sb.x1 >= 4 && nb.x2 <= VB - 4 && sb.x2 <= VB - 4;
      if (inside && !hit(nb) && !hit(sb)) {
        setLabelSide(name, sub, side);
        name.style.display = ''; sub.style.display = '';
        placed.push(nb, sb);
        done = true;
        break;
      }
    }
    if (!done) { name.style.display = 'none'; sub.style.display = 'none'; }
  });

  /* ring labels yield to stop labels */
  ringEls.forEach(r => {
    if (!r.on) return;
    const lx = C - view.cx * s + 4;
    const ly = C + (-ringRadius(r) - view.cy) * s;
    const value = MEASURE === 'time' ? timeRings[r.index] : r.rk;
    const full = MEASURE === 'time' ? fkm(value) + ' min' : (UNIT === 'km'
      ? fkm(value) + ' km · ' + fmi(value) + ' mi'
      : fmi(value) + ' mi · ' + fkm(value) + ' km');
    r.label.textContent = full;
    r.label.style.display = '';
    const b = r.label.getBBox();
    const box = { x1: lx + b.x - 4, y1: ly + b.y - 4,
      x2: lx + b.x + b.width + 4, y2: ly + b.y + b.height + 4 };
    const on = ringRadius(r) * s >= 48 && !hit(box);
    r.label.style.display = on ? '' : 'none';
    if (on) placed.push(box);
  });
  if (ghost.classList.contains('on')) {
    ghostLab.style.display = '';
    const b = ghostLab.getBBox(), r = +ghostC.getAttribute('r');
    const gx = C - view.cx * s, gy = C + (r - view.cy) * s + 24;
    const box = {x1: gx + b.x - 4, y1: gy + b.y - 4,
      x2: gx + b.x + b.width + 4, y2: gy + b.y + b.height + 4};
    if (hit(box)) ghostLab.style.display = 'none';
  }
}

/* ---------- apply the current view to the world ---------- */
function applyView() {
  const s = scale();
  clampCenter();
  updateGeometry();
  world.setAttribute('transform', 'translate(' + (C - view.cx * s) + ' ' + (C - view.cy * s) + ') scale(' + s + ')');
  hmFixed.setAttribute('transform', 'translate(' + (-view.cx * s) + ' ' + (-view.cy * s) + ')');

  /* counter-scaled groups keep a constant on-screen size */
  svg.querySelectorAll('.hm-fix').forEach(function (g) {
    if (g.id === 'hm-ghost-fix') return;
    g.setAttribute('transform', 'scale(' + (1 / s) + ')');
  });

  /* rings: show the doubling ladder up to the current scope */
  let outer = 0;
  for (const r of ringEls) {
    r.on = ringRadius(r) <= view.km * 1.02 && ringRadius(r) * s >= 24;
    if (r.on) outer = Math.max(outer, ringRadius(r));
  }
  ringEls.forEach(function (r) {
    const is8 = r.on && ringRadius(r) === outer;
    r.circle.style.display = r.on ? '' : 'none';
    r.circle.classList.toggle('hm-ring8', is8);
    r.circle.setAttribute('r', ringRadius(r));
    r.wrapEl.setAttribute('transform', 'translate(0 ' + (-ringRadius(r)) + ')');
    r.circle.setAttribute('stroke-width', (is8 ? 2.2 : 1.8) / s);
    r.wrapEl.style.display = r.on ? '' : 'none';
    r.tick.setAttribute('x1', ringRadius(r) * s);
    r.tick.setAttribute('x2', ringRadius(r) * s);
  });

  /* stroke weights + dash patterns stay legible at every zoom */
  svg.querySelectorAll('.hm-eq').forEach(el => el.setAttribute('stroke-width', 1.6 / s));
  svg.querySelectorAll('.hm-pathw').forEach(el => {
    el.setAttribute('stroke-width', 3.2 / s);
    el.setAttribute('stroke-dasharray', (0.1 / s) + ' ' + (8 / s));
  });
  svg.querySelectorAll('.hm-roadcase').forEach(el => el.setAttribute('stroke-width', 7 / s));
  svg.querySelectorAll('.hm-roadline').forEach(el => {
    el.setAttribute('stroke-width', 2.6 / s);
    el.setAttribute('stroke-dasharray', (13 / s) + ' ' + (8 / s));
  });
  svg.querySelectorAll('.hm-transitcase').forEach(el => el.setAttribute('stroke-width', 8 / s));
  svg.querySelectorAll('.hm-transitline').forEach(el => {
    el.setAttribute('stroke-width', 2.6 / s);
    el.setAttribute('stroke-dasharray', (3 / s) + ' ' + (11 / s));
  });
  ghostC.setAttribute('stroke-width', 2.6 / s);
  ghostC.setAttribute('stroke-dasharray', (5 / s) + ' ' + (9 / s));

  /* ambient dash-flow keeps a constant screen pace */
  svg.querySelectorAll('.hm-flow').forEach(el => el.style.animationDuration = clamp(1.6 / s, .05, 5) + 's');
  svg.querySelectorAll('.hm-step').forEach(el => el.style.animationDuration = clamp(1.5 / s, .05, 5) + 's');

  declutter();

  /* scope badge */
  scopeEl.textContent = 'scope ' + (MEASURE === 'time' ? fkm(view.km) + ' min' : (UNIT === 'km' ? fkm(view.km) + ' km' : fmi(view.km) + ' mi'));

  /* keep ghost + tooltip glued to their stops */
  if (ghost.classList.contains('on')) {
    const r = +ghostC.getAttribute('r');
    ghostFix.setAttribute('transform', 'translate(0 ' + (r + 24 / s) + ') scale(' + (1 / s) + ')');
  }
  if (tip.classList.contains('show') && (pinnedKey || hoverKey)) {
    const dot = svg.querySelector('.hm-ptg[data-g="' + (pinnedKey || hoverKey) + '"] .hm-core');
    if (dot) placeTip(tip, wrap, dot);
  }
}

/* ---------- emphasis / filter ---------- */
function applyEmphasis() {
  svg.querySelectorAll('.hm-ptg, .hm-pathg').forEach(function (g) {
    const filtered = filterCat !== 'all' && g.dataset.cat !== filterCat;
    g.classList.toggle('hm-hid', filtered);
    if (g.classList.contains('hm-ptg')) g.setAttribute('tabindex', filtered ? '-1' : '0');
    g.classList.toggle('hm-off', !filtered && !!cityEmph && g.dataset.city !== cityEmph);
  });
}

function fitSelection(animate) {
  const sel = stopsOf(filterCat);
  const maxKm = sel.reduce((m, st) => Math.max(m, targetRadius(st)), 0);
  tweenView(fitScope(maxKm), 0, 0, animate && !reduceMotion ? 700 : 0);
}

function setFilter(cat) {
  filterCat = cat;
  document.querySelectorAll('.hm-chip').forEach(function (chip) {
    chip.setAttribute('aria-pressed', String(chip.dataset.cat === cat));
    chip.setAttribute('aria-checked', String(chip.dataset.cat === cat));
  });
  const selected = document.querySelector('.hm-chip[data-cat="' + cat + '"]');
  document.getElementById('hm-category-label').textContent = cat === 'all' ? 'All stops' : catOf(cat).label;
  document.querySelector('.hm-picker-icon').innerHTML = selected.querySelector('.hm-option-icon').innerHTML;
  document.getElementById('hm-category').setAttribute('aria-label', 'Category: ' + (cat === 'all' ? 'All stops' : catOf(cat).label));
  if (pinnedKey) {
    const st = stopById(pinnedKey);
    if (st && filterCat !== 'all' && st.category !== filterCat) unpin();
  }
  applyEmphasis();
  fitSelection(true);
  renderMetrics();
}

/* ---------- tooltip ---------- */
function placeTip(tipEl, wrapEl, dot) {
  const wr = wrapEl.getBoundingClientRect(), dr = dot.getBoundingClientRect();
  const px = dr.left + dr.width / 2 - wr.left, py = dr.top + dr.height / 2 - wr.top;
  tipEl.style.setProperty('--tc', tipEl.dataset.accent);
  let left = px - 284; if (left < 4) left = px + 22;
  left = clamp(left, 4, Math.max(4, wr.width - tipEl.offsetWidth - 4));
  let top = py - tipEl.offsetHeight - 24; if (top < 4) top = py + 24;
  tipEl.style.left = left + 'px'; tipEl.style.top = top + 'px';
}
function tipHtml(st) {
  const city = D.cities[st.city];
  return '<div class="hm-tip-head"><span style="width:9px;height:9px;border-radius:50%;background:' + city.accent + ';display:inline-block"></span>'
    + esc(dispName(st)) + '<span class="hm-tip-cat">' + esc(st.catLabel) + '</span></div>'
    + '<div class="hm-tip-rows">'
    + (MEASURE === 'distance' ? '<div class="hm-tip-row">Distance<b>' + st.distStr[UNIT] + '</b></div>'
    + '<div class="hm-tip-row">Route<b>' + st.routeStr[UNIT] + '</b></div>' : '')
    + '<div class="hm-tip-row">' + modeLabel(st) + '<b>' + esc(st.timeNote) + '</b></div>'
    + '<div class="hm-tip-row">Bearing<b>' + esc(st.bearingText) + '</b></div>'
    + (st.status === 'closed' ? '<div class="hm-tip-row">Status<b>now closed</b></div>' : '')
    + '</div>'
    + '<div class="hm-tip-estimate">' + esc(st.timeDetail) + '</div>'
    + (MEASURE === 'distance' ? '<div class="hm-tip-note">' + esc(st.note) + '</div>' : '');
}

function activateStop(key) {
  const st = stopById(key);
  const city = D.cities[st.city];
  svg.classList.add('hm-dim');
  svg.querySelectorAll('.hm-ptg, .hm-pathg').forEach(function (g) { g.classList.toggle('on', g.dataset.g === key); });

  ghostC.setAttribute('r', radius(st));
  ghostC.setAttribute('stroke', city.accent);
  ghostLab.setAttribute('fill', city.accent);
  ghostLab.textContent = shortMeasure(st);
  ghost.classList.add('on');
  tip.dataset.accent = city.accent;
  tip.innerHTML = tipHtml(st);
  tip.classList.add('show');
  applyView();
  const dot = svg.querySelector('.hm-ptg[data-g="' + key + '"] .hm-core');
  placeTip(tip, wrap, dot);
}
function deactivateStop() {
  svg.classList.remove('hm-dim');
  svg.querySelectorAll('.on').forEach(function (g) { g.classList.remove('on'); });
  ghost.classList.remove('on');
  tip.classList.remove('show');
}

/* ---------- pinning ---------- */
function pinStop(key) {
  pinnedKey = key;
  document.querySelectorAll('.hm-ptg.pinned').forEach(function (g) { g.classList.remove('pinned'); });
  svg.querySelector('.hm-ptg[data-g="' + key + '"]').classList.add('pinned');
  activateStop(key);
}
function unpin() {
  pinnedKey = null;
  document.querySelectorAll('.hm-ptg.pinned').forEach(function (g) { g.classList.remove('pinned'); });
  deactivateStop();
}

/* ---------- metrics (bottom cards, recomputed per selection) ---------- */
function animNum(el, to, dec, prefix) {
  if (!el) return;
  cancelAnimationFrame(el.hmNumberFrame);
  const from = parseFloat(el.dataset.cur || '0');
  el.dataset.cur = String(to);
  if (reduceMotion || SKIP_INTRO) { el.textContent = prefix + to.toFixed(dec); return; }
  const t0 = performance.now(), dur = 700;
  const tick = function (now) {
    const t = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - t, 3);
    el.textContent = prefix + (from + (to - from) * e).toFixed(dec);
    if (t < 1) el.hmNumberFrame = requestAnimationFrame(tick);
  };
  el.hmNumberFrame = requestAnimationFrame(tick);
}

function renderMetrics() {
  const m = metricOf(filterCat);
  const sel = stopsOf(filterCat);
  if (!sel.length) return;
  const T = sel.filter(st => st.city === 'toronto');
  const R = sel.filter(st => st.city === 'raleigh');
  const avg = a => (a.length ? a.reduce((x, st) => x + targetRadius(st), 0) / a.length : 0);
  const avgMin = a => (a.length ? a.reduce((x, st) => x + st.minutes, 0) / a.length : 0);

  const num1 = document.getElementById('hm-m1-num'), unit1 = document.getElementById('hm-m1-unit');
  const lab1 = document.getElementById('hm-m1-lab'), p1 = document.getElementById('hm-m1-p');
  const num2 = document.getElementById('hm-m2-num'), unit2 = document.getElementById('hm-m2-unit');
  const p2 = document.getElementById('hm-m2-p');
  const num3a = document.getElementById('hm-m3a'), num3b = document.getElementById('hm-m3b');
  const arrow3 = document.getElementById('hm-m3-arrow'), p3 = document.getElementById('hm-m3-p');

  /* card 1 — the gap */
  lab1.textContent = m.title + (MEASURE === 'time' ? ' · time' : '');
  if (T.length && R.length) {
    const ratio = avg(R) / avg(T);
    animNum(num1, +ratio.toFixed(1), 1, '×');
    unit1.style.display = 'none';
    p1.innerHTML = 'Toronto averages <b>' + (MEASURE === 'time' ? '≈' + Math.round(avg(T)) + ' min' : udist(avg(T)))
      + '</b>; Raleigh, <b>' + (MEASURE === 'time' ? '≈' + Math.round(avg(R)) + ' min' : udist(avg(R))) + '</b>.';
  } else {
    const solo = T.length ? T : R;
    const names = solo.map(st => dispName(st)).join(' & ');
    const km = avg(solo);
    animNum(num1, +(MEASURE === 'time' ? km : (UNIT === 'km' ? km : km / KM_MI)).toFixed(MEASURE === 'time' ? 0 : 1), MEASURE === 'time' ? 0 : 1, '');
    unit1.textContent = MEASURE === 'time' ? 'min' : UNIT;
    unit1.style.display = '';
    p1.innerHTML = '<b>' + esc(names) + '</b> · ' + esc(D.cities[solo[0].city].name) + ' only.';
  }

  /* card 2 — the widest ring */
  const wide = sel.reduce((a, st) => (targetRadius(st) > targetRadius(a) ? st : a), sel[0]);
  animNum(num2, +(MEASURE === 'time' ? wide.minutes : (UNIT === 'km' ? wide.km : wide.km / KM_MI)).toFixed(MEASURE === 'time' ? 0 : 1), MEASURE === 'time' ? 0 : 1, '');
  unit2.textContent = MEASURE === 'time' ? 'min' : UNIT;
  p2.innerHTML = '<b>' + esc(dispName(wide)) + '</b> · ' + esc(D.cities[wide.city].name) + '.';

  /* card 3 — minutes */
  if (T.length && R.length) {
    const t = Math.round(avgMin(T)), r = Math.round(avgMin(R));
    animNum(num3a, t, 0, '');
    animNum(num3b, r, 0, '');
    arrow3.style.display = '';
    p3.innerHTML = 'Toronto → Raleigh · ' + modesOf(T) + ' vs driving.';
  } else {
    const solo = T.length ? T : R;
    const mode = modesOf(solo);
    const t = Math.round(avgMin(solo));
    animNum(num3a, t, 0, '');
    arrow3.style.display = 'none';
    num3b.textContent = '';
    p3.innerHTML = esc(D.cities[solo[0].city].name) + ' · ' + mode + ', each way.';
  }
}

/* ---------- unit toggle ---------- */
function setUnit(next) {
  if (next === UNIT || MEASURE === 'time') return;
  UNIT = next;
  document.getElementById('hm-btn-km').setAttribute('aria-pressed', String(next === 'km'));
  document.getElementById('hm-btn-mi').setAttribute('aria-pressed', String(next === 'mi'));
  refreshMeasureText();
  renderMetrics();
  applyView();
  if (pinnedKey || hoverKey) activateStop(pinnedKey || hoverKey);
}

/* ---------- intro ---------- */
function playIntro() {
  const app = document.getElementById('hm-app');
  if (SKIP_INTRO || reduceMotion) {
    renderMetrics();
    svg.classList.add('hm-live');
    return;
  }
  app.classList.add('hm-pre');
  svg.classList.add('hm-pre');
  void app.offsetWidth;
  requestAnimationFrame(function () {
    app.classList.remove('hm-pre');
    svg.classList.remove('hm-pre');
    renderMetrics();
    setTimeout(function () { svg.classList.add('hm-live'); }, 2600);
  });
}

/* ---------- events: stops ---------- */
let panMoved = 0;
D.stops.forEach(function (st) {
  const g = svg.querySelector('.hm-ptg[data-g="' + st.key + '"]');
  g.addEventListener('mouseenter', function () { hoverKey = st.key; if (!pinnedKey) activateStop(st.key); });
  g.addEventListener('mouseleave', function () { hoverKey = null; if (!pinnedKey) deactivateStop(); });
  g.addEventListener('focus', function () { hoverKey = st.key; activateStop(st.key); });
  g.addEventListener('blur', function () { hoverKey = null; if (pinnedKey !== st.key) deactivateStop(); });
  g.addEventListener('click', function () {
    const dragged = panMoved > 6;   /* it was a drag, not a click */
    panMoved = 0;
    if (dragged) return;
    pinnedKey === st.key ? unpin() : pinStop(st.key);
  });
  g.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      panMoved = 0;
      pinnedKey === st.key ? unpin() : pinStop(st.key);
    }
  });
});
svg.addEventListener('mouseleave', function () { hoverKey = null; if (!pinnedKey) deactivateStop(); });
document.addEventListener('pointerdown', function (e) {
  const t = e.target;
  if (t && t.closest && !t.closest('.hm-ptg') && !t.closest('.hm-picker') && !t.closest('.hm-zoom') && !t.closest('.hm-seg')) unpin();
});
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') unpin(); });

/* ---------- events: chips, units, cards ---------- */
const categoryTrigger = document.getElementById('hm-category');
const categoryMenu = document.getElementById('hm-category-menu');
const picker = document.querySelector('.hm-picker');
function closeCategory(returnFocus) {
  categoryMenu.hidden = true;
  categoryTrigger.setAttribute('aria-expanded', 'false');
  if (returnFocus) categoryTrigger.focus({preventScroll:true});
}
function openCategory(edge) {
  categoryMenu.hidden = false;
  categoryTrigger.setAttribute('aria-expanded', 'true');
  const items = [...categoryMenu.querySelectorAll('.hm-chip')];
  const selected = categoryMenu.querySelector('[aria-checked="true"]');
  (edge === 'first' ? items[0] : edge === 'last' ? items[items.length - 1] : selected).focus({preventScroll:true});
}
categoryTrigger.addEventListener('click', () => categoryMenu.hidden ? openCategory() : closeCategory(false));
categoryTrigger.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault(); e.stopPropagation();
    openCategory(e.key === 'ArrowDown' ? 'first' : 'last');
  }
});
// Menu buttons retain native Enter/Space activation; arrow keys move focus only.
picker.addEventListener('keydown', e => {
  if (categoryMenu.hidden) return;
  if (e.key === 'Escape') {
    e.preventDefault(); e.stopPropagation(); closeCategory(true); return;
  }
  const items = [...categoryMenu.querySelectorAll('.hm-chip')];
  const index = items.indexOf(document.activeElement);
  let target;
  if (e.key === 'ArrowDown') target = items[(index + 1) % items.length];
  if (e.key === 'ArrowUp') target = items[(index + items.length - 1) % items.length];
  if (e.key === 'Home') target = items[0];
  if (e.key === 'End') target = items[items.length - 1];
  if (e.key.length === 1 && /[a-z]/i.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
    target = items.find(item => item.textContent.trim().replace(/^◈/, '').toLowerCase().startsWith(e.key.toLowerCase()));
  }
  if (target) { e.preventDefault(); target.focus({preventScroll:true}); }
});
document.addEventListener('pointerdown', e => { if (!picker.contains(e.target)) closeCategory(false); });
picker.addEventListener('focusout', e => { if (!picker.contains(e.relatedTarget)) closeCategory(false); });
document.querySelectorAll('.hm-chip').forEach(function (chip) {
  chip.addEventListener('click', function () { setFilter(chip.dataset.cat); closeCategory(true); });
});
document.getElementById('hm-btn-distance').addEventListener('click', function () { setMeasure('distance'); });
document.getElementById('hm-btn-time').addEventListener('click', function () { setMeasure('time'); });
document.getElementById('hm-btn-km').addEventListener('click', function () { setUnit('km'); });
document.getElementById('hm-btn-mi').addEventListener('click', function () { setUnit('mi'); });

Object.keys(D.cities).forEach(function (cityKey) {
  const card = document.getElementById('hm-card-' + cityKey);
  if (!card) return;
  const on = function () { cityEmph = cityKey; applyEmphasis(); };
  const off = function () { cityEmph = null; applyEmphasis(); };
  card.addEventListener('mouseenter', on); card.addEventListener('mouseleave', off);
  card.addEventListener('focus', on); card.addEventListener('blur', off);
});

/* ---------- events: zoom + pan ---------- */
document.getElementById('hm-zin').addEventListener('click', function () {
  tweenView(view.km * 0.72, view.cx, view.cy, 220);
});
document.getElementById('hm-zout').addEventListener('click', function () {
  tweenView(view.km * 1.39, view.cx, view.cy, 220);
});
document.getElementById('hm-zfit').addEventListener('click', function () { fitSelection(true); });

svg.addEventListener('wheel', function (e) {
  e.preventDefault();
  cancelAnimationFrame(tweenReq);
  measureMix = MEASURE === 'time' ? 1 : 0;
  const f = Math.exp(clamp(e.deltaY, -60, 60) * 0.0016);
  zoomTo(clamp(view.km * f, minScope(), maxScope()), clientToVb(e.clientX, e.clientY));
  applyView();
}, { passive: false });

const pointers = new Map();
let pinchPrev = null;

svg.addEventListener('pointerdown', function (e) {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  svg.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  panMoved = 0;
  pinchPrev = null;
  cancelAnimationFrame(tweenReq);
  measureMix = MEASURE === 'time' ? 1 : 0;
  applyView();
  svg.classList.add('hm-panning');
});

svg.addEventListener('pointermove', function (e) {
  if (!pointers.has(e.pointerId)) return;
  const r = svg.getBoundingClientRect();
  const k = VB / r.width;
  if (pointers.size === 1) {
    const prev = pointers.get(e.pointerId);
    const dx = (e.clientX - prev.x) * k, dy = (e.clientY - prev.y) * k;
    panMoved += Math.abs(dx) + Math.abs(dy);
    const s = scale();
    view.cx -= dx / s;
    view.cy -= dy / s;
    applyView();
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  } else if (pointers.size === 2) {
    const old = pinchPrev;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const p = [...pointers.values()];
    const newD = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) * k;
    const newMid = { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
    if (old) {
      const oldMidVb = clientToVb(old.mid.x, old.mid.y);
      zoomTo(clamp(view.km * old.d / Math.max(newD, 1), minScope(), maxScope()), oldMidVb);
      const s = scale();
      view.cx -= (newMid.x - old.mid.x) * k / s;
      view.cy -= (newMid.y - old.mid.y) * k / s;
      panMoved += 8;
      applyView();
    }
    pinchPrev = { d: newD, mid: newMid };
  }
});

const endPointer = function (e) {
  pointers.delete(e.pointerId);
  pinchPrev = null;
  if (!pointers.size) svg.classList.remove('hm-panning');
};
svg.addEventListener('pointerup', endPointer);
svg.addEventListener('pointercancel', endPointer);
svg.addEventListener('lostpointercapture', endPointer);

/* ---------- boot ---------- */
view.km = fitScope(D.stops.reduce((mx, st) => Math.max(mx, targetRadius(st)), 0));
applyEmphasis();
applyView();
playIntro();
// Font loading can change label bounds after the first frame.
if (document.fonts) document.fonts.ready.then(applyView);

/* test/debug hook (used by tools/diag.html) */
window.HM = {
  get view() { return { km: view.km, cx: view.cx, cy: view.cy }; },
  filter: function () { return filterCat; },
  get measure() { return MEASURE; },
  get measureMix() { return measureMix; },
};
})();
