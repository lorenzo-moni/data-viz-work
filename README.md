# Built to Last — Milestone 2 Prototype

Static single-page app prototype built with D3.js v7. Three views, view-transition navigation, obvious dummy data.

## Running locally

```bash
cd web && python3 -m http.server 8000
# open http://localhost:8000
```

Always serve via a local server — not `file://`.

## Architecture

Single-page app with **three views**, one active at a time. No scrolling between sections:

1. View 1 - Main (default): filters and bubble chart. Possibility to click a bubble and add it to selection
2. View 2 - Sandbox: can be open by clicking on "Open sandbox". It shows clusters with the selected games.
3. View 3 - Analytics: our reading on the data.

### Key UX rules

- **The sandbox is gated.** The top-nav button for §02 is disabled (dashed border, grayed out) until the user makes their first selection. Clicking it while disabled triggers a horizontal shake animation so the user sees it's gated, not broken.
- **Selection persists across views.** Picks made in the main view carry into the sandbox; cleared items there update the bubbles when you go back.
- **The floating tray only appears on the main view.** Once in the sandbox or analysis, it hides — each view owns its own chrome.
- **Every non-main view has a `← Back to the landscape` footer.** The analysis view additionally offers `Build your own reading →` linking to the sandbox, so the static analysis feels like a closing argument that can still bounce the user back into exploration.
- **The prototype banner is always visible** at the top so there's zero confusion about the dummy data.

## Files

- **index.html** — HTML structure of the single-page app with three views (main, sandbox, analysis). Contains the persistent topbar with navigation buttons, the controls section with filters (time range, genres, rating, platform), the main SVG chart, the floating selection tray, the modal game card, and navigation footers. Imports D3.js v7 and local scripts (data.js, main.js).

- **style.css** — Dark editorial theme with curated color palette (bg #14100e, accent #e6a356, alive #7fc97f, dying #d96c6c). Defines grid layout for main view (sidebar + chart), animations (view fade-in, nav shake for gating, tray rise), styling of UI components (buttons, chips, sliders, range input) and D3 visualizations (axes, tooltip, bubble selection states, grid lines).

- **data.js** — Loads and processes real data from two CSVs (rawg_steam_final.csv and steamcharts_final.csv). Parses dates in "Mon-YY" format, normalizes platform names, calculates derived metrics (alive_ratio as current avg players to peak ratio, survivability percentage, archetype classification). Builds time series for each game by sorting data chronologically. Exports loadGameData() function that returns an array of game objects.

- **main.js** — SPA engine with view router, global state management (selectedIds, yearRange, genres, minRating, platforms, currentView), rendering of three D3 charts (main bubble chart, sandbox scatter plot, analysis time series), interaction logic (hover tooltip, click card, bubble selection), tray UI updates and navbar gating. Contains initChart(), renderChart(), initSandbox(), renderSandbox(), renderAnalysisCharts() and reactive update loop.

- **README.md** — Project documentation with local setup instructions (python server), three-view architecture description, core UX rules (gated sandbox, persistent selection, tray only on main, back buttons, prototype banner), file listing.

- **dataset/output/rawg_steam_final.csv** — Clean CSV with game metadata from RAWG (name, release_year, genres, platforms, rating, metacritic, completion_rate, drop_rate, steam_appid, peak_ccu).

- **dataset/output/steamcharts_final.csv** — CSV with aggregated time series per game (steam_appid, month in "Mon-YY" format, avg_players, peak_players).

- **dataset/processing/join.py** — Python script that merges and cleans raw data from RAWG and Steam Charts, normalizes names, resolves duplicates, produces final CSVs in output folder.

- **dataset/processing/rawg_data_cleaning.ipynb** — Jupyter notebook for EDA and initial cleaning of raw RAWG data, exploration of missing values and distributions.

- **notebooks/eda_immortal_games.ipynb** — Jupyter notebook with exploratory analysis on the classification of "immortal" games (those that remain alive over time), study of survival patterns.

- **notebooks/rawg_eda.ipynb** — Jupyter notebook with EDA on raw RAWG data, visualization of rating, year, genres, and platform distributions.
