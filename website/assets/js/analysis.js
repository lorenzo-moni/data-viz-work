// ==========================================================
// ANALYSIS VIEW - § 03 Our Reading (15-Act Narrative)
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
  return GAMES_DATA.filter((g) => g.archetype === "fading_aaa").sort((a, b) =>
    d3.descending(a.peak_players, b.peak_players),
  );
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
      const peakLocal = g.peak_players;
      if (peakLocal < 100) return;
      const relMs = new Date(g.year, g.release_month, 1).getTime();
      g.series.forEach(({ month, peak: monthPeak }) => {
        const relDate = new Date(g.year, g.release_month, 1);
        const obsDate = new Date(month);
        const mSince =
          (obsDate.getFullYear() - relDate.getFullYear()) * 12 +
          (obsDate.getMonth() - relDate.getMonth());

        if (mSince < 0 || mSince > MAX_MONTHS) return;
        if (!buckets.has(mSince)) buckets.set(mSince, []);
        buckets.get(mSince).push(monthPeak / peakLocal);
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
    .filter((d) => d.count >= 10 && d.key >= 3)
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

  const actInits = {
    2: () => initAct2(),
    3: () => initAct3(),
    4: () => initAct4(),
    5: () => initAct5(),
    6: () => initAct6(),
    7: () => initAct7(),
    8: () => initAct8(),
    10: () => initAct10(),
    11: () => initAct11(),
    12: () => initAct12(),
    13: () => initAct13(),
    14: () => initAct14(),
    15: () => initAct15(),
  };
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

// ---- ACT 1 - The Graveyard ----
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

// ---- ACT 2 - Time is not the verdict ----
function initAct2(filter) {
  filter = filter || "all";
  const allGames = GAMES_DATA.filter(
    (g) => g.engagement_total >= THRESHOLDS.ENGAGEMENT_FLOOR,
  );
  let games;
  if (filter === "aaa")
    games = allGames.filter(
      (g) => g.archetype === "aaa" || g.archetype === "fading_aaa",
    );
  else games = allGames;

  const margin = { top: 24, right: 24, bottom: 44, left: 56 };
  const svgEl = document.getElementById("act2-chart");
  if (!svgEl) return;
  svgEl.setAttribute("height", "400");
  const W = svgEl.getBoundingClientRect().width;
  if (W === 0) return;
  const w = W - margin.left - margin.right;
  const h = 400 - margin.top - margin.bottom;

  const svg = d3.select(svgEl);
  svg.selectAll("*").remove();
  const g = svg
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const yearExt = d3.extent(games, (d) => d.year);
  const x = d3
    .scaleLinear()
    .domain([yearExt[0] - 1, yearExt[1] + 1])
    .range([0, w]);
  const y = d3.scaleLinear().domain([0, 1]).range([h, 0]);
  const rScale = d3
    .scaleSqrt()
    .domain([0, d3.max(games, (d) => d.peak_players) || 1])
    .range([2, 10]);

  g.append("g")
    .attr("class", "axis axis-x")
    .attr("transform", `translate(0,${h})`)
    .call(d3.axisBottom(x).ticks(8).tickFormat(d3.format("d")));
  g.append("g")
    .attr("class", "axis axis-y")
    .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format(".0%")));
  g.append("g")
    .attr("class", "grid grid-y")
    .call(d3.axisLeft(y).ticks(5).tickSize(-w).tickFormat(""))
    .selectAll("text")
    .remove();

  // Rolling median line by year
  const byYear = d3.rollup(
    games,
    (v) => d3.median(v, (d) => d.alive_ratio),
    (d) => d.year,
  );
  const lineData = Array.from(byYear, ([yr, med]) => ({ yr, med })).sort(
    (a, b) => a.yr - b.yr,
  );
  g.append("path")
    .datum(lineData)
    .attr("fill", "none")
    .attr("stroke", "var(--ink-dim)")
    .attr("stroke-width", 1)
    .attr("stroke-dasharray", "3,3")
    .attr("opacity", 0.5)
    .attr(
      "d",
      d3
        .line()
        .x((d) => x(d.yr))
        .y((d) => y(Math.max(0.001, d.med))),
    );

  // Dots (jittered)
  const jitter = () => (Math.random() - 0.5) * 0.6;
  g.selectAll("circle.dot")
    .data(games)
    .join("circle")
    .attr("class", "dot")
    .attr("cx", (d) => x(d.year + jitter()))
    .attr("cy", (d) => y(Math.max(0.001, d.alive_ratio)))
    .attr("r", (d) => rScale(d.peak_players))
    .attr("fill", (d) => ALIVE_SCALE(d.alive_ratio))
    .attr("opacity", 0.45)
    .attr("stroke", "none");

  g.append("text")
    .attr("class", "axis-label")
    .attr("x", w / 2)
    .attr("y", h + 38)
    .attr("text-anchor", "middle")
    .text("release year");
  g.append("text")
    .attr("class", "axis-label")
    .attr("transform", "rotate(-90)")
    .attr("x", -h / 2)
    .attr("y", -44)
    .attr("text-anchor", "middle")
    .text("alive ratio");

  // Chips
  d3.select("#act2-chips")
    .selectAll(".act-chip")
    .on("click", function () {
      d3.select("#act2-chips").selectAll(".act-chip").classed("active", false);
      d3.select(this).classed("active", true);
      initAct2(this.dataset.filter);
      const guide = document.getElementById("act2-guide");
      if (guide && this.dataset.filter === "aaa") guide.classList.add("done");
    });
}

// ---- ACT 3 - Two populations, not one ----
function initAct3() {
  const games = GAMES_DATA;
  const margin = { top: 20, right: 24, bottom: 40, left: 60 };
  const svgEl = document.getElementById("act3-chart");
  if (!svgEl) return;
  svgEl.setAttribute("height", "320");
  const W = svgEl.getBoundingClientRect().width;
  if (W === 0) return;
  const w = W - margin.left - margin.right;
  const h = 320 - margin.top - margin.bottom;

  const svg = d3.select(svgEl);
  svg.selectAll("*").remove();
  const g = svg
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const types = ["story", "hybrid", "pure_online"];
  const typeColors = {
    story: "#d96c6c",
    hybrid: "#e6a356",
    pure_online: "#7fc97f",
  };
  const typeLabels = {
    story: "Story",
    hybrid: "Hybrid",
    pure_online: "Pure Online",
  };

  const x = d3.scaleLinear().domain([0, 0.8]).range([0, w]);
  const bandH = h / types.length;
  const nBins = 40;

  types.forEach((type, i) => {
    const vals = games
      .filter((d) => d.game_type === type)
      .map((d) => d.alive_ratio)
      .filter((v) => isFinite(v) && v >= 0);
    const bins = d3.bin().domain([0, 0.8]).thresholds(nBins)(vals);
    const yMax = d3.max(bins, (b) => b.length) || 1;
    const yLocal = d3
      .scaleLinear()
      .domain([0, yMax])
      .range([bandH - 4, 0]);
    const gy = g.append("g").attr("transform", `translate(0,${i * bandH})`);

    // Shade zones
    gy.append("rect")
      .attr("x", x(0))
      .attr("width", x(0.05) - x(0))
      .attr("y", 0)
      .attr("height", bandH)
      .attr("fill", "rgba(217,108,108,0.06)");
    gy.append("rect")
      .attr("x", x(0.3))
      .attr("width", w - x(0.3))
      .attr("y", 0)
      .attr("height", bandH)
      .attr("fill", "rgba(127,201,127,0.06)");

    gy.selectAll("rect.bar")
      .data(bins)
      .join("rect")
      .attr("class", "bar")
      .attr("x", (b) => x(b.x0) + 1)
      .attr("width", (b) => Math.max(0, x(b.x1) - x(b.x0) - 2))
      .attr("y", (b) => (b.length > 0 ? yLocal(b.length) : bandH))
      .attr("height", (b) => (b.length > 0 ? bandH - 4 - yLocal(b.length) : 0))
      .attr("fill", typeColors[type])
      .attr("opacity", 0.7);

    gy.append("text")
      .attr("x", w - 4)
      .attr("y", 14)
      .attr("font-size", 10)
      .attr("fill", typeColors[type])
      .attr("font-family", "var(--mono)")
      .attr("text-anchor", "end")
      .text(typeLabels[type]);

    if (i === types.length - 1) {
      gy.append("g")
        .attr("class", "axis axis-x")
        .attr("transform", `translate(0,${bandH - 4})`)
        .call(d3.axisBottom(x).ticks(5).tickFormat(d3.format(".0%")));
    }
  });

  g.append("text")
    .attr("x", x(0.55))
    .attr("y", h - 8)
    .attr("text-anchor", "middle")
    .attr("font-size", 8)
    .attr("fill", "var(--alive)")
    .attr("font-family", "var(--mono)")
    .text("endurance");
}

// ---- ACT 5 - Games built not to end ----
function initAct5() {
  const games = GAMES_DATA.filter(
    (g) =>
      g.engagement_total >= THRESHOLDS.ENGAGEMENT_FLOOR ||
      g.game_type === "pure_online",
  );
  const types = ["story", "hybrid", "pure_online"];
  const typeColors = {
    story: "#d96c6c",
    hybrid: "#e6a356",
    pure_online: "#7fc97f",
  };
  const typeLabels = {
    story: "Story",
    hybrid: "Hybrid",
    pure_online: "Pure Online",
  };

  const margin = { top: 32, right: 24, bottom: 44, left: 24 };
  const svgEl = document.getElementById("act5-chart");
  if (!svgEl) return;
  svgEl.setAttribute("height", "400");
  const W = svgEl.getBoundingClientRect().width;
  if (W === 0) return;
  const w = W - margin.left - margin.right;
  const h = 400 - margin.top - margin.bottom;

  const svg = d3.select(svgEl);
  svg.selectAll("*").remove();
  const g = svg
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const colW = w / types.length;
  const y = d3.scaleLinear().domain([0, 1]).range([h, 0]);

  g.append("g")
    .attr("class", "axis axis-y")
    .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format(".0%")));
  g.append("g")
    .attr("class", "grid grid-y")
    .call(d3.axisLeft(y).ticks(5).tickSize(-w).tickFormat(""))
    .selectAll("text")
    .remove();

  // Column labels
  types.forEach((type, i) => {
    g.append("text")
      .attr("x", colW * i + colW / 2)
      .attr("y", -12)
      .attr("text-anchor", "middle")
      .attr("font-size", 10)
      .attr("fill", typeColors[type])
      .attr("font-family", "var(--mono)")
      .text(typeLabels[type]);

    // Median line
    const typeGames = games.filter((d) => d.game_type === type);
    const med = d3.median(typeGames, (d) => d.alive_ratio) || 0.001;
    const xCenter = colW * i + colW / 2;
    g.append("line")
      .attr("x1", xCenter - colW * 0.35)
      .attr("x2", xCenter + colW * 0.35)
      .attr("y1", y(Math.max(0.001, med)))
      .attr("y2", y(Math.max(0.001, med)))
      .attr("stroke", typeColors[type])
      .attr("stroke-width", 1.5)
      .attr("opacity", 0.6);
  });

  // Beeswarm simulation
  const nodes = games.map((d) => ({
    ...d,
    ty: y(Math.max(0.001, d.alive_ratio)),
    tx: colW * types.indexOf(d.game_type) + colW / 2,
  }));

  const sim = d3
    .forceSimulation(nodes)
    .force("x", d3.forceX((d) => d.tx).strength(0.8))
    .force("y", d3.forceY((d) => d.ty).strength(1))
    .force("collide", d3.forceCollide(3.5))
    .stop();
  for (let i = 0; i < 120; i++) sim.tick();

  const tooltip =
    document.getElementById("tooltip") ||
    (() => {
      const t = document.createElement("div");
      t.id = "tooltip";
      t.className = "tooltip";
      document.body.appendChild(t);
      return t;
    })();

  g.selectAll("circle.bee")
    .data(nodes)
    .join("circle")
    .attr("class", "bee")
    .attr("cx", (d) => Math.max(4, Math.min(w - 4, d.x)))
    .attr("cy", (d) => Math.max(4, Math.min(h - 4, d.y)))
    .attr("r", 3)
    .attr("fill", (d) => ARCHETYPE_COLOR[d.archetype] || ARCHETYPE_COLOR.mid)
    .attr("opacity", 0.7)
    .attr("cursor", "pointer")
    .on("mouseover", (_ev, d) => {
      tooltip.innerHTML = `<strong>${d.name}</strong><br>${legendTag(d)}<br>${(d.alive_ratio * 100).toFixed(1)}% alive<br>${makeSpark(d)}`;
      tooltip.classList.add("visible");
    })
    .on("mousemove", (ev) => {
      tooltip.style.left = ev.pageX + 12 + "px";
      tooltip.style.top = ev.pageY - 28 + "px";
    })
    .on("mouseleave", () => tooltip.classList.remove("visible"))
    .on("click", (_ev, d) => {
      addToSelection(d);
      const guide = document.getElementById("act5-guide");
      if (guide) guide.classList.add("done");
    });
}

// ---- ACT 6 - Genre is a costume ----
function initAct6() {
  const games = GAMES_DATA;
  const countMap = d3.rollup(
    games,
    (v) => v.length,
    (g) => g.genres[0] || "Unknown",
  );
  const statsSorted = binnedStats(
    games,
    (g) => g.genres[0] || "Unknown",
    (g) => g.alive_ratio,
  )
    .filter((s) => s.count >= 30)
    .sort((a, b) =>
      d3.descending(countMap.get(a.key) || 0, countMap.get(b.key) || 0),
    )
    .slice(0, 12);

  const margin = { top: 24, right: 24, bottom: 80, left: 56 };
  const svgEl = document.getElementById("act6-chart");
  if (!svgEl) return;
  svgEl.setAttribute("height", "340");
  const W = svgEl.getBoundingClientRect().width;
  if (W === 0) return;
  const w = W - margin.left - margin.right;
  const h = 340 - margin.top - margin.bottom;

  const svg = d3.select(svgEl);
  svg.selectAll("*").remove();
  const g = svg
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const x = d3
    .scaleBand()
    .domain(statsSorted.map((s) => s.key))
    .range([0, w])
    .padding(0.25);
  const yMax = d3.max(statsSorted, (s) => s.p90) * 1.2 || 0.5;
  const y = d3.scaleLinear().domain([0, yMax]).range([h, 0]);
  const globalMedian = d3.median(games, (g) => g.alive_ratio) || 0;

  g.append("g")
    .attr("class", "axis axis-x")
    .attr("transform", `translate(0,${h})`)
    .call(d3.axisBottom(x))
    .selectAll("text")
    .attr("transform", "rotate(-35)")
    .attr("text-anchor", "end")
    .attr("dy", "0.4em")
    .attr("dx", "-0.4em");
  g.append("g")
    .attr("class", "axis axis-y")
    .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format(".0%")));
  g.append("g")
    .attr("class", "grid grid-y")
    .call(d3.axisLeft(y).ticks(5).tickSize(-w).tickFormat(""))
    .selectAll("text")
    .remove();

  // Global median reference
  g.append("line")
    .attr("x1", 0)
    .attr("x2", w)
    .attr("y1", y(globalMedian))
    .attr("y2", y(globalMedian))
    .attr("stroke", "var(--ink-dim)")
    .attr("stroke-dasharray", "4,3")
    .attr("stroke-width", 1)
    .attr("opacity", 0.5);
  g.append("text")
    .attr("x", w - 4)
    .attr("y", y(globalMedian) - 4)
    .attr("text-anchor", "end")
    .attr("font-size", 8)
    .attr("fill", "var(--ink-dim)")
    .text("global median");

  // Bars + whiskers
  statsSorted.forEach((s) => {
    const bx = x(s.key);
    const bw = x.bandwidth();

    // p25-p90 whisker
    g.append("line")
      .attr("x1", bx + bw / 2)
      .attr("x2", bx + bw / 2)
      .attr("y1", y(s.p90))
      .attr("y2", y(s.p25))
      .attr("stroke", ALIVE_SCALE(s.median))
      .attr("stroke-width", 1)
      .attr("opacity", 0.5);

    // Median bar
    g.append("rect")
      .attr("x", bx)
      .attr("width", bw)
      .attr("y", y(s.median))
      .attr("height", Math.max(1, h - y(s.median)))
      .attr("fill", ALIVE_SCALE(s.median))
      .attr("opacity", 0.75);
  });

  g.append("text")
    .attr("class", "axis-label")
    .attr("transform", "rotate(-90)")
    .attr("x", -h / 2)
    .attr("y", -44)
    .attr("text-anchor", "middle")
    .text("median alive ratio");
}

// ---- ACT 7 - Loved is not alive ----
function initAct7() {
  const games = GAMES_DATA.filter(
    (g) => g.ratings_count > 0 && g.rating > 0 && isFinite(g.alive_ratio),
  );

  const ratingThresh = 3.5;
  const aliveThresh = THRESHOLDS.ALIVE_MIN;
  const lovedGames = games.filter((g) => g.rating >= ratingThresh);
  const lovedAlive = lovedGames.filter((g) => g.alive_ratio >= aliveThresh);
  const belovedBuried = lovedGames.filter(
    (g) => g.alive_ratio < aliveThresh && g.game_type === "story",
  );
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  set("act7-loved-total", lovedGames.length.toLocaleString());
  set("act7-loved-alive", lovedAlive.length.toLocaleString());
  set(
    "act7-loved-pct",
    ((lovedAlive.length / Math.max(1, lovedGames.length)) * 100).toFixed(0) +
      "%",
  );
  set("act7-beloved-buried", belovedBuried.length.toLocaleString());

  const margin = { top: 20, right: 24, bottom: 44, left: 56 };
  const svgEl = document.getElementById("act7-chart");
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

  const x = d3.scaleLinear().domain([0, 5]).range([0, w]);
  const y = d3.scaleLinear().domain([0, 1]).range([h, 0]);

  g.append("g")
    .attr("class", "axis axis-x")
    .attr("transform", `translate(0,${h})`)
    .call(d3.axisBottom(x).ticks(5));
  g.append("g")
    .attr("class", "axis axis-y")
    .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format(".0%")));
  g.append("g")
    .attr("class", "grid grid-y")
    .call(d3.axisLeft(y).ticks(5).tickFormat("").tickSize(-w))
    .selectAll("text")
    .remove();

  // Quadrant lines
  g.append("line")
    .attr("x1", x(ratingThresh))
    .attr("x2", x(ratingThresh))
    .attr("y1", 0)
    .attr("y2", h)
    .attr("stroke", "var(--ink-dim)")
    .attr("stroke-dasharray", "3,3")
    .attr("opacity", 0.5);
  g.append("line")
    .attr("x1", 0)
    .attr("x2", w)
    .attr("y1", y(aliveThresh))
    .attr("y2", y(aliveThresh))
    .attr("stroke", "var(--ink-dim)")
    .attr("stroke-dasharray", "3,3")
    .attr("opacity", 0.5);

  const quadrants = [
    {
      id: "tl",
      x0: ratingThresh,
      x1: 5,
      y0: aliveThresh,
      y1: 1,
      label: "Loved & alive",
      color: "rgba(127,201,127,0.06)",
    },
    {
      id: "tr",
      x0: ratingThresh,
      x1: 5,
      y0: 0,
      y1: aliveThresh,
      label: "Loved but buried",
      color: "rgba(217,108,108,0.06)",
    },
    {
      id: "bl",
      x0: 0,
      x1: ratingThresh,
      y0: aliveThresh,
      y1: 1,
      label: "Sleeper hit",
      color: "rgba(230,163,86,0.04)",
    },
    {
      id: "br",
      x0: 0,
      x1: ratingThresh,
      y0: 0,
      y1: aliveThresh,
      label: "Forgotten",
      color: "rgba(166,154,140,0.04)",
    },
  ];

  quadrants.forEach((q) => {
    g.append("rect")
      .attr("class", "quadrant-overlay")
      .attr("x", x(q.x0))
      .attr("width", x(q.x1) - x(q.x0))
      .attr("y", y(q.y1))
      .attr("height", y(q.y0) - y(q.y1))
      .attr("fill", q.color)
      .attr("cursor", "pointer")
      .on("click", () => {
        g.selectAll(".quadrant-overlay").classed("active", false);
        g.select(`.quadrant-overlay[data-qid="${q.id}"]`).classed(
          "active",
          true,
        );
        showQuadrantPanel(q, games);
      })
      .attr("data-qid", q.id);

    // Quadrant label
    const labelX = (x(q.x0) + x(q.x1)) / 2;
    const labelY = (y(q.y1) + y(q.y0)) / 2;
    const qCount = games.filter(
      (d) =>
        d.rating >= q.x0 &&
        d.rating < q.x1 &&
        d.alive_ratio >= q.y0 &&
        d.alive_ratio < q.y1,
    ).length;
    g.append("text")
      .attr("class", "quadrant-label")
      .attr("x", labelX)
      .attr("y", labelY)
      .attr("text-anchor", "middle")
      .text(`${q.label} (${qCount})`);
  });

  g.selectAll("circle.qdot")
    .data(games)
    .join("circle")
    .attr("class", "qdot")
    .attr("cx", (d) => x(d.rating))
    .attr("cy", (d) => y(d.alive_ratio))
    .attr("r", 2.5)
    .attr("fill", (d) => ALIVE_SCALE(d.alive_ratio))
    .attr("opacity", 0.4);

  g.append("text")
    .attr("class", "axis-label")
    .attr("x", w / 2)
    .attr("y", h + 38)
    .attr("text-anchor", "middle")
    .text("RAWG rating (0–5)");
  g.append("text")
    .attr("class", "axis-label")
    .attr("transform", "rotate(-90)")
    .attr("x", -h / 2)
    .attr("y", -44)
    .attr("text-anchor", "middle")
    .text("alive ratio");

  if (!svgEl._outsideHandler) {
    const handler = (ev) => {
      const panel = document.getElementById("act7-panel");
      const wrap = svgEl.closest(".story-chart-wrap");
      if (!panel || panel.classList.contains("hidden")) return;
      if (wrap && !wrap.contains(ev.target)) {
        panel.classList.add("hidden");
        g.selectAll(".quadrant-overlay").classed("active", false);
      }
    };
    document.addEventListener("click", handler);
    svgEl._outsideHandler = handler;
  }
}

function showQuadrantPanel(q, games) {
  const panel = document.getElementById("act7-panel");
  const title = document.getElementById("act7-panel-title");
  const list = document.getElementById("act7-panel-list");
  if (!panel || !list) return;

  const sub = games.filter(
    (d) =>
      d.rating >= q.x0 &&
      d.rating < q.x1 &&
      d.alive_ratio >= q.y0 &&
      d.alive_ratio < q.y1 &&
      isFinite(d.alive_ratio),
  );
  const ranked = mortalityIndex(sub)
    .sort((a, b) => d3.descending(a._score, b._score))
    .slice(0, 8);

  title.textContent = q.label;
  list.innerHTML = ranked
    .map(
      (d) =>
        `<div class="cohort-row" title="${d.name}"><span class="cohort-row-name">${d.name}</span><span class="cohort-row-alive">${(d.alive_ratio * 100).toFixed(1)}%</span></div>`,
    )
    .join("");

  panel.classList.remove("hidden");
  const guide = document.getElementById("act7-guide");
  if (guide && q.id === "tr") guide.classList.add("done");
}

// ---- ACT 8 - Launch size is not destiny ----
function initAct8() {
  const games = GAMES_DATA.filter(
    (g) =>
      g.peak_players > 0 &&
      g.current_players >= 0 &&
      isFinite(g.alive_ratio) &&
      g.months_to_peak !== null &&
      g.series.length >= 6,
  );
  const container = document.getElementById("act8-multiples");
  if (!container) return;
  container.innerHTML = "";

  const panels = [
    {
      xFn: (d) => d.peak_players,
      yFn: (d) => d.current_players,
      rXFn: (d) => Math.log(d.peak_players),
      rYFn: (d) => Math.log(d.current_players),
      xLabel: "peak players (log)",
      yLabel: "current players (log)",
      yLog: true,
      refLine: true,
    },
    {
      xFn: (d) => d.months_to_peak,
      yFn: (d) => d.alive_ratio,
      rXFn: (d) => d.months_to_peak,
      rYFn: (d) => d.alive_ratio,
      xLog: false,
      xLabel: "months to peak players",
      yLabel: "alive ratio",
      yLog: false,
      yDomain: [0, 1],
      yTickFormat: d3.format(".0%"),
      refLine: false,
    },
  ];

  panels.forEach((panel, pi) => {
    const div = document.createElement("div");
    div.style.cssText = "position:relative;";
    container.appendChild(div);

    const svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svgEl.style.cssText = "width:100%;display:block;";
    div.appendChild(svgEl);

    const margin = { top: 16, right: 16, bottom: 44, left: 52 };
    const W = container.getBoundingClientRect().width / 2 - 10;
    const H = 280;
    svgEl.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const w = W - margin.left - margin.right;
    const h = H - margin.top - margin.bottom;

    const svg = d3.select(svgEl);
    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const xVals = games
      .map(panel.xFn)
      .filter((v) => (panel.xLog === false ? v >= 0 : v > 0));
    const yVals = games.map(panel.yFn).filter((v) => v >= 0);
    const x =
      panel.xLog === false
        ? d3.scaleLinear().domain(d3.extent(xVals)).range([0, w]).clamp(true)
        : d3.scaleLog().domain(d3.extent(xVals)).range([0, w]).clamp(true);
    const y = panel.yLog
      ? d3
          .scaleLog()
          .domain([0.001, d3.max(yVals) * 1.5])
          .range([h, 0])
          .clamp(true)
      : d3
          .scaleLinear()
          .domain(panel.yDomain || [0, 1])
          .range([h, 0]);

    g.append("g")
      .attr("class", "axis axis-x")
      .attr("transform", `translate(0,${h})`)
      .call(
        d3
          .axisBottom(x)
          .ticks(4)
          .tickFormat(panel.xLog === false ? d3.format("d") : fmtPlayers),
      );
    g.append("g")
      .attr("class", "axis axis-y")
      .call(
        d3
          .axisLeft(y)
          .ticks(4)
          .tickFormat(panel.yTickFormat || fmtPlayers),
      );

    if (panel.refLine) {
      const domain = x.domain();
      g.append("line")
        .attr("x1", x(domain[0]))
        .attr("x2", x(domain[1]))
        .attr("y1", y(domain[0]))
        .attr("y2", y(domain[1]))
        .attr("stroke", "var(--ink-dim)")
        .attr("stroke-dasharray", "3,3")
        .attr("opacity", 0.4);
    }

    g.selectAll("circle")
      .data(
        games.filter(
          (d) =>
            (panel.xLog === false ? panel.xFn(d) >= 0 : panel.xFn(d) > 0) &&
            panel.yFn(d) >= 0,
        ),
      )
      .join("circle")
      .attr("cx", (d) => x(panel.xFn(d)))
      .attr("cy", (d) =>
        y(panel.yLog ? Math.max(0.001, panel.yFn(d)) : panel.yFn(d)),
      )
      .attr("r", 2)
      .attr("fill", (d) => ALIVE_SCALE(d.alive_ratio))
      .attr("opacity", 0.35);

    const r = pearsonR(
      games.filter((d) => panel.xFn(d) > 0 && panel.yFn(d) > 0),
      panel.rXFn,
      panel.rYFn,
    );
    g.append("text")
      .attr("x", w - 25)
      .attr("y", 0)
      .attr("text-anchor", "end")
      .attr("font-size", 9)
      .attr("fill", "var(--ink-dim)")
      .attr("font-family", "var(--mono)")
      .text("Pearson R = " + r.toFixed(2));
    g.append("text")
      .attr("class", "axis-label")
      .attr("x", w / 2)
      .attr("y", h + 38)
      .attr("text-anchor", "middle")
      .text(panel.xLabel);
    g.append("text")
      .attr("class", "axis-label")
      .attr("transform", "rotate(-90)")
      .attr("x", -h / 2)
      .attr("y", -40)
      .attr("text-anchor", "middle")
      .text(panel.yLabel);
  });
}

// ---- ACT 10 - Release month is a rounding error ----
function initAct10(filter) {
  filter = filter || "all";
  let games = GAMES_DATA;
  if (filter === "aaa")
    games = games.filter(
      (g) => g.archetype === "aaa" || g.archetype === "fading_aaa",
    );

  const monthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const peakStats = binnedStats(
    games,
    (g) => g.release_month,
    (g) => g.peak_players,
  );
  const aliveStats = binnedStats(
    games,
    (g) => g.release_month,
    (g) => g.alive_ratio,
  );
  const peakMap = new Map(peakStats.map((s) => [s.key, s.median]));
  const aliveMap = new Map(aliveStats.map((s) => [s.key, s.median]));

  const svgEl = document.getElementById("act10-chart");
  if (!svgEl) return;
  const SIZE = 320;
  svgEl.setAttribute("height", SIZE);
  const W = svgEl.getBoundingClientRect().width;
  if (W === 0) return;
  const cx = W / 2,
    cy = SIZE / 2;
  const outerR = Math.min(cx, cy) - 20;
  const innerR = outerR * 0.42;

  const svg = d3.select(svgEl);
  svg.selectAll("*").remove();

  const peakVals = Array.from({ length: 12 }, (_, i) => peakMap.get(i) || 0);
  const aliveVals = Array.from({ length: 12 }, (_, i) => aliveMap.get(i) || 0);
  const peakMax = d3.max(peakVals) || 1;
  const aliveMax = d3.max(aliveVals) || 1;

  const tooltip =
    document.getElementById("tooltip") ||
    document.body.appendChild(
      Object.assign(document.createElement("div"), {
        id: "tooltip",
        className: "tooltip",
      }),
    );

  for (let m = 0; m < 12; m++) {
    const angle = (m / 12) * 2 * Math.PI;
    const nextAngle = ((m + 1) / 12) * 2 * Math.PI;
    const outerRadFrac = 0.35 + 0.65 * (peakVals[m] / peakMax);
    const innerRadFrac = 0.35 + 0.65 * (aliveVals[m] / aliveMax);

    const outerBandR = innerR + (outerR - innerR) * outerRadFrac;
    const innerBandR = innerR + (outerR - innerR) * 0.3;
    const innerAliveR = innerR + (outerR - innerR) * innerRadFrac * 0.3;

    const arcPeak = d3
      .arc()
      .innerRadius(innerBandR)
      .outerRadius(outerBandR)
      .startAngle(angle + 0.05)
      .endAngle(nextAngle - 0.05);
    const arcAlive = d3
      .arc()
      .innerRadius(innerR * 0.3)
      .outerRadius(innerAliveR)
      .startAngle(angle + 0.05)
      .endAngle(nextAngle - 0.05);

    const midAngle = (angle + nextAngle) / 2;
    const peakColor = d3.interpolateOranges(
      0.3 + 0.7 * (peakVals[m] / peakMax),
    );
    const aliveColor = d3.interpolateGreens(
      0.3 + 0.7 * (aliveVals[m] / aliveMax),
    );

    const gEl = svg.append("g").attr("transform", `translate(${cx},${cy})`);
    gEl
      .append("path")
      .attr("d", arcPeak())
      .attr("fill", peakColor)
      .attr("opacity", 0.8)
      .attr("cursor", "pointer")
      .on("mouseover", () => {
        tooltip.innerHTML = `<strong>${monthNames[m]}</strong><br>Peak: ${fmtPlayers(Math.round(peakVals[m]))}<br>Alive Rate: ${(aliveVals[m] * 100).toFixed(1)}%<br>Games: ${games.filter((g) => g.release_month === m).length}`;
        tooltip.classList.add("visible");
        const guide = document.getElementById("act10-guide");
        if (guide) guide.classList.add("done");
      })
      .on("mousemove", (ev) => {
        tooltip.style.left = ev.pageX + 12 + "px";
        tooltip.style.top = ev.pageY - 28 + "px";
      })
      .on("mouseleave", () => tooltip.classList.remove("visible"));

    gEl
      .append("path")
      .attr("d", arcAlive())
      .attr("fill", aliveColor)
      .attr("opacity", 0.85);

    // Month label
    const labelR = outerR + 10;
    gEl
      .append("text")
      .attr("x", Math.sin(midAngle) * labelR)
      .attr("y", -Math.cos(midAngle) * labelR)
      .attr("text-anchor", "middle")
      .attr("dominant-baseline", "middle")
      .attr("font-size", 8)
      .attr("font-family", "var(--mono)")
      .attr("fill", "var(--ink-dim)")
      .text(monthNames[m]);
  }

  // Center labels
  svg
    .append("text")
    .attr("x", cx)
    .attr("y", cy - 6)
    .attr("text-anchor", "middle")
    .attr("font-size", 8)
    .attr("fill", "var(--ink-dim)")
    .attr("font-family", "var(--mono)")
    .text("alive");
  svg
    .append("text")
    .attr("x", cx)
    .attr("y", cy + 8)
    .attr("text-anchor", "middle")
    .attr("font-size", 8)
    .attr("fill", "var(--ink-dim)")
    .attr("font-family", "var(--mono)")
    .text("ratio");

  // Legend
  svg
    .append("circle")
    .attr("cx", 16)
    .attr("cy", SIZE - 30)
    .attr("r", 5)
    .attr("fill", d3.interpolateOranges(0.7));
  svg
    .append("text")
    .attr("x", 26)
    .attr("y", SIZE - 26)
    .attr("font-size", 8)
    .attr("fill", "var(--ink-dim)")
    .attr("font-family", "var(--mono)")
    .text("peak players (outer ring)");
  svg
    .append("circle")
    .attr("cx", 16)
    .attr("cy", SIZE - 16)
    .attr("r", 5)
    .attr("fill", d3.interpolateGreens(0.7));
  svg
    .append("text")
    .attr("x", 26)
    .attr("y", SIZE - 12)
    .attr("font-size", 8)
    .attr("fill", "var(--ink-dim)")
    .attr("font-family", "var(--mono)")
    .text("alive ratio (inner ring)");

  d3.select("#act10-chips")
    .selectAll(".act-chip")
    .on("click", function () {
      d3.select("#act10-chips").selectAll(".act-chip").classed("active", false);
      d3.select(this).classed("active", true);
      initAct10(this.dataset.filter);
    });
}

// ---- ACT 11 - The DNA of endurance ----
function initAct11(sortKey) {
  sortKey = sortKey || "lift";
  const immortals = GAMES_DATA.filter((g) => g.archetype === "immortal");
  const mortals = GAMES_DATA.filter((g) => g.archetype !== "immortal");

  // Collect all tags from categories + genres
  const allCategories = new Set();
  GAMES_DATA.forEach((g) => {
    (g.tags || []).forEach((c) => {
      if (DESIGN_CATEGORIES.has(c)) allCategories.add(c);
    });

    (g.categories || []).forEach((c) => {
      if (DESIGN_CATEGORIES.has(c)) allCategories.add(c);
    });
  });

  const MIN_COUNT = 10;
  const categoriesStats = [];
  allCategories.forEach((category) => {
    const immortalCount = immortals.filter(
      (g) =>
        (g.tags || []).includes(category) ||
        (g.categories || []).includes(category),
    ).length;
    const mortalCount = mortals.filter(
      (g) =>
        (g.tags || []).includes(category) ||
        (g.categories || []).includes(category),
    ).length;
    console.log(category, immortalCount, mortalCount);
    if (immortalCount + mortalCount < MIN_COUNT) return;
    const immortalFreq = immortalCount / Math.max(1, immortals.length);
    const mortalFreq = mortalCount / Math.max(1, mortals.length);
    const lift = Math.log2(
      Math.max(0.001, immortalFreq) / Math.max(0.001, mortalFreq),
    );
    categoriesStats.push({
      category,
      immortalFreq,
      mortalFreq,
      immortalCount,
      mortalCount,
      lift,
    });
  });

  if (categoriesStats.length === 0) return;

  const sorted = [...categoriesStats]
    .sort((a, b) => {
      if (sortKey === "lift") return d3.descending(a.lift, b.lift);
      if (sortKey === "immortal")
        return d3.descending(a.immortalFreq, b.immortalFreq);
      if (sortKey === "mortal")
        return d3.descending(a.mortalCount, b.mortalCount);
      return d3.ascending(a.tag, b.tag);
    })
    .slice(0, 20);

  console.log(sorted);

  const margin = { top: 10, right: 24, bottom: 10, left: 140 };
  const svgEl = document.getElementById("act11-chart");
  if (!svgEl) return;
  const barH = 22;
  const chartH = sorted.length * barH + margin.top + margin.bottom;
  svgEl.setAttribute("height", chartH);
  const W = svgEl.getBoundingClientRect().width;
  if (W === 0) return;
  const w = W - margin.left - margin.right;

  const svg = d3.select(svgEl);
  svg.selectAll("*").remove();
  const g = svg
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const maxAbs = d3.max(sorted, (d) => Math.abs(d.lift)) || 1;
  const x = d3.scaleLinear().domain([-maxAbs, maxAbs]).range([0, w]);
  const y = d3
    .scaleBand()
    .domain(sorted.map((d) => d.category))
    .range([0, sorted.length * barH])
    .padding(0.2);

  g.append("line")
    .attr("x1", x(0))
    .attr("x2", x(0))
    .attr("y1", 0)
    .attr("y2", sorted.length * barH)
    .attr("stroke", "var(--rule-strong)")
    .attr("stroke-width", 1);

  sorted.forEach((d) => {
    const barX = d.lift >= 0 ? x(0) : x(d.lift);
    const barW = Math.abs(x(d.lift) - x(0));
    const color = d.lift >= 0 ? "#7fc97f" : "#d96c6c";
    g.append("rect")
      .attr("x", barX)
      .attr("width", Math.max(1, barW))
      .attr("y", y(d.category))
      .attr("height", y.bandwidth())
      .attr("fill", color)
      .attr("opacity", 0.75);
    g.append("text")
      .attr("x", d.lift >= 0 ? x(0) - 4 : x(0) + 4)
      .attr("y", y(d.category) + y.bandwidth() / 2)
      .attr("dominant-baseline", "middle")
      .attr("text-anchor", d.lift >= 0 ? "end" : "start")
      .attr("font-size", 10)
      .attr("fill", "var(--ink-dim)")
      .text(d.category);
    g.append("text")
      .attr("x", d.lift >= 0 ? barX + barW + 3 : barX - 3)
      .attr("y", y(d.category) + y.bandwidth() / 2)
      .attr("dominant-baseline", "middle")
      .attr("text-anchor", d.lift >= 0 ? "start" : "end")
      .attr("font-size", 8)
      .attr("fill", color)
      .attr("font-family", "var(--mono)")
      .text(d.lift.toFixed(1));
  });

  // X axis labels
  g.append("text")
    .attr("x", x(-maxAbs))
    .attr("y", sorted.length * barH + 12)
    .attr("text-anchor", "middle")
    .attr("font-size", 8)
    .attr("fill", "var(--dying)")
    .attr("font-family", "var(--mono)")
    .text("← graveyard");
  g.append("text")
    .attr("x", x(maxAbs))
    .attr("y", sorted.length * barH + 12)
    .attr("text-anchor", "middle")
    .attr("font-size", 8)
    .attr("fill", "var(--alive)")
    .attr("font-family", "var(--mono)")
    .text("immortal →");
}

// ---- ACT 12 - Attention is oxygen ----
function initAct12(s) {
  let signal = s || "reddit";
  const field = "reddit_count";

  const games = GAMES_DATA.filter(
    (g) => (g[field] || 0) > 0 && isFinite(g.alive_ratio) && g.alive_ratio > 0,
  );
  const r = pearsonR(
    games,
    (g) => Math.log10(g[field]),
    (g) => g.alive_ratio,
  );
  const rEl = document.getElementById("act12-r");
  if (rEl) rEl.textContent = r.toFixed(3);

  const margin = { top: 20, right: 24, bottom: 44, left: 56 };
  const svgEl = document.getElementById("act12-chart");
  if (!svgEl) return;
  svgEl.setAttribute("height", "360");
  const W = svgEl.getBoundingClientRect().width;
  if (W === 0) return;
  const w = W - margin.left - margin.right;
  const h = 360 - margin.top - margin.bottom;

  const svg = d3.select(svgEl);
  svg.selectAll("*").remove();
  const gEl = svg
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const xVals = games.map((g) => g[field]).filter((v) => v > 0);
  const x = d3.scaleLog().domain(d3.extent(xVals)).range([0, w]).clamp(true);
  const y = d3.scaleLinear().domain([0, 1]).range([h, 0]);

  gEl
    .append("g")
    .attr("class", "axis axis-x")
    .attr("transform", `translate(0,${h})`)
    .call(d3.axisBottom(x));
  gEl
    .append("g")
    .attr("class", "axis axis-y")
    .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format(".0%")));
  gEl
    .append("g")
    .attr("class", "grid grid-y")
    .call(d3.axisLeft(y).ticks(5).tickSize(-w).tickFormat(""))
    .selectAll("text")
    .remove();

  gEl
    .selectAll("circle")
    .data(games)
    .join("circle")
    .attr("cx", (d) => x(Math.max(0.01, d[field])))
    .attr("cy", (d) => y(Math.max(0.001, d.alive_ratio)))
    .attr("r", 2.5)
    .attr("fill", (d) => ARCHETYPE_COLOR[d.archetype] || ARCHETYPE_COLOR.mid)
    .attr("opacity", 0.45);

  gEl
    .append("text")
    .attr("x", w - 4)
    .attr("y", 16)
    .attr("text-anchor", "end")
    .attr("font-size", 10)
    .attr("fill", "#8ab4ff")
    .attr("font-family", "var(--mono)")
    .text("r = " + r.toFixed(3));
  gEl
    .append("text")
    .attr("class", "axis-label")
    .attr("x", w / 2)
    .attr("y", h + 38)
    .attr("text-anchor", "middle")
    .text(signal.toUpperCase() + " COUNT / YEAR (LOG)");
  gEl
    .append("text")
    .attr("class", "axis-label")
    .attr("transform", "rotate(-90)")
    .attr("x", -h / 2)
    .attr("y", -44)
    .attr("text-anchor", "middle")
    .text("alive ratio");

  d3.select("#act12-chips")
    .selectAll(".act-chip")
    .on("click", function () {
      d3.select("#act12-chips").selectAll(".act-chip").classed("active", false);
      d3.select(this).classed("active", true);
      initAct12(this.dataset.signal);
      const guide = document.getElementById("act12-guide");
      if (guide && this.dataset.signal === "reddit")
        guide.classList.add("done");
    });
}

// ---- ACT 13 - The shape of a survivor ----
function initAct13(arch) {
  arch = arch || "all";

  const margin = { top: 24, right: 24, bottom: 44, left: 56 };
  const svgEl = document.getElementById("act13-chart");
  if (!svgEl) return;
  svgEl.setAttribute("height", "360");
  const W = svgEl.getBoundingClientRect().width;
  if (W === 0) return;
  const w = W - margin.left - margin.right;
  const h = 360 - margin.top - margin.bottom;

  const svg = d3.select(svgEl);
  svg.selectAll("*").remove();
  const g = svg
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const x = d3.scaleLinear().domain([0, 72]).range([0, w]);
  const y = d3.scaleLinear().domain([0, 1]).range([h, 0]);

  g.append("g")
    .attr("class", "axis axis-x")
    .attr("transform", `translate(0,${h})`)
    .call(
      d3
        .axisBottom(x)
        .ticks(6)
        .tickFormat((d) => d + "mo"),
    );
  g.append("g")
    .attr("class", "axis axis-y")
    .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format(".0%")));
  g.append("g")
    .attr("class", "grid grid-y")
    .call(d3.axisLeft(y).ticks(5).tickSize(-w).tickFormat(""))
    .selectAll("text")
    .remove();

  const archTypes =
    arch === "all"
      ? ["immortal", "aaa", "fading_aaa", "slow_burn", "mid"]
      : [arch];

  archTypes.forEach((a) => {
    const subset = GAMES_DATA.filter((d) => d.archetype === a);
    const curve = buildDecayCurve(subset).filter((d) => d.key <= 72);
    if (curve.length < 3) return;

    const color = ARCHETYPE_COLOR[a] || "#a69a8c";
    const opacity = arch === "all" ? 0.7 : 1;

    const area = d3
      .area()
      .x((d) => x(d.key))
      .y0((d) => y(d.p25))
      .y1((d) => y(d.p90))
      .curve(d3.curveCatmullRom);

    const line = d3
      .line()
      .x((d) => x(d.key))
      .y((d) => y(d.median))
      .curve(d3.curveCatmullRom);

    g.append("path")
      .datum(curve)
      .attr("fill", color)
      .attr("opacity", 0.12)
      .attr("d", area);
    g.append("path")
      .datum(curve)
      .attr("fill", "none")
      .attr("stroke", color)
      .attr("stroke-width", 2)
      .attr("opacity", opacity)
      .attr("d", line);

    // Label at end of line
    const last = curve[curve.length - 1];
    if (last) {
      g.append("text")
        .attr("x", x(last.key) + 3)
        .attr("y", y(last.median))
        .attr("font-size", 9)
        .attr("fill", color)
        .attr("font-family", "var(--mono)")
        .text(a.replace("_", " "));
    }
  });

  // Annotations
  if (arch === "all" || arch === "immortal") {
    g.append("text")
      .attr("class", "quadrant-label")
      .attr("x", x(36))
      .attr("y", y(0.45))
      .attr("text-anchor", "middle")
      .text("plateau →");
  }
  if (arch === "all" || arch === "fading_aaa") {
    g.append("text")
      .attr("class", "quadrant-label")
      .attr("x", x(8))
      .attr("y", y(0.15))
      .attr("text-anchor", "middle")
      .text("cliff ↓");
  }

  g.append("text")
    .attr("class", "axis-label")
    .attr("x", w / 2)
    .attr("y", h + 38)
    .attr("text-anchor", "middle")
    .text("months since release");
  g.append("text")
    .attr("class", "axis-label")
    .attr("transform", "rotate(-90)")
    .attr("x", -h / 2)
    .attr("y", -44)
    .attr("text-anchor", "middle")
    .text("players / peak");

  d3.select("#act13-chips")
    .selectAll(".act-chip")
    .on("click", function () {
      d3.select("#act13-chips").selectAll(".act-chip").classed("active", false);
      d3.select(this).classed("active", true);
      initAct13(this.dataset.arch);
      const guide = document.getElementById("act13-guide");
      if (guide && this.dataset.arch === "fading_aaa")
        guide.classList.add("done");
    });
}

// ---- ACT 14 - The mortality index, ranked ----
function initAct14(sortMode) {
  sortMode = sortMode || "top";
  const ranked = mortalityIndex(GAMES_DATA);
  const aliveRanked = [...GAMES_DATA].sort((a, b) =>
    d3.descending(a.alive_ratio, b.alive_ratio),
  );
  const aliveRankMap = new Map(aliveRanked.map((g, i) => [g.id, i + 1]));

  let display;
  if (sortMode === "top") {
    display = [...ranked]
      .sort((a, b) => d3.descending(a._score, b._score))
      .slice(0, 25);
  } else if (sortMode === "bottom") {
    display = [...ranked]
      .sort((a, b) => d3.ascending(a._score, b._score))
      .slice(0, 25);
  } else {
    // Biggest movers: largest abs difference between mortality rank and alive_ratio rank
    const mortRanked = [...ranked].sort((a, b) =>
      d3.descending(a._score, b._score),
    );
    const mortRankMap = new Map(mortRanked.map((g, i) => [g.id, i + 1]));
    display = ranked
      .map((g) => ({
        ...g,
        _rankDiff: Math.abs(
          (aliveRankMap.get(g.id) || 999) - (mortRankMap.get(g.id) || 999),
        ),
      }))
      .sort((a, b) => d3.descending(a._rankDiff, b._rankDiff))
      .slice(0, 25);
  }

  const list = document.getElementById("act14-list");
  if (!list) return;
  const scoreMax = d3.max(ranked, (d) => d._score) || 100;

  list.innerHTML = display
    .map(
      (d, i) => `
    <li class="mortality-row" title="${d.name}">
      <span class="mortality-rank">${i + 1}</span>
      <span class="mortality-name">${d.name}</span>
      <span class="mortality-year">${d.year}</span>
      <div class="mortality-bar-wrap"><div class="mortality-bar" style="width:${((d._score / scoreMax) * 100).toFixed(1)}%"></div></div>
      ${makeSpark(d)}
    </li>
  `,
    )
    .join("");

  list.querySelectorAll(".mortality-row").forEach((row, i) => {
    row.addEventListener("click", () => {
      const game = display[i];
      if (game) addToSelection(game);
    });
    row.addEventListener("mouseenter", () => {
      const game = display[i];
      if (!game) return;
      const tooltip =
        document.getElementById("tooltip") ||
        document.body.appendChild(
          Object.assign(document.createElement("div"), {
            id: "tooltip",
            className: "tooltip",
          }),
        );
      tooltip.innerHTML = `<strong>${game.name}</strong><br>Score: ${game._score}<br>alive: ${(game.alive_ratio * 100).toFixed(1)}%<br>${legendTag(game)}`;
      tooltip.classList.add("visible");
      const rect = row.getBoundingClientRect();
      tooltip.style.left = rect.right + 8 + "px";
      tooltip.style.top = rect.top + "px";
    });
    row.addEventListener("mouseleave", () => {
      const tooltip = document.getElementById("tooltip");
      if (tooltip) tooltip.classList.remove("visible");
    });
  });

  d3.select("#act14-sort-chips")
    .selectAll(".sort-chip")
    .on("click", function () {
      d3.select("#act14-sort-chips")
        .selectAll(".sort-chip")
        .classed("active", false);
      d3.select(this).classed("active", true);
      initAct14(this.dataset.sort);
      const guide = document.getElementById("act14-guide");
      if (guide && this.dataset.sort === "movers") guide.classList.add("done");
    });
}

// ---- ACT 15 - Now make your own reading ----
function initAct15() {
  const top5immortal = immortalsTop(5);
  const top5fading = fadingAAAGames().slice(0, 5);
  const top5slow = slowBurnTop(5);

  function renderList(containerId, games) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = games
      .map(
        (g) =>
          `<div class="drill-row" data-id="${g.id}">
        <span class="drill-name">${g.name}</span>
        <span class="drill-alive">${(g.alive_ratio * 100).toFixed(1)}%</span>
        <span style="flex-shrink:0">${makeSpark(g)}</span>
      </div>`,
      )
      .join("");
    el.querySelectorAll(".drill-row").forEach((row, i) => {
      row.addEventListener("click", () => {
        addToSelection(games[i]);
        row.style.opacity = "0.5";
        const guide = document.getElementById("act15-guide");
        if (guide) guide.classList.add("done");
      });
    });
  }

  renderList("act15-immortals", top5immortal);
  renderList("act15-fading", top5fading);
  renderList("act15-slowburn", top5slow);

  const cta = document.getElementById("act15-cta");
  if (cta) {
    cta.addEventListener("click", () => {
      [...top5immortal, ...top5fading, ...top5slow].forEach((g) => {
        state.selectedIds.add(g.id);
      });
      updateSelectionUI();
      d3.select("#nav-sandbox").classed("disabled", false);
      switchView("sandbox");
    });
  }
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
