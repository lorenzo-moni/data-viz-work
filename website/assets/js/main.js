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
    .attr("cx", (d) => chart.xScale(d.year + 0.5))
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
    .attr("cx", (d) => chart.xScale(d.year + 0.5))
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
  update();
});

// ==========================================================
// SELECTION UI (tray + nav state)
// ==========================================================

function updateSelectionUI() {
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
      (enter) =>
        enter
          .append("div")
          .attr("class", "tray-chip")
          .text((d) => d.name),
      (update) => update.text((d) => d.name),
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
      (update) => update.select(".sel-name").text((d) => d.name),
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
};

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
  initChart();
  update();
  updateSelectionUI();
});

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
    }
  }, 200);
});
