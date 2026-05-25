// ==========================================================
// BOOKMARKS - save/restore named sandbox views in localStorage
// ==========================================================

const BOOKMARKS_KEY = "mobava_bookmarks_v1";

function listBookmarks() {
  try {
    return JSON.parse(localStorage.getItem(BOOKMARKS_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveBookmark(name) {
  if (!name.trim()) return;
  const bookmarks = listBookmarks();
  bookmarks.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2),
    name: name.trim(),
    selectedIds: [...state.selectedIds],
    x: sandbox.xField,
    y: sandbox.yField,
    color: sandbox.colorField,
    size: sandbox.sizeField,
    createdAt: new Date().toISOString(),
  });
  localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(bookmarks));
  renderBookmarks();
}

function applyBookmark(id) {
  const bm = listBookmarks().find((b) => b.id === id);
  if (!bm) return;
  state.selectedIds.clear();
  bm.selectedIds.forEach((sid) => {
    if (GAMES_DATA.find((g) => g.id === sid)) state.selectedIds.add(sid);
  });
  sandbox.xField = bm.x;
  sandbox.yField = bm.y;
  sandbox.colorField = bm.color;
  sandbox.sizeField = bm.size || "none";
  d3.select("#sandbox-x").property("value", bm.x);
  d3.select("#sandbox-y").property("value", bm.y);
  d3.select("#sandbox-color").property("value", bm.color);
  d3.select("#sandbox-size").property("value", bm.size || "none");
  updateSelectionUI();
  if (sandbox.initialized) renderSandbox();
  updateSandboxDescriptions();
}

function deleteBookmark(id) {
  const updated = listBookmarks().filter((b) => b.id !== id);
  localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(updated));
  renderBookmarks();
}

function renderBookmarks() {
  const bookmarks = listBookmarks();
  const container = document.getElementById("bookmark-chips");
  if (!container) return;

  d3.select(container)
    .selectAll(".bookmark-chip")
    .data(bookmarks, (d) => d.id)
    .join(
      (enter) => {
        const chip = enter.append("div").attr("class", "bookmark-chip");
        chip
          .append("span")
          .attr("class", "bookmark-name")
          .on("click", (_, d) => applyBookmark(d.id));
        chip
          .append("button")
          .attr("class", "bookmark-remove")
          .text("×")
          .on("click", (_, d) => deleteBookmark(d.id));
        return chip;
      },
      (update) => update,
      (exit) => exit.remove(),
    )
    .select(".bookmark-name")
    .text((d) => d.name);
}
