// ==========================================================
// MAIN — orchestrator: state, router, controls, selection UI, bootstrap
// ==========================================================

// Populated asynchronously by loadGameData() before any chart renders
let GAMES_DATA = [];
let ALL_GENRES = [];
let ALL_PLATFORMS = [];

const state = {
  view: "analysis",
  yearRange: [2012, 2018],
  genres: new Set(),
  minRating: 2.5,
  platforms: new Set(),
  selectedIds: new Set(),
  hoveredId: null,
};

// View Router
function switchView(targetView) {
  if (targetView === "sandbox" && state.selectedIds.size === 0) {
    flashSandboxNav();
    return;
  }
  if (document.fullscreenElement) document.exitFullscreen();
  state.view = targetView;

  d3.selectAll(".view").classed("active", false);
  d3.select(`#view-${targetView}`).classed("active", true);

  d3.selectAll(".nav-item").classed("active", false);
  d3.select(`.nav-item[data-view="${targetView}"]`).classed("active", true);

  d3.select("#selection-tray").classed(
    "hidden",
    targetView !== "main" || state.selectedIds.size === 0,
  );

  d3.select("#game-card").classed("hidden", true);

  if (targetView === "sandbox") {
    requestAnimationFrame(() => {
      if (!sandbox.initialized) initSandbox();
      renderSandbox();
      if (!ts.initialized) initTimeSeries();
      renderTimeSeries();
      updateSandboxDescriptions();
    });
  }

  if (targetView === "analysis") {
    requestAnimationFrame(() => {
      if (!analysis.initialized) renderAnalysisView();
    });
  }

  window.location.hash = targetView;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function flashSandboxNav() {
  const nav = d3.select("#nav-sandbox");
  nav.classed("flash", true);
  setTimeout(() => nav.classed("flash", false), 600);
}

d3.selectAll("[data-view]").on("click", function () {
  switchView(this.dataset.view);
});

// ==========================================================
// SELECTION UI (tray + nav state)
// ==========================================================

const TS_PALETTE = d3.schemeTableau10;

function colorForGame(id) {
  if (!sandbox.colorByGameId.has(id)) {
    const used = new Set(sandbox.colorByGameId.values());
    const free =
      TS_PALETTE.find((c) => !used.has(c)) ||
      TS_PALETTE[sandbox.colorByGameId.size % TS_PALETTE.length];
    sandbox.colorByGameId.set(id, free);
  }
  return sandbox.colorByGameId.get(id);
}

function pruneSelectionColors() {
  for (const id of [...sandbox.colorByGameId.keys()]) {
    if (!state.selectedIds.has(id)) sandbox.colorByGameId.delete(id);
  }
}

function updateSelectionUI() {
  pruneSelectionColors();
  const count = state.selectedIds.size;

  d3.select("#nav-sandbox").classed("disabled", count === 0);

  const tray = d3.select("#selection-tray");
  const showTray = count > 0 && state.view === "main";
  tray.classed("hidden", !showTray);

  d3.select("#tray-count").text(count);
  d3.select("#selection-count").text(count);

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
        update
          .select(".chip-swatch")
          .style("background", (d) => colorForGame(d.id));
        update.select("span:last-child").text((d) => d.name);
        return update;
      },
      (exit) => exit.remove(),
    );

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
          .on("click", (_ev, d) => {
            state.selectedIds.delete(d.id);
            updateSelectionUI();
            if (state.view === "sandbox") renderSandbox();
            if (state.view === "main") update();
          });
        return e;
      },
      (update) => {
        update
          .select(".chip-swatch")
          .style("background", (d) => colorForGame(d.id));
        update.select(".sel-name").text((d) => d.name);
        return update;
      },
      (exit) => exit.remove(),
    );

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

// ==========================================================
// UPDATE + BOOTSTRAP
// ==========================================================

function update() {
  const filtered = getFilteredGames();
  d3.select("#visible-count").text(filtered.length);
  renderChart(filtered);
}

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

  const validViews = ["main", "sandbox", "analysis"];
  const hash = window.location.hash.replace("#", "");
  if (validViews.includes(hash)) switchView(hash);
});
