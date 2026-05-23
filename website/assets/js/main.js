// Main JS File

// Populated asynchronously by loadGameData() before any chart renders
let GAMES_DATA = [];
let ALL_GENRES = [];
let ALL_PLATFORMS = [];

const state = {
  view: "main",
  yearRange: [2012, 2025],
  genres: new Set(),
  minRating: 0,
  platforms: new Set(),
  selectedIds: new Set(), // the user's picks (this is what powers the sandbox)
  hoveredId: null,
};

// View Router
function switchView(targetView) {
  // Guard: sandbox requires at least 1 selection
  if (targetView === "sandbox" && state.selectedIds.size === 0) {
    flashSandboxNav();
    return;
  }
  state.view = targetView;

  d3.selectAll(".view").classed("active", false);
  d3.select(`#view-${targetView}`).classed("active", true);

  d3.selectAll(".nav-item").classed("active", false);
  d3.select(`.nav-item[data-view="${targetView}"]`).classed("active", true);

  // Selection tray only visible on main view
  d3.select("#selection-tray").classed(
    "hidden",
    targetView !== "main" || state.selectedIds.size === 0,
  );

  // Close game card on view switch
  d3.select("#game-card").classed("hidden", true);

  // Render the incoming view
  if (targetView === "sandbox") {
    // Must init AFTER the view is visible so getBoundingClientRect has real dimensions
    // Use requestAnimationFrame so the browser lays out the now-visible view first
    requestAnimationFrame(() => {
      if (!sandbox.initialized) initSandbox();
      renderSandbox();
      if (!ts.initialized) initTimeSeries();
      renderTimeSeries();
    });
  }

  if (targetView === "analysis") {
    requestAnimationFrame(() => {
      if (!analysis.initialized) renderAnalysisView();
    });
  }

  // Scroll to top
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function flashSandboxNav() {
  const nav = d3.select("#nav-sandbox");
  nav.classed("flash", true);
  setTimeout(() => nav.classed("flash", false), 600);
}

// Wire up all [data-view] buttons
d3.selectAll("[data-view]").on("click", function () {
  switchView(this.dataset.view);
});

// ==========================================================
// CONTROLS
// ==========================================================

function setupGenreChips() {
  d3.select("#genre-filters")
    .selectAll(".chip")
    .data(ALL_GENRES)
    .join("button")
    .attr("class", "chip")
    .text((d) => d)
    .on("click", function (event, d) {
      if (state.genres.has(d)) state.genres.delete(d);
      else state.genres.add(d);
      d3.select(this).classed("active", state.genres.has(d));
      update();
    });
}

function setupPlatformChips() {
  d3.select("#platform-filters")
    .selectAll(".chip")
    .data(ALL_PLATFORMS)
    .join("button")
    .attr("class", "chip")
    .text((d) => d)
    .on("click", function (event, d) {
      if (state.platforms.has(d)) state.platforms.delete(d);
      else state.platforms.add(d);
      d3.select(this).classed("active", state.platforms.has(d));
      update();
    });
}

function setupSearch() {
  d3.selectAll(".search-input").each(function () {
    const input = d3.select(this);
    const wrap = d3.select(this.parentNode);
    const results = wrap.select(".search-results");
    const clearBtn = wrap.select(".search-clear");
    let activeIdx = -1;
    let currentMatches = [];

    function rank(game, q) {
      const n = game.name.toLowerCase();
      if (n === q) return 0;
      if (n.startsWith(q)) return 1;
      return 2;
    }

    function runSearch() {
      const q = input.property("value").trim().toLowerCase();
      clearBtn.classed("hidden", q.length === 0);
      if (q.length === 0) { results.classed("hidden", true); return; }

      currentMatches = GAMES_DATA
        .filter((g) => g.name.toLowerCase().includes(q))
        .sort((a, b) => rank(a, q) - rank(b, q) || b.peak_players - a.peak_players)
        .slice(0, 8);
      activeIdx = -1;
      renderResults();
      results.classed("hidden", false);
    }

    function renderResults() {
      if (currentMatches.length === 0) {
        results.html('<div class="search-empty">No games match.</div>');
        return;
      }
      results.selectAll(".search-result-item")
        .data(currentMatches, (d) => d.id)
        .join("div")
        .attr("class", (d, i) =>
          "search-result-item" +
          (state.selectedIds.has(d.id) ? " selected-already" : "") +
          (i === activeIdx ? " active" : "")
        )
        .html((d) =>
          `<span class="search-result-name">${d.name}</span>` +
          `<span class="search-result-meta">${d.year} · ${fmtPlayers(d.peak_players)}${state.selectedIds.has(d.id) ? " · ✓" : ""}</span>`
        )
        .on("mousedown", (event, d) => {
          event.preventDefault();
          pick(d);
        });
    }

    function pick(game) {
      showCard(game);
      input.property("value", "");
      clearBtn.classed("hidden", true);
      results.classed("hidden", true);
      currentMatches = [];
    }

    input.on("input", runSearch);
    input.on("focus", runSearch);
    input.on("blur", () => setTimeout(() => results.classed("hidden", true), 100));
    input.on("keydown", (event) => {
      if (currentMatches.length === 0) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        activeIdx = (activeIdx + 1) % currentMatches.length;
        renderResults();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        activeIdx = (activeIdx - 1 + currentMatches.length) % currentMatches.length;
        renderResults();
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (activeIdx >= 0) pick(currentMatches[activeIdx]);
        else if (currentMatches.length > 0) pick(currentMatches[0]);
      } else if (event.key === "Escape") {
        results.classed("hidden", true);
        input.node().blur();
      }
    });

    clearBtn.on("click", () => {
      input.property("value", "");
      clearBtn.classed("hidden", true);
      results.classed("hidden", true);
    });
  });
}

function setupSliders() {
  const startEl = d3.select("#time-slider-start");
  const endEl = d3.select("#time-slider-end");

  function onTimeChange() {
    let s = +startEl.property("value");
    let e = +endEl.property("value");
    if (s > e) [s, e] = [e, s];
    state.yearRange = [s, e];
    d3.select("#time-start").text(s);
    d3.select("#time-end").text(e);
    update();
  }
  startEl.on("input", onTimeChange);
  endEl.on("input", onTimeChange);

  d3.select("#rating-slider").on("input", function () {
    state.minRating = +this.value;
    d3.select("#rating-value").text(state.minRating.toFixed(1));
    update();
  });
}

function getFilteredGames() {
  return GAMES_DATA.filter((g) => {
    if (g.year < state.yearRange[0] || g.year > state.yearRange[1])
      return false;
    if (g.rating < state.minRating) return false;
    if (state.genres.size > 0 && !g.genres.some((gen) => state.genres.has(gen)))
      return false;
    if (
      state.platforms.size > 0 &&
      !g.platforms.some((p) => state.platforms.has(p))
    )
      return false;
    return true;
  });
}

// ==========================================================
// MAIN CHART
// ==========================================================

const chart = {
  svg: null,
  g: null,
  xScale: null,
  yScale: null,
  rScale: null,
  colorScale: null,
  width: 0,
  height: 0,
  margin: { top: 30, right: 40, bottom: 60, left: 80 },
};

function initChart() {
  const svg = d3.select("#main-chart");
  const bbox = svg.node().getBoundingClientRect();
  chart.width = bbox.width - chart.margin.left - chart.margin.right;
  chart.height = bbox.height - chart.margin.top - chart.margin.bottom;

  chart.svg = svg;
  chart.g = svg
    .append("g")
    .attr("transform", `translate(${chart.margin.left},${chart.margin.top})`);

  chart.xScale = d3.scaleLinear().range([0, chart.width]);
  chart.yScale = d3.scaleLog().range([chart.height, 0]).clamp(true);
  chart.rScale = d3.scaleSqrt().range([6, 30]);
  chart.colorScale = d3
    .scaleLinear()
    .domain([0, 0.1, 0.3])
    .range(["#d96c6c", "#e6a356", "#7fc97f"])
    .clamp(true);

  chart.g
    .append("g")
    .attr("class", "axis axis-x")
    .attr("transform", `translate(0,${chart.height})`);
  chart.g.append("g").attr("class", "axis axis-y");
  chart.g.append("g").attr("class", "grid grid-y");

  chart.g
    .append("text")
    .attr("class", "axis-label")
    .attr("x", chart.width / 2)
    .attr("y", chart.height + 48)
    .attr("text-anchor", "middle")
    .text("<- older releases          more recent ->");

  chart.g
    .append("text")
    .attr("class", "axis-label")
    .attr("transform", "rotate(-90)")
    .attr("x", -chart.height / 2)
    .attr("y", -60)
    .attr("text-anchor", "middle")
    .text("average monthly players");

  chart.g.append("g").attr("class", "bubbles");
}

function renderChart(games) {
  chart.xScale.domain([state.yearRange[0], state.yearRange[1] + 1]);
  const maxP = d3.max(games, (d) => d.avg_players) || 1e6;
  chart.yScale.domain([100, maxP * 1.3]);
  chart.rScale.domain([0, d3.max(GAMES_DATA, (d) => d.peak_players)]);

  chart.g
    .select(".axis-x")
    .transition()
    .duration(500)
    .call(
      d3
        .axisBottom(chart.xScale)
        .tickFormat(d3.format("d"))
        .ticks(Math.min(10, state.yearRange[1] - state.yearRange[0])),
    );

  chart.g
    .select(".axis-y")
    .transition()
    .duration(500)
    .call(
      d3
        .axisLeft(chart.yScale)
        .ticks(6)
        .tickFormat((d) => {
          if (d >= 1e6) return (d / 1e6).toFixed(1) + "M";
          if (d >= 1e3) return (d / 1e3).toFixed(0) + "k";
          return d;
        }),
    );

  chart.g
    .select(".grid-y")
    .transition()
    .duration(500)
    .call(
      d3.axisLeft(chart.yScale).ticks(6).tickSize(-chart.width).tickFormat(""),
    )
    .selectAll("text")
    .remove();

  const bubbles = chart.g
    .select(".bubbles")
    .selectAll("circle.bubble")
    .data(games, (d) => d.id);

  bubbles
    .exit()
    .transition()
    .duration(300)
    .attr("r", 0)
    .style("opacity", 0)
    .remove();

  const enter = bubbles
    .enter()
    .append("circle")
    .attr("class", "bubble")
    .attr("cx", (d) => chart.xScale(d.year + (d.release_month + 0.5) / 12))
    .attr("cy", (d) => chart.yScale(Math.max(100, d.avg_players)))
    .attr("r", 0)
    .attr("fill", (d) => chart.colorScale(d.alive_ratio))
    .style("opacity", 0)
    .on("mouseover", onHover)
    .on("mouseout", onHoverOut)
    .on("click", onBubbleClick);

  enter
    .merge(bubbles)
    .classed("selected", (d) => state.selectedIds.has(d.id))
    .transition()
    .duration(500)
    .attr("cx", (d) => chart.xScale(d.year + (d.release_month + 0.5) / 12))
    .attr("cy", (d) => chart.yScale(Math.max(100, d.avg_players)))
    .attr("r", (d) => chart.rScale(d.peak_players))
    .attr("fill", (d) => chart.colorScale(d.alive_ratio))
    .style("opacity", 0.85);
}

// ==========================================================
// INTERACTIONS
// ==========================================================

const tooltip = d3.select("#tooltip");

function onHover(event, d) {
  const rect = document.querySelector(".chart-wrap").getBoundingClientRect();
  const [mx, my] = d3.pointer(event, document.querySelector(".chart-wrap"));
  tooltip
    .classed("visible", true)
    .style("left", mx + 16 + "px")
    .style("top", my + 16 + "px").html(`
      <div class="tooltip-title">${d.name}</div>
      <div class="tooltip-row"><span>Released</span><span>${d.year}</span></div>
      <div class="tooltip-row"><span>Avg players</span><span>${fmtPlayers(d.avg_players)}</span></div>
      <div class="tooltip-row"><span>Alive ratio</span><span>${(d.alive_ratio * 100).toFixed(0)}%</span></div>
      <div class="tooltip-row"><span>Rating</span><span>${d.rating.toFixed(2)}</span></div>
      <div class="tooltip-hint">click to ${state.selectedIds.has(d.id) ? "deselect" : "select"}</div>
    `);
}

function onHoverOut() {
  tooltip.classed("visible", false);
}

function onBubbleClick(event, d) {
  showCard(d);
}

// ==========================================================
// GAME CARD
// ==========================================================

let activeCardGameId = null;

function showCard(d) {
  activeCardGameId = d.id;
  const card = d3.select("#game-card");
  card.classed("hidden", false);
  d3.select("#card-name").text(d.name);
  d3.select("#card-meta").text(`${d.year} · ${d.genres[0]}`);
  d3.select("#card-players").text(
    `${fmtPlayers(d.avg_players)} / ${fmtPlayers(d.peak_players)}`,
  );
  d3.select("#card-survival").text(`${d.survivability}%`);
  d3.select("#card-rating").text(`${d.rating.toFixed(2)} / 5`);
  d3.select("#card-alive").text(`${(d.alive_ratio * 100).toFixed(0)}%`);
  d3.select("#card-genres").text(d.genres.join(" · "));

  const isSelected = state.selectedIds.has(d.id);
  d3.select("#toggle-selection")
    .text(isSelected ? "− Remove from selection" : "+ Add to selection")
    .classed("selected-state", isSelected);
}

d3.select("#close-card").on("click", () => {
  d3.select("#game-card").classed("hidden", true);
  activeCardGameId = null;
});

d3.select("#toggle-selection").on("click", () => {
  if (activeCardGameId === null) return;
  if (state.selectedIds.has(activeCardGameId)) {
    state.selectedIds.delete(activeCardGameId);
  } else {
    state.selectedIds.add(activeCardGameId);
  }
  const game = GAMES_DATA.find((g) => g.id === activeCardGameId);
  showCard(game); // re-render card with new button state
  updateSelectionUI();
  if (state.view === "sandbox") renderSandbox();
  else update();
});

// ==========================================================
// SELECTION UI (tray + nav state)
// ==========================================================

function updateSelectionUI() {
  pruneSelectionColors();
  const count = state.selectedIds.size;

  // Top nav: unlock sandbox when we have >= 1 selection
  d3.select("#nav-sandbox").classed("disabled", count === 0);

  // Floating tray on main view
  const tray = d3.select("#selection-tray");
  const showTray = count > 0 && state.view === "main";
  tray.classed("hidden", !showTray);

  d3.select("#tray-count").text(count);
  d3.select("#selection-count").text(count);

  // Tray chips
  const selectedGames = [...state.selectedIds].map((id) =>
    GAMES_DATA.find((g) => g.id === id),
  );
  d3.select("#tray-chips")
    .selectAll(".tray-chip")
    .data(selectedGames, (d) => d.id)
    .join(
      (enter) => {
        const e = enter.append("div").attr("class", "tray-chip");
        e.append("span")
          .attr("class", "chip-swatch")
          .style("background", (d) => colorForGame(d.id));
        e.append("span").text((d) => d.name);
        return e;
      },
      (update) => {
        update.select(".chip-swatch").style("background", (d) => colorForGame(d.id));
        update.select("span:last-child").text((d) => d.name);
        return update;
      },
      (exit) => exit.remove(),
    );

  // Sandbox sidebar chips
  d3.select("#selection-chips")
    .selectAll(".sel-chip")
    .data(selectedGames, (d) => d.id)
    .join(
      (enter) => {
        const e = enter.append("div").attr("class", "sel-chip");
        e.append("span")
          .attr("class", "chip-swatch")
          .style("background", (d) => colorForGame(d.id));
        e.append("span")
          .attr("class", "sel-name")
          .text((d) => d.name);
        e.append("button")
          .attr("class", "sel-remove")
          .text("×")
          .on("click", (event, d) => {
            state.selectedIds.delete(d.id);
            updateSelectionUI();
            if (state.view === "sandbox") renderSandbox();
            if (state.view === "main") update();
          });
        return e;
      },
      (update) => {
        update.select(".chip-swatch").style("background", (d) => colorForGame(d.id));
        update.select(".sel-name").text((d) => d.name);
        return update;
      },
      (exit) => exit.remove(),
    );

  // Update selected-state class on bubbles
  d3.selectAll("circle.bubble").classed("selected", (d) =>
    state.selectedIds.has(d.id),
  );
}

d3.select("#open-sandbox").on("click", () => switchView("sandbox"));
d3.select("#clear-selection").on("click", () => {
  state.selectedIds.clear();
  updateSelectionUI();
  renderSandbox();
  if (state.view === "main") update();
});

// Sandbox
const sandbox = {
  svg: null,
  g: null,
  xScale: null,
  yScale: null,
  width: 0,
  height: 0,
  margin: { top: 30, right: 40, bottom: 60, left: 80 },
  xField: "completion_rate",
  yField: "alive_ratio",
  colorField: "genre",
  colorByGameId: new Map(),
};

const TS_PALETTE = d3.schemeTableau10;

function colorForGame(id) {
  if (!sandbox.colorByGameId.has(id)) {
    const used = new Set(sandbox.colorByGameId.values());
    const free = TS_PALETTE.find((c) => !used.has(c))
              || TS_PALETTE[sandbox.colorByGameId.size % TS_PALETTE.length];
    sandbox.colorByGameId.set(id, free);
  }
  return sandbox.colorByGameId.get(id);
}

function pruneSelectionColors() {
  for (const id of [...sandbox.colorByGameId.keys()]) {
    if (!state.selectedIds.has(id)) sandbox.colorByGameId.delete(id);
  }
}

function initSandbox() {
  const svg = d3.select("#sandbox-chart");
  const bbox = svg.node().getBoundingClientRect();

  // If the view is hidden, bbox is 0×0 — bail and we'll re-init when it's visible
  if (bbox.width === 0 || bbox.height === 0) {
    sandbox.initialized = false;
    return;
  }

  sandbox.width = bbox.width - sandbox.margin.left - sandbox.margin.right;
  sandbox.height = bbox.height - sandbox.margin.top - sandbox.margin.bottom;
  sandbox.svg = svg;

  // Remove any stale content from previous init
  svg.selectAll("*").remove();

  sandbox.g = svg
    .append("g")
    .attr(
      "transform",
      `translate(${sandbox.margin.left},${sandbox.margin.top})`,
    );
  sandbox.g
    .append("g")
    .attr("class", "axis axis-x")
    .attr("transform", `translate(0,${sandbox.height})`);
  sandbox.g.append("g").attr("class", "axis axis-y");
  sandbox.g.append("g").attr("class", "grid grid-y");
  sandbox.g
    .append("text")
    .attr("class", "axis-label sandbox-x-label")
    .attr("x", sandbox.width / 2)
    .attr("y", sandbox.height + 48)
    .attr("text-anchor", "middle");
  sandbox.g
    .append("text")
    .attr("class", "axis-label sandbox-y-label")
    .attr("transform", "rotate(-90)")
    .attr("x", -sandbox.height / 2)
    .attr("y", -60)
    .attr("text-anchor", "middle");
  sandbox.g.append("g").attr("class", "sandbox-points");

  sandbox.initialized = true;
}

const FIELD_LABELS = {
  completion_rate: "Completion rate",
  rating: "Rating",
  year: "Release year",
  survivability: "Survivability %",
  alive_ratio: "Alive ratio",
  avg_players: "Avg players",
  peak_players: "Peak players",
};

function renderSandbox() {
  if (!sandbox.initialized) return;

  const selected = [...state.selectedIds].map((id) =>
    GAMES_DATA.find((g) => g.id === id),
  );

  d3.select("#sandbox-empty").classed("hidden", selected.length > 0);
  d3.select("#sandbox-chart").style("opacity", selected.length > 0 ? 1 : 0);

  if (selected.length === 0) return;

  const xVals = selected.map((d) => d[sandbox.xField]);
  const yVals = selected.map((d) => d[sandbox.yField]);

  // Build a padded domain that handles n=1 and all-equal cases
  function paddedDomain(vals, isLog = false) {
    let lo = d3.min(vals);
    let hi = d3.max(vals);
    if (lo === hi) {
      // Single value or all equal
      const pad = Math.abs(lo) > 0.01 ? Math.abs(lo) * 0.5 : 0.1;
      lo -= pad;
      hi += pad;
    } else {
      const span = hi - lo;
      lo -= span * 0.15;
      hi += span * 0.15;
    }
    if (isLog) {
      lo = Math.max(1, lo);
    }
    return [lo, hi];
  }

  sandbox.xScale = d3
    .scaleLinear()
    .domain(paddedDomain(xVals))
    .range([0, sandbox.width]);

  if (sandbox.yField === "avg_players" || sandbox.yField === "peak_players") {
    const [lo, hi] = paddedDomain(yVals, true);
    sandbox.yScale = d3
      .scaleLog()
      .domain([Math.max(1, lo), Math.max(10, hi)])
      .range([sandbox.height, 0])
      .clamp(true);
  } else {
    sandbox.yScale = d3
      .scaleLinear()
      .domain(paddedDomain(yVals))
      .range([sandbox.height, 0]);
  }

  // Color
  let colorScale;
  if (sandbox.colorField === "genre") {
    const genres = [...new Set(selected.map((d) => d.genres[0]))];
    colorScale = d3
      .scaleOrdinal()
      .domain(genres)
      .range([
        "#e6a356",
        "#7fc97f",
        "#d96c6c",
        "#a5b1e4",
        "#ddb892",
        "#c8a2d6",
      ]);
  } else if (sandbox.colorField === "alive_ratio") {
    colorScale = d3
      .scaleLinear()
      .domain([0, 0.15, 0.3])
      .range(["#d96c6c", "#e6a356", "#7fc97f"]);
  } else {
    colorScale = d3.scaleSequential(d3.interpolateViridis).domain([2012, 2025]);
  }

  sandbox.g
    .select(".axis-x")
    .transition()
    .duration(400)
    .call(d3.axisBottom(sandbox.xScale).ticks(6));
  sandbox.g
    .select(".axis-y")
    .transition()
    .duration(400)
    .call(
      d3
        .axisLeft(sandbox.yScale)
        .ticks(6)
        .tickFormat((d) => {
          if (d >= 1e6) return (d / 1e6).toFixed(1) + "M";
          if (d >= 1e3) return (d / 1e3).toFixed(0) + "k";
          if (Math.abs(d) < 1 && d !== 0) return d.toFixed(2);
          return d;
        }),
    );

  sandbox.g
    .select(".sandbox-x-label")
    .text(FIELD_LABELS[sandbox.xField].toLowerCase());
  sandbox.g
    .select(".sandbox-y-label")
    .text(FIELD_LABELS[sandbox.yField].toLowerCase());

  // Points + labels
  const points = sandbox.g
    .select(".sandbox-points")
    .selectAll(".sandbox-point")
    .data(selected, (d) => d.id);

  points.exit().remove();

  const enter = points.enter().append("g").attr("class", "sandbox-point");
  enter.append("circle").attr("r", 0);
  enter.append("text").attr("class", "sandbox-label");

  const merged = enter.merge(points);
  merged
    .select("circle")
    .transition()
    .duration(500)
    .attr("cx", (d) => sandbox.xScale(d[sandbox.xField]))
    .attr("cy", (d) => sandbox.yScale(d[sandbox.yField]))
    .attr("r", 9)
    .attr("fill", (d) => {
      if (sandbox.colorField === "genre") return colorScale(d.genres[0]);
      return colorScale(d[sandbox.colorField]);
    });
  merged
    .select("text")
    .text((d) => d.name)
    .transition()
    .duration(500)
    .attr("x", (d) => sandbox.xScale(d[sandbox.xField]) + 14)
    .attr("y", (d) => sandbox.yScale(d[sandbox.yField]) + 4);

  renderTimeSeries();
}

d3.selectAll("#sandbox-x, #sandbox-y, #sandbox-color").on(
  "change",
  function () {
    if (this.id === "sandbox-x") sandbox.xField = this.value;
    if (this.id === "sandbox-y") sandbox.yField = this.value;
    if (this.id === "sandbox-color") sandbox.colorField = this.value;
    renderSandbox();
  },
);

// ==========================================================
// SANDBOX TIME SERIES
// ==========================================================

const ts = {
  svg: null,
  g: null,
  xScale: null,
  yScale: null,
  width: 0,
  height: 0,
  margin: { top: 10, right: 24, bottom: 28, left: 56 },
  initialized: false,
};

function initTimeSeries() {
  const svg = d3.select("#sandbox-ts");
  const bbox = svg.node().getBoundingClientRect();
  if (bbox.width === 0 || bbox.height === 0) { ts.initialized = false; return; }

  ts.width = bbox.width - ts.margin.left - ts.margin.right;
  ts.height = bbox.height - ts.margin.top - ts.margin.bottom;
  ts.svg = svg;
  svg.selectAll("*").remove();

  ts.g = svg.append("g")
    .attr("transform", `translate(${ts.margin.left},${ts.margin.top})`);
  ts.g.append("g").attr("class", "axis axis-x")
    .attr("transform", `translate(0,${ts.height})`);
  ts.g.append("g").attr("class", "axis axis-y");
  ts.g.append("g").attr("class", "grid grid-y");
  ts.g.append("g").attr("class", "ts-lines");
  ts.initialized = true;
}

function renderTimeSeries() {
  if (!ts.initialized) return;

  const selected = [...state.selectedIds]
    .map((id) => GAMES_DATA.find((g) => g.id === id))
    .filter((g) => g && g.series && g.series.length > 0);

  d3.select("#ts-empty").classed("hidden", selected.length > 0);
  d3.select("#sandbox-ts").style("opacity", selected.length > 0 ? 1 : 0);
  if (selected.length === 0) {
    ts.g.select(".ts-lines").selectAll("path").remove();
    return;
  }

  const allPoints = selected.flatMap((g) => g.series);
  ts.xScale = d3.scaleTime()
    .domain(d3.extent(allPoints, (d) => new Date(d.month)))
    .range([0, ts.width]);

  const maxPlayers = d3.max(allPoints, (d) => d.players) || 10;
  ts.yScale = d3.scaleLog()
    .domain([1, maxPlayers * 1.3])
    .range([ts.height, 0])
    .clamp(true);

  ts.g.select(".axis-x")
    .transition().duration(400)
    .call(d3.axisBottom(ts.xScale).ticks(6).tickFormat(d3.timeFormat("%Y")));

  ts.g.select(".axis-y")
    .transition().duration(400)
    .call(d3.axisLeft(ts.yScale).ticks(5, "~s"));

  ts.g.select(".grid-y")
    .transition().duration(400)
    .call(d3.axisLeft(ts.yScale).ticks(5).tickSize(-ts.width).tickFormat(""))
    .selectAll("text").remove();

  const line = d3.line()
    .x((d) => ts.xScale(new Date(d.month)))
    .y((d) => ts.yScale(Math.max(1, d.players)))
    .defined((d) => d.players > 0)
    .curve(d3.curveMonotoneX);

  const lines = ts.g.select(".ts-lines")
    .selectAll("path.ts-line")
    .data(selected, (d) => d.id);

  lines.exit().remove();

  lines.enter().append("path")
    .attr("class", "ts-line")
    .attr("stroke", (d) => colorForGame(d.id))
    .merge(lines)
    .attr("stroke", (d) => colorForGame(d.id))
    .on("mouseover", function (event, d) {
      ts.g.selectAll("path.ts-line").classed("dimmed", (o) => o.id !== d.id);
      d3.select(this).classed("focused", true).classed("dimmed", false);
    })
    .on("mouseout", function () {
      ts.g.selectAll("path.ts-line").classed("dimmed", false).classed("focused", false);
    })
    .transition().duration(500)
    .attr("d", (d) => line(d.series));
}

// Helpers
function fmtPlayers(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(0) + "k";
  return n.toString();
}

// Update Loop
function update() {
  const filtered = getFilteredGames();
  d3.select("#visible-count").text(filtered.length);
  renderChart(filtered);
}

// Bootstrap
document.addEventListener("DOMContentLoaded", async () => {
  const games = await loadGameData();
  GAMES_DATA = games;
  ALL_GENRES = [...new Set(games.flatMap((g) => g.genres))].sort();
  ALL_PLATFORMS = [...new Set(games.flatMap((g) => g.platforms))].sort();

  setupGenreChips();
  setupPlatformChips();
  setupSliders();
  setupSearch();
  initChart();
  update();
  updateSelectionUI();
});

// ==========================================================
// § 03 — OUR READING (Static Analysis)
// ==========================================================

const analysis = { initialized: false };

const CASE_STUDY_IDS = [240, 440, 413150, 367520, 377160, 532210]; // CS:S, TF2, Stardew, HK, Fallout4, LiS2 (steam_appids)

const ARCHETYPE_COLORS = {
  immortal: "#7fc97f",
  slow_burn: "#8ab4ff",
  fading_aaa: "#d96c6c",
  mid: "#655a50",
};

const ARCHETYPE_LABELS = {
  immortal: "Immortal",
  slow_burn: "Slow Burn",
  fading_aaa: "Fading AAA",
  mid: "Mid",
};

const CASE_STUDY_COLORS = [
  "#7fc97f", "#4daf4a", // CS:S, TF2 — immortal AAA (greens)
  "#8ab4ff", "#5c9eff", // Stardew, HK — immortal indie (blues)
  "#d96c6c", "#e89090", // Fallout 4, LiS2 — fading AAA (reds)
];

function renderAnalysisView() {
  analysis.initialized = true;
  drawAct1();       // Hero histogram
  drawAct2();       // Four Archetypes scatter
  drawAct3();       // DNA diverging bar
  drawActGenre();   // Genre Battlefield strip
  drawActCritic();  // Critic Blind Spot scatter
  drawAct4();       // Designed Not To End scatter
  drawActDrop();    // Drop Rate Paradox scatter
  drawActPrice();   // Price of Forever bar
  drawAct5();       // Time Curve multi-line
  drawAct6();       // Buzz Multiplier scatter
  wireOutroCTA();
}

// --- Act 1: Alive ratio histogram ---
function drawAct1() {
  const container = document.getElementById("act1-chart");
  if (!container) return;
  const W = container.clientWidth || 500;
  const H = 200;
  const margin = { top: 10, right: 20, bottom: 40, left: 48 };
  const w = W - margin.left - margin.right;
  const h = H - margin.top - margin.bottom;

  const svg = d3.select("#act1-chart").append("svg")
    .attr("width", W).attr("height", H);
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  const values = GAMES_DATA.map(d => d.alive_ratio).filter(v => v != null && v >= 0);
  const x = d3.scaleLinear().domain([0, 1]).range([0, w]);
  const bins = d3.bin().domain([0, 1]).thresholds(50)(values);
  const y = d3.scaleLinear().domain([0, d3.max(bins, b => b.length)]).range([h, 0]);

  g.selectAll("rect").data(bins).join("rect")
    .attr("x", d => x(d.x0) + 1)
    .attr("width", d => Math.max(0, x(d.x1) - x(d.x0) - 2))
    .attr("y", d => y(d.length))
    .attr("height", d => h - y(d.length))
    .attr("fill", d => {
      const mid = (d.x0 + d.x1) / 2;
      return mid < 0.08 ? "var(--dying)" : mid < 0.15 ? "var(--accent)" : "var(--alive)";
    })
    .attr("opacity", 0.8);

  // Median line at 0.04
  const medX = x(0.04);
  g.append("line")
    .attr("x1", medX).attr("x2", medX)
    .attr("y1", 0).attr("y2", h)
    .attr("stroke", "var(--ink)").attr("stroke-width", 1.5)
    .attr("stroke-dasharray", "4,3").attr("opacity", 0.7);
  g.append("text")
    .attr("x", medX + 5).attr("y", 14)
    .attr("fill", "var(--ink)").attr("font-family", "var(--mono)")
    .attr("font-size", 10).text("P50 = 4%");

  // 20% marker
  const p20X = x(0.2);
  g.append("line")
    .attr("x1", p20X).attr("x2", p20X)
    .attr("y1", 0).attr("y2", h)
    .attr("stroke", "var(--alive)").attr("stroke-width", 1)
    .attr("stroke-dasharray", "3,3").attr("opacity", 0.6);
  g.append("text")
    .attr("x", p20X + 5).attr("y", 14)
    .attr("fill", "var(--alive)").attr("font-family", "var(--mono)")
    .attr("font-size", 10).text("20% → 348 games");

  g.append("g").attr("transform", `translate(0,${h})`)
    .call(d3.axisBottom(x).tickFormat(d3.format(".0%")).ticks(6))
    .select(".domain").remove();
  g.append("g")
    .call(d3.axisLeft(y).ticks(4).tickFormat(d3.format("~s")))
    .select(".domain").remove();

  svg.selectAll(".tick line").attr("stroke", "var(--rule-strong)");
  svg.selectAll(".tick text").attr("fill", "var(--ink-dim)").attr("font-family", "var(--mono)").attr("font-size", 10);
}

// --- Act 2: Archetype scatter ---
function drawAct2() {
  const container = document.getElementById("act2-chart");
  if (!container) return;
  const W = container.clientWidth || 560;
  const H = 400;
  const margin = { top: 20, right: 20, bottom: 48, left: 64 };
  const w = W - margin.left - margin.right;
  const h = H - margin.top - margin.bottom;

  const svg = d3.select("#act2-chart").append("svg")
    .attr("width", W).attr("height", H);
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  const data = GAMES_DATA.filter(d => d.peak_players > 0 && d.alive_ratio != null);

  const x = d3.scaleLog().domain([Math.max(1, d3.min(data, d => d.peak_players)), d3.max(data, d => d.peak_players)]).range([0, w]).clamp(true);
  const y = d3.scaleLinear().domain([0, Math.min(1, d3.max(data, d => d.alive_ratio) * 1.1)]).range([h, 0]);

  // Quadrant lines
  const xMid = x(50000);
  const yMid = y(0.08);
  g.append("line").attr("x1", xMid).attr("x2", xMid).attr("y1", 0).attr("y2", h)
    .attr("stroke", "var(--rule-strong)").attr("stroke-dasharray", "4,3");
  g.append("line").attr("x1", 0).attr("x2", w).attr("y1", yMid).attr("y2", yMid)
    .attr("stroke", "var(--rule-strong)").attr("stroke-dasharray", "4,3");

  // Quadrant labels
  const quadLabels = [
    { x: xMid + 8, y: 12, text: "Immortal", align: "start" },
    { x: xMid - 8, y: 12, text: "Slow Burn", align: "end" },
    { x: xMid + 8, y: h - 8, text: "Fading AAA", align: "start" },
    { x: xMid - 8, y: h - 8, text: "Mid", align: "end" },
  ];
  quadLabels.forEach(q => {
    g.append("text").attr("x", q.x).attr("y", q.y)
      .attr("text-anchor", q.align).attr("fill", "var(--ink-faint)")
      .attr("font-family", "var(--mono)").attr("font-size", 9)
      .attr("letter-spacing", "0.1em").text(q.text.toUpperCase());
  });

  g.selectAll("circle").data(data).join("circle")
    .attr("cx", d => x(Math.max(1, d.peak_players)))
    .attr("cy", d => y(d.alive_ratio))
    .attr("r", 3)
    .attr("fill", d => ARCHETYPE_COLORS[d.archetype] || "var(--ink-faint)")
    .attr("opacity", 0.55)
    .attr("stroke", "none");

  // Highlight case studies
  const caseGames = CASE_STUDY_IDS.map(id => GAMES_DATA.find(g => g.id === id)).filter(Boolean);
  g.selectAll("circle.case").data(caseGames).join("circle")
    .attr("class", "case")
    .attr("cx", d => x(Math.max(1, d.peak_players)))
    .attr("cy", d => y(d.alive_ratio))
    .attr("r", 6)
    .attr("fill", (d, i) => CASE_STUDY_COLORS[i])
    .attr("stroke", "var(--bg)").attr("stroke-width", 1.5)
    .attr("opacity", 1);

  g.selectAll("text.case-label").data(caseGames).join("text")
    .attr("class", "case-label")
    .attr("x", d => x(Math.max(1, d.peak_players)) + 8)
    .attr("y", d => y(d.alive_ratio) + 4)
    .attr("fill", "var(--ink)").attr("font-family", "var(--mono)")
    .attr("font-size", 9).text(d => d.name);

  g.append("g").attr("transform", `translate(0,${h})`)
    .call(d3.axisBottom(x).ticks(4).tickFormat(n => n >= 1e6 ? (n/1e6).toFixed(0)+"M" : n >= 1e3 ? (n/1e3).toFixed(0)+"k" : n))
    .select(".domain").remove();
  g.append("g")
    .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format(".0%")))
    .select(".domain").remove();

  g.append("text").attr("x", w/2).attr("y", h + 38)
    .attr("text-anchor", "middle").attr("fill", "var(--ink-dim)")
    .attr("font-family", "var(--mono)").attr("font-size", 10)
    .text("Peak concurrent players");
  g.append("text").attr("transform", "rotate(-90)")
    .attr("x", -h/2).attr("y", -52)
    .attr("text-anchor", "middle").attr("fill", "var(--ink-dim)")
    .attr("font-family", "var(--mono)").attr("font-size", 10)
    .text("Alive ratio");

  svg.selectAll(".tick line").attr("stroke", "var(--rule-strong)");
  svg.selectAll(".tick text").attr("fill", "var(--ink-dim)").attr("font-family", "var(--mono)").attr("font-size", 10);

  // Case cards
  const cardData = [
    { arch: "immortal", name: "Counter-Strike: Source", year: 2004, note: "Alive ratio: 66% — 21 years old" },
    { arch: "slow_burn", name: "Euro Truck Simulator 2", year: 2012, note: "Low peak, loyal niche" },
    { arch: "fading_aaa", name: "Fallout 4", year: 2015, note: "472k peak → 2.7% alive" },
    { arch: "mid", name: "The Silent Majority", year: null, note: "Thousands of games below 4% alive" },
  ];
  const cards = d3.select("#act2-cards").selectAll(".case-card").data(cardData).join("div")
    .attr("class", "case-card");
  cards.append("div").attr("class", "case-card-arch")
    .style("color", d => ARCHETYPE_COLORS[d.arch])
    .text(d => ARCHETYPE_LABELS[d.arch] || d.arch);
  cards.append("div").attr("class", "case-card-name").text(d => d.name);
  cards.append("div").attr("class", "case-card-meta").text(d => d.note);
}

// --- Act 3: DNA diverging bar chart ---
function drawAct3() {
  const container = document.getElementById("act3-chart");
  if (!container) return;
  const W = container.clientWidth || 500;

  const tagDNA = [
    { tag: "2D", diff: 5.9 },
    { tag: "Sandbox", diff: 5.0 },
    { tag: "Story Rich", diff: 4.4 },
    { tag: "Building", diff: 4.0 },
    { tag: "Exploration", diff: 3.7 },
    { tag: "Survival", diff: 2.0 },
    { tag: "Moddable", diff: 1.9 },
    { tag: "Crafting", diff: 1.9 },
    { tag: "Classic", diff: -3.4 },
    { tag: "FPS", diff: -4.4 },
  ].sort((a, b) => a.diff - b.diff);

  const margin = { top: 10, right: 80, bottom: 30, left: 90 };
  const H = tagDNA.length * 28 + margin.top + margin.bottom;
  const w = W - margin.left - margin.right;
  const h = H - margin.top - margin.bottom;

  const svg = d3.select("#act3-chart").append("svg")
    .attr("width", W).attr("height", H);
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  const x = d3.scaleLinear().domain([-6, 6]).range([0, w]);
  const y = d3.scaleBand().domain(tagDNA.map(d => d.tag)).range([0, h]).padding(0.25);

  g.append("line").attr("x1", x(0)).attr("x2", x(0)).attr("y1", 0).attr("y2", h)
    .attr("stroke", "var(--rule-strong)");

  g.selectAll("rect").data(tagDNA).join("rect")
    .attr("x", d => d.diff >= 0 ? x(0) : x(d.diff))
    .attr("y", d => y(d.tag))
    .attr("width", d => Math.abs(x(d.diff) - x(0)))
    .attr("height", y.bandwidth())
    .attr("fill", d => d.diff >= 0 ? "var(--alive)" : "var(--dying)")
    .attr("opacity", 0.85);

  g.selectAll("text.bar-val").data(tagDNA).join("text")
    .attr("class", "bar-val")
    .attr("x", d => d.diff >= 0 ? x(d.diff) + 5 : x(d.diff) - 5)
    .attr("y", d => y(d.tag) + y.bandwidth() / 2 + 4)
    .attr("text-anchor", d => d.diff >= 0 ? "start" : "end")
    .attr("fill", d => d.diff >= 0 ? "var(--alive)" : "var(--dying)")
    .attr("font-family", "var(--mono)").attr("font-size", 10)
    .text(d => (d.diff >= 0 ? "+" : "") + d.diff.toFixed(1) + "pp");

  g.append("g").attr("transform", `translate(0,${h})`)
    .call(d3.axisBottom(x).ticks(6).tickFormat(d => (d > 0 ? "+" : "") + d + "pp"))
    .select(".domain").remove();

  g.append("g").call(d3.axisLeft(y).tickSize(0))
    .select(".domain").remove();

  svg.selectAll(".tick line").attr("stroke", "var(--rule-strong)");
  svg.selectAll(".tick text").attr("fill", "var(--ink-dim)").attr("font-family", "var(--mono)").attr("font-size", 11);
}

// --- Act 4: Completion vs Alive scatter ---
function drawAct4() {
  const container = document.getElementById("act4-chart");
  if (!container) return;
  const W = container.clientWidth || 500;
  const H = 380;
  const margin = { top: 20, right: 20, bottom: 48, left: 60 };
  const w = W - margin.left - margin.right;
  const h = H - margin.top - margin.bottom;

  const GENRE_CLUSTERS = {
    "Massively Multiplayer": { color: "#7fc97f", cluster: "sandbox" },
    "Strategy": { color: "#8ab4ff", cluster: "sandbox" },
    "Simulation": { color: "#a4d4ff", cluster: "sandbox" },
    "Sports": { color: "#c8b8ff", cluster: "sandbox" },
    "Action": { color: "#e6a356", cluster: "competitive" },
    "Shooter": { color: "#f4bb6d", cluster: "competitive" },
    "RPG": { color: "#d4a3e0", cluster: "narrative" },
    "Adventure": { color: "#e8c8e0", cluster: "narrative" },
    "Puzzle": { color: "#f8d8a0", cluster: "narrative" },
    "Platformer": { color: "#d96c6c", cluster: "completable" },
    "Fighting": { color: "#e08888", cluster: "completable" },
    "Indie": { color: "#a69a8c", cluster: "mid" },
  };

  const data = GAMES_DATA.filter(d =>
    d.completion_rate != null && d.completion_rate >= 0 &&
    d.alive_ratio != null && d.alive_ratio >= 0 &&
    d.completion_rate <= 0.5
  );

  const svg = d3.select("#act4-chart").append("svg")
    .attr("width", W).attr("height", H);
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  const x = d3.scaleLinear().domain([0, 0.5]).range([0, w]);
  const y = d3.scaleLinear().domain([0, Math.min(0.8, d3.max(data, d => d.alive_ratio) * 1.1)]).range([h, 0]);

  g.selectAll("circle").data(data).join("circle")
    .attr("cx", d => x(d.completion_rate))
    .attr("cy", d => y(d.alive_ratio))
    .attr("r", 3)
    .attr("fill", d => {
      const genre = d.genres[0];
      return (GENRE_CLUSTERS[genre] || { color: "var(--ink-faint)" }).color;
    })
    .attr("opacity", 0.4);

  // Genre median markers
  const genreMeds = Object.keys(GENRE_CLUSTERS).map(genre => {
    const pts = GAMES_DATA.filter(d => d.genres.includes(genre) && d.completion_rate != null && d.alive_ratio != null);
    if (pts.length < 5) return null;
    return {
      genre,
      cr: d3.median(pts, d => d.completion_rate),
      ar: d3.median(pts, d => d.alive_ratio),
      color: GENRE_CLUSTERS[genre].color,
    };
  }).filter(Boolean);

  g.selectAll("circle.genre-med").data(genreMeds).join("circle")
    .attr("class", "genre-med")
    .attr("cx", d => x(Math.min(0.5, d.cr)))
    .attr("cy", d => y(Math.min(0.8, d.ar)))
    .attr("r", 7)
    .attr("fill", d => d.color)
    .attr("stroke", "var(--bg)").attr("stroke-width", 1.5)
    .attr("opacity", 1);

  g.selectAll("text.genre-med-label").data(genreMeds).join("text")
    .attr("class", "genre-med-label")
    .attr("x", d => x(Math.min(0.5, d.cr)) + 9)
    .attr("y", d => y(Math.min(0.8, d.ar)) + 4)
    .attr("fill", "var(--ink)").attr("font-family", "var(--mono)")
    .attr("font-size", 9).text(d => d.genre);

  g.append("g").attr("transform", `translate(0,${h})`)
    .call(d3.axisBottom(x).tickFormat(d3.format(".0%")).ticks(6))
    .select(".domain").remove();
  g.append("g")
    .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format(".0%")))
    .select(".domain").remove();

  g.append("text").attr("x", w/2).attr("y", h + 38)
    .attr("text-anchor", "middle").attr("fill", "var(--ink-dim)")
    .attr("font-family", "var(--mono)").attr("font-size", 10)
    .text("Completion rate (beaten/owned)");
  g.append("text").attr("transform", "rotate(-90)")
    .attr("x", -h/2).attr("y", -48)
    .attr("text-anchor", "middle").attr("fill", "var(--ink-dim)")
    .attr("font-family", "var(--mono)").attr("font-size", 10)
    .text("Alive ratio");

  svg.selectAll(".tick line").attr("stroke", "var(--rule-strong)");
  svg.selectAll(".tick text").attr("fill", "var(--ink-dim)").attr("font-family", "var(--mono)").attr("font-size", 10);
}

// --- Act 5: Time series case studies ---
function drawAct5() {
  const container = document.getElementById("act5-chart");
  if (!container) return;
  const W = container.clientWidth || 600;
  const H = 360;
  const margin = { top: 20, right: 20, bottom: 48, left: 64 };
  const w = W - margin.left - margin.right;
  const h = H - margin.top - margin.bottom;

  const caseGames = CASE_STUDY_IDS
    .map(id => GAMES_DATA.find(g => g.id === id))
    .filter(g => g && g.series && g.series.length > 0);

  if (caseGames.length === 0) return;

  const svg = d3.select("#act5-chart").append("svg")
    .attr("width", W).attr("height", H);
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  const allPoints = caseGames.flatMap(g => g.series);
  const xScale = d3.scaleTime()
    .domain(d3.extent(allPoints, d => new Date(d.month)))
    .range([0, w]);
  const maxP = d3.max(allPoints, d => d.players) || 10;
  const yScale = d3.scaleLog()
    .domain([100, maxP * 1.4])
    .range([h, 0])
    .clamp(true);

  const line = d3.line()
    .x(d => xScale(new Date(d.month)))
    .y(d => yScale(Math.max(100, d.players)))
    .defined(d => d.players > 0)
    .curve(d3.curveMonotoneX);

  g.append("g").attr("class", "grid-y")
    .call(d3.axisLeft(yScale).ticks(5).tickSize(-w).tickFormat(""))
    .selectAll("line").attr("stroke", "var(--rule)").attr("stroke-dasharray", "2,3");
  g.select(".grid-y .domain").remove();

  caseGames.forEach((game, i) => {
    g.append("path")
      .datum(game.series)
      .attr("fill", "none")
      .attr("stroke", CASE_STUDY_COLORS[i])
      .attr("stroke-width", 2)
      .attr("opacity", 0.9)
      .attr("d", line);
  });

  g.append("g").attr("transform", `translate(0,${h})`)
    .call(d3.axisBottom(xScale).ticks(6).tickFormat(d3.timeFormat("%Y")))
    .select(".domain").remove();
  g.append("g")
    .call(d3.axisLeft(yScale).ticks(5, "~s"))
    .select(".domain").remove();

  svg.selectAll(".tick line").attr("stroke", "var(--rule-strong)");
  svg.selectAll(".tick text").attr("fill", "var(--ink-dim)").attr("font-family", "var(--mono)").attr("font-size", 10);

  // Legend
  const legendEl = d3.select("#act5-legend");
  const caseNames = [
    "Counter-Strike: Source", "Team Fortress 2",
    "Stardew Valley", "Hollow Knight",
    "Fallout 4", "Life is Strange 2",
  ];
  caseGames.forEach((game, i) => {
    const item = legendEl.append("div").attr("class", "ts-legend-item");
    item.append("div").attr("class", "ts-legend-swatch")
      .style("background", CASE_STUDY_COLORS[i]);
    item.append("span").text(caseNames[i] || game.name);
  });
}

// --- Act 6: YouTube buzz scatter ---
function drawAct6() {
  const container = document.getElementById("act6-chart");
  if (!container) return;
  const W = container.clientWidth || 500;
  const H = 340;
  const margin = { top: 20, right: 20, bottom: 48, left: 72 };
  const w = W - margin.left - margin.right;
  const h = H - margin.top - margin.bottom;

  const currentYear = 2025;
  const data = GAMES_DATA.filter(d =>
    d.youtube_count > 0 && d.alive_ratio != null &&
    d.release_year > 0 && d.release_year <= currentYear
  ).map(d => ({
    ...d,
    age: Math.max(1, currentYear - d.release_year),
    yt_per_year: d.youtube_count / Math.max(1, currentYear - d.release_year),
    capped: d.youtube_count >= 999000,
  }));

  const svg = d3.select("#act6-chart").append("svg")
    .attr("width", W).attr("height", H);
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  const x = d3.scaleLinear().domain([0, Math.min(1, d3.max(data, d => d.alive_ratio) * 1.1)]).range([0, w]);
  const maxYt = d3.max(data.filter(d => !d.capped), d => d.yt_per_year) || 1e6;
  const y = d3.scaleLog()
    .domain([1, maxYt * 1.5])
    .range([h, 0])
    .clamp(true);

  g.selectAll("circle").data(data).join("circle")
    .attr("cx", d => x(d.alive_ratio))
    .attr("cy", d => y(Math.max(1, d.yt_per_year)))
    .attr("r", 3)
    .attr("fill", d => d.alive_ratio > 0.15 ? "var(--alive)" : "var(--dying)")
    .attr("opacity", d => d.capped ? 0.2 : 0.45);

  // Median lines by tier
  const highVit = data.filter(d => d.alive_ratio > 0.15 && !d.capped);
  const lowVit = data.filter(d => d.alive_ratio <= 0.05 && !d.capped);
  const medHigh = d3.median(highVit, d => d.yt_per_year) || 0;
  const medLow = d3.median(lowVit, d => d.yt_per_year) || 0;

  if (medHigh > 0) {
    g.append("line").attr("x1", x(0.15)).attr("x2", w)
      .attr("y1", y(medHigh)).attr("y2", y(medHigh))
      .attr("stroke", "var(--alive)").attr("stroke-width", 1.5)
      .attr("stroke-dasharray", "6,3");
    g.append("text").attr("x", w - 5).attr("y", y(medHigh) - 5)
      .attr("text-anchor", "end").attr("fill", "var(--alive)")
      .attr("font-family", "var(--mono)").attr("font-size", 9)
      .text("high-vitality median: " + Math.round(medHigh).toLocaleString());
  }
  if (medLow > 0) {
    g.append("line").attr("x1", 0).attr("x2", x(0.05))
      .attr("y1", y(medLow)).attr("y2", y(medLow))
      .attr("stroke", "var(--dying)").attr("stroke-width", 1.5)
      .attr("stroke-dasharray", "6,3");
    g.append("text").attr("x", 5).attr("y", y(medLow) - 5)
      .attr("text-anchor", "start").attr("fill", "var(--dying)")
      .attr("font-family", "var(--mono)").attr("font-size", 9)
      .text("low-vitality median: " + Math.round(medLow).toLocaleString());
  }

  g.append("g").attr("transform", `translate(0,${h})`)
    .call(d3.axisBottom(x).ticks(5).tickFormat(d3.format(".0%")))
    .select(".domain").remove();
  g.append("g")
    .call(d3.axisLeft(y).ticks(5, "~s"))
    .select(".domain").remove();

  g.append("text").attr("x", w/2).attr("y", h + 38)
    .attr("text-anchor", "middle").attr("fill", "var(--ink-dim)")
    .attr("font-family", "var(--mono)").attr("font-size", 10)
    .text("Alive ratio");
  g.append("text").attr("transform", "rotate(-90)")
    .attr("x", -h/2).attr("y", -58)
    .attr("text-anchor", "middle").attr("fill", "var(--ink-dim)")
    .attr("font-family", "var(--mono)").attr("font-size", 10)
    .text("YouTube videos / year");

  svg.selectAll(".tick line").attr("stroke", "var(--rule-strong)");
  svg.selectAll(".tick text").attr("fill", "var(--ink-dim)").attr("font-family", "var(--mono)").attr("font-size", 10);
}

// --- Act 4 (new): Genre Battlefield strip plot ---
function drawActGenre() {
  const container = document.getElementById("act-genre-chart");
  if (!container) return;
  const W = container.clientWidth || 540;

  const GENRES_ORDERED = [
    "Massively Multiplayer", "Strategy", "Simulation", "Sports", "Racing",
    "Fighting", "Shooter", "Action", "RPG", "Casual",
    "Indie", "Puzzle", "Adventure", "Platformer",
  ];

  const byGenre = GENRES_ORDERED.map(genre => {
    const pts = GAMES_DATA.filter(d => d.genres.includes(genre) && d.alive_ratio != null);
    if (pts.length < 3) return null;
    const vals = pts.map(d => d.alive_ratio).sort(d3.ascending);
    return { genre, vals, med: d3.median(vals), n: pts.length };
  }).filter(Boolean).sort((a, b) => b.med - a.med);

  const margin = { top: 10, right: 20, bottom: 36, left: 155 };
  const rowH = 26;
  const H = byGenre.length * rowH + margin.top + margin.bottom;
  const w = W - margin.left - margin.right;
  const h = H - margin.top - margin.bottom;

  const svg = d3.select("#act-genre-chart").append("svg")
    .attr("width", W).attr("height", H);
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  const x = d3.scaleLinear().domain([0, 0.7]).range([0, w]);
  const y = d3.scaleBand().domain(byGenre.map(d => d.genre)).range([0, h]).padding(0.3);

  // Jittered dots
  byGenre.forEach(gd => {
    const yc = y(gd.genre) + y.bandwidth() / 2;
    gd.vals.slice(0, 300).forEach(v => {
      g.append("circle")
        .attr("cx", x(v))
        .attr("cy", yc + (Math.random() - 0.5) * y.bandwidth())
        .attr("r", 1.8)
        .attr("fill", v > 0.15 ? "var(--alive)" : v > 0.08 ? "var(--accent)" : "var(--dying)")
        .attr("opacity", 0.35);
    });
    // Median tick
    g.append("line")
      .attr("x1", x(gd.med)).attr("x2", x(gd.med))
      .attr("y1", y(gd.genre)).attr("y2", y(gd.genre) + y.bandwidth())
      .attr("stroke", "var(--ink)").attr("stroke-width", 2);
  });

  g.append("g").attr("transform", `translate(0,${h})`)
    .call(d3.axisBottom(x).tickFormat(d3.format(".0%")).ticks(5))
    .select(".domain").remove();
  g.append("g").call(d3.axisLeft(y).tickSize(0))
    .select(".domain").remove();

  svg.selectAll(".tick line").attr("stroke", "var(--rule-strong)");
  svg.selectAll(".tick text").attr("fill", "var(--ink-dim)").attr("font-family", "var(--mono)").attr("font-size", 10);
}

// --- Act 5 (new): Critic Blind Spot scatter ---
function drawActCritic() {
  const container = document.getElementById("act-critic-chart");
  if (!container) return;
  const W = container.clientWidth || 500;
  const H = 360;
  const margin = { top: 20, right: 20, bottom: 48, left: 60 };
  const w = W - margin.left - margin.right;
  const h = H - margin.top - margin.bottom;

  const data = GAMES_DATA.filter(d =>
    d.rating_delta !== 0 && d.alive_ratio != null && d.metacritic > 0
  );

  const svg = d3.select("#act-critic-chart").append("svg")
    .attr("width", W).attr("height", H);
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  const x = d3.scaleLinear().domain([-2, 2]).range([0, w]);
  const y = d3.scaleLinear().domain([0, Math.min(0.75, d3.max(data, d => d.alive_ratio) * 1.1)]).range([h, 0]);

  // Zero line
  g.append("line").attr("x1", x(0)).attr("x2", x(0)).attr("y1", 0).attr("y2", h)
    .attr("stroke", "var(--rule-strong)").attr("stroke-dasharray", "3,3");

  g.selectAll("circle").data(data).join("circle")
    .attr("cx", d => x(d.rating_delta))
    .attr("cy", d => y(d.alive_ratio))
    .attr("r", 3)
    .attr("fill", d => ARCHETYPE_COLORS[d.archetype] || "var(--ink-faint)")
    .attr("opacity", 0.5);

  // Global median delta line
  const medDelta = d3.median(data, d => d.rating_delta) || -0.14;
  g.append("line").attr("x1", x(medDelta)).attr("x2", x(medDelta)).attr("y1", 0).attr("y2", h)
    .attr("stroke", "var(--ink-dim)").attr("stroke-width", 1).attr("stroke-dasharray", "5,3");
  g.append("text").attr("x", x(medDelta) + 4).attr("y", h - 6)
    .attr("fill", "var(--ink-dim)").attr("font-family", "var(--mono)").attr("font-size", 9)
    .text("global median: " + medDelta.toFixed(2));

  // Immortal median delta
  const immortals = data.filter(d => d.archetype === "immortal");
  if (immortals.length > 3) {
    const medIm = d3.median(immortals, d => d.rating_delta);
    g.append("line").attr("x1", x(medIm)).attr("x2", x(medIm)).attr("y1", 0).attr("y2", h * 0.4)
      .attr("stroke", "var(--alive)").attr("stroke-width", 1.5).attr("stroke-dasharray", "5,3");
    g.append("text").attr("x", x(medIm) + 4).attr("y", 14)
      .attr("fill", "var(--alive)").attr("font-family", "var(--mono)").attr("font-size", 9)
      .text("immortal median: " + medIm.toFixed(2));
  }

  g.append("g").attr("transform", `translate(0,${h})`)
    .call(d3.axisBottom(x).ticks(6))
    .select(".domain").remove();
  g.append("g").call(d3.axisLeft(y).ticks(5).tickFormat(d3.format(".0%")))
    .select(".domain").remove();

  g.append("text").attr("x", w / 2).attr("y", h + 38)
    .attr("text-anchor", "middle").attr("fill", "var(--ink-dim)")
    .attr("font-family", "var(--mono)").attr("font-size", 10)
    .text("Rating delta (user score − critic score)");
  g.append("text").attr("transform", "rotate(-90)")
    .attr("x", -h / 2).attr("y", -48)
    .attr("text-anchor", "middle").attr("fill", "var(--ink-dim)")
    .attr("font-family", "var(--mono)").attr("font-size", 10)
    .text("Alive ratio");

  svg.selectAll(".tick line").attr("stroke", "var(--rule-strong)");
  svg.selectAll(".tick text").attr("fill", "var(--ink-dim)").attr("font-family", "var(--mono)").attr("font-size", 10);
}

// --- Act 7 (new): Drop Rate Paradox scatter ---
function drawActDrop() {
  const container = document.getElementById("act-drop-chart");
  if (!container) return;
  const W = container.clientWidth || 500;
  const H = 360;
  const margin = { top: 20, right: 20, bottom: 48, left: 60 };
  const w = W - margin.left - margin.right;
  const h = H - margin.top - margin.bottom;

  const data = GAMES_DATA.filter(d =>
    d.drop_rate != null && d.drop_rate > 0 &&
    d.alive_ratio != null && d.drop_rate <= 0.3
  );

  const svg = d3.select("#act-drop-chart").append("svg")
    .attr("width", W).attr("height", H);
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  const x = d3.scaleLinear().domain([0, 0.3]).range([0, w]);
  const y = d3.scaleLinear().domain([0, Math.min(0.75, d3.max(data, d => d.alive_ratio) * 1.1)]).range([h, 0]);

  const medDrop = d3.median(data, d => d.drop_rate) || 0.066;
  const medAlive = d3.median(data, d => d.alive_ratio) || 0.04;

  // Quadrant lines
  g.append("line").attr("x1", x(medDrop)).attr("x2", x(medDrop)).attr("y1", 0).attr("y2", h)
    .attr("stroke", "var(--rule-strong)").attr("stroke-dasharray", "4,3");
  g.append("line").attr("x1", 0).attr("x2", w).attr("y1", y(medAlive)).attr("y2", y(medAlive))
    .attr("stroke", "var(--rule-strong)").attr("stroke-dasharray", "4,3");

  // Quadrant labels
  [
    { x: x(medDrop) + 6, y: 12, text: "Games you return to", align: "start" },
    { x: x(medDrop) - 6, y: 12, text: "Games people never leave", align: "end" },
    { x: x(medDrop) + 6, y: h - 8, text: "Genuinely abandoned", align: "start" },
    { x: x(medDrop) - 6, y: h - 8, text: "Quietly forgotten", align: "end" },
  ].forEach(q => {
    g.append("text").attr("x", q.x).attr("y", q.y)
      .attr("text-anchor", q.align).attr("fill", "var(--ink-faint)")
      .attr("font-family", "var(--mono)").attr("font-size", 9)
      .attr("letter-spacing", "0.08em").text(q.text.toUpperCase());
  });

  g.selectAll("circle").data(data).join("circle")
    .attr("cx", d => x(d.drop_rate))
    .attr("cy", d => y(d.alive_ratio))
    .attr("r", 3)
    .attr("fill", d => ARCHETYPE_COLORS[d.archetype] || "var(--ink-faint)")
    .attr("opacity", 0.5);

  g.append("g").attr("transform", `translate(0,${h})`)
    .call(d3.axisBottom(x).tickFormat(d3.format(".0%")).ticks(6))
    .select(".domain").remove();
  g.append("g").call(d3.axisLeft(y).ticks(5).tickFormat(d3.format(".0%")))
    .select(".domain").remove();

  g.append("text").attr("x", w / 2).attr("y", h + 38)
    .attr("text-anchor", "middle").attr("fill", "var(--ink-dim)")
    .attr("font-family", "var(--mono)").attr("font-size", 10)
    .text("Drop rate (dropped/owned)");
  g.append("text").attr("transform", "rotate(-90)")
    .attr("x", -h / 2).attr("y", -48)
    .attr("text-anchor", "middle").attr("fill", "var(--ink-dim)")
    .attr("font-family", "var(--mono)").attr("font-size", 10)
    .text("Alive ratio");

  svg.selectAll(".tick line").attr("stroke", "var(--rule-strong)");
  svg.selectAll(".tick text").attr("fill", "var(--ink-dim)").attr("font-family", "var(--mono)").attr("font-size", 10);
}

// --- Act 8 (new): Price of Forever bar chart ---
function drawActPrice() {
  const container = document.getElementById("act-price-chart");
  if (!container) return;
  const W = container.clientWidth || 480;
  const H = 280;
  const margin = { top: 30, right: 20, bottom: 48, left: 56 };
  const w = W - margin.left - margin.right;
  const h = H - margin.top - margin.bottom;

  const buckets = [
    { label: "Free", min: 0, max: 0 },
    { label: "< $5", min: 0.01, max: 4.99 },
    { label: "$5–20", min: 5, max: 19.99 },
    { label: "$20–40", min: 20, max: 39.99 },
    { label: "> $40", min: 40, max: Infinity },
  ];

  const paid = GAMES_DATA.filter(d => d.price >= 0 && d.alive_ratio != null);
  const bucketData = buckets.map(b => {
    const games = paid.filter(d =>
      b.min === 0 && b.max === 0 ? d.price === 0 : d.price >= b.min && d.price <= b.max
    );
    return { label: b.label, med: d3.median(games, d => d.alive_ratio) || 0, n: games.length };
  }).filter(b => b.n >= 5);

  const svg = d3.select("#act-price-chart").append("svg")
    .attr("width", W).attr("height", H);
  const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

  const x = d3.scaleBand().domain(bucketData.map(d => d.label)).range([0, w]).padding(0.3);
  const maxMed = d3.max(bucketData, d => d.med) || 0.1;
  const y = d3.scaleLinear().domain([0, maxMed * 1.2]).range([h, 0]);

  g.selectAll("rect").data(bucketData).join("rect")
    .attr("x", d => x(d.label))
    .attr("y", d => y(d.med))
    .attr("width", x.bandwidth())
    .attr("height", d => h - y(d.med))
    .attr("fill", (d, i) => i === 0 ? "var(--accent)" : "var(--alive)")
    .attr("opacity", 0.8);

  // n labels above bars
  g.selectAll("text.n-label").data(bucketData).join("text")
    .attr("class", "n-label")
    .attr("x", d => x(d.label) + x.bandwidth() / 2)
    .attr("y", d => y(d.med) - 6)
    .attr("text-anchor", "middle")
    .attr("fill", "var(--ink-dim)").attr("font-family", "var(--mono)").attr("font-size", 9)
    .text(d => "n=" + d.n);

  // Value labels on bars
  g.selectAll("text.val-label").data(bucketData).join("text")
    .attr("class", "val-label")
    .attr("x", d => x(d.label) + x.bandwidth() / 2)
    .attr("y", d => y(d.med) + 14)
    .attr("text-anchor", "middle")
    .attr("fill", "var(--bg)").attr("font-family", "var(--mono)").attr("font-size", 10)
    .attr("font-weight", "500")
    .text(d => d3.format(".1%")(d.med));

  g.append("g").attr("transform", `translate(0,${h})`)
    .call(d3.axisBottom(x).tickSize(0))
    .select(".domain").remove();
  g.append("g").call(d3.axisLeft(y).ticks(4).tickFormat(d3.format(".0%")))
    .select(".domain").remove();

  g.append("text").attr("x", w / 2).attr("y", h + 38)
    .attr("text-anchor", "middle").attr("fill", "var(--ink-dim)")
    .attr("font-family", "var(--mono)").attr("font-size", 10)
    .text("Launch price (USD)");
  g.append("text").attr("transform", "rotate(-90)")
    .attr("x", -h / 2).attr("y", -44)
    .attr("text-anchor", "middle").attr("fill", "var(--ink-dim)")
    .attr("font-family", "var(--mono)").attr("font-size", 10)
    .text("Median alive ratio");

  svg.selectAll(".tick line").attr("stroke", "var(--rule-strong)");
  svg.selectAll(".tick text").attr("fill", "var(--ink-dim)").attr("font-family", "var(--mono)").attr("font-size", 10);
}

// --- Outro CTA ---
function wireOutroCTA() {
  document.getElementById("cta-sandbox-cases")?.addEventListener("click", () => {
    CASE_STUDY_IDS.forEach(id => {
      if (GAMES_DATA.find(g => g.id === id)) state.selectedIds.add(id);
    });
    updateSelectionUI();
    switchView("sandbox");
  });
}

// Redraw on resize
let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    d3.select("#main-chart").selectAll("*").remove();
    initChart();
    update();

    if (state.view === "sandbox") {
      sandbox.initialized = false;
      initSandbox();
      renderSandbox();
      ts.initialized = false;
      initTimeSeries();
      renderTimeSeries();
    }

    if (state.view === "analysis") {
      ["act1-chart","act2-chart","act3-chart","act-genre-chart","act-critic-chart",
       "act4-chart","act-drop-chart","act-price-chart","act5-chart","act6-chart"].forEach(id => {
        d3.select(`#${id}`).selectAll("*").remove();
      });
      d3.select("#act2-cards").selectAll("*").remove();
      d3.select("#act5-legend").selectAll("*").remove();
      analysis.initialized = false;
      renderAnalysisView();
    }
  }, 200);
});
