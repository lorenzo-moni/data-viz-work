// LANDSCAPE VIEW

const chart = {
  svg: null,
  g: null,
  xScale: null,
  yScale: null,
  rScale: null,
  zoom: null,
  width: 0,
  height: 0,
  margin: { top: 30, right: 40, bottom: 60, left: 80 },
};

function initChart() {
  const svg = d3.select("#main-chart");
  svg.selectAll("*").remove();
  const bbox = svg.node().getBoundingClientRect();
  chart.width = bbox.width - chart.margin.left - chart.margin.right;
  chart.height = bbox.height - chart.margin.top - chart.margin.bottom;

  chart.svg = svg;
  chart.g = svg
    .append("g")
    .attr("transform", `translate(${chart.margin.left},${chart.margin.top})`);

  svg
    .append("defs")
    .append("clipPath")
    .attr("id", "landscape-clip")
    .append("rect")
    .attr("width", chart.width)
    .attr("height", chart.height);

  chart.xScale = d3.scaleLinear().range([0, chart.width]);
  chart.yScale = d3.scaleLog().range([chart.height, 0]).clamp(true);
  chart.rScale = d3.scaleSqrt().range([6, 30]);
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
    .text("Release Year");

  chart.g
    .append("text")
    .attr("class", "axis-label")
    .attr("transform", "rotate(-90)")
    .attr("x", -chart.height / 2)
    .attr("y", -60)
    .attr("text-anchor", "middle")
    .text("average monthly players");

  chart.g
    .append("g")
    .attr("class", "bubbles")
    .attr("clip-path", "url(#landscape-clip)");

  chart.zoom = d3
    .zoom()
    .scaleExtent([1, 20])
    .translateExtent([
      [0, 0],
      [chart.width, chart.height],
    ])
    .extent([
      [0, 0],
      [chart.width, chart.height],
    ])
    .on("start.tooltip", () => tooltip.classed("visible", false))
    .on("start.cursor", (e) => {
      if (
        !(e.sourceEvent instanceof WheelEvent) &&
        d3.zoomTransform(chart.svg.node()).k > 1
      )
        chart.svg.classed("is-dragging", true);
    })
    .on("end.cursor", () => chart.svg.classed("is-dragging", false))
    .on("zoom", onChartZoom);

  svg.call(chart.zoom);
  svg.on("dblclick.zoom", () => {
    svg.transition().duration(300).call(chart.zoom.transform, d3.zoomIdentity);
  });

  setupChartToolbar({
    wrapEl: document.querySelector(".chart-wrap"),
    svgEl: svg.node(),
    chartObj: chart,
    reinit: () => {
      initChart();
      update();
    },
    hasOverlayPanel: true,
  });
}

function onChartZoom(event) {
  const t = event.transform;
  chart.svg.classed("is-zoomed", t.k > 1);
  const xz = t.rescaleX(chart.xScale);
  const yz = t.rescaleY(chart.yScale);

  chart.g.select(".axis-x").call(
    d3
      .axisBottom(xz)
      .tickFormat(d3.format("d"))
      .ticks(Math.min(10, state.yearRange[1] - state.yearRange[0])),
  );
  chart.g.select(".axis-y").call(
    d3
      .axisLeft(yz)
      .ticks(6)
      .tickFormat((d) => {
        if (d >= 1e6) return (d / 1e6).toFixed(1) + "M";
        if (d >= 1e3) return (d / 1e3).toFixed(0) + "k";
        return d;
      }),
  );
  chart.g
    .select(".grid-y")
    .call(d3.axisLeft(yz).ticks(6).tickSize(-chart.width).tickFormat(""))
    .selectAll("text")
    .remove();

  chart.g
    .selectAll("circle.bubble")
    .attr("cx", (d) => xz(d.year + (d.release_month + 0.5) / 12))
    .attr("cy", (d) => yz(Math.max(100, d.avg_players)));
}

function renderChart(games) {
  if (chart.zoom) chart.svg.call(chart.zoom.transform, d3.zoomIdentity);
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
    .attr("fill", (d) => ALIVE_SCALE(d.alive_ratio))
    .style("opacity", 0)
    .on("click", onBubbleClick);

  enter
    .merge(bubbles)
    .classed("selected", (d) => state.selectedIds.has(d.id))
    .transition()
    .duration(500)
    .attr("cx", (d) => chart.xScale(d.year + (d.release_month + 0.5) / 12))
    .attr("cy", (d) => chart.yScale(Math.max(100, d.avg_players)))
    .attr("r", (d) => chart.rScale(d.peak_players))
    .attr("fill", (d) => ALIVE_SCALE(d.alive_ratio))
    .style("opacity", 0.85);
}

// INTERACTIONS

const tooltip = d3.select("#tooltip");

function onHover(event, d) {
  const wrap = document.querySelector(".chart-wrap");
  const [mx, my] = d3.pointer(event, wrap);

  // Set content first so offsetWidth/Height are accurate
  tooltip.classed("visible", true).html(`
      <div class="tooltip-title">${d.name}</div>
      <div class="tooltip-row"><span>Released</span><span>${d.year}</span></div>
      <div class="tooltip-row"><span>Avg players</span><span>${fmtPlayers(d.avg_players)}</span></div>
      <div class="tooltip-row"><span>Alive ratio</span><span>${(d.alive_ratio * 100).toFixed(0)}%</span></div>
      <div class="tooltip-row"><span>Rating</span><span>${d.rating.toFixed(2)}</span></div>
      <div class="tooltip-hint">click to ${state.selectedIds.has(d.id) ? "deselect" : "select"}</div>
    `);

  const gap = 12;
  const ttW = tooltip.node().offsetWidth;
  const ttH = tooltip.node().offsetHeight;
  const left = mx + gap + ttW > wrap.offsetWidth ? mx - ttW - gap : mx + gap;
  const top = my + gap + ttH > wrap.offsetHeight ? my - ttH - gap : my + gap;

  tooltip.style("left", left + "px").style("top", top + "px");
}

function onHoverOut() {
  tooltip.classed("visible", false);
}

function onBubbleClick(_event, d) {
  showCard(d);
}

// GAME CARD

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
  showCard(game);
  updateSelectionUI();
  if (state.view === "sandbox") renderSandbox();
  else update();
});

// CONTROLS - filters, search, sliders

function setupGenreChips() {
  d3.select("#genre-filters")
    .selectAll(".chip")
    .data(ALL_GENRES)
    .join("button")
    .attr("class", "chip")
    .text((d) => d)
    .on("click", function (_ev, d) {
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
    .on("click", function (_ev, d) {
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
      if (q.length === 0) {
        results.classed("hidden", true);
        return;
      }
      currentMatches = GAMES_DATA.filter((g) =>
        g.name.toLowerCase().includes(q),
      )
        .sort(
          (a, b) => rank(a, q) - rank(b, q) || b.peak_players - a.peak_players,
        )
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
      results
        .selectAll(".search-result-item")
        .data(currentMatches, (d) => d.id)
        .join("div")
        .attr(
          "class",
          (d, i) =>
            "search-result-item" +
            (state.selectedIds.has(d.id) ? " selected-already" : "") +
            (i === activeIdx ? " active" : ""),
        )
        .html(
          (d) =>
            `<span class="search-result-name">${d.name}</span>` +
            `<span class="search-result-meta">${d.year} · ${fmtPlayers(d.peak_players)}${state.selectedIds.has(d.id) ? " · ✓" : ""}</span>`,
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
    input.on("blur", () =>
      setTimeout(() => results.classed("hidden", true), 100),
    );
    input.on("keydown", (event) => {
      if (currentMatches.length === 0) return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        activeIdx = (activeIdx + 1) % currentMatches.length;
        renderResults();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        activeIdx =
          (activeIdx - 1 + currentMatches.length) % currentMatches.length;
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

  // Sync sliders to match state.yearRange (state is the source of truth)
  startEl.property("value", state.yearRange[0]);
  endEl.property("value", state.yearRange[1]);
  d3.select("#time-start").text(state.yearRange[0]);
  d3.select("#time-end").text(state.yearRange[1]);

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
