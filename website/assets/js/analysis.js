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
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const pct0 = (v) => Math.round(v * 100) + "%";
  const games = GAMES_DATA;

  const sorted = games.map((g) => g.alive_ratio).filter(isFinite).sort(d3.ascending);
  const medAll = d3.quantile(sorted, 0.5) || 0;
  const p75    = d3.quantile(sorted, 0.75) || 0;
  const immortals = games.filter((g) => g.alive_ratio > THRESHOLDS.IMMORTAL_MIN);

  set("lede-total",          games.length.toLocaleString());
  set("lede-median-alive",   pct0(medAll));
  set("lede-p75-alive",      pct0(p75));
  set("lede-immortal-count", immortals.length.toLocaleString());
  set("lede-immortal-pct",   (immortals.length / games.length * 100).toFixed(0) + "%");

  set("lede-imm-thr",  pct0(THRESHOLDS.IMMORTAL_MIN));
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

  d3.select("#act15-sort-chips")
    .selectAll(".sort-chip")
    .on("click", function () {
      d3.select("#act15-sort-chips")
        .selectAll(".sort-chip")
        .classed("active", false);
      d3.select(this).classed("active", true);
      renderAct15List(this.dataset.sort);
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
    9: () => initAct9(),
    10: () => initAct10(),
    11: () => initAct11("alive"),
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

// ---- ACT 2 — The Flood ----
function initAct2() {
  const margin = { top: 20, right: 20, bottom: 40, left: 50 };
  const svgEl = document.getElementById("act2-chart");
  if (!svgEl) return;
  svgEl.setAttribute("height", "260");
  const W = svgEl.getBoundingClientRect().width;
  if (W === 0) return;
  const w = W - margin.left - margin.right;
  const h = 260 - margin.top - margin.bottom;

  const svg = d3.select(svgEl);
  svg.selectAll("*").remove();
  const g = svg
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const byCohort = d3.rollup(
    GAMES_DATA,
    (v) => ({
      count: v.length,
      median: d3.median(v, (d) => d.alive_ratio) || 0,
      top3: v
        .sort((a, b) => d3.descending(a.alive_ratio, b.alive_ratio))
        .slice(0, 3),
      all: v,
    }),
    (d) => d.year,
  );
  const data = Array.from(byCohort, ([year, v]) => ({ year, ...v }))
    .filter((d) => d.year >= 1995 && d.year <= 2025)
    .sort((a, b) => d3.ascending(a.year, b.year));

  const x = d3
    .scaleBand()
    .domain(data.map((d) => d.year))
    .range([0, w])
    .padding(0.15);
  const y = d3
    .scaleLinear()
    .domain([0, d3.max(data, (d) => d.count) * 1.1])
    .range([h, 0]);

  g.append("g")
    .attr("class", "axis axis-x")
    .attr("transform", `translate(0,${h})`)
    .call(
      d3
        .axisBottom(x)
        .tickValues(data.filter((_, i) => i % 5 === 0).map((d) => d.year))
        .tickFormat(d3.format("d")),
    );
  g.append("g").attr("class", "axis axis-y").call(d3.axisLeft(y).ticks(5));
  g.append("g")
    .attr("class", "grid grid-y")
    .call(d3.axisLeft(y).ticks(5).tickSize(-w).tickFormat(""))
    .selectAll("text")
    .remove();
  g.append("text")
    .attr("class", "axis-label")
    .attr("transform", "rotate(-90)")
    .attr("x", -h / 2)
    .attr("y", -42)
    .attr("text-anchor", "middle")
    .text("# of releases");

  const tooltip2 = d3.select("#tooltip");
  const chartWrap2 = svgEl.closest(".story-chart-wrap") || svgEl.parentElement;

  g.selectAll("rect.bar2")
    .data(data)
    .join("rect")
    .attr("class", "bar2")
    .attr("x", (d) => x(d.year))
    .attr("width", x.bandwidth())
    .attr("y", (d) => y(d.count))
    .attr("height", (d) => h - y(d.count))
    .attr("fill", (d) => ALIVE_SCALE(d.median))
    .attr("opacity", 0.85)
    .on("mouseover", function (event, d) {
      d3.select(this).attr("opacity", 1);
      const rect = chartWrap2.getBoundingClientRect();
      tooltip2
        .classed("visible", true)
        .style("left", event.clientX - rect.left + 12 + "px")
        .style("top", event.clientY - rect.top + 12 + "px")
        .html(`<div class="tooltip-title">${d.year}</div>
          <div class="tooltip-row"><span>Games released</span><span>${d.count}</span></div>
          <div class="tooltip-row"><span>Median vitality</span><span>${(d.median * 100).toFixed(1)}%</span></div>
          ${d.top3.map((t) => `<div class="tooltip-row dim"><span>${t.name}</span><span>${(t.alive_ratio * 100).toFixed(0)}%</span></div>`).join("")}`);
    })
    .on("mousemove", function (event) {
      const rect = chartWrap2.getBoundingClientRect();
      tooltip2
        .style("left", event.clientX - rect.left + 12 + "px")
        .style("top", event.clientY - rect.top + 12 + "px");
    })
    .on("mouseout", function () {
      d3.select(this).attr("opacity", 0.85);
      tooltip2.classed("visible", false);
    })
    .on("click", function (_ev, d) {
      const panel = document.getElementById("act2-panel");
      const title = document.getElementById("act2-panel-title");
      const list = document.getElementById("act2-panel-list");
      if (
        !panel.classList.contains("hidden") &&
        title.textContent.startsWith(String(d.year))
      ) {
        panel.classList.add("hidden");
        return;
      }
      title.textContent = `${d.year} — ${d.count} games`;
      list.innerHTML = d.all
        .sort((a, b) => d3.descending(a.alive_ratio, b.alive_ratio))
        .map(
          (g2) => `<div class="cohort-row" data-id="${g2.id}">
          <span class="cohort-row-name">${g2.name}</span>
          <span class="cohort-row-alive">${(g2.alive_ratio * 100).toFixed(0)}%</span>
        </div>`,
        )
        .join("");
      list.querySelectorAll(".cohort-row").forEach((row) => {
        row.addEventListener("click", () => {
          const gm = GAMES_DATA.find((x) => x.id === +row.dataset.id);
          if (gm) addToSelection(gm);
        });
      });
      panel.classList.remove("hidden");
      document.getElementById("act2-guide")?.classList.add("done");
    });

  const peak = data.reduce((a, b) => (b.count > a.count ? b : a), data[0]);
  const floodEl = document.getElementById("lede-flood-year");
  if (floodEl) floodEl.textContent = peak.year;
  g.append("text")
    .attr("x", x(peak.year) + x.bandwidth() / 2)
    .attr("y", y(peak.count) - 6)
    .attr("text-anchor", "middle")
    .attr("fill", "var(--ink-dim)")
    .attr("font-size", 9)
    .text(peak.count.toLocaleString());

  if (!initAct2._listenerAttached) {
    document.addEventListener("click", (e) => {
      if (!e.target.closest("[data-act='2']")) {
        document.getElementById("act2-panel")?.classList.add("hidden");
      }
    });
    initAct2._listenerAttached = true;
  }
}

// ---- ACT 3 — Most Games Are Never Finished ----
function initAct3() {
  const margin = { top: 20, right: 20, bottom: 40, left: 55 };
  const svgEl = document.getElementById("act3-chart");
  if (!svgEl) return;
  svgEl.setAttribute("height", "320");
  const W = svgEl.getBoundingClientRect().width;
  if (W === 0) return;
  const half = (W - margin.left - margin.right) / 2 - 20;
  const h = 320 - margin.top - margin.bottom;

  const svg = d3.select(svgEl);
  svg.selectAll("*").remove();

  const gL = svg
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);
  const storyGames = GAMES_DATA.filter(
    (g) => g.game_type !== "pure_online" && g.completion_rate > 0,
  );
  const medC = d3.median(storyGames, (g) => g.completion_rate) || 0;
  d3.select("#act3-median-stat").text(d3.format(".1%")(medC));
  const bins = d3.bin().domain([0, 0.5]).thresholds(25)(
    storyGames.map((d) => Math.min(d.completion_rate, 0.5)),
  );
  const xL = d3.scaleLinear().domain([0, 0.5]).range([0, half]);
  const yL = d3
    .scaleLinear()
    .domain([0, d3.max(bins, (b) => b.length) * 1.1])
    .range([h, 0]);

  gL.append("g")
    .attr("class", "axis axis-x")
    .attr("transform", `translate(0,${h})`)
    .call(d3.axisBottom(xL).ticks(5).tickFormat(d3.format(".0%")));
  gL.append("g").attr("class", "axis axis-y").call(d3.axisLeft(yL).ticks(5));
  gL.append("text")
    .attr("class", "axis-label")
    .attr("transform", "rotate(-90)")
    .attr("x", -h / 2)
    .attr("y", -46)
    .attr("text-anchor", "middle")
    .text("# of games");
  gL.append("text")
    .attr("class", "axis-label")
    .attr("x", half / 2)
    .attr("y", h + 34)
    .attr("text-anchor", "middle")
    .text("completion rate (story-driven games)");

  gL.selectAll("rect.bar3")
    .data(bins)
    .join("rect")
    .attr("class", "bar3")
    .attr("x", (b) => xL(b.x0) + 1)
    .attr("width", (b) => Math.max(0, xL(b.x1) - xL(b.x0) - 2))
    .attr("y", (b) => yL(b.length))
    .attr("height", (b) => h - yL(b.length))
    .attr("fill", "var(--accent)")
    .attr("opacity", 0.7);

  gL.append("line")
    .attr("x1", xL(medC))
    .attr("x2", xL(medC))
    .attr("y1", 0)
    .attr("y2", h)
    .attr("stroke", "var(--ink)")
    .attr("stroke-dasharray", "4,3")
    .attr("stroke-width", 1);
  gL.append("text")
    .attr("x", xL(medC) + 4)
    .attr("y", 14)
    .attr("fill", "var(--ink-dim)")
    .attr("font-size", 9)
    .text("median " + (medC * 100).toFixed(1) + "%");

  const gR = svg
    .append("g")
    .attr("transform", `translate(${margin.left + half + 40},${margin.top})`);

  const TOP_GENRES3 = [...new Set(GAMES_DATA.flatMap((d) => d.genres))]
    .map((genre) => ({
      genre,
      count: GAMES_DATA.filter((d) => d.genres.includes(genre)).length,
    }))
    .sort((a, b) => d3.descending(a.count, b.count))
    .slice(0, 10)
    .map((d) => d.genre)
    .filter((g) => g !== "Unknown");

  const TYPES3 = ["story", "hybrid", "pure_online"];
  const TYPE_COLOR = {
    story: "var(--accent)",
    hybrid: "#8ab4ff",
    pure_online: "var(--dying)",
  };
  const TYPE_LABEL = {
    story: "Story-driven",
    hybrid: "Hybrid (campaign + PvP)",
    pure_online: "Live-service / Online",
  };

  const genreData = TOP_GENRES3.map((genre) => {
    return {
      genre,
      meds: Object.fromEntries(
        TYPES3.map((t) => {
          const sub = GAMES_DATA.filter(
            (d) => d.genres.includes(genre) && d.game_type === t,
          );
          return [t, d3.median(sub, (d) => d.completion_rate) || 0];
        }),
      ),
    };
  }).sort((a, b) => d3.descending(a.meds.story, b.meds.story));

  const maxMed = d3.max(genreData, (d) =>
    Math.max(...TYPES3.map((t) => d.meds[t])),
  );
  const xR = d3
    .scaleLinear()
    .domain([0, maxMed * 1.1])
    .range([0, half]);
  const yR = d3
    .scaleBand()
    .domain(genreData.map((d) => d.genre))
    .range([0, h])
    .padding(0.15);
  const subBand = d3
    .scaleBand()
    .domain(TYPES3)
    .range([0, yR.bandwidth()])
    .padding(0.06);

  gR.append("g")
    .attr("class", "axis axis-x")
    .attr("transform", `translate(0,${h})`)
    .call(d3.axisBottom(xR).ticks(4).tickFormat(d3.format(".0%")));
  gR.append("g")
    .attr("class", "axis axis-y")
    .call(d3.axisLeft(yR).tickSize(0))
    .select(".domain")
    .remove();
  gR.append("text")
    .attr("class", "axis-label")
    .attr("x", half / 2)
    .attr("y", h + 34)
    .attr("text-anchor", "middle")
    .text("median completion rate");

  genreData.forEach((d) => {
    const yBase = yR(d.genre);
    TYPES3.forEach((t) => {
      if (d.meds[t] <= 0) return;
      gR.append("rect")
        .attr("x", 0)
        .attr("y", yBase + subBand(t))
        .attr("width", xR(d.meds[t]))
        .attr("height", subBand.bandwidth())
        .attr("fill", TYPE_COLOR[t])
        .attr("opacity", 0.75)
        .append("title")
        .text(`${d.genre} ${TYPE_LABEL[t]}: ${(d.meds[t] * 100).toFixed(1)}%`);
    });
  });

  const leg3 = gR.append("g").attr("transform", `translate(0,${h + 46})`);
  TYPES3.forEach((t, i) => {
    leg3
      .append("rect")
      .attr("x", i * 110)
      .attr("width", 9)
      .attr("height", 9)
      .attr("fill", TYPE_COLOR[t])
      .attr("opacity", 0.75);
    leg3
      .append("text")
      .attr("x", i * 110 + 12)
      .attr("y", 8)
      .attr("font-size", 8)
      .attr("fill", "var(--ink-dim)")
      .text(TYPE_LABEL[t]);
  });
}

// ---- ACT 4 — The Completion Paradox ----
function initAct4() {
  const margin = { top: 20, right: 20, bottom: 50, left: 55 };
  const svgEl = document.getElementById("act4-chart");
  if (!svgEl) return;
  svgEl.setAttribute("height", "340");
  const W = svgEl.getBoundingClientRect().width;
  if (W === 0) return;
  const w = W - margin.left - margin.right;
  const h = 340 - margin.top - margin.bottom;

  const filtered = GAMES_DATA.filter(
    (g) =>
      g.engagement_total >= 10 && g.completion_rate > 0 && g.alive_ratio > 0,
  );
  let colorMode = "live_service";

  const svg = d3.select(svgEl);
  svg.selectAll("*").remove();
  const gWrap = svg
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);
  const g = gWrap.append("g");

  const x = d3
    .scaleLinear()
    .domain([0, d3.max(filtered, (d) => d.completion_rate) * 1.05])
    .range([0, w]);
  const y = d3.scaleLinear().domain([0, 1]).range([h, 0]);

  g.append("g")
    .attr("class", "axis axis-x")
    .attr("transform", `translate(0,${h})`)
    .call(d3.axisBottom(x).ticks(5).tickFormat(d3.format(".0%")));
  g.append("g")
    .attr("class", "axis axis-y")
    .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format(".0%")));
  g.append("g")
    .attr("class", "grid grid-y")
    .call(d3.axisLeft(y).ticks(5).tickSize(-w).tickFormat(""))
    .selectAll("text")
    .remove();

  const mx = d3.median(filtered, (d) => d.completion_rate);
  const my = d3.median(filtered, (d) => d.alive_ratio);
  g.append("line")
    .attr("x1", x(mx))
    .attr("x2", x(mx))
    .attr("y1", 0)
    .attr("y2", h)
    .attr("stroke", "var(--rule-strong)")
    .attr("stroke-dasharray", "3,3");
  g.append("line")
    .attr("x1", 0)
    .attr("x2", w)
    .attr("y1", y(my))
    .attr("y2", y(my))
    .attr("stroke", "var(--rule-strong)")
    .attr("stroke-dasharray", "3,3");

  const qlabels = [
    { tx: x(mx) / 2, ty: 10, text: "Never finished, still played" },
    { tx: x(mx) + (w - x(mx)) / 2, ty: 10, text: "Finished & replayed" },
    { tx: x(mx) / 2, ty: h - 6, text: "Abandoned & forgotten" },
    { tx: x(mx) + (w - x(mx)) / 2, ty: h - 6, text: "One-and-done" },
  ];
  g.selectAll(".quadrant-label")
    .data(qlabels)
    .join("text")
    .attr("class", "quadrant-label")
    .attr("x", (d) => d.tx)
    .attr("y", (d) => d.ty)
    .attr("text-anchor", "middle")
    .text((d) => d.text);

  const r = pearsonR(
    filtered,
    (d) => d.completion_rate,
    (d) => d.alive_ratio,
  );
  const storyOnly = filtered.filter((d) => d.game_type !== "pure_online");
  const rStory = pearsonR(
    storyOnly,
    (d) => d.completion_rate,
    (d) => d.alive_ratio,
  );
  d3.select("#act4-r-stat").text(r.toFixed(3));
  g.append("text")
    .attr("x", w - 4)
    .attr("y", h - 18)
    .attr("text-anchor", "end")
    .attr("fill", "var(--ink-faint)")
    .attr("font-size", 10)
    .text(`r (all) = ${r.toFixed(3)}`);
  g.append("text")
    .attr("x", w - 4)
    .attr("y", h - 6)
    .attr("text-anchor", "end")
    .attr("fill", "var(--ink-faint)")
    .attr("font-size", 10)
    .text(`r (story-driven) = ${rStory.toFixed(3)}`);

  g.append("text")
    .attr("class", "axis-label")
    .attr("x", w / 2)
    .attr("y", h + 40)
    .attr("text-anchor", "middle")
    .text("completion rate");
  g.append("text")
    .attr("class", "axis-label")
    .attr("transform", "rotate(-90)")
    .attr("x", -h / 2)
    .attr("y", -42)
    .attr("text-anchor", "middle")
    .text("alive ratio");

  const TOP_GENRES = [...new Set(GAMES_DATA.flatMap((g) => g.genres))]
    .map((genre) => ({
      genre,
      count: GAMES_DATA.filter((d) => d.genres.includes(genre)).length,
    }))
    .sort((a, b) => d3.descending(a.count, b.count))
    .slice(0, 8)
    .map((d) => d.genre);
  const genreColorScale = d3
    .scaleOrdinal(d3.schemeTableau10)
    .domain(TOP_GENRES);

  const GAME_TYPE_COLOR = {
    story: "var(--accent)",
    hybrid: "#8ab4ff",
    pure_online: "var(--dying)",
  };
  function getColor(d) {
    if (colorMode === "live_service")
      return GAME_TYPE_COLOR[d.game_type] || "#888";
    if (colorMode === "archetype")
      return ARCHETYPE_COLOR[d.archetype] || "#888";
    const pg = d.genres.find((gg) => TOP_GENRES.includes(gg));
    return pg ? genreColorScale(pg) : "#555";
  }

  const dots = g
    .append("g")
    .attr("class", "dots")
    .selectAll("circle.dot4")
    .data(filtered)
    .join("circle")
    .attr("class", "dot4")
    .attr("cx", (d) => x(d.completion_rate))
    .attr("cy", (d) => y(d.alive_ratio))
    .attr("r", 3.5)
    .attr("fill", (d) => getColor(d))
    .attr("opacity", 0.5)
    .on("mouseover", (event, d) => {
      d3
        .select("#tooltip")
        .classed("visible", true)
        .style("left", event.offsetX + 14 + "px")
        .style("top", event.offsetY + 14 + "px")
        .html(`<div class="tooltip-title">${d.name}</div>
          <div class="tooltip-row"><span>Completion</span><span>${(d.completion_rate * 100).toFixed(1)}%</span></div>
          <div class="tooltip-row"><span>Alive</span><span>${(d.alive_ratio * 100).toFixed(1)}%</span></div>`);
    })
    .on("mouseout", () => d3.select("#tooltip").classed("visible", false));

  d3.select("#act4-color-archetype").on("click", function () {
    colorMode = "archetype";
    d3.select("#act4-color-archetype").classed("active", true);
    d3.select("#act4-color-genre").classed("active", false);
    d3.select("#act4-color-live").classed("active", false);
    dots
      .transition()
      .duration(400)
      .attr("fill", (d) => getColor(d));
  });
  d3.select("#act4-color-genre").on("click", function () {
    colorMode = "genre";
    d3.select("#act4-color-genre").classed("active", true);
    d3.select("#act4-color-archetype").classed("active", false);
    d3.select("#act4-color-live").classed("active", false);
    dots
      .transition()
      .duration(400)
      .attr("fill", (d) => getColor(d));
  });
  d3.select("#act4-color-live").on("click", function () {
    colorMode = "live_service";
    d3.select("#act4-color-live").classed("active", true);
    d3.select("#act4-color-archetype").classed("active", false);
    d3.select("#act4-color-genre").classed("active", false);
    dots
      .transition()
      .duration(400)
      .attr("fill", (d) => getColor(d));
  });

  // Clip dots to the chart area so they don't overflow during zoom
  svg
    .append("defs")
    .append("clipPath")
    .attr("id", "act4-clip")
    .append("rect")
    .attr("width", w)
    .attr("height", h);
  dots.attr("clip-path", "url(#act4-clip)");

  // Current rescaled axes (updated by zoom handler)
  let xZ = x,
    yZ = y;

  function applyZoom(e) {
    xZ = e.transform.rescaleX(x);
    yZ = e.transform.rescaleY(y);

    g.select(".axis-x").call(
      d3.axisBottom(xZ).ticks(5).tickFormat(d3.format(".0%")),
    );
    g.select(".axis-y").call(
      d3.axisLeft(yZ).ticks(5).tickFormat(d3.format(".0%")),
    );
    g.select(".grid-y")
      .call(d3.axisLeft(yZ).ticks(5).tickSize(-w).tickFormat(""))
      .selectAll("text")
      .remove();

    dots
      .attr("cx", (d) => xZ(d.completion_rate))
      .attr("cy", (d) => yZ(d.alive_ratio))
      .attr("r", 3.5 / Math.sqrt(e.transform.k));

    // Update median lines
    g.select(".vline-med").attr("x1", xZ(mx)).attr("x2", xZ(mx));
    g.select(".hline-med").attr("y1", yZ(my)).attr("y2", yZ(my));

    // Update quadrant label positions
    const mxPx = xZ(mx),
      myPx = yZ(my);
    g.selectAll(".quadrant-label")
      .attr("x", (d) => (d.side === "left" ? mxPx / 2 : mxPx + (w - mxPx) / 2))
      .attr("y", (d) =>
        d.top ? Math.min(myPx - 4, 14) : Math.max(myPx + 10, h - 6),
      );
  }

  // Give median lines classes so zoom can update them
  g.selectAll("line[stroke-dasharray]").each(function () {
    const el = d3.select(this);
    if (+el.attr("x1") === +el.attr("x2")) el.attr("class", "vline-med");
    else el.attr("class", "hline-med");
  });

  // Attach quadrant side/top data for positional updates
  g.selectAll(".quadrant-label")
    .data([
      { side: "left", top: true, text: "Never finished, still played" },
      { side: "right", top: true, text: "Finished & replayed" },
      { side: "left", top: false, text: "Abandoned & forgotten" },
      { side: "right", top: false, text: "One-and-done" },
    ])
    .attr("class", "quadrant-label");

  // Zoom via scroll/wheel only — brush keeps mouse drag for selection.
  // Attached to gWrap so wheel events bubble up from any child (including brush overlay).
  const zoom4 = d3
    .zoom()
    .scaleExtent([1, 12])
    .filter((event) => event.type === "wheel")
    .on("zoom", applyZoom);

  gWrap.call(zoom4);

  d3.select("#act4-zoom-reset").on("click", () => {
    gWrap.transition().duration(300).call(zoom4.transform, d3.zoomIdentity);
  });

  const brushG = gWrap.append("g").attr("class", "brush");
  const brushObj = d3
    .brush()
    .extent([
      [0, 0],
      [w, h],
    ])
    .on("end", (event) => {
      const guide = document.getElementById("act4-guide");
      const result = document.getElementById("act4-brush-result");
      if (!event.selection) {
        result.innerHTML = "";
        return;
      }
      const [[x0, y0], [x1, y1]] = event.selection;
      // Use current rescaled axes so selection is correct after zoom
      const sel = filtered.filter(
        (d) =>
          xZ(d.completion_rate) >= x0 &&
          xZ(d.completion_rate) <= x1 &&
          yZ(d.alive_ratio) >= y0 &&
          yZ(d.alive_ratio) <= y1,
      );
      result.innerHTML = sel.length
        ? `<p class="story-caption" style="color:var(--ink-dim)">${sel.length} games selected: ${sel
            .slice(0, 5)
            .map((d) => d.name)
            .join(", ")}${sel.length > 5 ? "…" : ""}</p>`
        : `<p class="story-caption">No games in that region.</p>`;
      if (guide && sel.length > 0) guide.classList.add("done");
    });
  brushG.call(brushObj);
}

// ---- ACT 5 — The Decay Curve ----
function initAct5() {
  const margin = { top: 20, right: 20, bottom: 45, left: 60 };
  const svgEl = document.getElementById("act5-chart");
  if (!svgEl) return;
  svgEl.setAttribute("height", "300");
  const W = svgEl.getBoundingClientRect().width;
  if (W === 0) return;
  const w = W - margin.left - margin.right;
  const h = 300 - margin.top - margin.bottom;

  const svg = d3.select(svgEl);
  svg.selectAll("*").remove();
  const g = svg
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const stats = buildDecayCurve(GAMES_DATA).filter((d) => d.key <= 96);

  if (!stats.length) {
    g.append("text")
      .attr("x", w / 2)
      .attr("y", h / 2)
      .attr("text-anchor", "middle")
      .attr("fill", "var(--ink-dim)")
      .text("Insufficient time-series data");
    return;
  }

  const x = d3
    .scaleLinear()
    .domain([0, d3.max(stats, (d) => d.key)])
    .range([0, w]);
  const y = d3
    .scaleLinear()
    .domain([0, Math.min(1, d3.max(stats, (d) => d.p90) * 1.15)])
    .range([h, 0]);

  g.append("g")
    .attr("class", "axis axis-x")
    .attr("transform", `translate(0,${h})`)
    .call(
      d3
        .axisBottom(x)
        .ticks(8)
        .tickFormat((d) => (d % 12 === 0 ? `yr ${d / 12}` : "")),
    );
  g.append("g")
    .attr("class", "axis axis-y")
    .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format(".0%")));
  g.append("g")
    .attr("class", "grid grid-y")
    .call(d3.axisLeft(y).ticks(5).tickSize(-w).tickFormat(""))
    .selectAll("text")
    .remove();

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
    .attr("y", -48)
    .attr("text-anchor", "middle")
    .text("players / peak (ratio)");

  const area5 = d3
    .area()
    .x((d) => x(d.key))
    .y0((d) => y(d.p25))
    .y1((d) => y(d.p90))
    .curve(d3.curveCatmullRom);
  const line5 = d3
    .line()
    .x((d) => x(d.key))
    .y((d) => y(d.median))
    .curve(d3.curveCatmullRom);

  g.append("path")
    .datum(stats)
    .attr("fill", "var(--alive)")
    .attr("opacity", 0.15)
    .attr("d", area5);
  g.append("path")
    .datum(stats)
    .attr("fill", "none")
    .attr("stroke", "var(--alive)")
    .attr("stroke-width", 2)
    .attr("d", line5);

  const lineP90 = d3
    .line()
    .x((d) => x(d.key))
    .y((d) => y(d.p90))
    .curve(d3.curveCatmullRom);
  g.append("path")
    .datum(stats)
    .attr("fill", "none")
    .attr("stroke", "var(--alive)")
    .attr("stroke-width", 1)
    .attr("stroke-dasharray", "4,3")
    .attr("opacity", 0.6)
    .attr("d", lineP90);

  g.append("text")
    .attr("x", 4)
    .attr("y", 12)
    .attr("fill", "var(--ink-faint)")
    .attr("font-size", 9)
    .text("Games released 2013–2025 only (full lifecycle data available)");

  const TOP_GENRES = [...new Set(GAMES_DATA.flatMap((d) => d.genres))]
    .map((genre) => ({
      genre,
      count: GAMES_DATA.filter((d) => d.genres.includes(genre)).length,
    }))
    .sort((a, b) => d3.descending(a.count, b.count))
    .slice(0, 8)
    .map((d) => d.genre);
  const GENRE_PALETTE = d3.schemeTableau10;

  const selectedGenres = new Set();
  const overlayPaths = new Map();

  function drawOverlay(genre, color) {
    const gs = GAMES_DATA.filter((d) => d.genres.includes(genre));
    const st = buildDecayCurve(gs).filter((d) => d.key <= 96);
    if (!st.length) return;
    const p = g
      .append("path")
      .datum(st)
      .attr("fill", "none")
      .attr("stroke", color)
      .attr("stroke-width", 2)
      .attr("opacity", 0.85)
      .attr("d", line5);
    overlayPaths.set(genre, p);
  }

  const chips = d3.select("#act5-genre-chips");
  chips
    .selectAll(".act-chip")
    .data(TOP_GENRES)
    .join("button")
    .attr("class", "act-chip")
    .text((d) => d)
    .on("click", function (_ev, genre) {
      if (selectedGenres.has(genre)) {
        selectedGenres.delete(genre);
        overlayPaths.get(genre)?.remove();
        overlayPaths.delete(genre);
        d3.select(this).classed("active", false);
      } else if (selectedGenres.size < 3) {
        selectedGenres.add(genre);
        const color = GENRE_PALETTE[selectedGenres.size - 1];
        drawOverlay(genre, color);
        d3.select(this).classed("active", true);
        document.getElementById("act5-guide")?.classList.add("done");
      }
    });

  d3.select("#act5-reset").on("click", () => {
    selectedGenres.forEach((genre) => overlayPaths.get(genre)?.remove());
    selectedGenres.clear();
    overlayPaths.clear();
    d3.select("#act5-genre-chips")
      .selectAll(".act-chip")
      .classed("active", false);
  });
}

// ---- ACT 6 — Genre Lifecycles ----
function initAct6() {
  // Inject live genre ranking by median alive_ratio (min 20 games per genre)
  (function injectGenreRanking() {
    const byGenre = [...new Set(GAMES_DATA.flatMap((d) => d.genres))]
      .map((genre) => {
        const sub = GAMES_DATA.filter((d) => d.genres.includes(genre));
        return {
          genre,
          count: sub.length,
          med: d3.median(sub, (d) => d.alive_ratio) || 0,
        };
      })
      .filter((d) => d.count >= 20)
      .sort((a, b) => d3.descending(a.med, b.med));
    const top3 = byGenre
      .slice(0, 3)
      .map((d) => d.genre)
      .join(", ");
    const bot2 = byGenre
      .slice(-2)
      .map((d) => d.genre)
      .join(" and ");
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };
    set("lede-top-genres", top3);
    set("lede-bottom-genres", bot2);
  })();

  const TOP_GENRES = [...new Set(GAMES_DATA.flatMap((d) => d.genres))]
    .map((genre) => ({
      genre,
      count: GAMES_DATA.filter((d) => d.genres.includes(genre)).length,
    }))
    .sort((a, b) => d3.descending(a.count, b.count))
    .slice(0, 8)
    .map((d) => d.genre);

  const grid = document.getElementById("act6-grid");
  const expanded = document.getElementById("act6-expanded");
  let expandedGenre = null;

  function slopeLabel(stats) {
    if (stats.length < 5) return "";
    const early = stats.find((s) => s.key <= 12)?.median || 0;
    const late = stats.find((s) => s.key >= 60)?.median || 0;
    const delta = late - early;
    if (delta < -0.04) return "↘ fades";
    if (delta > 0.01) return "↗ grows";
    return "→ stable";
  }

  function drawMiniChart(container, genre, isExpanded) {
    const gs = GAMES_DATA.filter((d) => d.genres.includes(genre));
    const stats = buildDecayCurve(gs).filter((d) => d.key <= 96);
    if (!stats.length) return;

    const cW = isExpanded ? 500 : 120;
    const cH = isExpanded ? 200 : 70;
    const m = isExpanded
      ? { top: 20, right: 20, bottom: 36, left: 50 }
      : { top: 6, right: 4, bottom: 6, left: 4 };

    const innerW = cW - m.left - m.right;
    const innerH = cH - m.top - m.bottom;

    const svg6 = d3
      .select(container)
      .append("svg")
      .attr("width", "100%")
      .attr("height", cH)
      .attr("viewBox", `0 0 ${cW} ${cH}`)
      .attr("preserveAspectRatio", "xMidYMid meet");
    const gg = svg6
      .append("g")
      .attr("transform", `translate(${m.left},${m.top})`);

    const x6 = d3
      .scaleLinear()
      .domain([0, d3.max(stats, (d) => d.key)])
      .range([0, innerW]);
    const y6 = d3
      .scaleLinear()
      .domain([0, Math.min(1, d3.max(stats, (d) => d.p90) * 1.2)])
      .range([innerH, 0]);
    const slope = slopeLabel(stats);

    if (isExpanded) {
      gg.append("g")
        .attr("class", "axis axis-x")
        .attr("transform", `translate(0,${innerH})`)
        .call(
          d3
            .axisBottom(x6)
            .ticks(8)
            .tickFormat((d) => (d % 12 === 0 ? `yr ${d / 12}` : "")),
        );
      gg.append("g")
        .attr("class", "axis axis-y")
        .call(d3.axisLeft(y6).ticks(4).tickFormat(d3.format(".0%")));
      gg.append("text")
        .attr("class", "axis-label")
        .attr("x", innerW / 2)
        .attr("y", innerH + 30)
        .attr("text-anchor", "middle")
        .text("months since release");
      gg.append("text")
        .attr("class", "axis-label")
        .attr("transform", "rotate(-90)")
        .attr("x", -innerH / 2)
        .attr("y", -40)
        .attr("text-anchor", "middle")
        .text("players / peak");
    } else if (slope) {
      gg.append("text")
        .attr("x", innerW / 2)
        .attr("y", innerH - 2)
        .attr("text-anchor", "middle")
        .attr("fill", "var(--ink-faint)")
        .attr("font-size", 8)
        .text(slope);
    }

    const area6 = d3
      .area()
      .x((d) => x6(d.key))
      .y0((d) => y6(d.p25))
      .y1((d) => y6(d.p90))
      .curve(d3.curveCatmullRom);
    const line6 = d3
      .line()
      .x((d) => x6(d.key))
      .y((d) => y6(d.median))
      .curve(d3.curveCatmullRom);
    gg.append("path")
      .datum(stats)
      .attr("fill", "var(--alive)")
      .attr("opacity", 0.15)
      .attr("d", area6);
    gg.append("path")
      .datum(stats)
      .attr("fill", "none")
      .attr("stroke", "var(--alive)")
      .attr("stroke-width", isExpanded ? 2 : 1.5)
      .attr("d", line6);
  }

  function renderMiniCards() {
    grid.innerHTML = "";
    TOP_GENRES.forEach((genre) => {
      const cell = document.createElement("div");
      cell.className =
        "genre-mini" + (genre === expandedGenre ? " expanded" : "");
      cell.innerHTML = `<div class="genre-mini-label">${genre}</div>`;
      const chartDiv = document.createElement("div");
      cell.appendChild(chartDiv);
      drawMiniChart(chartDiv, genre, false);
      cell.addEventListener("click", () => {
        if (expandedGenre === genre) {
          expandedGenre = null;
          expanded.style.display = "none";
          expanded.innerHTML = "";
        } else {
          expandedGenre = genre;
          expanded.style.display = "block";
          expanded.innerHTML = `<div class="genre-mini-label" style="font-size:11px;margin-bottom:8px">${genre} — full decay curve</div>`;
          drawMiniChart(expanded, genre, true);
          document.getElementById("act6-guide")?.classList.add("done");
        }
        renderMiniCards();
      });
      grid.appendChild(cell);
    });
  }

  renderMiniCards();
}

// ---- ACT 7 — The DNA of Immortality ----
function initAct7() {
  const margin = { top: 20, right: 60, bottom: 40, left: 140 };
  const svgEl = document.getElementById("act7-chart");
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

  function computeLift(dim) {
    const immortals = GAMES_DATA.filter(
      (d) =>
        d.year <= THRESHOLDS.IMMORTAL_YEAR_CUTOFF &&
        d.alive_ratio > THRESHOLDS.IMMORTAL_MIN &&
        d.engagement_total >= THRESHOLDS.ENGAGEMENT_FLOOR,
    );
    const mortals = GAMES_DATA.filter(
      (d) =>
        d.year <= THRESHOLDS.IMMORTAL_YEAR_CUTOFF &&
        d.alive_ratio <= THRESHOLDS.ALIVE_MIN &&
        d.engagement_total >= 10,
    );
    const getFn = dim === "genre" ? (d) => d.genres : (d) => d.platforms;

    const share = (pool, key) => {
      const total = pool.length;
      const inKey = pool.filter((d) => getFn(d).includes(key)).length;
      return total > 0 ? inKey / total : 0;
    };
    const keys =
      dim === "genre"
        ? [...new Set(GAMES_DATA.flatMap((d) => d.genres))].filter(
            (k) => k !== "Unknown",
          )
        : [...new Set(GAMES_DATA.flatMap((d) => d.platforms))];

    return keys
      .map((k) => {
        const nImm = immortals.filter((d) => getFn(d).includes(k)).length;
        const nMort = mortals.filter((d) => getFn(d).includes(k)).length;
        return {
          key: k,
          lift: share(immortals, k) - share(mortals, k),
          nImm,
          nMort,
        };
      })
      .filter((d) => d.nImm + d.nMort >= 40)
      .sort((a, b) => d3.descending(Math.abs(a.lift), Math.abs(b.lift)))
      .slice(0, 14);
  }

  function render7(dim) {
    g.selectAll("*").remove();
    const data = computeLift(dim);
    const y7 = d3
      .scaleBand()
      .domain(data.map((d) => d.key))
      .range([0, h])
      .padding(0.25);
    const maxL = d3.max(data, (d) => Math.abs(d.lift));
    const x7 = d3.scaleLinear().domain([-maxL, maxL]).range([0, w]);

    g.append("g")
      .attr("class", "axis axis-x")
      .attr("transform", `translate(0,${h})`)
      .call(
        d3
          .axisBottom(x7)
          .ticks(5)
          .tickFormat((d) => d3.format("+.0%")(d)),
      );
    g.append("g")
      .attr("class", "axis axis-y")
      .call(d3.axisLeft(y7).tickSize(0))
      .select(".domain")
      .remove();

    g.append("line")
      .attr("x1", x7(0))
      .attr("x2", x7(0))
      .attr("y1", 0)
      .attr("y2", h)
      .attr("stroke", "var(--rule-strong)")
      .attr("stroke-width", 1);

    g.selectAll("rect.bar7")
      .data(data)
      .join("rect")
      .attr("class", "bar7")
      .attr("x", (d) => (d.lift >= 0 ? x7(0) : x7(d.lift)))
      .attr("y", (d) => y7(d.key))
      .attr("width", (d) => Math.abs(x7(d.lift) - x7(0)))
      .attr("height", y7.bandwidth())
      .attr("fill", (d) => (d.lift >= 0 ? "var(--alive)" : "var(--dying)"))
      .attr("opacity", 0.8)
      .attr("cursor", "pointer")
      .on("mouseover", (event, d) => {
        d3
          .select("#tooltip")
          .classed("visible", true)
          .style("left", event.clientX + 12 + "px")
          .style("top", event.clientY + 12 + "px")
          .html(`<div class="tooltip-title">${d.key}</div>
            <div class="tooltip-row"><span>Lift</span><span>${d3.format("+.1%")(d.lift)}</span></div>
            <div class="tooltip-row"><span>Immortal N</span><span>${d.nImm}</span></div>
            <div class="tooltip-row"><span>Mortal N</span><span>${d.nMort}</span></div>`);
      })
      .on("mouseout", () => d3.select("#tooltip").classed("visible", false))
      .on("click", (_ev, d) => {
        const drill = document.getElementById("act7-drill");
        const immortals = GAMES_DATA.filter(
          (gd) =>
            gd.year <= THRESHOLDS.IMMORTAL_YEAR_CUTOFF &&
            gd.alive_ratio > THRESHOLDS.IMMORTAL_MIN &&
            (gd.game_type === "pure_online"
              ? gd.peak_players >= THRESHOLDS.PURE_ONLINE_PEAK_FLOOR
              : gd.engagement_total >= THRESHOLDS.ENGAGEMENT_FLOOR) &&
            (dim === "genre"
              ? gd.genres.includes(d.key)
              : gd.platforms.includes(d.key)),
        )
          .sort((a, b) => d3.descending(a.alive_ratio, b.alive_ratio))
          .slice(0, 10);
        drill.innerHTML = immortals.length
          ? `<div style="font:9px var(--mono);text-transform:uppercase;letter-spacing:.1em;color:var(--accent);margin-bottom:8px">Immortals in ${d.key} (N=${d.nImm})</div>` +
            immortals
              .map(
                (gd, i) =>
                  `<div class="drill-row"><span class="drill-rank">${i + 1}</span><span class="drill-name">${gd.name}</span><span class="drill-alive">${(gd.alive_ratio * 100).toFixed(0)}%</span></div>`,
              )
              .join("")
          : `<p class="story-caption">No immortals found for ${d.key}.</p>`;
        document.getElementById("act7-guide")?.classList.add("done");
      });

    g.append("text")
      .attr("class", "axis-label")
      .attr("x", w / 2)
      .attr("y", h + 34)
      .attr("text-anchor", "middle")
      .text("share in immortals minus share in mortals (pp)");
  }

  render7("genre");

  // Inject live RPG gap into the lead text
  (function injectRpgGap() {
    const immortals7 = GAMES_DATA.filter(
      (d) =>
        d.year <= THRESHOLDS.IMMORTAL_YEAR_CUTOFF &&
        d.alive_ratio > THRESHOLDS.IMMORTAL_MIN &&
        d.engagement_total >= THRESHOLDS.ENGAGEMENT_FLOOR,
    );
    const mortals7 = GAMES_DATA.filter(
      (d) =>
        d.year <= THRESHOLDS.IMMORTAL_YEAR_CUTOFF &&
        d.alive_ratio <= THRESHOLDS.ALIVE_MIN &&
        d.engagement_total >= 10,
    );
    const share = (pool, g) =>
      pool.length > 0
        ? pool.filter((d) => d.genres.includes(g)).length / pool.length
        : 0;
    const gap = (share(immortals7, "RPG") - share(mortals7, "RPG")) * 100;
    d3.select("#act7-rpg-gap").text(`${gap.toFixed(1)} pp`);
  })();

  d3.select("#act7-by-genre").on("click", function () {
    d3.select("#act7-by-genre").classed("active", true);
    d3.select("#act7-by-platform").classed("active", false);
    render7("genre");
  });
  d3.select("#act7-by-platform").on("click", function () {
    d3.select("#act7-by-platform").classed("active", true);
    d3.select("#act7-by-genre").classed("active", false);
    render7("platform");
  });
}

// ---- ACT 8 — Critics vs Community ----
function initAct8() {
  const margin = { top: 20, right: 20, bottom: 50, left: 55 };
  const svgEl = document.getElementById("act8-chart");
  if (!svgEl) return;
  svgEl.setAttribute("height", "300");
  const W = svgEl.getBoundingClientRect().width;
  if (W === 0) return;
  const half = (W - margin.left - margin.right) / 2 - 20;
  const h = 300 - margin.top - margin.bottom;

  const svg = d3.select(svgEl);
  svg.selectAll("*").remove();

  const metaGames = GAMES_DATA.filter(
    (g) => g.metacritic > 0 && g.alive_ratio >= 0,
  );
  const ratingGames = GAMES_DATA.filter(
    (g) => g.rating > 0 && g.alive_ratio >= 0,
  );
  const rMeta = pearsonR(
    metaGames,
    (d) => d.metacritic,
    (d) => d.alive_ratio,
  );
  const rRating = pearsonR(
    ratingGames,
    (d) => d.rating,
    (d) => d.alive_ratio,
  );

  const setTxt = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  setTxt("act8-r-meta", rMeta.toFixed(3));
  setTxt("act8-r-rating", rRating.toFixed(3));

  const drill8 = document.getElementById("act8-drill");

  let panelCount = 0;

  function drawPanel(parent, data, xFn, xDomain, xLabel, rVal) {
    const clipId = `act8-clip-${panelCount++}`;
    parent
      .append("defs")
      .append("clipPath")
      .attr("id", clipId)
      .append("rect")
      .attr("x", 0)
      .attr("y", 0)
      .attr("width", half)
      .attr("height", h);

    const gg = parent.append("g");
    const x8 = d3.scaleLinear().domain(xDomain).range([0, half]);
    const y8 = d3.scaleLinear().domain([0, 1]).range([h, 0]);
    const mx8 = d3.median(data, xFn);
    const my8 = d3.median(data, (d) => d.alive_ratio);

    gg.append("g")
      .attr("class", "axis axis-x")
      .attr("transform", `translate(0,${h})`)
      .call(d3.axisBottom(x8).ticks(5));
    gg.append("g")
      .attr("class", "axis axis-y")
      .call(d3.axisLeft(y8).ticks(5).tickFormat(d3.format(".0%")));
    gg.append("text")
      .attr("class", "axis-label")
      .attr("transform", "rotate(-90)")
      .attr("x", -h / 2)
      .attr("y", -46)
      .attr("text-anchor", "middle")
      .text("alive ratio");
    gg.append("line")
      .attr("x1", x8(mx8))
      .attr("x2", x8(mx8))
      .attr("y1", 0)
      .attr("y2", h)
      .attr("stroke", "var(--rule-strong)")
      .attr("stroke-dasharray", "3,3");
    gg.append("line")
      .attr("x1", 0)
      .attr("x2", half)
      .attr("y1", y8(my8))
      .attr("y2", y8(my8))
      .attr("stroke", "var(--rule-strong)")
      .attr("stroke-dasharray", "3,3");

    const quadClip = gg.append("g").attr("clip-path", `url(#${clipId})`);
    const quadrants = [
      {
        id: "TL",
        x0: xDomain[0],
        x1: mx8,
        y0: my8,
        y1: 1,
        label: "Low score, high survival",
      },
      {
        id: "TR",
        x0: mx8,
        x1: xDomain[1],
        y0: my8,
        y1: 1,
        label: "High score, high survival",
      },
      {
        id: "BL",
        x0: xDomain[0],
        x1: mx8,
        y0: 0,
        y1: my8,
        label: "Low score, low survival",
      },
      {
        id: "BR",
        x0: mx8,
        x1: xDomain[1],
        y0: 0,
        y1: my8,
        label: "High score, low survival",
      },
    ];
    quadClip
      .selectAll(".quadrant-overlay")
      .data(quadrants)
      .join("rect")
      .attr("class", "quadrant-overlay")
      .attr("x", (d) => x8(d.x0))
      .attr("y", (d) => y8(d.y1))
      .attr("width", (d) => Math.max(0, x8(d.x1) - x8(d.x0)))
      .attr("height", (d) => Math.max(0, y8(d.y0) - y8(d.y1)))
      .on("click", function (_ev, d) {
        const sel = data
          .filter(
            (gd) =>
              xFn(gd) >= d.x0 &&
              xFn(gd) <= d.x1 &&
              gd.alive_ratio >= d.y0 &&
              gd.alive_ratio <= d.y1,
          )
          .sort((a, b) => d3.descending(a.alive_ratio, b.alive_ratio))
          .slice(0, 15);
        gg.selectAll(".quadrant-overlay").classed("active", false);
        d3.select(this).classed("active", true);
        document.getElementById("act8-guide")?.classList.add("done");
        drill8.innerHTML =
          `<div style="font:9px var(--mono);text-transform:uppercase;letter-spacing:.1em;color:var(--accent);margin-bottom:8px">${d.label} (${sel.length} games)</div>` +
          sel
            .map(
              (gd, i) =>
                `<div class="drill-row"><span class="drill-rank">${i + 1}</span><span class="drill-name">${gd.name}</span><span class="drill-alive">${(gd.alive_ratio * 100).toFixed(0)}%</span></div>`,
            )
            .join("");
      });

    gg.selectAll("circle.dot8")
      .data(data.filter((_, i) => i % 2 === 0))
      .join("circle")
      .attr("class", "dot8")
      .attr("cx", (d) => x8(xFn(d)))
      .attr("cy", (d) => y8(d.alive_ratio))
      .attr("r", 2.5)
      .attr("fill", (d) => ARCHETYPE_COLOR[d.archetype])
      .attr("opacity", 0.4)
      .on("mouseover", (event, d) => {
        d3
          .select("#tooltip")
          .classed("visible", true)
          .style("left", event.clientX + 14 + "px")
          .style("top", event.clientY + 14 + "px")
          .html(`<div class="tooltip-title">${d.name}</div>
            <div class="tooltip-row"><span>Alive</span><span>${(d.alive_ratio * 100).toFixed(1)}%</span></div>`);
      })
      .on("mouseout", () => d3.select("#tooltip").classed("visible", false));

    gg.append("text")
      .attr("x", half - 4)
      .attr("y", h - 8)
      .attr("text-anchor", "end")
      .attr("fill", "var(--ink-faint)")
      .attr("font-size", 10)
      .text(`r = ${rVal.toFixed(3)}`);
    gg.append("text")
      .attr("class", "axis-label")
      .attr("x", half / 2)
      .attr("y", h + 36)
      .attr("text-anchor", "middle")
      .text(xLabel);

    return gg;
  }

  const gL = svg
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);
  drawPanel(
    gL,
    metaGames,
    (d) => d.metacritic,
    [0, 100],
    "Metacritic score",
    rMeta,
  );
  const gR = svg
    .append("g")
    .attr("transform", `translate(${margin.left + half + 40},${margin.top})`);
  drawPanel(
    gR,
    ratingGames,
    (d) => d.rating,
    [1, 5],
    "RAWG rating (0–5)",
    rRating,
  );
}

// ---- ACT 9 — The Price of Survival ----
function initAct9() {
  // Inject live F2P claim stats
  (function injectF2PClaim() {
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };
    const pct = (v) => (v * 100).toFixed(1) + "%";
    // Use same engagement guard as data.js to avoid small-sample artifacts
    const hasEnough = (g) =>
      g.game_type === "pure_online"
        ? g.peak_players >= THRESHOLDS.PURE_ONLINE_PEAK_FLOOR
        : g.engagement_total >= THRESHOLDS.ENGAGEMENT_FLOOR;
    const f2pGames = GAMES_DATA.filter(
      (g) => g.price === 0 && g.alive_ratio > 0 && hasEnough(g),
    );
    const paidGames = GAMES_DATA.filter(
      (g) => g.price > 0 && g.alive_ratio > 0 && hasEnough(g),
    );
    const medF2P = d3.median(f2pGames, (g) => g.alive_ratio) || 0;
    const medPaid = d3.median(paidGames, (g) => g.alive_ratio) || 0;
    set("lede-f2p-median", pct(medF2P));
    set("lede-paid-median", pct(medPaid));
    const top3F2P = [...f2pGames]
      .sort((a, b) => d3.descending(a.alive_ratio, b.alive_ratio))
      .slice(0, 3)
      .map((g) => g.name)
      .join(", ");
    if (top3F2P) set("lede-f2p-top", top3F2P);
  })();
  const margin = { top: 20, right: 20, bottom: 50, left: 55 };
  const svgEl = document.getElementById("act9-chart");
  if (!svgEl) return;
  svgEl.setAttribute("height", "260");
  const W = svgEl.getBoundingClientRect().width;
  if (W === 0) return;
  const w = W - margin.left - margin.right;
  const h = 260 - margin.top - margin.bottom;

  const svg = d3.select(svgEl);
  svg.selectAll("*").remove();
  const g = svg
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const PRICE_BUCKETS = [
    { label: "<$10", test: (p) => p > 0 && p < 10 },
    { label: "$10–30", test: (p) => p >= 10 && p < 30 },
    { label: "$30–60", test: (p) => p >= 30 && p < 60 },
    { label: "$60+", test: (p) => p >= 60 },
  ];

  const TOP_GENRES9 = [
    "All",
    ...[...new Set(GAMES_DATA.flatMap((d) => d.genres))]
      .map((genre) => ({
        genre,
        count: GAMES_DATA.filter((d) => d.genres.includes(genre)).length,
      }))
      .sort((a, b) => d3.descending(a.count, b.count))
      .slice(0, 8)
      .map((d) => d.genre),
  ];

  const sel9 = document.getElementById("act9-genre-select");
  TOP_GENRES9.forEach((genre) => {
    const opt = document.createElement("option");
    opt.value = genre;
    opt.textContent = genre;
    sel9.appendChild(opt);
  });

  function render9(genre) {
    g.selectAll("*").remove();
    const sub =
      genre === "All"
        ? GAMES_DATA
        : GAMES_DATA.filter((d) => d.genres.includes(genre));
    const data9 = PRICE_BUCKETS.map((b) => {
      const bucket = sub.filter((d) => b.test(d.price));
      return {
        label: b.label,
        med: d3.median(bucket, (d) => d.alive_ratio) || 0,
        count: bucket.length,
      };
    });

    const x9 = d3
      .scaleBand()
      .domain(data9.map((d) => d.label))
      .range([0, w])
      .padding(0.3);
    const y9 = d3
      .scaleLinear()
      .domain([0, d3.max(data9, (d) => d.med) * 1.3])
      .range([h, 0]);

    g.append("g")
      .attr("class", "axis axis-x")
      .attr("transform", `translate(0,${h})`)
      .call(d3.axisBottom(x9));
    g.append("g")
      .attr("class", "axis axis-y")
      .call(d3.axisLeft(y9).ticks(5).tickFormat(d3.format(".0%")));
    g.append("g")
      .attr("class", "grid grid-y")
      .call(d3.axisLeft(y9).ticks(5).tickSize(-w).tickFormat(""))
      .selectAll("text")
      .remove();
    g.append("text")
      .attr("class", "axis-label")
      .attr("transform", "rotate(-90)")
      .attr("x", -h / 2)
      .attr("y", -46)
      .attr("text-anchor", "middle")
      .text("median alive ratio");

    g.selectAll("rect.bar9")
      .data(data9)
      .join("rect")
      .attr("class", "bar9")
      .attr("x", (d) => x9(d.label))
      .attr("width", x9.bandwidth())
      .attr("y", (d) => y9(d.med))
      .attr("height", (d) => h - y9(d.med))
      .attr("fill", "var(--accent)")
      .attr("opacity", 0.8);

    g.selectAll("text.bar9-count")
      .data(data9)
      .join("text")
      .attr("class", "bar9-count")
      .attr("x", (d) => x9(d.label) + x9.bandwidth() / 2)
      .attr("y", (d) => y9(d.med) - 5)
      .attr("text-anchor", "middle")
      .attr("fill", "var(--ink-faint)")
      .attr("font-size", 9)
      .text((d) => (d.count > 0 ? `n=${d.count}` : ""));
  }

  render9("All");
  sel9.addEventListener("change", () => {
    render9(sel9.value);
    document.getElementById("act9-guide")?.classList.add("done");
  });
}

// ---- ACT 10 — Platforms ----
function initAct10() {
  const margin = { top: 20, right: 20, bottom: 50, left: 100 };
  const svgEl = document.getElementById("act10-chart");
  if (!svgEl) return;
  svgEl.setAttribute("height", "280");
  const W = svgEl.getBoundingClientRect().width;
  if (W === 0) return;
  const w = W - margin.left - margin.right;
  const h = 280 - margin.top - margin.bottom;

  const svg = d3.select(svgEl);
  svg.selectAll("*").remove();
  const g = svg
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const TOP_PLATFORMS = ["PC", "PlayStation", "Xbox", "Nintendo", "iOS"];
  const ARCHETYPES = ["immortal", "fading_aaa", "slow_burn", "mid"];
  const visibleArchetypes = new Set(ARCHETYPES);

  function render10() {
    g.selectAll("*").remove();
    const vis = [...visibleArchetypes];
    if (!vis.length) return;

    const data10 = TOP_PLATFORMS.map((plat) => {
      const platGames = GAMES_DATA.filter((d) => d.platforms.includes(plat));
      const byArch = ARCHETYPES.map((arch) => {
        const sub = platGames.filter((d) => d.archetype === arch);
        return {
          arch,
          med: d3.median(sub, (d) => d.alive_ratio) || 0,
          count: sub.length,
        };
      }).filter((d) => vis.includes(d.arch));
      return { plat, byArch };
    });

    const subGroupScale = d3.scaleBand().domain(vis).padding(0.05);
    const y10 = d3.scaleBand().domain(TOP_PLATFORMS).range([0, h]).padding(0.2);
    subGroupScale.rangeRound([0, y10.bandwidth()]);

    const x10 = d3.scaleLinear().domain([0, 0.4]).range([0, w]);

    g.append("g")
      .attr("class", "axis axis-x")
      .attr("transform", `translate(0,${h})`)
      .call(d3.axisBottom(x10).ticks(5).tickFormat(d3.format(".0%")));
    g.append("g")
      .attr("class", "axis axis-y")
      .call(d3.axisLeft(y10).tickSize(0))
      .select(".domain")
      .remove();
    g.append("text")
      .attr("class", "axis-label")
      .attr("x", w / 2)
      .attr("y", h + 38)
      .attr("text-anchor", "middle")
      .text("median alive ratio (RAWG engagement — sold on that platform)");

    data10.forEach((row) => {
      const yOffset = y10(row.plat);
      row.byArch.forEach((b) => {
        g.append("rect")
          .attr("x", 0)
          .attr("y", yOffset + subGroupScale(b.arch))
          .attr("width", x10(b.med))
          .attr("height", subGroupScale.bandwidth())
          .attr("fill", ARCHETYPE_COLOR[b.arch])
          .attr("opacity", 0.8);
      });
    });
  }

  const chipsDiv = document.getElementById("act10-archetype-chips");
  ARCHETYPES.forEach((arch) => {
    const btn = document.createElement("button");
    btn.className = "act-chip active";
    btn.textContent = arch.replace(/_/g, " ");
    btn.addEventListener("click", function () {
      if (visibleArchetypes.has(arch)) {
        visibleArchetypes.delete(arch);
        btn.classList.remove("active");
      } else {
        visibleArchetypes.add(arch);
        btn.classList.add("active");
      }
      render10();
      document.getElementById("act10-guide")?.classList.add("done");
    });
    chipsDiv.appendChild(btn);
  });

  render10();

  // Inject live platform avg for immortal vs mortal (notebook cell 23 finding: no signal)
  (function injectPlatformAvg() {
    const imm = GAMES_DATA.filter(
      (d) =>
        d.year <= THRESHOLDS.IMMORTAL_YEAR_CUTOFF &&
        d.alive_ratio > THRESHOLDS.IMMORTAL_MIN &&
        d.engagement_total >= THRESHOLDS.ENGAGEMENT_FLOOR,
    );
    const mort = GAMES_DATA.filter(
      (d) =>
        d.year <= THRESHOLDS.IMMORTAL_YEAR_CUTOFF &&
        d.alive_ratio <= THRESHOLDS.ALIVE_MIN &&
        d.engagement_total >= 10,
    );
    const avg = (pool) =>
      pool.length > 0 ? d3.mean(pool, (d) => d.platforms.length) : 0;
    d3.select("#act10-imm-plat").text(avg(imm).toFixed(1));
    d3.select("#act10-mort-plat").text(avg(mort).toFixed(1));
  })();
}

// ---- ACT 11 — The Immortals ----
function injectImmortalsPara() {
  if (injectImmortalsPara._done) return;
  injectImmortalsPara._done = true;
  const set = (id, html) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  };
  const fmtM = (v) =>
    v >= 1e6
      ? (v / 1e6).toFixed(1) + "M"
      : v >= 1e3
        ? Math.round(v / 1000) + "k"
        : String(v);
  const find = (...names) => {
    for (const n of names) {
      const g = GAMES_DATA.find((d) =>
        d.name.toLowerCase().includes(n.toLowerCase()),
      );
      if (g) return g;
    }
    return null;
  };
  const csgo = find("Counter-Strike 2", "Counter-Strike: Global Offensive");
  if (csgo)
    set(
      "lede-csgo-stat",
      `${csgo.name} peaked at ${fmtM(csgo.peak_players)} concurrent players and currently holds ${fmtM(csgo.current_players)}.`,
    );
  const dota = find("Dota 2");
  if (dota)
    set("lede-dota-stat", ` Dota 2 peaked at ${fmtM(dota.peak_players)}.`);
  const tf2 = find("Team Fortress 2");
  if (tf2)
    set(
      "lede-tf2-stat",
      ` Team Fortress 2 — released in ${tf2.year} — still draws ${fmtM(tf2.current_players)} active players ${2026 - tf2.year} years later.`,
    );
  const g2024 = GAMES_DATA.filter((g) => g.year === 2024);
  if (g2024.length > 0) {
    const sub100k = g2024.filter((g) => g.peak_players < 100000).length;
    set(
      "lede-2024-stat",
      ` ${d3.format(".0%")(sub100k / g2024.length)} of games released in 2024 never exceeded 100k peak players.`,
    );
  }
}

function initAct11(sortKey = "alive") {
  injectImmortalsPara();
  let data11 = immortalsTop(15);
  if (sortKey === "peak")
    data11 = [...data11].sort((a, b) =>
      d3.descending(a.peak_players, b.peak_players),
    );
  else if (sortKey === "age")
    data11 = [...data11].sort((a, b) => d3.ascending(a.year, b.year));

  const container = document.getElementById("act11-list");
  container.innerHTML = data11
    .map(
      (g) => `
    <div class="game-bar-row" data-id="${g.id}" title="${g.name} — based on ${g.engagement_total.toLocaleString()} RAWG engagement reports">
      <span class="game-bar-name">${g.name}</span>
      <span class="game-bar-year">${g.year}</span>
      <span class="legend-tag ${archetypeClass(g)}">${g.archetype.replace(/_/g, " ")}</span>
      <div class="game-bar-track"><div class="game-bar-fill" style="width:${(g.alive_ratio * 100).toFixed(0)}%;background:${ALIVE_SCALE(g.alive_ratio)}"></div></div>
      <span style="font:9px var(--mono);color:var(--ink-faint);white-space:nowrap">${(g.alive_ratio * 100).toFixed(0)}% alive</span>
    </div>
  `,
    )
    .join("");

  container.querySelectorAll(".game-bar-row").forEach((row) => {
    row.addEventListener("click", () => {
      const gm = GAMES_DATA.find((x) => x.id === +row.dataset.id);
      if (gm) {
        addToSelection(gm);
        document.getElementById("act11-guide")?.classList.add("done");
      }
    });
  });
}

// ---- ACT 12 — The Fading AAA ----
function initAct12() {
  const margin = { top: 20, right: 20, bottom: 50, left: 55 };
  const svgEl = document.getElementById("act12-chart");
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

  const games12 = GAMES_DATA.filter(
    (d) => d.peak_players > 1000 && d.alive_ratio >= 0,
  );
  const x12 = d3
    .scaleLog()
    .domain([1000, d3.max(games12, (d) => d.peak_players) * 1.3])
    .range([0, w]);
  const y12 = d3.scaleLinear().domain([0, 1]).range([h, 0]);
  const PEAK_THRESHOLD = THRESHOLDS.FADING_AAA_PEAK_MIN;
  const ALIVE_THRESHOLD = THRESHOLDS.ALIVE_MIN;

  g.append("g")
    .attr("class", "axis axis-x")
    .attr("transform", `translate(0,${h})`)
    .call(d3.axisBottom(x12).ticks(5, "~s"));
  g.append("g")
    .attr("class", "axis axis-y")
    .call(d3.axisLeft(y12).ticks(5).tickFormat(d3.format(".0%")));
  g.append("text")
    .attr("class", "axis-label")
    .attr("x", w / 2)
    .attr("y", h + 38)
    .attr("text-anchor", "middle")
    .text("peak players (log scale)");
  g.append("text")
    .attr("class", "axis-label")
    .attr("transform", "rotate(-90)")
    .attr("x", -h / 2)
    .attr("y", -42)
    .attr("text-anchor", "middle")
    .text("alive ratio");

  g.append("rect")
    .attr("x", x12(PEAK_THRESHOLD))
    .attr("y", y12(ALIVE_THRESHOLD))
    .attr("width", w - x12(PEAK_THRESHOLD))
    .attr("height", h - y12(ALIVE_THRESHOLD))
    .attr("fill", "rgba(217,108,108,0.08)")
    .attr("stroke", "var(--dying)")
    .attr("stroke-width", 1)
    .attr("stroke-dasharray", "4,3");
  g.append("text")
    .attr("class", "quadrant-label")
    .attr("x", x12(PEAK_THRESHOLD) + 8)
    .attr("y", h - 8)
    .text("FADING AAA");

  g.selectAll("circle.dot12")
    .data(games12, (d) => d.id)
    .join("circle")
    .attr("class", "dot12")
    .attr("cx", (d) => x12(d.peak_players))
    .attr("cy", (d) => y12(d.alive_ratio))
    .attr("r", 3.5)
    .attr("fill", (d) => ARCHETYPE_COLOR[d.archetype])
    .attr("opacity", 0.5)
    .on("mouseover", (event, d) => {
      d3
        .select("#tooltip")
        .classed("visible", true)
        .style("left", event.offsetX + 14 + "px")
        .style("top", event.offsetY + 14 + "px")
        .html(`<div class="tooltip-title">${d.name}</div>
          <div class="tooltip-row"><span>Peak</span><span>${fmtPlayers(d.peak_players)}</span></div>
          <div class="tooltip-row"><span>Alive</span><span>${(d.alive_ratio * 100).toFixed(1)}%</span></div>`);
    })
    .on("mouseout", () => d3.select("#tooltip").classed("visible", false));

  function renderCards12(pool) {
    const top4 = pool
      .sort((a, b) => d3.descending(a.peak_players, b.peak_players))
      .slice(0, 4);
    d3.select("#act12-cards").html(
      top4
        .map(
          (gd) => `
      <div class="case-card">
        <div class="case-card-arch"><span class="legend-tag ${archetypeClass(gd)}">${gd.archetype.replace(/_/g, " ")}</span></div>
        <div class="case-card-name">${gd.name}</div>
        <div class="case-card-meta">Peak: ${fmtPlayers(gd.peak_players)} · Alive: ${(gd.alive_ratio * 100).toFixed(0)}% · ${gd.year}</div>
      </div>`,
        )
        .join(""),
    );
  }

  renderCards12(fadingAAAGames());

  const brushG12 = g.append("g").attr("class", "brush");
  const brush12 = d3
    .brush()
    .extent([
      [0, 0],
      [w, h],
    ])
    .on("end", (event) => {
      const guide = document.getElementById("act12-guide");
      if (!event.selection) {
        renderCards12(fadingAAAGames());
        return;
      }
      const [[bx0, by0], [bx1, by1]] = event.selection;
      const sel = games12.filter(
        (d) =>
          x12(d.peak_players) >= bx0 &&
          x12(d.peak_players) <= bx1 &&
          y12(d.alive_ratio) >= by0 &&
          y12(d.alive_ratio) <= by1,
      );
      renderCards12(sel.length ? sel : fadingAAAGames());
      if (guide && sel.length > 0) guide.classList.add("done");
    });
  brushG12.call(brush12);
}

// ---- ACT 13 — The Slow Burn ----
function initAct13() {
  const anchors = slowBurnTop(6);
  if (!anchors.length) return;

  const grid13 = document.getElementById("act13-grid");
  grid13.innerHTML = "";

  const PANEL_H = 100;
  const margin13 = { top: 8, right: 8, bottom: 20, left: 36 };

  const allPoints = anchors.flatMap((g) => g.series);
  const tDomain = d3.extent(allPoints, (d) => d.month);
  const maxP =
    d3.max(
      anchors.flatMap((g) => g.series),
      (d) => d.players,
    ) * 1.2;

  const panels = [];

  anchors.forEach((game, idx) => {
    const cell = document.createElement("div");
    cell.className = "genre-mini";
    cell.innerHTML = `<div class="genre-mini-label">${game.name} · ${(game.alive_ratio * 100).toFixed(0)}%</div>`;

    const svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svgEl.setAttribute("height", PANEL_H);
    svgEl.style.width = "100%";
    svgEl.style.display = "block";
    cell.appendChild(svgEl);
    grid13.appendChild(cell);

    requestAnimationFrame(() => {
      const panelW = svgEl.getBoundingClientRect().width;
      if (panelW === 0) return;
      const w13 = panelW - margin13.left - margin13.right;
      const h13 = PANEL_H - margin13.top - margin13.bottom;

      const svg13 = d3.select(svgEl);
      svg13.selectAll("*").remove();
      const g13 = svg13
        .append("g")
        .attr("transform", `translate(${margin13.left},${margin13.top})`);

      const x13 = d3.scaleTime().domain(tDomain).range([0, w13]);
      const y13 = d3
        .scaleLog()
        .domain([Math.max(1, d3.min(game.series, (d) => d.players) || 1), maxP])
        .range([h13, 0])
        .clamp(true);

      g13
        .append("g")
        .attr("class", "axis axis-x")
        .attr("transform", `translate(0,${h13})`)
        .call(d3.axisBottom(x13).ticks(3).tickFormat(d3.timeFormat("%Y")));
      g13
        .append("g")
        .attr("class", "axis axis-y")
        .call(
          d3
            .axisLeft(y13)
            .ticks(2)
            .tickFormat((d) => (d >= 1000 ? (d / 1000).toFixed(0) + "k" : d)),
        );
      if (idx % 3 === 0) {
        g13
          .append("text")
          .attr("class", "axis-label")
          .attr("transform", "rotate(-90)")
          .attr("x", -h13 / 2)
          .attr("y", -28)
          .attr("text-anchor", "middle")
          .attr("font-size", 7)
          .text("avg players/mo");
      }

      const line13 = d3
        .line()
        .x((d) => x13(d.month))
        .y((d) => y13(Math.max(1, d.players)))
        .curve(d3.curveCatmullRom);
      const color13 = TS_PALETTE[idx % TS_PALETTE.length];
      g13
        .append("path")
        .datum(game.series)
        .attr("fill", "none")
        .attr("stroke", color13)
        .attr("stroke-width", 1.5)
        .attr("d", line13);

      const xLine13 = g13
        .append("line")
        .attr("y1", 0)
        .attr("y2", h13)
        .attr("stroke", "var(--ink-dim)")
        .attr("stroke-width", 1)
        .attr("stroke-dasharray", "3,3")
        .attr("opacity", 0)
        .attr("pointer-events", "none");

      panels.push({
        g: g13,
        x: x13,
        y: y13,
        xLine: xLine13,
        series: game.series,
        w: w13,
        h: h13,
      });

      g13
        .append("rect")
        .attr("width", w13)
        .attr("height", h13)
        .attr("fill", "transparent")
        .on("mousemove", function (event) {
          const [mx] = d3.pointer(event);
          const date = x13.invert(mx);
          panels.forEach((p) => {
            const px = p.x(date);
            p.xLine.attr("x1", px).attr("x2", px).attr("opacity", 0.6);
          });
          document.getElementById("act13-guide")?.classList.add("done");
        })
        .on("mouseleave", () => {
          panels.forEach((p) => p.xLine.attr("opacity", 0));
        });
    });
  });
}

// ---- ACT 14 — The Coverage Multiplier ----
function initAct14() {
  const margin = { top: 20, right: 20, bottom: 50, left: 55 };
  const svgEl = document.getElementById("act14-chart");
  if (!svgEl) return;
  svgEl.setAttribute("height", "260");
  const W = svgEl.getBoundingClientRect().width;
  if (W === 0) return;
  const w = W - margin.left - margin.right;
  const h = 260 - margin.top - margin.bottom;

  const games14 = GAMES_DATA.filter(
    (g) => g.youtube_count > 0 && g.youtube_count < 1000000 && g.year < 2026,
  );
  const medAlive = d3.median(GAMES_DATA, (g) => g.alive_ratio) || 0;
  const high = games14
    .filter((g) => g.alive_ratio >= medAlive)
    .map((g) => g.youtube_count / Math.max(1, 2026 - g.year));
  const low = games14
    .filter((g) => g.alive_ratio < medAlive)
    .map((g) => g.youtube_count / Math.max(1, 2026 - g.year));

  const svg14 = d3.select(svgEl);
  svg14.selectAll("*").remove();
  const g = svg14
    .append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const allVals = [...high, ...low].filter((v) => v > 0);
  const xExtent = d3.extent(allVals);
  const x14 = d3
    .scaleLog()
    .domain([Math.max(1, xExtent[0]), xExtent[1]])
    .range([0, w])
    .clamp(true);

  function kde(kernel, thresholds, data) {
    return thresholds.map((x) => [x, d3.mean(data, (v) => kernel(x - v))]);
  }
  function epanechnikov(bandwidth) {
    return (v) =>
      Math.abs((v /= bandwidth)) <= 1 ? (0.75 * (1 - v * v)) / bandwidth : 0;
  }

  const ticks14 = x14.ticks(40);
  const bw = 0.2;
  const logHigh = high.filter((v) => v > 0).map(Math.log10);
  const logLow = low.filter((v) => v > 0).map(Math.log10);
  const logTicks = ticks14.map(Math.log10);

  const densityHigh = kde(epanechnikov(bw), logTicks, logHigh);
  const densityLow = kde(epanechnikov(bw), logTicks, logLow);

  const y14 = d3
    .scaleLinear()
    .domain([0, d3.max([...densityHigh, ...densityLow], (d) => d[1]) * 1.2])
    .range([h, 0]);

  g.append("g")
    .attr("class", "axis axis-x")
    .attr("transform", `translate(0,${h})`)
    .call(d3.axisBottom(x14).ticks(5, "~s"));
  g.append("g").attr("class", "axis axis-y").call(d3.axisLeft(y14).ticks(4));
  g.append("g")
    .attr("class", "grid grid-y")
    .call(d3.axisLeft(y14).ticks(4).tickSize(-w).tickFormat(""))
    .selectAll("text")
    .remove();
  g.append("text")
    .attr("class", "axis-label")
    .attr("x", w / 2)
    .attr("y", h + 38)
    .attr("text-anchor", "middle")
    .text("YouTube videos / year (log scale, capped rows excluded)");
  g.append("text")
    .attr("class", "axis-label")
    .attr("transform", "rotate(-90)")
    .attr("x", -h / 2)
    .attr("y", -46)
    .attr("text-anchor", "middle")
    .text("density");

  const lineFn = d3
    .line()
    .x((d) => x14(Math.pow(10, d[0])))
    .y((d) => y14(d[1]))
    .curve(d3.curveBasis);
  g.append("path")
    .datum(densityLow)
    .attr("fill", "none")
    .attr("stroke", "var(--dying)")
    .attr("stroke-width", 2.5)
    .attr("opacity", 0.85)
    .attr("d", lineFn);
  g.append("path")
    .datum(densityHigh)
    .attr("fill", "none")
    .attr("stroke", "var(--alive)")
    .attr("stroke-width", 2.5)
    .attr("opacity", 0.85)
    .attr("d", lineFn);

  const medH = d3.median(high.filter((v) => v > 0)) || 1;
  const medL = d3.median(low.filter((v) => v > 0)) || 1;
  const multiplierVal = (medH / medL).toFixed(1);
  d3.select("#act14-multiplier").text(multiplierVal);
  d3.select("#act14-multiplier-guide").text(multiplierVal);
  g.append("line")
    .attr("x1", x14(medH))
    .attr("x2", x14(medH))
    .attr("y1", 0)
    .attr("y2", h)
    .attr("stroke", "var(--alive)")
    .attr("stroke-dasharray", "4,3")
    .attr("stroke-width", 1.5);
  g.append("line")
    .attr("x1", x14(medL))
    .attr("x2", x14(medL))
    .attr("y1", 0)
    .attr("y2", h)
    .attr("stroke", "var(--dying)")
    .attr("stroke-dasharray", "4,3")
    .attr("stroke-width", 1.5);
  g.append("text")
    .attr("x", x14(medH) + 4)
    .attr("y", 12)
    .attr("fill", "var(--alive)")
    .attr("font-size", 9)
    .text(Math.round(medH).toLocaleString() + "/yr");
  g.append("text")
    .attr("x", x14(medL) + 4)
    .attr("y", 24)
    .attr("fill", "var(--dying)")
    .attr("font-size", 9)
    .text(Math.round(medL).toLocaleString() + "/yr");

  const leg = g.append("g").attr("transform", `translate(${w - 140},8)`);
  [
    { color: "var(--alive)", label: "High vitality" },
    { color: "var(--dying)", label: "Low vitality" },
  ].forEach((item, i) => {
    leg
      .append("rect")
      .attr("x", 0)
      .attr("y", i * 16)
      .attr("width", 14)
      .attr("height", 3)
      .attr("fill", item.color);
    leg
      .append("text")
      .attr("x", 18)
      .attr("y", i * 16 + 3)
      .attr("fill", "var(--ink-dim)")
      .attr("font-size", 10)
      .text(item.label);
  });
}

// ---- ACT 15 — The Verdict ----
function initAct15() {
  const games15 = mortalityIndex(
    GAMES_DATA.filter(
      (g) => g.peak_players >= 1000 && g.engagement_total >= 100,
    ),
  );
  // Inject overlap between top-25 by score and top-25 by YouTube coverage
  (function injectOverlap() {
    const byScore = new Set(
      [...games15]
        .sort((a, b) => d3.descending(a._score, b._score))
        .slice(0, 25)
        .map((g) => g.id),
    );
    const byCoverage = new Set(
      [...games15]
        .sort((a, b) => d3.descending(a._ytpy, b._ytpy))
        .slice(0, 25)
        .map((g) => g.id),
    );
    let overlap = 0;
    byScore.forEach((id) => {
      if (byCoverage.has(id)) overlap++;
    });
    const pctOverlap = Math.round((overlap / 25) * 100);
    const el = document.getElementById("act15-overlap");
    if (el) el.textContent = pctOverlap;
  })();
  renderAct15List("index", games15);
}

function renderAct15List(sortKey, games15Arg) {
  const games15 =
    games15Arg ||
    mortalityIndex(GAMES_DATA.filter((g) => g.peak_players > 1000));
  let sorted;
  if (sortKey === "alive")
    sorted = [...games15].sort((a, b) =>
      d3.descending(a.alive_ratio, b.alive_ratio),
    );
  else if (sortKey === "coverage")
    sorted = [...games15].sort((a, b) => d3.descending(a._ctpy, b._ctpy));
  else if (sortKey === "age")
    sorted = [...games15].sort((a, b) => d3.ascending(a.year, b.year));
  else sorted = [...games15].sort((a, b) => d3.descending(a._score, b._score));

  const top25 = sorted.slice(0, 25);

  const list = document.getElementById("act15-list");
  list.innerHTML = top25
    .map((g, i) => {
      const spark = makeSpark(g);
      return `<li class="mortality-row" data-id="${g.id}">
      <span class="mortality-rank">${i + 1}</span>
      <span class="mortality-name">${g.name}</span>
      <span class="mortality-year">${g.year}</span>
      <div class="mortality-bar-wrap"><div class="mortality-bar" style="width:${g._score}%"></div></div>
      <span class="mortality-sparkline">${spark}</span>
    </li>`;
    })
    .join("");

  list.querySelectorAll(".mortality-row").forEach((row) => {
    row.addEventListener("click", () => {
      const gm = GAMES_DATA.find((x) => x.id === +row.dataset.id);
      if (gm) {
        addToSelection(gm);
        switchView("sandbox");
      }
    });
  });

  const header = document.getElementById("act15-list-header");
  if (header) {
    header.querySelectorAll("span[data-col]").forEach((span) => {
      span.classList.toggle("sort-active", span.dataset.col === sortKey);
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
