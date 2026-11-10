/* Moteur de simulation exécuté dans le navigateur.
 *
 * Traduction fidèle de traffic/traffic_env.py (simulateur) et de traffic/models.py
 * (GNN + tête Q, implémentation dense), avec les poids exportés par export_web.py.
 * Aucune dépendance : le site peut être hébergé tel quel (GitHub Pages).
 *
 * Seule différence avec Python : le générateur aléatoire (mulberry32 au lieu de NumPy).
 * Les tirages diffèrent, mais les règles et le modèle sont identiques
 * (vérifié par tests/test_web_engine.py).
 */
(function (root) {
  "use strict";

  const APPROACHES = ["N", "S", "E", "W"];
  const AI = { N: 0, S: 1, E: 2, W: 3 };
  const MOVE = { N: [-1, 0], S: [1, 0], E: [0, 1], W: [0, -1] };          // (d_row, d_col)
  const TRAVEL_FROM_APPROACH = { N: "S", S: "N", E: "W", W: "E" };
  const APPROACH_FROM_TRAVEL = { S: "N", N: "S", W: "E", E: "W" };
  const TURNS = { S: ["E", "W"], N: ["W", "E"], E: ["N", "S"], W: ["S", "N"] }; // (gauche, droite)
  const PHASE_APPROACHES = [[AI.N, AI.S], [AI.E, AI.W]];
  const N_FEATURES = 8;

  /* ------------------------------------------------------------ aléatoire */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function subSeed(seed, stream) {           // flux indépendants dérivés d'une graine
    let h = (seed * 2654435761 + stream * 40503 + 12345) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
  }
  function poisson(rand, lam) {
    if (lam <= 0) return 0;
    if (lam > 30) return Math.max(0, Math.round(lam + Math.sqrt(lam) * gauss(rand)));
    const L = Math.exp(-lam);
    let k = 0, p = 1;
    do { k++; p *= rand(); } while (p > L);
    return k - 1;
  }
  function gauss(rand) {
    const u = Math.max(rand(), 1e-12), v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function multinomial(rand, n, probs) {
    const out = new Array(probs.length).fill(0);
    for (let i = 0; i < n; i++) {
      let r = rand(), j = 0;
      while (j < probs.length - 1 && r >= probs[j]) { r -= probs[j]; j++; }
      out[j]++;
    }
    return out;
  }

  /* ------------------------------------------------------------ réseau routier */
  function gridShape(n) {
    const cols = Math.ceil(Math.sqrt(n));
    return [Math.ceil(n / cols), cols];
  }

  function buildLayout(n) {
    const [rows, cols] = gridShape(n);
    const neighbors = {}, edgeList = [];
    for (let u = 0; u < n; u++) {
      const r = Math.floor(u / cols), c = u % cols;
      for (const d of APPROACHES) {
        const rr = r + MOVE[d][0], cc = c + MOVE[d][1], v = rr * cols + cc;
        if (rr >= 0 && rr < rows && cc >= 0 && cc < cols && v < n) {
          neighbors[`${u},${d}`] = v;
          edgeList.push([u, v]);                               // arête orientée u -> v
        }
      }
    }
    const nodes = [];
    for (let u = 0; u < n; u++) {
      // l'approche "N" est une entrée s'il n'y a pas d'intersection au nord, etc.
      const entries = APPROACHES.filter((a) => neighbors[`${u},${a}`] === undefined);
      nodes.push({ id: u, row: Math.floor(u / cols), col: u % cols, entries });
    }
    const undirected = edgeList.filter(([u, v]) => u < v);
    return { n, rows, cols, nodes, edges: undirected, neighbors, directed: edgeList };
  }

  /* ------------------------------------------------------------ environnement */
  class TrafficEnv {
    constructor(cfg, n) {
      this.cfg = cfg;
      this.layout = buildLayout(n);
      this.n = n;
      this.entry = this.layout.nodes.map((nd) => APPROACHES.map((a) => nd.entries.includes(a)));
    }

    reset(seed, options = {}) {
      const c = this.cfg, n = this.n;
      this.randInit = mulberry32(subSeed(seed, 1));
      this.randArr = mulberry32(subSeed(seed, 2));
      this.randSvc = mulberry32(subSeed(seed, 3));
      this.t = 0;
      this.phase = Array.from({ length: n }, () => (this.randInit() < 0.5 ? 0 : 1));
      this.timeInPhase = new Array(n).fill(0);
      this.yellow = new Array(n).fill(0);
      this.transit = Array.from({ length: c.travel_steps }, () => zeros(n));
      this.queues = options.initial_queues ? options.initial_queues.map((q) => q.slice()) : zeros(n);
      this.rates = options.entry_rates
        ? options.entry_rates.map((row, u) => row.map((x, a) => (this.entry[u][a] ? x : 0)))
        : this.entry.map((row) => row.map((e, a) => (e ? (a < 2 ? c.rate_ns : c.rate_ew) : 0)));
      this.demandShift = this.randInit() * 2 * Math.PI;
      const initial = sum2(this.queues);
      this.stats = { waiting_time: 0, arrived: initial, exited: 0 };
      return this.obs();
    }

    step(action) {
      const c = this.cfg, n = this.n;
      // 1) changements de phase
      for (let u = 0; u < n; u++) {
        const can = this.yellow[u] === 0 && this.timeInPhase[u] >= c.min_green_steps;
        if (can && action[u] !== this.phase[u]) {
          this.phase[u] = action[u];
          this.yellow[u] = c.yellow_steps;
          this.timeInPhase[u] = 0;
        }
      }
      // 2) décharge des approches au vert
      let exited = 0;
      const incoming = zeros(n);
      for (let u = 0; u < n; u++) {
        if (this.yellow[u] > 0) continue;
        for (const a of PHASE_APPROACHES[this.phase[u]]) {
          const cap = c.base_capacity + (this.randSvc() < c.extra_capacity_prob ? 1 : 0);
          const served = Math.min(this.queues[u][a], cap);
          if (served === 0) continue;
          this.queues[u][a] -= served;
          const travel = TRAVEL_FROM_APPROACH[APPROACHES[a]];
          const [left, right] = TURNS[travel];
          const split = multinomial(this.randSvc, served, c.turn_probs);
          [travel, left, right].forEach((dir, i) => {
            const k = split[i];
            if (!k) return;
            const v = this.layout.neighbors[`${u},${dir}`];
            if (v === undefined) exited += k;
            else incoming[v][AI[APPROACH_FROM_TRAVEL[dir]]] += k;
          });
        }
      }
      // 3) véhicules en transit qui arrivent
      const arriving = this.transit.shift();
      for (let u = 0; u < n; u++) for (let a = 0; a < 4; a++) this.queues[u][a] += arriving[u][a];
      this.transit.push(incoming);
      // 4) nouvelles arrivées aux entrées
      const wave = (2 * Math.PI * this.t) / c.demand_period_steps + this.demandShift;
      const multNS = 1 + c.demand_amplitude * Math.sin(wave);
      const multEW = 1 + c.demand_amplitude * Math.sin(wave + Math.PI);
      let arrived = 0;
      for (let u = 0; u < n; u++) {
        for (let a = 0; a < 4; a++) {
          const lam = Math.max(this.rates[u][a] * (a < 2 ? multNS : multEW), 0) * c.dt;
          const k = poisson(this.randArr, lam);
          this.queues[u][a] += k;
          arrived += k;
        }
      }
      // 5) horloges des feux
      for (let u = 0; u < n; u++) {
        this.yellow[u] = Math.max(this.yellow[u] - 1, 0);
        this.timeInPhase[u] += 1;
      }
      this.t += 1;
      // 6) statistiques
      const queued = sum2(this.queues);
      this.stats.waiting_time += queued * c.dt;
      this.stats.arrived += arrived;
      this.stats.exited += exited;
      return { obs: this.obs(), done: this.t >= c.episode_steps };
    }

    obs() {
      const c = this.cfg;
      return this.queues.map((q, u) => {
        const f = new Array(N_FEATURES).fill(0);
        for (let a = 0; a < 4; a++) f[a] = Math.min(q[a] / c.queue_scale, 5);
        f[4 + this.phase[u]] = 1;
        f[6] = this.yellow[u] > 0 ? 1 : 0;
        f[7] = Math.min(this.timeInPhase[u] / 10, 1);
        return f;
      });
    }

    snapshot() {
      return {
        queues: this.queues.map((q) => q.slice()),
        phase: this.phase.slice(),
        yellow: this.yellow.slice(),
        transit: this.transit.map((t) => t.map((q) => q.slice())),
        waiting_time: this.stats.waiting_time,
        arrived: this.stats.arrived,
        exited: this.stats.exited,
      };
    }

    metrics() {
      const s = this.stats, steps = Math.max(this.t, 1);
      return {
        total_waiting_time_s: s.waiting_time,
        avg_queue: s.waiting_time / this.cfg.dt / steps,
        avg_wait_per_vehicle_s: s.waiting_time / Math.max(s.arrived, 1),
        throughput: s.exited,
        arrived: s.arrived,
      };
    }
  }

  /* ------------------------------------------------------------ politiques */
  class FixedTimePolicy {
    constructor(greenSteps, yellowSteps) { this.period = greenSteps + yellowSteps; this.name = "Feux fixes"; }
    reset(obs) { this.t = 0; this.start = obs.map((f) => (f[5] > f[4] ? 1 : 0)); }
    act() {
      const k = Math.floor(this.t / this.period);
      this.t++;
      return this.start.map((s) => (s + k) % 2);
    }
  }

  // GNN + DQN : même calcul que GNNQNetwork (backend dense) dans traffic/models.py
  class GNNPolicy {
    constructor(model, layout) {
      this.name = "GNN + DQN";
      this.conv = model.conv;
      this.nLayers = model.layers;
      this.W = {};
      for (const [k, v] of Object.entries(model.weights)) this.W[k] = v;
      this.setGraph(layout);
    }
    setGraph(layout) {
      const n = layout.n;
      const adj = Array.from({ length: n }, () => new Array(n).fill(0));
      for (const [u, v] of layout.directed) adj[v][u] = 1;          // message source -> cible
      // D^-1/2 (A + I) D^-1/2
      const aHat = adj.map((row, i) => row.map((x, j) => x + (i === j ? 1 : 0)));
      const d = aHat.map((row) => 1 / Math.sqrt(row.reduce((s, x) => s + x, 0)));
      this.aNorm = aHat.map((row, i) => row.map((x, j) => d[i] * x * d[j]));
      // moyenne des voisins (GraphSAGE)
      this.aMean = adj.map((row) => { const deg = Math.max(1, row.reduce((s, x) => s + x, 0)); return row.map((x) => x / deg); });
    }
    reset() {}
    qvalues(obs) {
      const W = this.W;
      const h0 = obs.map((x) => relu(linear(W["embed.weight"], W["embed.bias"], x)));
      let h = h0;
      for (let l = 0; l < this.nLayers; l++) {
        const p = `gnn.layers.${l}.`;
        if (this.conv === "gcn") {
          const hw = h.map((x) => linear(W[p + "lin.weight"], null, x));
          h = matmul(this.aNorm, hw).map((row) => relu(add(row, W[p + "bias"].data)));
        } else {
          const agg = matmul(this.aMean, h);
          h = h.map((x, i) => relu(add(linear(W[p + "lin_l.weight"], W[p + "lin_l.bias"], agg[i]), linear(W[p + "lin_r.weight"], null, x))));
        }
      }
      return h0.map((x, i) => {
        const z = relu(linear(W["head.0.weight"], W["head.0.bias"], x.concat(h[i])));
        return linear(W["head.2.weight"], W["head.2.bias"], z);
      });
    }
    act(obs) { return this.qvalues(obs).map((q) => (q[1] > q[0] ? 1 : 0)); }
  }

  /* ------------------------------------------------------------ algèbre */
  function linear(Wt, b, x) {                  // y = W x + b, W de forme (out, in)
    const [out, inp] = Wt.shape, w = Wt.data, y = new Array(out);
    for (let o = 0; o < out; o++) {
      let s = b ? b.data[o] : 0;
      const off = o * inp;
      for (let i = 0; i < inp; i++) s += w[off + i] * x[i];
      y[o] = s;
    }
    return y;
  }
  function matmul(A, H) {                      // (n, n) x (n, f)
    return A.map((row) => {
      const out = new Array(H[0].length).fill(0);
      row.forEach((a, j) => { if (a) for (let k = 0; k < out.length; k++) out[k] += a * H[j][k]; });
      return out;
    });
  }
  const relu = (v) => v.map((x) => (x > 0 ? x : 0));
  const add = (a, b) => a.map((x, i) => x + b[i]);
  const zeros = (n) => Array.from({ length: n }, () => [0, 0, 0, 0]);
  const sum2 = (m) => m.reduce((s, row) => s + row.reduce((t, x) => t + x, 0), 0);

  /* ------------------------------------------------------------ simulation complète */
  function runPolicy(env, policy, seed, options) {
    let obs = env.reset(seed, options);
    policy.reset(obs);
    const frames = [env.snapshot()];
    let done = false;
    while (!done) {
      const res = env.step(policy.act(obs));
      obs = res.obs; done = res.done;
      frames.push(env.snapshot());
    }
    return { name: policy.name, frames, metrics: env.metrics() };
  }

  /* req : { n, nodes: [{cars, inflow}], duration_min, green_s, variable_demand, seed } */
  function simulate(bundle, req) {
    const base = bundle.env;
    const n = clamp(Math.round(req.n || 4), 2, 12);
    const duration = clamp(req.duration_min || 15, 1, 60);
    const steps = Math.round((duration * 60) / base.dt);
    const cfg = Object.assign({}, base, {
      episode_steps: steps,
      demand_amplitude: req.variable_demand === false ? 0 : base.demand_amplitude,
      demand_period_steps: Math.max(steps, 24),
    });
    const env = new TrafficEnv(cfg, n);
    const seed = (req.seed || 0) >>> 0;

    // scénario : voitures au départ réparties au hasard sur les 4 files,
    // arrivées/min réparties sur les entrées de l'intersection
    const rand = mulberry32(subSeed(seed, 9));
    const nodes = req.nodes || [];
    const initial = [], rates = [];
    for (let u = 0; u < n; u++) {
      const spec = nodes[u] || { cars: 0, inflow: 0 };
      initial.push(multinomial(rand, clamp(Math.round(spec.cars || 0), 0, 200), [0.25, 0.25, 0.25, 0.25]));
      const nEntries = env.entry[u].filter(Boolean).length;
      const perEntry = nEntries ? clamp(spec.inflow || 0, 0, 60) / 60 / nEntries : 0;
      rates.push(env.entry[u].map((e) => (e ? perEntry : 0)));
    }
    const options = { initial_queues: initial, entry_rates: rates };
    const greenSteps = Math.max(1, Math.round(clamp(req.green_s || 30, 10, 120) / base.dt));
    const fixed = runPolicy(env, new FixedTimePolicy(greenSteps, base.yellow_steps), seed, options);
    const agent = runPolicy(env, new GNNPolicy(bundle.model, env.layout), seed, options);
    return { layout: env.layout, dt: base.dt, steps, travel_steps: base.travel_steps, runs: { fixed, agent } };
  }
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, Number(x) || 0));

  const api = { simulate, buildLayout, TrafficEnv, GNNPolicy, FixedTimePolicy, mulberry32, N_FEATURES };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.TrafficEngine = api;
})(typeof self !== "undefined" ? self : this);
