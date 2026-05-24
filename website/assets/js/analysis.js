// ==========================================================
// ANALYSIS VIEW — § 03 Our Reading (15-Act Narrative)
// ==========================================================

const analysis = {
  initialized: false,
  observer: null,
};

// ---- shared helpers ----

function archetypeClass(g) {
  return g.archetype.replace(/_/g, "-");
}

function legendTag(g) {
  return `<span class="legend-tag ${archetypeClass(g)}">${g.archetype.replace(/_/g, " ")}</span>`;
}

function addToSelection(g) {
  state.selectedIds.add(g.id);
  updateSelectionUI();
  d3.select("#nav-sandbox").classed("disabled", false);
  showToast(`${g.name} added to selection`);
}

function mortalityIndex(games) {
  const age = (g) => Math.max(1, 2026 - g.year);
  // Subset: year >= 2000 per notebook cell 27
  const pool = games.filter((g) => g.year >= 2000);

  const feats = pool.map((g) => {
    const eng = g.engagement_total || 0;
    return {
      g,
      alive: g.alive_ratio,
      playing: eng > 0 ? g.status_playing / eng : 0, // same as alive_ratio but notebook lists separately
      beaten: eng > 0 ? g.status_beaten / eng : 0,
      playtime: g.playtime || 0,
      reddit_py: (g.reddit_count || 0) / age(g),
      twitch_py: (g.twitch_count || 0) / age(g),
    };
  });

  // Clip each feature at its 99th percentile then MinMax-scale to [0,1]
  const cols = [
    "alive",
    "playing",
    "beaten",
    "playtime",
    "reddit_py",
    "twitch_py",
  ];
  cols.forEach((c) => {
    const sorted = feats
      .map((f) => f[c])
      .filter((v) => isFinite(v))
      .sort(d3.ascending);
    const p99 = d3.quantile(sorted, 0.99) || 1;
    const clipped = feats.map((f) => Math.min(f[c], p99));
    const mn = d3.min(clipped),
      mx = d3.max(clipped);
    feats.forEach((f, i) => {
      f[c] = mx === mn ? 0 : (clipped[i] - mn) / (mx - mn);
    });
  });

  // Weighted sum (notebook cell 27 weights)
  const W = {
    alive: 1.0,
    playing: 0.5,
    beaten: -0.3,
    playtime: 0.3,
    reddit_py: 0.2,
    twitch_py: 0.2,
  };
  const raw = feats.map(
    (f) =>
      W.alive * f.alive +
      W.playing * f.playing +
      W.beaten * f.beaten +
      W.playtime * f.playtime +
      W.reddit_py * f.reddit_py +
      W.twitch_py * f.twitch_py,
  );
  const rmin = d3.min(raw),
    rmax = d3.max(raw);

  return feats.map((f, i) => ({
    ...f.g,
    _score:
      rmax === rmin ? 50 : Math.round(((raw[i] - rmin) / (rmax - rmin)) * 100),
    _ytpy: (f.g.youtube_count || 0) / age(f.g),
    _ctpy: ((f.g.reddit_count || 0) + (f.g.twitch_count || 0)) / age(f.g),
  }));
}

function immortalsTop(n) {
  return GAMES_DATA.filter((g) => {
    if (g.year > THRESHOLDS.IMMORTAL_YEAR_CUTOFF) return false;
    return g.game_type === "pure_online"
      ? g.peak_players >= THRESHOLDS.PURE_ONLINE_PEAK_FLOOR
      : g.engagement_total >= THRESHOLDS.ENGAGEMENT_FLOOR;
  })
    .sort((a, b) => d3.descending(a.alive_ratio, b.alive_ratio))
    .slice(0, n);
}

function fadingAAAGames() {
  return GAMES_DATA.filter((g) => {
    const isRealAAA =
      g.peak_players > THRESHOLDS.FADING_AAA_PEAK_MIN &&
      (g.game_type === "pure_online" ||
        g.engagement_total >= THRESHOLDS.FADING_AAA_STORY_ENGAGEMENT_MIN);
    return isRealAAA && g.alive_ratio < THRESHOLDS.FADING_AAA_ALIVE_MAX;
  }).sort((a, b) => d3.descending(a.peak_players, b.peak_players));
}

function slowBurnTop(n) {
  const candidates = GAMES_DATA.filter(
    (g) =>
      g.peak_players < THRESHOLDS.SLOW_BURN_PEAK_MAX &&
      g.alive_ratio > THRESHOLDS.SLOW_BURN_ALIVE_MIN &&
      g.year <= THRESHOLDS.SLOW_BURN_YEAR_CUTOFF &&
      (g.game_type === "pure_online" ||
        g.engagement_total >= THRESHOLDS.ENGAGEMENT_FLOOR) &&
      g.series.length >= THRESHOLDS.SLOW_BURN_MIN_SERIES_MONTHS,
  );
  const shaped = candidates.filter((g) => {
    const relMs = new Date(g.year, g.release_month, 1).getTime();
    const peakIdx = g.series.reduce(
      (mi, s, i) => (s.players > g.series[mi].players ? i : mi),
      0,
    );
    const peakMonth = g.series[peakIdx].month;
    const latePeak = peakMonth - relMs > 12 * 2628000000;
    const last12 = g.series.slice(-12).map((s) => s.players);
    const allPeak = g.series.map((s) => s.players);
    const recentMed = d3.median(last12) || 0;
    const maxPeak = d3.max(allPeak) || 1;
    const sustained = recentMed / maxPeak >= 0.5;
    return latePeak || sustained;
  });
  const pool = shaped.length >= n ? shaped : candidates;
  return pool
    .sort((a, b) => d3.descending(a.current_players, b.current_players))
    .slice(0, n);
}

// True per-game decay curve from time series
// Restricted to games released >= 2013 so early-life months are present in steamcharts
function buildDecayCurve(games) {
  const buckets = new Map();
  const MAX_MONTHS = 120;
  games
    .filter((g) => g.year >= 2013 && g.series.length >= 6)
    .forEach((g) => {
      const peakLocal = Math.max(
        g.peak_players,
        d3.max(g.series, (s) => s.players) || 0,
        1,
      );
      if (peakLocal < 100) return;
      const relMs = new Date(g.year, g.release_month, 1).getTime();
      g.series.forEach(({ month, players }) => {
        const mSince = Math.round((month - relMs) / 2628000000);
        if (mSince < 0 || mSince > MAX_MONTHS) return;
        if (!buckets.has(mSince)) buckets.set(mSince, []);
        buckets.get(mSince).push(players / peakLocal);
      });
    });
  return Array.from(buckets, ([key, vals]) => {
    const sorted = vals.filter((v) => isFinite(v) && v >= 0).sort(d3.ascending);
    return {
      key,
      median: d3.quantile(sorted, 0.5) || 0,
      p25: d3.quantile(sorted, 0.25) || 0,
      p90: d3.quantile(sorted, 0.9) || 0,
      count: sorted.length,
    };
  })
    .filter((d) => d.count >= 10)
    .sort((a, b) => d3.ascending(a.key, b.key));
}

// ---- Lede stat injections (run once at view init) ----

function injectLedeStats() {
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  const pct0 = (v) => Math.round(v * 100) + "%";
  const games = GAMES_DATA;

  const sorted = games
    .map((g) => g.alive_ratio)
    .filter(isFinite)
    .sort(d3.ascending);
  const medAll = d3.quantile(sorted, 0.5) || 0;
  const p75 = d3.quantile(sorted, 0.75) || 0;
  const immortals = games.filter(
    (g) => g.alive_ratio > THRESHOLDS.IMMORTAL_MIN,
  );

  set("lede-total", games.length.toLocaleString());
  set("lede-median-alive", pct0(medAll));
  set("lede-p75-alive", pct0(p75));
  set("lede-immortal-count", immortals.length.toLocaleString());
  set(
    "lede-immortal-pct",
    ((immortals.length / games.length) * 100).toFixed(0) + "%",
  );

  set("lede-imm-thr", pct0(THRESHOLDS.IMMORTAL_MIN));
  set("lede-mort-thr", pct0(THRESHOLDS.ALIVE_MIN));
}

// ---- Entry point ----

function renderAnalysisView() {
  analysis.initialized = true;
  injectLedeStats();

  d3.select("#analysis-to-sandbox").on("click", () => {
    const top = immortalsTop(1)[0];
    if (top) addToSelection(top);
    switchView("sandbox");
  });

  d3.select("#act11-sort-chips")
    .selectAll(".sort-chip")
    .on("click", function () {
      d3.select("#act11-sort-chips")
        .selectAll(".sort-chip")
        .classed("active", false);
      d3.select(this).classed("active", true);
      initAct11(this.dataset.sort);
    });

  initAct1();

  const actInits = {};
  const done = new Set([1]);

  analysis.observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const n = +entry.target.dataset.act;
        if (n && !done.has(n) && actInits[n]) {
          done.add(n);
          actInits[n]();
        }
      });
    },
    { rootMargin: "200px 0px" },
  );

  document.querySelectorAll(".story-act[data-act]").forEach((el) => {
    analysis.observer.observe(el);
  });
}

// ---- ACT 1 — The Graveyard ----
function initAct1() {
  const games = GAMES_DATA;
  const median = d3.median(games, (g) => g.alive_ratio);
  const immortalCount = games.filter(
    (g) => g.alive_ratio > THRESHOLDS.IMMORTAL_MIN,
  ).length;

  const immortalPctAll =
    ((immortalCount / games.length) * 100).toFixed(1) + "%";
  d3.select("#act1-total").text(games.length.toLocaleString());
  d3.select("#act1-median").text((median * 100).toFixed(1) + "%");
  d3.select("#act1-alive").text(immortalPctAll);

  const margin = { top: 20, right: 20, bottom: 40, left: 60 };
  const svgEl = document.getElementById("act1-chart");
  if (!svgEl) return;
  svgEl.setAttribute("height", "380");
  const W = svgEl.getBoundingClientRect().width;
  if (W === 0) return;
  const w = W - margin.left - margin.right;
  const h = 380 - margin.top - margin.bottom;

  const svg = d3.select(svgEl);
  svg.selectAll("*").remove();
  const g = svg
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const bins = d3.bin().domain([0, 1]).thresholds(20)(
    games.map((d) => d.alive_ratio),
  );

  const x = d3.scaleLinear().domain([0, 1]).range([0, w]);
  const y = d3
    .scaleLog()
    .domain([0.5, d3.max(bins, (b) => b.length) * 1.3])
    .range([h, 0])
    .clamp(true);

  g.append("g")
    .attr("class", "axis axis-x")
    .attr("transform", `translate(0,${h})`)
    .call(d3.axisBottom(x).ticks(5).tickFormat(d3.format(".0%")));
  g.append("g")
    .attr("class", "axis axis-y")
    .call(
      d3
        .axisLeft(y)
        .ticks(4)
        .tickFormat((d) => (d >= 1000 ? (d / 1000).toFixed(0) + "k" : d)),
    );
  g.append("g")
    .attr("class", "grid grid-y")
    .call(d3.axisLeft(y).ticks(4).tickSize(-w).tickFormat(""))
    .selectAll("text")
    .remove();

  g.selectAll("rect.bar")
    .data(bins)
    .join("rect")
    .attr("class", "bar")
    .attr("x", (b) => x(b.x0) + 1)
    .attr("width", (b) => Math.max(0, x(b.x1) - x(b.x0) - 2))
    .attr("y", (b) => (b.length > 0 ? y(b.length) : h))
    .attr("height", (b) => (b.length > 0 ? h - y(b.length) : 0))
    .attr("fill", (b) => ALIVE_SCALE((b.x0 + b.x1) / 2))
    .attr("opacity", 0.85);

  g.append("line")
    .attr("x1", x(median))
    .attr("x2", x(median))
    .attr("y1", 0)
    .attr("y2", h)
    .attr("stroke", "var(--ink-dim)")
    .attr("stroke-dasharray", "4,3")
    .attr("stroke-width", 1);
  g.append("text")
    .attr("x", x(median) + 4)
    .attr("y", 12)
    .attr("fill", "var(--ink-dim)")
    .attr("font-size", 9)
    .text("median " + (median * 100).toFixed(1) + "%");

  g.append("text")
    .attr("class", "axis-label")
    .attr("x", w / 2)
    .attr("y", h + 36)
    .attr("text-anchor", "middle")
    .text("alive ratio");
  g.append("text")
    .attr("class", "axis-label")
    .attr("transform", "rotate(-90)")
    .attr("x", -h / 2)
    .attr("y", -50)
    .attr("text-anchor", "middle")
    .text("# of games (log)");

  const brushSel = g.append("g").attr("class", "brush");
  const brushObj = d3
    .brushX()
    .extent([
      [0, 0],
      [w, h],
    ])
    .on("brush end", (event) => {
      const guide = document.getElementById("act1-guide");
      const aliveLabel = document.querySelector(
        "#act1-stats .hero-stat:last-child .hero-label",
      );
      if (!event.selection) {
        d3.select("#act1-total").text(games.length.toLocaleString());
        d3.select("#act1-median").text((median * 100).toFixed(1) + "%");
        d3.select("#act1-alive").text(immortalPctAll);
        if (aliveLabel) aliveLabel.textContent = "immortal games";
        if (guide) guide.classList.remove("done");
        return;
      }
      const [x0, x1] = event.selection.map(x.invert);
      const sub = games.filter(
        (d) => d.alive_ratio >= x0 && d.alive_ratio <= x1,
      );
      const immortalInSub = sub.filter(
        (d) => d.alive_ratio > THRESHOLDS.IMMORTAL_MIN,
      ).length;
      const immortalPct =
        sub.length > 0
          ? ((immortalInSub / sub.length) * 100).toFixed(1)
          : "0.0";
      d3.select("#act1-total").text(sub.length.toLocaleString());
      const sm = d3.median(sub, (d) => d.alive_ratio) || 0;
      d3.select("#act1-median").text((sm * 100).toFixed(1) + "%");
      d3.select("#act1-alive").text(immortalPct + "%");
      if (aliveLabel) aliveLabel.textContent = "immortal in selection";
      if (guide && x0 > 0.05) guide.classList.add("done");
    });
  brushSel.call(brushObj);
}

function makeSpark(g) {
  if (!g.series || g.series.length < 2) return "";
  const sw = 80,
    sh = 16;
  const margin = { l: 0, r: 0 };
  const w = sw - margin.l - margin.r;
  const maxP = d3.max(g.series, (d) => d.players) || 1;
  const xS = d3
    .scaleLinear()
    .domain(d3.extent(g.series, (d) => d.month))
    .range([0, w]);
  const yS = d3
    .scaleLinear()
    .domain([0, maxP])
    .range([sh - 2, 2]);
  const pts = g.series
    .map((d) => `${xS(d.month).toFixed(1)},${yS(d.players).toFixed(1)}`)
    .join(" ");
  const col = ALIVE_SCALE(g.alive_ratio);
  return `<svg width="${sw}" height="${sh}" class="mortality-sparkline"><polyline points="${pts}" fill="none" stroke="${col}" stroke-width="1.2" opacity="0.8"/></svg>`;
}
