// UTILS: shared helpers and constants

function fmtPlayers(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(0) + "k";
  return n.toString();
}

// Domain is set dynamically in data.js after computing the population median.
// Placeholder keeps rendering sane if scale is ever read before data loads.
let ALIVE_SCALE = d3
  .scaleLinear()
  .range(["#d96c6c", "#e6a356", "#7fc97f"])
  .clamp(true);

function _rebuildAliveScale() {
  const domain = ALIVE_SCALE.domain();
  if (CB_MODE) {
    ALIVE_SCALE = d3.scaleLinear().domain(domain).range(["#0072B2", "#F0E442", "#D55E00"]).clamp(true);
  } else {
    ALIVE_SCALE = d3.scaleLinear().domain(domain).range(["#d96c6c", "#e6a356", "#7fc97f"]).clamp(true);
  }
}

function setColorblindMode(on) {
  CB_MODE = on;
  localStorage.setItem("mobava_colorblind", on ? "1" : "0");
  _applyCBMode();
  _rebuildAliveScale();
  // Clear cached time-series colors so they re-pick from the new palette
  if (typeof sandbox !== "undefined") sandbox.colorByGameId.clear();
  rerenderAll();
  const btn = document.getElementById("cb-toggle");
  if (btn) btn.setAttribute("aria-pressed", on ? "true" : "false");
}

// Compute binned stats (median, p25, p90) grouped by a numeric key
function binnedStats(games, keyFn, valFn) {
  const byKey = d3.rollup(games, (v) => v.map(valFn), keyFn);
  return Array.from(byKey, ([key, vals]) => {
    const sorted = vals.filter((v) => isFinite(v) && v >= 0).sort(d3.ascending);
    return {
      key,
      median: d3.quantile(sorted, 0.5) || 0,
      p25: d3.quantile(sorted, 0.25) || 0,
      p90: d3.quantile(sorted, 0.9) || 0,
      count: sorted.length,
    };
  }).sort((a, b) => d3.ascending(a.key, b.key));
}

function pearsonR(data, xFn, yFn) {
  const xs = data.map(xFn),
    ys = data.map(yFn);
  const mx = d3.mean(xs),
    my = d3.mean(ys);
  const num = d3.sum(data, (_, i) => (xs[i] - mx) * (ys[i] - my));
  const den = Math.sqrt(
    d3.sum(data, (_, i) => (xs[i] - mx) ** 2) *
      d3.sum(data, (_, i) => (ys[i] - my) ** 2),
  );
  return den === 0 ? 0 : num / den;
}

function showToast(msg) {
  let toast = document.querySelector(".analysis-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "analysis-toast";
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add("visible");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove("visible"), 2200);
}
