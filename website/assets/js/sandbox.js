// ==========================================================
// SANDBOX — § 02 The Sandbox (scatter + time series)
// ==========================================================

const sandbox = {
  svg: null,
  g: null,
  xScale: null,
  yScale: null,
  zoom: null,
  width: 0,
  height: 0,
  margin: { top: 30, right: 40, bottom: 60, left: 80 },
  xField: "completion_rate",
  yField: "alive_ratio",
  colorField: "genre",
  colorByGameId: new Map(),
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
  svg.append("defs").append("clipPath")
    .attr("id", "sandbox-clip")
    .append("rect")
    .attr("width", sandbox.width)
    .attr("height", sandbox.height);

  sandbox.g.append("g").attr("class", "sandbox-points").attr("clip-path", "url(#sandbox-clip)");

  sandbox.zoom = d3.zoom()
    .scaleExtent([1, 20])
    .translateExtent([[0, 0], [sandbox.width, sandbox.height]])
    .extent([[0, 0], [sandbox.width, sandbox.height]])
    .on("zoom", onSandboxZoom);

  svg.call(sandbox.zoom);
  svg.on("dblclick.zoom", () => {
    svg.transition().duration(300).call(sandbox.zoom.transform, d3.zoomIdentity);
  });

  sandbox.initialized = true;
}

function onSandboxZoom(event) {
  if (!sandbox.xScale || !sandbox.yScale) return;
  const t = event.transform;
  const xz = t.rescaleX(sandbox.xScale);
  const yz = t.rescaleY(sandbox.yScale);

  function sandboxFmtZoom(field) {
    if (LOG_FIELDS.has(field)) {
      return (d) => {
        if (d >= 1e6) return (d / 1e6).toFixed(1) + "M";
        if (d >= 1e3) return (d / 1e3).toFixed(0) + "k";
        return d;
      };
    }
    return (d) => (Math.abs(d) < 1 && d !== 0 ? d.toFixed(2) : d);
  }

  sandbox.g.select(".axis-x").call(
    d3.axisBottom(xz).ticks(6).tickFormat(sandboxFmtZoom(sandbox.xField)),
  );
  sandbox.g.select(".axis-y").call(
    d3.axisLeft(yz).ticks(6).tickFormat(sandboxFmtZoom(sandbox.yField)),
  );

  sandbox.g.selectAll(".sandbox-point")
    .select("circle")
    .attr("cx", (d) => xz(d[sandbox.xField]))
    .attr("cy", (d) => yz(d[sandbox.yField]));
  sandbox.g.selectAll(".sandbox-point")
    .select("text")
    .attr("x", (d) => xz(d[sandbox.xField]) + 14)
    .attr("y", (d) => yz(d[sandbox.yField]) + 4);
}

const FIELD_LABELS = {
  completion_rate: "Completion rate",
  alive_ratio: "Alive ratio",
  drop_rate: "Drop rate",
  rating: "Rating",
  metacritic: "Metacritic",
  year: "Release year",
  price: "Price (USD)",
  avg_players: "Avg players",
  peak_players: "Peak players",
  current_players: "Current players",
  youtube_count: "YouTube videos",
  engagement_total: "Total engagement",
  ratings_count: "# of ratings",
};

const LOG_FIELDS = new Set([
  "peak_players", "avg_players", "current_players",
  "youtube_count", "engagement_total", "ratings_count",
]);

const FIELD_DESCRIPTIONS = {
  completion_rate:   'Share of RAWG players who marked the game as "beaten". Most meaningful for story-driven titles.',
  alive_ratio:       'Share of engaged players still actively playing vs. those who finished or dropped it. The headline "still-alive" signal.',
  drop_rate:         "Share of RAWG players who abandoned the game before finishing it.",
  rating:            "Average user rating from RAWG, on a 0–5 scale.",
  metacritic:        "Aggregated Metacritic critic score, 0–100.",
  year:              "Calendar year of the Steam release.",
  price:             "Current Steam price in USD.",
  avg_players:       "Mean monthly concurrent players over the game's full SteamCharts history (log scale).",
  peak_players:      "All-time peak of monthly concurrent players on Steam (log scale).",
  current_players:   "Concurrent players in the most recent SteamCharts month (log scale).",
  youtube_count:     "Number of YouTube videos referencing the game — a proxy for cultural footprint (log scale).",
  engagement_total:  "Total RAWG players who tagged the game as playing, beaten, or dropped (log scale).",
  ratings_count:     "Number of RAWG user ratings — a proxy for audience size (log scale).",
  color_genre:       "Each dot is tinted by its primary RAWG genre.",
  color_alive_ratio: "Red → orange → green gradient mapping current vitality.",
  color_year:        "Viridis gradient from 2012 (dark purple) to 2025 (yellow).",
};

const COLOR_LABELS = {
  genre:       "Primary genre",
  alive_ratio: "Alive ratio gradient",
  year:        "Release year gradient",
};

function updateSandboxDescriptions() {
  d3.select("#desc-x-label").text(`X-axis selected: ${FIELD_LABELS[sandbox.xField]}`);
  d3.select("#desc-x-body").text(FIELD_DESCRIPTIONS[sandbox.xField] || "");
  d3.select("#desc-y-label").text(`Y-axis selected: ${FIELD_LABELS[sandbox.yField]}`);
  d3.select("#desc-y-body").text(FIELD_DESCRIPTIONS[sandbox.yField] || "");
  d3.select("#desc-color-label").text(`Color by selected: ${COLOR_LABELS[sandbox.colorField]}`);
  d3.select("#desc-color-body").text(FIELD_DESCRIPTIONS[`color_${sandbox.colorField}`] || "");
}

function renderSandbox() {
  if (!sandbox.initialized) return;
  if (sandbox.zoom) sandbox.svg.call(sandbox.zoom.transform, d3.zoomIdentity);

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
      const pad = Math.abs(lo) > 0.01 ? Math.abs(lo) * 0.5 : 0.1;
      lo -= pad;
      hi += pad;
    } else {
      const span = hi - lo;
      lo -= span * 0.15;
      hi += span * 0.15;
    }
    if (isLog) lo = Math.max(1, lo);
    return [lo, hi];
  }

  if (LOG_FIELDS.has(sandbox.xField)) {
    const [lo, hi] = paddedDomain(xVals, true);
    sandbox.xScale = d3
      .scaleLog()
      .domain([Math.max(1, lo), Math.max(10, hi)])
      .range([0, sandbox.width])
      .clamp(true);
  } else {
    sandbox.xScale = d3
      .scaleLinear()
      .domain(paddedDomain(xVals))
      .range([0, sandbox.width]);
  }

  if (LOG_FIELDS.has(sandbox.yField)) {
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
      .range(["#e6a356", "#7fc97f", "#d96c6c", "#a5b1e4", "#ddb892", "#c8a2d6"]);
  } else if (sandbox.colorField === "alive_ratio") {
    colorScale = d3
      .scaleLinear()
      .domain([0, 0.15, 0.3])
      .range(["#d96c6c", "#e6a356", "#7fc97f"]);
  } else {
    colorScale = d3.scaleSequential(d3.interpolateViridis).domain([2012, 2025]);
  }

  function sandboxFmt(field) {
    if (LOG_FIELDS.has(field)) {
      return (d) => {
        if (d >= 1e6) return (d / 1e6).toFixed(1) + "M";
        if (d >= 1e3) return (d / 1e3).toFixed(0) + "k";
        return d;
      };
    }
    return (d) => (Math.abs(d) < 1 && d !== 0 ? d.toFixed(2) : d);
  }

  sandbox.g
    .select(".axis-x")
    .transition()
    .duration(400)
    .call(d3.axisBottom(sandbox.xScale).ticks(6).tickFormat(sandboxFmt(sandbox.xField)));
  sandbox.g
    .select(".axis-y")
    .transition()
    .duration(400)
    .call(d3.axisLeft(sandbox.yScale).ticks(6).tickFormat(sandboxFmt(sandbox.yField)));

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
  updateSandboxDescriptions();
}

d3.selectAll("#sandbox-x, #sandbox-y, #sandbox-color").on(
  "change",
  function () {
    if (this.id === "sandbox-x") sandbox.xField = this.value;
    if (this.id === "sandbox-y") sandbox.yField = this.value;
    if (this.id === "sandbox-color") sandbox.colorField = this.value;
    updateSandboxDescriptions();
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
  zoom: null,
  width: 0,
  height: 0,
  margin: { top: 10, right: 24, bottom: 28, left: 56 },
  initialized: false,
};

function initTimeSeries() {
  const svg = d3.select("#sandbox-ts");
  const bbox = svg.node().getBoundingClientRect();
  if (bbox.width === 0 || bbox.height === 0) {
    ts.initialized = false;
    return;
  }

  ts.width = bbox.width - ts.margin.left - ts.margin.right;
  ts.height = bbox.height - ts.margin.top - ts.margin.bottom;
  ts.svg = svg;
  svg.selectAll("*").remove();

  ts.g = svg
    .append("g")
    .attr("transform", `translate(${ts.margin.left},${ts.margin.top})`);
  ts.g
    .append("g")
    .attr("class", "axis axis-x")
    .attr("transform", `translate(0,${ts.height})`);
  ts.g.append("g").attr("class", "axis axis-y");
  ts.g.append("g").attr("class", "grid grid-y");
  svg.append("defs").append("clipPath")
    .attr("id", "ts-clip")
    .append("rect")
    .attr("width", ts.width)
    .attr("height", ts.height);

  ts.g.append("g").attr("class", "ts-lines").attr("clip-path", "url(#ts-clip)");

  ts.zoom = d3.zoom()
    .scaleExtent([1, 40])
    .translateExtent([[0, 0], [ts.width, ts.height]])
    .extent([[0, 0], [ts.width, ts.height]])
    .on("zoom", onTsZoom);

  svg.call(ts.zoom);
  svg.on("dblclick.zoom", () => {
    svg.transition().duration(300).call(ts.zoom.transform, d3.zoomIdentity);
  });

  ts.initialized = true;
}

function onTsZoom(event) {
  if (!ts.xScale || !ts.yScale) return;
  const t = event.transform;
  const xz = t.rescaleX(ts.xScale);
  const yz = t.rescaleY(ts.yScale);

  ts.g.select(".axis-x").call(
    d3.axisBottom(xz).ticks(6).tickFormat(d3.timeFormat("%Y")),
  );
  ts.g.select(".axis-y").call(
    d3.axisLeft(yz).ticks(5, "~s"),
  );
  ts.g.select(".grid-y")
    .call(d3.axisLeft(yz).ticks(5).tickSize(-ts.width).tickFormat(""))
    .selectAll("text").remove();

  const line = d3.line()
    .x((d) => xz(new Date(d.month)))
    .y((d) => yz(Math.max(1, d.players)))
    .defined((d) => d.players > 0)
    .curve(d3.curveMonotoneX);

  ts.g.select(".ts-lines").selectAll("path.ts-line")
    .attr("d", (d) => line(d.series));
}

function renderTimeSeries() {
  if (!ts.initialized) return;
  if (ts.zoom) ts.svg.call(ts.zoom.transform, d3.zoomIdentity);

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
  ts.xScale = d3
    .scaleTime()
    .domain(d3.extent(allPoints, (d) => new Date(d.month)))
    .range([0, ts.width]);

  const maxPlayers = d3.max(allPoints, (d) => d.players) || 10;
  ts.yScale = d3
    .scaleLog()
    .domain([1, maxPlayers * 1.3])
    .range([ts.height, 0])
    .clamp(true);

  ts.g
    .select(".axis-x")
    .transition()
    .duration(400)
    .call(d3.axisBottom(ts.xScale).ticks(6).tickFormat(d3.timeFormat("%Y")));

  ts.g
    .select(".axis-y")
    .transition()
    .duration(400)
    .call(d3.axisLeft(ts.yScale).ticks(5, "~s"));

  ts.g
    .select(".grid-y")
    .transition()
    .duration(400)
    .call(d3.axisLeft(ts.yScale).ticks(5).tickSize(-ts.width).tickFormat(""))
    .selectAll("text")
    .remove();

  const line = d3
    .line()
    .x((d) => ts.xScale(new Date(d.month)))
    .y((d) => ts.yScale(Math.max(1, d.players)))
    .defined((d) => d.players > 0)
    .curve(d3.curveMonotoneX);

  const lines = ts.g
    .select(".ts-lines")
    .selectAll("path.ts-line")
    .data(selected, (d) => d.id);

  lines.exit().remove();

  lines
    .enter()
    .append("path")
    .attr("class", "ts-line")
    .attr("stroke", (d) => colorForGame(d.id))
    .merge(lines)
    .attr("stroke", (d) => colorForGame(d.id))
    .on("mouseover", function (_event, d) {
      ts.g.selectAll("path.ts-line").classed("dimmed", (o) => o.id !== d.id);
      d3.select(this).classed("focused", true).classed("dimmed", false);
    })
    .on("mouseout", function () {
      ts.g
        .selectAll("path.ts-line")
        .classed("dimmed", false)
        .classed("focused", false);
    })
    .transition()
    .duration(500)
    .attr("d", (d) => line(d.series));
}
