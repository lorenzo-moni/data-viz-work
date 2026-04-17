# Built to Last — Milestone 2 Prototype

Static single-page app prototype built with D3.js v7. Three views, view-transition navigation, obvious dummy data.

## Deliverables:

- Report: [TODO]
- Website URL: [TODO]

## Getting the dataset

The two final datasets can be found in dataset/output. The code to obtain the final dataset is detailed in the dataset/processing/processing.py file.

In particular, the pipeline to obtain the final dataset is the following:

1. Download RAWG dataset
2. Clean RAWG dataset as described in dataset/processing/rawg.py
3. Join the RAWG dataset with the FronkonGames/steam-games-dataset on the name to obtain the Steam AppId for steam games
4. Scrape Steam Charts to Time series data for each game.
5. Store games that have both RAWG entry and Time series entry.

Since the final dataset contains [TODO] games the scraping procedure can take up to a few hours, thus we advice to use the dataset provided in the dataset/output folder for evaluation.

## Running locally

The website can be run by spinning up a local HTTP server with the following command

```bash
cd website
python3 -m http.server 8000
```

And by visiting the webpage htpp://localhost:8000, or by visualizing the live version on [TODO].

## Architecture

Single-page app with **three main views**, one active at a time:

1. View 1 - Main (default): filters and bubble chart. Possibility to click a bubble and add it to selection
2. View 2 - Sandbox: can be open by clicking on "Open sandbox". It shows clusters with the selected games.
3. View 3 - Analytics: our reading on the data.

## Files

- **website/index.html**: Single-page app shell with three views, one active at a time.

- **website/assets/css/style.css**: All styles: layout, theming, D3 element classes, responsive breakpoints.

- **website/assets/js/data.js**: Loads both CSVs via D3, joins them in memory, and exposes `loadGameData()` returning a unified array of game objects.

- **website/assets/js/main.js**: SPA engine: view router, filter and selection state, D3 charts.

- **website/data/**: Copy of the final datasets served statically to the frontend.

- **dataset/processing/**: Python pipeline that produces the final datasets.
