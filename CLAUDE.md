# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

**Built to Last** — a data visualization study of video game longevity, built for the COM-480 course at EPFL (Milestone 3 due 29 May 2026). Live site: https://com-480-data-visualization.github.io/mobava/

## Running locally

```bash
cd website
python3 -m http.server 8000
# visit http://localhost:8000
```

The site is a static single-page app — no build step needed. GitHub Actions deploys the `website/` folder to GitHub Pages on every push to `main`.

## Dataset pipeline (Python)

Run only when you need to regenerate the datasets. The pre-built CSVs are already in `website/data/` and are the authoritative source for the frontend.

```bash
cd dataset/processing
source ../../venv/bin/activate
python processing.py
```

The pipeline: RAWG (Hugging Face) → fuzzy-join with FronkonGames/steam-games-dataset → scrape SteamCharts → intersect → output two CSVs to `website/data/`.

## Architecture

**Frontend** (`website/`) — vanilla JS + D3.js v7, no bundler:
- `assets/js/data.js` — loads both CSVs via `d3.csv()`, joins them in memory, and returns a unified `games[]` array. Each game object is assembled here: `alive_ratio`, `survivability`, `archetype`, and `series[]` are all computed in this file.
- `assets/js/main.js` — SPA engine: global `state` object drives view routing, filter state (`yearRange`, `genres`, `minRating`, `platforms`), and `selectedIds` (the user's picks). All D3 chart rendering lives here.
- `assets/css/style.css` — all styles; no preprocessor.
- `data/` — static CSV files served directly to the browser.

**Three views**, one visible at a time (CSS class `active` on `.view`):
1. **§ 01 The Landscape** — bubble chart of all games; click a bubble to add to selection.
2. **§ 02 The Sandbox** — scatter plot of user-selected games with configurable X/Y/color axes. Requires ≥1 selection to unlock.
3. **§ 03 Our Reading** — analysis view (coming soon for Milestone 3).

**Game archetypes** (assigned in `data.js`): `immortal` (old + high alive_ratio), `fading_aaa` (high peak, low alive_ratio), `slow_burn` (low peak, high alive_ratio), `mid` (everything else).

**Dataset processing** (`dataset/processing/`) — four Python modules:
- `rawg.py` — cleans the Hugging Face RAWG dataset; computes `completion_rate`, `drop_rate`, `rating_delta`.
- `join.py` — fuzzy-matches RAWG game names to Steam app IDs; filters to games present in all three sources.
- `steamcharts.py` — scrapes SteamCharts month-by-month player counts.
- `processing.py` — orchestrates the full pipeline.

Multi-value columns in the CSVs (genres, platforms, etc.) are pipe-delimited (`|`).
