# Static Analysis View — 15-Act Narrative on Game Survival

## Context

The website (`Built to Last`) currently has three views routed by `switchView()` in `website/assets/js/main.js`. View 3 (`#view-analysis`) is **completely empty** in HTML (lines 203–205) and `renderAnalysisView()` is referenced at main.js:56 but **never defined**. The existing CSS already contains a full design system for a story narrative (`.story-act`, `.act-label`, `.act-title`, `.story-prose`, `.story-thesis`, `.story-chart-wrap`, `.hero-stat`, `.case-cards`, `.legend-tag.{immortal,slow-burn,fading-aaa,mid}`, etc. at style.css:1263–1510), but no JS or HTML consumes it.

We are throwing out any reference to the current placeholder analysis and rebuilding the third view from scratch as a **15-act guided narrative** (Martini Glass, author-driven) that tells the story of which games survive and which die, computed **live in the browser** from `website/data/rawg_steam_final.csv` and `website/data/steamcharts_final.csv` via the existing `loadGameData()` in `data.js` (no new data files, no Python re-runs).

All analyses are grounded in real findings already verified in `notebooks/rawg_eda.ipynb` and `notebooks/eda_immortal_games.ipynb`:
- 12,207 games surviving the filter; releases peak in 2016 (1,037 titles).
- Median `alive_ratio = 0.041`; median `completion_rate = 9.1%`.
- `completion_rate × alive_ratio` correlation = **−0.175**.
- High-vitality games get **1.5×** more YouTube/year than fading games.
- Two clear genre regimes: high-completion/low-vitality (Puzzle, Adventure, Platformer) vs low-completion/high-vitality (MMO, Sports, Simulation, Strategy).
- Real anchor titles for case studies: **League of Legends, osu!, American Truck Simulator, Brick Rigs, Parkitect, CrossCode, Muse Dash** (immortals); **Star Citizen, Baldur's Gate III, Genshin Impact, Palia, Wuthering Waves** (top mortality index); **Cyberpunk 2077, Fall Guys, New World** (fading AAA candidates — to be confirmed by `peak > 100k AND alive_ratio < 0.08`).

Existing CSS already provides ~250 lines of styling specifically for this view; the work is to author the HTML scaffold + JS analytics + D3 charts that consume it.

---

## The 15 Acts

Each act is a `<section class="story-act">` with a 2-col grid (prose left, chart right). Act 1 is the hero (`act-hero` variant). Act 15 is the outro/CTA, linking back to the sandbox.

**Narrative arc** (Martini Glass, author-driven → reader-driven CTA at the end):
- **Acts 1–3 — Setup**: scope of the graveyard, the flood of releases, the abandonment of completion.
- **Acts 4–5 — First insight**: the paradox + the decay curve.
- **Acts 6–10 — Drivers of survival**: genre lifecycle, immortal DNA, critics vs community, price, platform.
- **Acts 11–13 — Profiles**: the immortals, the fading AAA, the slow burn.
- **Act 14 — Multiplier**: cultural feedback loop (coverage).
- **Act 15 — Verdict**: composite ranking + CTA to sandbox.

Each act has a clearly defined **interactivity level**. Acts 3 and 14 are deliberately mostly static editorial moments.

| # | Title | Thesis | Chart | Interactivity |
|---|---|---|---|---|
| 01 | **The Graveyard** | Of the games we tracked, only ~4% of their engaged players are still active. Most games die. | Hero stat block (3 big numbers) + histogram of `alive_ratio` (log-y), median line annotated. | **High** — Brush horizontally over the histogram. The hero stat block reactively recomputes the count + median for the brushed band. |
| 02 | **The Flood** | Releases peaked in 2016. Most of that cohort is now silent. | Bar chart of releases per year (1995–2025), each bar colored by **median alive_ratio of that cohort today**. | **Medium** — Hover a year → tooltip with cohort size, median alive, top-3 surviving titles. Click a year → side-panel list of all games released that year, scrollable. |
| 03 | **Most Games Are Never Finished** | The median completion rate is 9.1%. Players walk away before the credits. | Two-panel: (a) histogram of `completion_rate` (capped at 0.5), (b) horizontal bar of median completion by genre. | **Low** — Hover tooltips only. "Facts on the table" moment. |
| 04 | **The Completion Paradox** | The games people *finish* aren't the ones that *survive*. Completion and vitality are negatively correlated (r = −0.175). | Scatter: x = `completion_rate`, y = `alive_ratio`; quadrants labeled; regression overlay. | **High** — Drag-rectangle brush selects games; selected count + names appear in side caption. Toggle: "Color by archetype / Color by genre". |
| 05 | **The Decay Curve** | Vitality erodes with age — but the upper tail refuses to die. | Median line + p25–p90 ribbon over years-since-release. | **Medium** — Multi-select genre chips overlay per-genre median curves (max 3). Reset button. |
| 06 | **Genre Lifecycles** | Every genre has its own death curve. Strategy and MMO age like wine; Action ages like milk. | Small multiples: 8 mini-charts, one per top-8 genre, median alive_ratio vs years-since-release. | **High** — Click a mini-chart → expands into focus view with p25–p90 ribbon and game list. Click again to collapse. |
| 07 | **The DNA of Immortality** | Certain genres are over-represented among immortals by double-digit margins. | Lift chart — divergent bars showing genre share-in-immortals minus share-in-mortals. RPG ~+13pp. | **High** — Click a genre bar → side panel shows the actual immortal games in that genre. Toggle: by-genre / by-platform. |
| 08 | **Critics vs Community** | Critic score (Metacritic) barely predicts survival. Community engagement does. | Two-panel scatter: (a) `metacritic` × `alive_ratio`, (b) `rating` × `alive_ratio`. Pearson r on each. | **Medium** — Toggle linear/log y. Click a quadrant → game list filters to that quadrant. |
| 09 | **The Price of Survival** | Free-to-play games dominate survival rankings — but $20 indie hits punch above their weight. | Bar chart: median alive_ratio by price bucket (Free, <$10, $10–30, $30–60, $60+). Cohort sizes annotated. | **Medium** — Dropdown filter by genre. Bars re-rank live with transitions. |
| 10 | **Platforms — Where Survival Lives** | Multi-platform titles survive longer than single-platform titles. | Grouped bar: median alive_ratio by parent_platform × single vs multi-platform. | **Medium** — Toggle archetype filter chips. Falls back to null-finding prose if signal is weak. |
| 11 | **The Immortals** | A handful of pre-2018 games still command more active players than most 2024 releases. | Horizontal bar chart, top 12 pre-2018 games by `alive_ratio`. Each row: name + year + archetype tag. | **High** — Sortable by alive / peak / age. Click a row → add to `state.selectedIds`, flash nav, show toast. |
| 12 | **The Fading AAA** | Massive launches don't guarantee longevity. The bottom-right quadrant is where the dream dies. | Scatter: x = `peak_players` (log), y = `alive_ratio`; bottom-right region highlighted; 4 fading-AAA case cards. | **High** — Drag-brush selects games; case cards update to selection's top 4 by peak. |
| 13 | **The Slow Burn** | Small launches, loyal communities. Niche games can out-live their flashier peers. | Small multiples: 6 monthly time-series for top-6 slow-burn anchors. Shared log y-axis. | **Medium** — Hover any panel → vertical guideline syncs across all 6 panels. Coordinated views. |
| 14 | **The Coverage Multiplier** | Cultural memory compounds: surviving games get 1.5× more YouTube/year. | Side-by-side KDE distributions of `youtube_per_year` by vitality cohort. | **Low** — Hover for median values only. |
| 15 | **The Verdict** | Survival isn't luck. It's genre design + community gravity + "playable forever" mechanics + cultural feedback. | Interactive ranked list of top 25 games by composite mortality index (0–100). Each row: rank, name, year, archetype tag, index bar, inline sparkline. | **High** — Sortable columns. Click a row → adds to `state.selectedIds` and routes to sandbox. CTA button: `Continue the inquiry →`. |

The Martini Glass closes at Act 15: the user is handed back to the **Sandbox** with a one-click CTA, calling `switchView('sandbox')` and seeding `state.selectedIds` with the top-1 immortal.

**Note on Acts 9 & 10**: exploratory — the data signal hasn't been verified. If the live data shows no meaningful effect, the act is reframed as a "null finding" (with prose explaining *why*) rather than dropped.

---

## Guided Discovery — Instructional copy for High-interactivity acts

A high-interactivity act risks failing the reader: they see a chart, don't know what to do, and walk away without the insight. Every High-interactivity act (1, 4, 6, 7, 11, 12, 15) includes a **guided-discovery block** placed just below the chart, styled with `.story-guide`:

```html
<div class="story-guide">
  <div class="guide-eyebrow">↳ Try this</div>
  <p class="guide-instruction">{{ how to interact }}</p>
  <p class="guide-expected">{{ what they should see }}</p>
</div>
```

CSS (additive to style.css):
```css
.story-guide { 
  margin-top: 16px; padding: 16px 18px;
  border-left: 2px solid var(--accent); 
  background: rgba(230,163,86,0.04);
}
.guide-eyebrow { font: 10px var(--mono); text-transform: uppercase; letter-spacing: 0.12em; color: var(--accent); margin-bottom: 6px; }
.guide-instruction { font-size: 15px; color: var(--ink); margin: 0 0 4px; }
.guide-expected { font-size: 14px; color: var(--ink-dim); font-style: italic; margin: 0; }
```

After the user performs the action, the block fades to `opacity: 0.4`. Reset button restores it.

### Per-act guided-discovery copy

- **Act 1**: Drag a band across the **right half** of the histogram (alive_ratio > 0.10). → The hero stats collapse to ~600–800 games — the entire "still-alive" population fits in a sliver of the distribution.
- **Act 4**: Drag a box around the **upper-left quadrant** (completion < 0.10, alive > 0.20). → 20–30 MMOs, simulation, and strategy titles appear. Now drag the upper-right: nearly empty. Finishing and surviving rarely coexist.
- **Act 6**: Click **Strategy**, then **Action**. → Strategy's curve barely bends. Action falls off a cliff after year 3.
- **Act 7**: Click the **RPG** bar (longest green). → 10+ pre-2018 RPGs still alive today. Then click the longest red bar: mostly empty.
- **Act 11**: Click `By Peak`, then `By Alive`. → The order completely reshuffles. Peak ≠ longevity. Then click any row to bring it into the sandbox.
- **Act 12**: Drag a box around the **highlighted bottom-right band** (peak > 100k, alive < 0.05). → The 4 case cards populate with the most spectacular fade-outs.
- **Act 15**: Sort `By Coverage`. Compare against the default `By Index` ranking. → Top 25 by index and by coverage overlap by 70%+. Click any row to challenge the verdict in the sandbox.

Medium-interactivity acts (2, 5, 8, 9, 10, 13) use a single-line `.story-caption` hint instead.

---

## Files to Modify

### `website/index.html` — replace empty `#view-analysis` (lines 202–205)
Add a `<div class="view-container">` wrapper, a `.view-header` with §03 numbering, then 15 `<section class="story-act">` blocks (each with `data-act="N"`, `.act-label`, `.act-title`, `.story-prose`, `.story-thesis`, `.story-chart-wrap > svg`). Act 1 gets the `act-hero` variant. The outro is a `.story-outro` block.

Each act's `<svg>` gets a stable id: `#act-1-chart` … `#act-15-list`. Act 15 is an HTML `<ol>`, not an SVG. Acts 6 and 13 use a `.act-multiples` grid of mini-SVGs.

### `website/assets/js/main.js` — add the analysis module (~after line 940)

```js
const analysis = {
  initialized: false,
  acts: {},  // act-N → { svg, g, scales, width, height, margin, state }
  observer: null,
};

function renderAnalysisView() { /* scaffold + IntersectionObserver, init Act 1 eagerly */ }
function initAct1()  { /* hero stats + alive_ratio histogram + brushX */ }
function initAct2()  { /* releases-per-year bars + hover/click drilldown */ }
function initAct3()  { /* two-panel static: completion histogram + genre bars */ }
function initAct4()  { /* completion×alive scatter + brush + color toggle */ }
function initAct5()  { /* decay curve area + genre chip overlays */ }
function initAct6()  { /* genre lifecycles small multiples + click-to-expand */ }
function initAct7()  { /* DNA lift chart + click drilldown + genre/platform toggle */ }
function initAct8()  { /* critics×community two-panel scatter + quadrant click */ }
function initAct9()  { /* price-bucket bars + genre dropdown filter */ }
function initAct10() { /* platform grouped bar + archetype chip toggle */ }
function initAct11() { /* immortals bar chart + sort chips + row click */ }
function initAct12() { /* fading AAA scatter + brush + case cards */ }
function initAct13() { /* slow burn small multiples + coordinated hover */ }
function initAct14() { /* coverage KDE two curves (static) */ }
function initAct15() { /* mortality index ranked list + sort + CTA */ }
```

Each act follows the existing lifecycle pattern from `initChart` (main.js:269–315):
1. Select svg, read `getBoundingClientRect()`, bail if 0.
2. Compute `width/height` minus margins, store on `analysis.acts[N]`.
3. Append translated `<g>`, build scales, append axis groups, draw geometry.

Reusable helpers (new, kept small):
- `ARCHETYPE_COLOR = { immortal: '#7fc97f', slow_burn: '#8ab4ff', fading_aaa: '#d96c6c', mid: '#a69a8c' }`
- `byCohort(games, accessor, yearFn, fn)` — group by release-year, return median/p25/p90 per bucket
- `immortalsTop(n)`, `fadingAAATop(n)`, `slowBurnTop(n)` — filter+sort subsets
- `mortalityIndex(g)` — composite score, min-max normalized across all games
- `quadrantBrush(svg, scales, onChange)` — reused by Acts 4, 12
- `genreChips(container, onToggle)` — reused by Acts 5, 6, 9
- `archetypeChips(container, onToggle)` — Act 10
- `gameRow(g)` — name + year + archetype tag + bar, reused by Acts 2, 11, 15
- `coordinatedHover(panels)` — Act 13

Reuse without re-implementing: `fmtPlayers()` (line 931), diverging color scale (line 283), tooltip pattern, `colorForGame()`/`TS_PALETTE` (line 579).

Trigger: `switchView("analysis")` at main.js:54–58 already calls `renderAnalysisView()` inside `requestAnimationFrame` — the wiring is there. Acts 2–15 init lazily via IntersectionObserver.

### `website/assets/css/style.css` — additive only
New rules needed:
```css
/* Small multiples grid (Acts 6, 13) */
.act-multiples { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.genre-mini { cursor: pointer; border: 1px solid var(--rule); border-radius: 2px; padding: 8px; }
.genre-mini.expanded { grid-column: 1 / -1; }

/* Quadrant labels (Acts 4, 8, 12) */
.quadrant-label { font: 10px var(--mono); fill: var(--ink-faint); text-transform: uppercase; letter-spacing: 0.1em; }

/* Guided discovery block */
.story-guide { margin-top: 16px; padding: 16px 18px; border-left: 2px solid var(--accent); background: rgba(230,163,86,0.04); transition: opacity 0.4s; }
.story-guide.done { opacity: 0.4; }
.guide-eyebrow { font: 10px var(--mono); text-transform: uppercase; letter-spacing: 0.12em; color: var(--accent); margin-bottom: 6px; }
.guide-instruction { font-size: 15px; color: var(--ink); margin: 0 0 4px; }
.guide-expected { font-size: 14px; color: var(--ink-dim); font-style: italic; margin: 0; }

/* Mortality index list (Act 15) */
.mortality-list { list-style: none; padding: 0; margin: 0; }
.mortality-row { display: grid; grid-template-columns: 24px 1fr 80px 60px 80px; gap: 12px; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--rule); cursor: pointer; }
.mortality-row:hover { background: var(--bg-lift); }
.mortality-rank { font: 10px var(--mono); color: var(--ink-faint); }
.mortality-bar-wrap { height: 4px; background: var(--rule); border-radius: 2px; }
.mortality-bar { height: 100%; border-radius: 2px; background: var(--accent); }

/* Cohort side panel (Act 2) */
.cohort-panel { position: absolute; top: 0; right: 0; width: 280px; background: var(--bg-panel); border: 1px solid var(--rule); padding: 16px; max-height: 400px; overflow-y: auto; z-index: 10; }
.cohort-panel.hidden { display: none; }
```

Also fix the orphan `.analysis-grid` reference at style.css:1199 — delete it.

### Bridge `_` ↔ `-` in archetype class names
`data.js` emits `fading_aaa` / `slow_burn` (underscores); CSS legend uses `fading-aaa` / `slow-burn` (hyphens). In JS: `g.archetype.replace(/_/g, '-')` for class names. Do not touch `data.js`.

---

## Per-Act Implementation Notes

### Act 1 — The Graveyard  (brush)
- Hero stats: `games.length`, `Math.round(d3.median(games, g => g.alive_ratio) * 100)`, `games.filter(g => g.alive_ratio > 0.1).length`.
- Chart: `d3.bin()` on alive_ratio, 20 bins, log y-axis, diverging color scale on bin centroid.
- `d3.brushX()` → on brush, filter `games` to [x0, x1] band, update the 3 hero numbers in-place with a `transition`.

### Act 2 — The Flood  (hover + click drilldown)
- `d3.rollup(games, v => v.length, g => g.year)` + median alive_ratio per cohort.
- Fill each bar with diverging color on the cohort's median alive_ratio.
- Hover: position a shared `#tooltip` with cohort stats + top-3 game names.
- Click: populate `.cohort-panel` (absolutely positioned, `hidden` by default) with sorted game rows; close on second click or outside click.

### Act 3 — Most Games Are Never Finished  (static)
- Left SVG: `d3.bin()` on completion_rate ∈ [0, 0.5], 25 bins. Annotate median.
- Right SVG: `d3.rollup` → median completion by `g.genres[0]`. Sort desc. Horizontal bars.

### Act 4 — The Completion Paradox  (brush + toggle)
- Scatter floor: `g.peak_players > 100`. Color: `ARCHETYPE_COLOR[g.archetype]`.
- Toggle button: fires `act4state.colorMode = 'genre'|'archetype'` → re-colors with `transition(400)`.
- Pearson r: `d3.mean((x−mx)(y−my)) / (σx × σy)` — computed inline, rendered as SVG `<text>`.
- Binned-median regression line: group x into 10 bins, compute median y per bin, draw `d3.line()`.
- `d3.brush()` → on brushend, collect games in extent, render top-5 names in `.story-guide` below.

### Act 5 — The Decay Curve  (genre chips)
- X = `2026 - g.year`, capped at 25. Bin by integer year-age. Compute median, p25, p90 per bucket.
- `d3.area()` for ribbon. `d3.line()` for median.
- Chips: top-8 genres by frequency. Click → push/pop `act5state.selectedGenres`. On change, for each active genre draw its median curve as a `d3.line()` in a genre-specific color from `d3.schemeTableau10`.

### Act 6 — Genre Lifecycles  (expand/collapse)
- 8 `.genre-mini` cells in a 4×2 `.act-multiples` grid.
- Each cell: tiny SVG with median alive_ratio vs age (no axes), genre label, decay slope annotation.
- `act6state.expandedGenre`: click a cell → set `expandedGenre`, that cell gets `.expanded` (grid-column 1/-1), full axes + p25–p90 ribbon + game labels re-render. Click same → collapse.

### Act 7 — The DNA of Immortality  (drill-down + toggle)
- `immortals = games.filter(g => g.year <= 2018 && g.alive_ratio > 0.10)`; `mortals = games.filter(g => g.year <= 2018 && g.alive_ratio <= 0.03)`.
- Per-genre lift = (share in immortals) − (share in mortals). Divergent horizontal bars.
- Click a bar → render top-10 immortal games of that genre in a side list (reuse `gameRow(g)`).
- Toggle `Genre | Platform`: re-runs lift computation on platform groups.

### Act 8 — Critics vs Community  (quadrant click)
- Two SVGs. Each has 4 invisible `<rect>` quadrant overlays with `.on('click', ...)`.
- Click a quadrant → `act8state.filter = {panel, q}` → render a shared game list below (top-20 sorted by alive_ratio).

### Act 9 — The Price of Survival  (genre dropdown)
- Price buckets: `Free (0), <10, 10–30, 30–60, 60+` based on `g.price`.
- `<select>` above the chart; `on('change')` re-runs `d3.rollup` on the filtered subset, updates bars with `transition(500)`.

### Act 10 — Platforms — Where Survival Lives  (archetype chips)
- For each top-5 platform, compute median alive_ratio per archetype. Grouped bars.
- Archetype chips toggle `act10state.visibleArchetypes` Set. On change, show/hide bar groups with `transition`.
- Fallback prose if no platform shows meaningful difference.

### Act 11 — The Immortals  (sort chips + row click)
- `games.filter(g => g.year <= 2018 && g.peak_players > 100)`.
- Sort chips: `alive | peak | age`. On click → re-sort, re-render bars with `transition(500)`.
- `gameRow(g)` for each. Click → `state.selectedIds.add(g.id)`, show toast, flash sandbox nav.

### Act 12 — The Fading AAA  (brush + case cards)
- Highlight rect for bottom-right region drawn first (z behind dots).
- Default case cards = top-4 by peak_players in the highlighted region.
- `d3.brush()` → on brushend, update case cards from the selected subset.

### Act 13 — The Slow Burn  (coordinated hover)
- `games.filter(g => g.peak_players < 100000 && g.alive_ratio > 0.12).sort().slice(0,6)`.
- Each panel: `g.series[]` line on shared x-scale (time) and log y-scale.
- One `<rect class="hover-overlay">` per panel captures mouse-x → convert to date → draw crosshair on all panels + show values.

### Act 14 — The Coverage Multiplier  (static)
- `g.youtube_per_year = g.youtube_count / Math.max(1, 2026 - g.year)`.
- Split on `d3.median(games, g => g.alive_ratio)`. KDE via `d3.kde` (kernel density estimation on log-spaced x-grid, bandwidth 0.4).
- Two `d3.area()` paths overlapping, plus vertical lines at the two medians.

### Act 15 — The Verdict  (sort + click + CTA)
- `mortalityIndex(g)` = weighted sum, min-max normalized. Render as `<ol class="mortality-list">`.
- Sort chips: `By Index | By Alive | By Coverage | By Age`. Re-sort and re-render with list transitions.
- Each `<li class="mortality-row">` click → `state.selectedIds.add(g.id); switchView('sandbox')`.
- Inline sparkline: a `<svg width="80" height="16">` inside each row with a tiny `d3.line()` of `g.series`.
- `.outro-cta` button → `switchView('sandbox')`.

---

## Verification

1. **Visual smoke test**: `cd website && python3 -m http.server 8000`, open `http://localhost:8000`, navigate to `§ 03 — Our Reading`. All 15 acts render with non-empty charts.

2. **Numerical sanity** (browser console):
   - `games.length` ≈ 1,000–1,200.
   - `d3.median(games, g => g.alive_ratio)` ≈ 0.04.
   - `d3.median(games, g => g.completion_rate)` ≈ 0.09.
   - Pearson r ≈ −0.17.
   - YouTube/year ratio ≈ 1.5×.

3. **Interactivity smoke test**: exercise every interactive act (see plan section above for per-act checklist).

4. **Resize**: shrink to 1100px — `.story-act` collapses to single column. No resize debouncer needed.

5. **Lazy init**: only Act 1 chart drawn on first paint; Acts 2–15 fire via IntersectionObserver.

6. **No regressions**: main and sandbox views work; `state` object unchanged except for `selectedIds.add()` calls; `data.js` untouched.

---

## Out of scope

- Re-running the Python pipeline.
- Adding new dependencies (D3 v7 only).
- Scroll-driven libraries (Scrollama, etc.).
- Mobile-first redesign.
- Refactoring main or sandbox view.
- Tests.
