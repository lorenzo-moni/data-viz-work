// MAIN ORCHESTRATOR

// Populated asynchronously by loadGameData() before any chart renders
let GAMES_DATA = [];
let ALL_GENRES = [];
let ALL_PLATFORMS = [];

const state = {
  view: "landscape",
  yearRange: [2012, 2018],
  genres: new Set(),
  minRating: 2.5,
  platforms: new Set(),
  selectedIds: new Set(),
  hoveredId: null,
};

// View Router
function switchView(targetView) {
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

d3.selectAll("[data-view]").on("click", function () {
  switchView(this.dataset.view);
});

// SELECTION UI (tray + nav state)
// ==========================================================

const markedForRemoval = new Set();

function updateMarkedButton() {
  const n = markedForRemoval.size;
  d3.select("#remove-marked")
    .classed("hidden", n === 0)
    .text(`Remove ${n}`);
}

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
  for (const id of [...markedForRemoval]) {
    if (!state.selectedIds.has(id)) markedForRemoval.delete(id);
  }
  updateMarkedButton();
  const count = state.selectedIds.size;

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
          .text("x")
          .on("click", (_ev, d) => {
            markedForRemoval.delete(d.id);
            state.selectedIds.delete(d.id);
            updateMarkedButton();
            updateSelectionUI();
            if (state.view === "sandbox") renderSandbox();
            if (state.view === "main") update();
          });
        e.on("click", (event, d) => {
          if (event.target.classList.contains("sel-remove")) return;
          if (event.metaKey || event.ctrlKey) {
            const chip = d3.select(event.currentTarget);
            if (markedForRemoval.has(d.id)) {
              markedForRemoval.delete(d.id);
              chip.classed("chip-marked", false);
            } else {
              markedForRemoval.add(d.id);
              chip.classed("chip-marked", true);
            }
            updateMarkedButton();
          }
        });
        return e;
      },
      (update) => {
        update
          .select(".chip-swatch")
          .style("background", (d) => colorForGame(d.id));
        update.select(".sel-name").text((d) => d.name);
        update.classed("chip-marked", (d) => markedForRemoval.has(d.id));
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
  markedForRemoval.clear();
  updateMarkedButton();
  updateSelectionUI();
  renderSandbox();
  if (state.view === "main") update();
});

d3.select("#remove-marked").on("click", () => {
  markedForRemoval.forEach((id) => state.selectedIds.delete(id));
  markedForRemoval.clear();
  updateMarkedButton();
  updateSelectionUI();
  if (state.view === "sandbox") renderSandbox();
  if (state.view === "main") update();
});

d3.select("#sandbox-reset").on("click", () => {
  state.selectedIds.clear();
  markedForRemoval.clear();
  updateMarkedButton();
  sandbox.xField = "completion_rate";
  sandbox.yField = "alive_ratio";
  sandbox.colorField = "genre";
  sandbox.sizeField = "none";
  d3.select("#sandbox-x").property("value", "completion_rate");
  d3.select("#sandbox-y").property("value", "alive_ratio");
  d3.select("#sandbox-color").property("value", "genre");
  d3.select("#sandbox-size").property("value", "none");
  if (sandbox.svg && sandbox.zoom)
    sandbox.svg.transition().duration(300).call(sandbox.zoom.transform, d3.zoomIdentity);
  if (ts.svg && ts.zoom)
    ts.svg.transition().duration(300).call(ts.zoom.transform, d3.zoomIdentity);
  updateSelectionUI();
  renderSandbox();
  updateSandboxDescriptions();
});

// ==========================================================
// UPDATE + BOOTSTRAP
// ==========================================================

function rerenderAll() {
  if (state.view === "main") update();
  if (state.view === "sandbox") {
    updateSelectionUI();
    renderSandbox();
    renderTimeSeries();
  }
  if (state.view === "analysis") {
    analysis.initialized = false;
    renderAnalysisView();
  }
}

function update() {
  const filtered = getFilteredGames();
  d3.select("#visible-count").text(filtered.length);
  renderChart(filtered);
}

d3.select("#cb-toggle").on("click", () => {
  setColorblindMode(!CB_MODE);
});

document.addEventListener("DOMContentLoaded", async () => {
  const games = await loadGameData();
  GAMES_DATA = games;
  // Apply CB palette after domain is set by loadGameData
  if (CB_MODE) _rebuildAliveScale();
  ALL_GENRES = [...new Set(games.flatMap((g) => g.genres))].sort();
  ALL_PLATFORMS = [...new Set(games.flatMap((g) => g.platforms))].sort();

  setupGenreChips();
  setupPlatformChips();
  setupSliders();
  setupSearch();
  initChart();
  update();
  updateSelectionUI();

  const cbBtn = document.getElementById("cb-toggle");
  if (cbBtn) cbBtn.setAttribute("aria-pressed", CB_MODE ? "true" : "false");

  const validViews = ["main", "sandbox", "analysis"];
  const hash = window.location.hash.replace("#", "");
  if (validViews.includes(hash)) switchView(hash);
});
