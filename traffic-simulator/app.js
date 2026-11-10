/* Simulateur « Avant / Après » — interface (aucune bibliothèque externe).
 *
 * Écran 1 : l'utilisateur choisit le nombre d'intersections et, pour chacune,
 *           les voitures présentes au départ et le flux d'arrivées (véh/min).
 * Écran 2 : le même trafic est simulé avec les feux fixes et avec l'agent GNN + DQN
 *           (moteur engine.js, dans le navigateur), puis rejoué côte à côte, pas par pas.
 */
"use strict";

const $ = (s) => document.querySelector(s);
const APPROACHES = ["N", "S", "E", "W"];
const DIR = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] }; // côté de l'approche (dx, dy)
const DIR_NAMES = { N: "Nord", S: "Sud", E: "Est", W: "Ouest" };
const CAR_COLORS = ["#e4572e", "#f3a712", "#29a3d6", "#7b61ff", "#2bb673", "#ff7eb6", "#f5f5f5", "#5c6bc0", "#ffd166"];
const STEPS_PER_SECOND = 2.5; // vitesse ×1 : 2,5 pas (12,5 s simulées) par seconde réelle

const state = {
  n: 6,
  layout: null,
  nodes: [],        // [{cars, inflow}]
  selected: 0,
  bundle: null,     // model.json : poids du GNN + paramètres du simulateur
  sim: null,        // résultat de la simulation
  t: 0,             // position de lecture (en pas, fractionnaire)
  playing: false,
  speed: 2,
  lastTs: 0,
};

/* ================================================================ outils */
function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
function palette() {
  return {
    grass: css("--grass"), grass2: css("--grass-2"), road: css("--road"), roadEdge: css("--road-edge"),
    lane: css("--lane"), node: css("--node"), text: css("--text"), muted: css("--muted"),
    accent: css("--accent"), fixed: css("--fixed"), agent: css("--agent"), surface: css("--surface"),
    border: css("--border"), bad: css("--bad"),
  };
}
function fitCanvas(cv) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(cv.clientWidth * dpr));
  const h = Math.max(1, Math.round(cv.clientHeight * dpr));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, W: cv.clientWidth, H: cv.clientHeight };
}
function fmtClock(sec) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
function hash(a, b, c) { return Math.abs((a * 73856093) ^ (b * 19349663) ^ (c * 83492791)); }
/* ================================================================ géométrie */
function geometry(W, H, layout) {
  const { rows, cols } = layout;
  const unit = Math.min(W / (cols + 0.6), H / (rows + 0.6));
  const ox = (W - cols * unit) / 2, oy = (H - rows * unit) / 2;
  const rw = Math.max(16, unit * 0.2);              // largeur de la route (2 voies)
  const pos = layout.nodes.map((nd) => ({ x: ox + (nd.col + 0.5) * unit, y: oy + (nd.row + 0.5) * unit }));
  const car = { len: rw * 0.4, wid: rw * 0.3, gap: rw * 0.1 };
  return { unit, rw, pos, car, W, H, half: rw / 2, lane: rw / 4 };
}

// Point sur la voie d'une approche, à la distance d de la ligne d'arrêt (vers l'extérieur)
function lanePoint(g, node, a, d) {
  const p = g.pos[node];
  const [dx, dy] = DIR[a];
  // circulation à droite : voie entrante décalée sur la droite du conducteur
  const side = { N: [-1, 0], S: [1, 0], E: [0, -1], W: [0, 1] }[a];
  return {
    x: p.x + dx * (g.half + d) + side[0] * g.lane,
    y: p.y + dy * (g.half + d) + side[1] * g.lane,
  };
}

// Longueur disponible pour la file d'une approche
function approachLength(g, layout, node, a) {
  const nb = layout.neighbors[`${node},${a}`];
  if (nb !== undefined) return g.unit - g.rw - 4;
  const p = g.pos[node];
  return { N: p.y, S: g.H - p.y, W: p.x, E: g.W - p.x }[a] - g.half - 4;
}

/* ================================================================ dessin de la ville */
function drawCity(cv, layout, frame, opts = {}) {
  const { ctx, W, H } = fitCanvas(cv);
  const P = palette();
  const g = geometry(W, H, layout);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = P.grass;
  ctx.fillRect(0, 0, W, H);

  // pâtés de maisons entre les routes (décor)
  ctx.fillStyle = P.grass2;
  for (let r = 0; r <= layout.rows; r++) {
    for (let c = 0; c <= layout.cols; c++) {
      const x = (W - layout.cols * g.unit) / 2 + (c - 0.5) * g.unit + g.half + 6;
      const y = (H - layout.rows * g.unit) / 2 + (r - 0.5) * g.unit + g.half + 6;
      roundRect(ctx, x, y, g.unit - g.rw - 12, g.unit - g.rw - 12, 8);
      ctx.fill();
    }
  }

  // routes : liens entre intersections + tronçons d'entrée/sortie
  const segs = [];
  for (const [u, v] of layout.edges) segs.push([g.pos[u], g.pos[v]]);
  layout.nodes.forEach((nd, u) => {
    for (const a of APPROACHES) {
      if (layout.neighbors[`${u},${a}`] !== undefined) continue;
      const p = g.pos[u], [dx, dy] = DIR[a];
      const L = { N: p.y, S: H - p.y, W: p.x, E: W - p.x }[a];
      segs.push([p, { x: p.x + dx * L, y: p.y + dy * L }]);
    }
  });
  ctx.lineCap = "butt";
  ctx.strokeStyle = P.roadEdge; ctx.lineWidth = g.rw + 4;
  for (const [p, q] of segs) line(ctx, p, q);
  ctx.strokeStyle = P.road; ctx.lineWidth = g.rw;
  for (const [p, q] of segs) line(ctx, p, q);
  ctx.strokeStyle = P.lane; ctx.lineWidth = 1.5; ctx.setLineDash([g.rw * 0.35, g.rw * 0.35]);
  for (const [p, q] of segs) line(ctx, p, q);
  ctx.setLineDash([]);

  // intersections
  layout.nodes.forEach((nd, u) => {
    const p = g.pos[u];
    const q = frame ? frame.queues[u].reduce((s, x) => s + x, 0) : 0;
    if (frame && q > 12) { // halo d'embouteillage
      ctx.fillStyle = P.bad;
      ctx.globalAlpha = Math.min(0.35, 0.08 + q / 150);
      ctx.beginPath(); ctx.arc(p.x, p.y, g.rw * 1.3, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = P.node;
    ctx.fillRect(p.x - g.half - 2, p.y - g.half - 2, g.rw + 4, g.rw + 4);
    // passages piétons
    ctx.fillStyle = P.lane; ctx.globalAlpha = 0.55;
    for (let i = 0; i < 4; i++) {
      const o = -g.half + (i + 0.5) * (g.rw / 4) - 1.5;
      ctx.fillRect(p.x + o, p.y - g.half - 2, 3, 2); ctx.fillRect(p.x + o, p.y + g.half, 3, 2);
      ctx.fillRect(p.x - g.half - 2, p.y + o, 2, 3); ctx.fillRect(p.x + g.half, p.y + o, 2, 3);
    }
    ctx.globalAlpha = 1;
  });

  if (frame) {
    drawQueuesAndTransit(ctx, g, layout, frame, opts);
    drawLights(ctx, g, layout, frame);
  }

  // numéros et sélection
  layout.nodes.forEach((nd, u) => {
    const p = g.pos[u];
    const bx = p.x + g.half + 10, by = p.y - g.half - 10;
    if (opts.selected === u) {
      ctx.strokeStyle = P.accent; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(p.x, p.y, g.rw * 0.95, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.fillStyle = opts.selected === u ? P.accent : P.surface;
    ctx.beginPath(); ctx.arc(bx, by, 10, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = P.border; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = opts.selected === u ? "#fff" : P.text;
    ctx.font = "600 11px Segoe UI, system-ui, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(String(u + 1), bx, by + 0.5);
  });

  if (opts.preview) drawPreviewBadges(ctx, g, layout, opts.preview, P);
  return g;
}

function drawQueuesAndTransit(ctx, g, layout, frame, opts) {
  const { len, wid, gap } = g.car;
  const step = len + gap;
  const tails = {}; // position de la fin de file, pour que les voitures en transit s'y arrêtent

  layout.nodes.forEach((nd, u) => {
    APPROACHES.forEach((a, ai) => {
      const q = frame.queues[u][ai];
      const avail = approachLength(g, layout, u, a);
      const maxVis = Math.max(1, Math.floor((avail - gap) / step));
      const vis = Math.min(q, maxVis);
      for (let i = 0; i < vis; i++) {
        drawCar(ctx, lanePoint(g, u, a, gap + i * step + len / 2), a, len, wid, CAR_COLORS[hash(u, ai, i) % CAR_COLORS.length]);
      }
      tails[`${u},${a}`] = gap + vis * step;
      if (q > vis) { // file plus longue que la route visible
        const p = lanePoint(g, u, a, Math.min(avail - 10, gap + vis * step - len));
        badge(ctx, p.x, p.y, `+${q - vis}`);
      }
    });
  });

  // voitures en transit entre deux intersections (positions interpolées)
  const T = frame.transit.length;
  const frac = opts.frac || 0;
  for (let k = 0; k < T; k++) {
    layout.nodes.forEach((nd, v) => {
      APPROACHES.forEach((a, ai) => {
        const count = frame.transit[k][v][ai];
        if (!count) return;
        const u = layout.neighbors[`${v},${a}`];
        if (u === undefined) return;
        const total = approachLength(g, layout, v, a) + 4;
        const tail = tails[`${v},${a}`] || gap;
        const progress = (T - (k + 1) + frac) / T;               // 0 = vient de partir, 1 = arrivé
        const d0 = total - progress * (total - tail);             // distance à la ligne d'arrêt
        for (let j = 0; j < Math.min(count, 6); j++) {
          const d = Math.min(total - len / 2, d0 + j * step + len / 2);
          drawCar(ctx, lanePoint(g, v, a, d), a, len, wid, CAR_COLORS[hash(v, ai, 100 + k * 7 + j) % CAR_COLORS.length]);
        }
      });
    });
  }
}

function drawLights(ctx, g, layout, frame) {
  layout.nodes.forEach((nd, u) => {
    const phase = frame.phase[u], yellow = frame.yellow[u] > 0;
    APPROACHES.forEach((a) => {
      const servesNS = a === "N" || a === "S";
      const isGreenPhase = (phase === 0) === servesNS;
      let color = "#e05252";
      if (yellow && !isGreenPhase) color = "#e9b949";   // ancienne phase : orange
      else if (!yellow && isGreenPhase) color = "#3cc36f";
      const { x, y } = lanePoint(g, u, a, 1); // feu posé sur la ligne d'arrêt de la voie
      ctx.fillStyle = "#1b1e21";
      ctx.beginPath(); ctx.arc(x, y, Math.max(3.5, g.rw * 0.13), 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = color;
      ctx.shadowColor = color; ctx.shadowBlur = 6;
      ctx.beginPath(); ctx.arc(x, y, Math.max(2.5, g.rw * 0.09), 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    });
  });
}

function drawPreviewBadges(ctx, g, layout, nodes, P) {
  layout.nodes.forEach((nd, u) => {
    const p = g.pos[u];
    // flèches d'entrée
    for (const a of nd.entries) {
      const s = lanePoint(g, u, a, Math.min(approachLength(g, layout, u, a) * 0.75, g.unit * 0.42));
      arrow(ctx, s, a, g.rw * 0.45, nodes[u].inflow > 0 ? P.accent : P.muted);
    }
    const label = `${nodes[u].cars} 🚗` + (nd.entries.length ? `  +${nodes[u].inflow}/min` : "");
    ctx.font = "600 12px Segoe UI, system-ui, sans-serif";
    const w = ctx.measureText(label).width + 14;
    const x = p.x - w / 2, y = p.y + g.half + 10;
    ctx.fillStyle = P.surface; ctx.strokeStyle = P.border; ctx.lineWidth = 1;
    roundRect(ctx, x, y, w, 22, 11); ctx.fill(); ctx.stroke();
    ctx.fillStyle = P.text; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(label, p.x, y + 11.5);
  });
}

function drawCar(ctx, p, a, len, wid, color) {
  const vertical = a === "N" || a === "S";
  const w = vertical ? wid : len, h = vertical ? len : wid;
  ctx.fillStyle = color;
  roundRect(ctx, p.x - w / 2, p.y - h / 2, w, h, Math.min(w, h) * 0.3);
  ctx.fill();
  ctx.fillStyle = "rgba(20,30,40,.45)"; // pare-brise côté intersection
  const [dx, dy] = DIR[a];
  const fx = p.x - dx * (len * 0.22), fy = p.y - dy * (len * 0.22);
  if (vertical) ctx.fillRect(fx - w * 0.32, fy - 1.2, w * 0.64, 2.4);
  else ctx.fillRect(fx - 1.2, fy - h * 0.32, 2.4, h * 0.64);
}
function badge(ctx, x, y, text) {
  ctx.font = "700 11px Segoe UI, system-ui, sans-serif";
  const w = ctx.measureText(text).width + 10;
  ctx.fillStyle = "#d64545";
  roundRect(ctx, x - w / 2, y - 9, w, 18, 9); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, x, y + 0.5);
}
function arrow(ctx, p, a, size, color) {
  const [dx, dy] = DIR[a];          // l'approche est du côté (dx,dy) : la flèche pointe vers le carrefour
  const tx = -dx, ty = -dy;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(p.x + tx * size, p.y + ty * size);
  ctx.lineTo(p.x - ty * size * 0.6, p.y + tx * size * 0.6);
  ctx.lineTo(p.x + ty * size * 0.6, p.y - tx * size * 0.6);
  ctx.closePath(); ctx.fill();
}
function line(ctx, p, q) { ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); }
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
}

/* ================================================================ écran 1 : configuration */
const PRESETS = {
  calm: () => ({ cars: 2, inflow: 3 }),
  normal: () => ({ cars: 5, inflow: 6 }),
  rush: () => ({ cars: 14, inflow: 10 }),
  jam: () => ({ cars: 30, inflow: 14 }),
  random: () => ({ cars: Math.floor(Math.random() * 21), inflow: Math.floor(Math.random() * 15) }),
};

function loadLayout(n) {
  state.n = n;
  state.layout = TrafficEngine.buildLayout(n);
  const old = state.nodes;
  state.nodes = state.layout.nodes.map((nd, i) => old[i] || { cars: 6, inflow: 6 });
  state.selected = Math.min(state.selected, n - 1);
  $("#n-label").textContent = n;
  $("#grid-label").textContent = `grille ${state.layout.rows} × ${state.layout.cols}` +
    (state.layout.rows * state.layout.cols > n ? " (incomplète)" : "");
  renderNodeList();
  drawPreview();
}

function drawPreview() {
  if (!state.layout) return;
  state.previewGeom = drawCity($("#preview"), state.layout, null, { selected: state.selected, preview: state.nodes });
}

function renderNodeList() {
  const list = $("#node-list");
  list.innerHTML = "";
  state.layout.nodes.forEach((nd, u) => {
    const spec = state.nodes[u];
    const card = document.createElement("div");
    card.className = "node" + (u === state.selected ? " sel" : "");
    const entries = nd.entries.map((a) => DIR_NAMES[a]).join(", ");
    card.innerHTML = `
      <div class="node-title"><b>Intersection ${u + 1}</b>
        <small>${nd.entries.length ? "entrées : " + entries : "intersection centrale"}</small></div>
      <label class="field"><span>Voitures au départ <b data-out="cars">${spec.cars}</b></span>
        <input type="range" min="0" max="60" value="${spec.cars}" data-key="cars"></label>
      ${nd.entries.length ? `
      <label class="field"><span>Arrivées par minute <b data-out="inflow">${spec.inflow}</b></span>
        <input type="range" min="0" max="30" value="${spec.inflow}" data-key="inflow"></label>` :
      `<p class="none">Pas d'entrée depuis l'extérieur : elle reçoit les voitures de ses voisines.</p>`}`;
    card.addEventListener("pointerdown", () => selectNode(u, false));
    card.querySelectorAll("input").forEach((inp) => {
      inp.addEventListener("input", () => {
        spec[inp.dataset.key] = Number(inp.value);
        card.querySelector(`[data-out="${inp.dataset.key}"]`).textContent = inp.value;
        drawPreview();
      });
    });
    list.appendChild(card);
  });
}

function selectNode(u, scroll = true) {
  state.selected = u;
  document.querySelectorAll(".node").forEach((el, i) => el.classList.toggle("sel", i === u));
  if (scroll) document.querySelectorAll(".node")[u]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  drawPreview();
}

function applyPreset(name) {
  state.layout.nodes.forEach((nd, u) => {
    if (name === "ns") { // flux fort sur les entrées Nord/Sud, faible ailleurs
      const ns = nd.entries.some((a) => a === "N" || a === "S");
      state.nodes[u] = { cars: ns ? 10 : 3, inflow: ns ? 14 : 2 };
    } else {
      state.nodes[u] = PRESETS[name]();
    }
  });
  renderNodeList();
  drawPreview();
}

/* ================================================================ écran 2 : simulation */
async function runSimulation() {
  const btn = $("#run");
  $("#setup-error").textContent = "";
  btn.disabled = true;
  $("#loading").classList.remove("hidden");
  try {
    const req = {
      n: state.n, nodes: state.nodes,
      duration_min: Number($("#duration").value), green_s: Number($("#green").value),
      variable_demand: $("#variable").checked, seed: Number($("#seed").value) || 0,
    };
    await new Promise((r) => setTimeout(r, 30)); // laisser s'afficher l'indicateur de chargement
    state.sim = TrafficEngine.simulate(state.bundle, req);
    state.req = req;
    showSim();
  } catch (e) {
    $("#setup-error").textContent = e.message;
  } finally {
    btn.disabled = false;
    $("#loading").classList.add("hidden");
  }
}

function showSim() {
  $("#setup").classList.add("hidden");
  $("#sim").classList.remove("hidden");
  const s = state.sim, r = state.req;
  const cars = r.nodes.reduce((a, x) => a + x.cars, 0);
  const inflow = s.layout.nodes.reduce((a, nd, i) => a + (nd.entries.length ? r.nodes[i].inflow : 0), 0);
  $("#scenario-summary").textContent =
    `${s.layout.n} intersections · ${cars} voitures au départ · ${inflow} arrivées/min · ` +
    `${r.duration_min} min simulées · feux fixes ${r.green_s} s`;
  $("#timeline").max = s.steps;
  state.t = 0;
  state.switches = {};
  for (const key of ["fixed", "agent"]) {
    const fr = s.runs[key].frames;
    state.switches[key] = fr.map((f, i) => i === 0 ? 0 : f.phase.reduce((c, p, j) => c + (p !== fr[i - 1].phase[j]), 0));
  }
  renderResult(false);
  setPlaying(true);
}

function setPlaying(on) {
  state.playing = on;
  $("#play").textContent = on ? "❚❚" : "▶";
  $("#play").setAttribute("aria-label", on ? "Pause" : "Lecture");
  if (on && state.t >= state.sim.steps) state.t = 0;
  state.lastTs = performance.now();
}

function tick(ts) {
  if (state.sim && !$("#sim").classList.contains("hidden")) {
    if (state.playing) {
      state.t += ((ts - state.lastTs) / 1000) * STEPS_PER_SECOND * state.speed;
      if (state.t >= state.sim.steps) { state.t = state.sim.steps; setPlaying(false); }
    }
    state.lastTs = ts;
    renderSim();
  }
  requestAnimationFrame(tick);
}

function renderSim() {
  const s = state.sim;
  const f = Math.min(Math.floor(state.t), s.steps);
  const frac = f >= s.steps ? 0 : state.t - f;
  for (const key of ["fixed", "agent"]) {
    const frame = s.runs[key].frames[f];
    drawCity($(`#cv-${key}`), s.layout, frame, { frac });
    renderStats(key, frame);
  }
  $("#timeline").value = f;
  $("#clock").textContent = `${fmtClock(f * s.dt)} / ${fmtClock(s.steps * s.dt)}`;
  drawChart(f + frac);
  if (f >= s.steps && !state.revealed) renderResult(true);
}

function renderStats(key, frame) {
  const waiting = frame.queues.reduce((a, q) => a + q.reduce((b, x) => b + x, 0), 0);
  const avg = frame.arrived ? frame.waiting_time / frame.arrived : 0;
  $(`#stats-${key}`).innerHTML = `
    <div class="stat"><span>En attente</span><b>${waiting}<small>véh.</small></b></div>
    <div class="stat"><span>Attente moy. / véhicule</span><b>${avg.toFixed(1)}<small>s</small></b></div>
    <div class="stat"><span>Sortis du réseau</span><b>${frame.exited}</b></div>`;
}

function drawChart(tNow) {
  const cv = $("#chart");
  const { ctx, W, H } = fitCanvas(cv);
  const P = palette(), s = state.sim;
  const series = ["fixed", "agent"].map((k) =>
    s.runs[k].frames.map((fr) => fr.queues.reduce((a, q) => a + q.reduce((b, x) => b + x, 0), 0)));
  const maxY = Math.max(10, ...series.flat()) * 1.1;
  const L = 36, R = 24, T = 8, B = 22;
  const x = (i) => L + (i / s.steps) * (W - L - R);
  const y = (v) => T + (1 - v / maxY) * (H - T - B);
  ctx.clearRect(0, 0, W, H);
  ctx.font = "11px Segoe UI, system-ui, sans-serif";
  ctx.fillStyle = P.muted; ctx.strokeStyle = P.border; ctx.lineWidth = 1;
  ctx.textAlign = "right"; ctx.textBaseline = "middle";
  for (let i = 0; i <= 4; i++) {
    const v = (maxY / 4) * i;
    ctx.beginPath(); ctx.moveTo(L, y(v)); ctx.lineTo(W - R, y(v)); ctx.stroke();
    ctx.fillText(Math.round(v), L - 6, y(v));
  }
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  const totalMin = (s.steps * s.dt) / 60, stepMin = totalMin > 30 ? 10 : 5;
  for (let m = 0; m <= totalMin; m += stepMin) ctx.fillText(`${m} min`, x((m * 60) / s.dt), H - B + 6);

  const upto = Math.floor(tNow);
  [[series[0], P.fixed], [series[1], P.agent]].forEach(([data, color]) => {
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.globalAlpha = 0.25;
    path(ctx, data, x, y, data.length - 1);           // courbe complète en transparence
    ctx.globalAlpha = 1;
    path(ctx, data, x, y, upto);                      // partie déjà jouée
  });
  ctx.strokeStyle = P.text; ctx.globalAlpha = 0.5; ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(x(tNow), T); ctx.lineTo(x(tNow), H - B); ctx.stroke();
  ctx.setLineDash([]); ctx.globalAlpha = 1;
}
function path(ctx, data, x, y, upto) {
  ctx.beginPath();
  for (let i = 0; i <= upto && i < data.length; i++) i ? ctx.lineTo(x(i), y(data[i])) : ctx.moveTo(x(i), y(data[i]));
  ctx.stroke();
}

function renderResult(reveal) {
  state.revealed = reveal;
  const el = $("#result");
  if (!reveal) {
    el.innerHTML = `<h3>Résultat</h3><p class="pending">Le bilan s'affiche à la fin de la simulation
      (ou faites glisser la chronologie jusqu'au bout).</p>`;
    return;
  }
  const a = state.sim.runs.fixed.metrics, b = state.sim.runs.agent.metrics;
  const gain = a.avg_wait_per_vehicle_s > 0 ? (100 * (a.avg_wait_per_vehicle_s - b.avg_wait_per_vehicle_s)) / a.avg_wait_per_vehicle_s : 0;
  const good = gain >= 0;
  const sw = (k) => state.switches[k].reduce((x, y) => x + y, 0);
  const row = (label, va, vb, fmt) => `<tr><td>${label}</td><td>${fmt(va)}</td><td>${fmt(vb)}</td></tr>`;
  el.innerHTML = `
    <h3>Résultat</h3>
    <div class="big-gain ${good ? "good" : "bad"}">${good ? "−" : "+"}${Math.abs(gain).toFixed(0)} %</div>
    <p>${good ? "de temps d'attente moyen grâce à l'agent GNN + DQN" : "de temps d'attente : l'agent fait moins bien que les feux fixes sur ce scénario"}</p>
    <table class="compare">
      <tr><th></th><th>Feux fixes</th><th>Agent</th></tr>
      ${row("Attente moy. / véhicule", a.avg_wait_per_vehicle_s, b.avg_wait_per_vehicle_s, (v) => v.toFixed(1) + " s")}
      ${row("File moyenne", a.avg_queue, b.avg_queue, (v) => v.toFixed(1) + " véh.")}
      ${row("Véhicules sortis", a.throughput, b.throughput, (v) => v)}
      ${row("Attente totale", a.total_waiting_time_s, b.total_waiting_time_s, (v) => (v / 3600).toFixed(1) + " h")}
      ${row("Changements de feu", sw("fixed"), sw("agent"), (v) => v)}
    </table>`;
}

/* ================================================================ événements */
function bind() {
  $("#n-nodes").addEventListener("input", (e) => loadLayout(Number(e.target.value)));
  $("#duration").addEventListener("input", (e) => ($("#dur-label").textContent = `${e.target.value} min`));
  $("#green").addEventListener("input", (e) => ($("#green-label").textContent = `${e.target.value} s`));
  document.querySelectorAll("[data-preset]").forEach((b) => b.addEventListener("click", () => applyPreset(b.dataset.preset)));
  $("#run").addEventListener("click", runSimulation);

  $("#preview").addEventListener("click", (e) => {
    const g = state.previewGeom; if (!g) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    let best = -1, bestD = Infinity;
    g.pos.forEach((p, i) => { const d = Math.hypot(p.x - x, p.y - y); if (d < bestD) { bestD = d; best = i; } });
    if (best >= 0 && bestD < g.unit * 0.5) selectNode(best);
  });

  $("#back").addEventListener("click", () => {
    setPlaying(false);
    $("#sim").classList.add("hidden");
    $("#setup").classList.remove("hidden");
    drawPreview();
  });
  $("#play").addEventListener("click", () => setPlaying(!state.playing));
  $("#restart").addEventListener("click", () => { state.t = 0; state.revealed = false; renderResult(false); setPlaying(true); });
  $("#timeline").addEventListener("input", (e) => {
    state.t = Number(e.target.value);
    if (state.t < state.sim.steps && state.revealed) renderResult(false);
  });
  document.querySelectorAll("[data-speed]").forEach((b) => b.addEventListener("click", () => {
    state.speed = Number(b.dataset.speed);
    document.querySelectorAll("[data-speed]").forEach((x) => x.classList.toggle("on", x === b));
  }));
  window.addEventListener("resize", () => drawPreview());
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => drawPreview());
}
function showSetupError(e) { $("#setup-error").textContent = e.message; }

async function init() {
  bind();
  loadLayout(Number($("#n-nodes").value));
  const st = $("#model-status");
  try {
    const res = await fetch("model.json");
    if (!res.ok) throw new Error(res.status);
    state.bundle = await res.json();
    st.textContent = "Modèle GNN + DQN chargé";
    st.className = "status ok";
  } catch (e) {
    st.textContent = "Modèle introuvable";
    st.className = "status ko";
    $("#run").disabled = true;
    showSetupError(new Error("web/model.json introuvable : lancez « python export_web.py »."));
  }
  requestAnimationFrame(tick);
}
init();
