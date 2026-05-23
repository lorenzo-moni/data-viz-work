# Project of Data Visualization (COM-480)

| Student's name                | SCIPER |
| ----------------------------- | ------ |
| Lorenzo Moni                  | 416074 |
| Barozet Golbery Julien Pierre | 361312 |
| Louis James Vasseur           | 362239 |

[Milestone 1](#milestone-1) • [Milestone 2](#milestone-2) • [Milestone 3](#milestone-3)

## Milestone 1 (20th March, 5pm)

Milestone 1 Report: [PDF Report](milestones/milestone-1/milestone-1.pdf)

## Milestone 2 (17th April, 5pm)

Milestone 2 Report: [PDF Report](milestones/milestone-2/milestone-2.pdf)

Website Prototype: [Website URL](https://com-480-data-visualization.github.io/mobava/)

## Milestone 3 (29th May, 5pm)

# Built to Last: Milestone 2 Prototype

Static single-page app prototype built with D3.js v7. Three views, view-transition navigation, obvious dummy data.

## Getting the dataset

The two final datasets can be found in dataset/output. The code to obtain the final dataset is detailed in the dataset/processing/processing.py file.

In particular, the pipeline to obtain the final dataset is the following:

1. Download RAWG dataset
2. Clean RAWG dataset as described in dataset/processing/rawg.py
3. Join the RAWG dataset with the FronkonGames/steam-games-dataset on the name to obtain the Steam AppId for steam games
4. Scrape Steam Charts to Time series data for each game.
5. Store games that have both RAWG entry and Time series entry.

We advice to use the already provided dataset in the website/data folder for evaluation.

## Running locally

The website can be run by spinning up a local HTTP server with the following command

```bash
cd website
python3 -m http.server 8000
```

And by visiting the webpage htpp://localhost:8000, or by visualizing the live version [here](https://com-480-data-visualization.github.io/mobava/).

## Architecture

Single-page app with **three main views**, one active at a time:

1. View 1 - Main: filters and bubble chart. Possibility to click a bubble and add it to selection
2. View 2 - Sandbox: can be open by clicking on "Open sandbox". It shows clusters with the selected games.
3. View 3 - Analytics: our reading on the data.

## Files

- **website/index.html**: Single-page app shell with three views, one active at a time.

- **website/assets/css/style.css**: All styles: layout, theming, D3 element classes, responsive breakpoints.

- **website/assets/js/data.js**: Loads both CSVs via D3, joins them in memory, and exposes `loadGameData()` returning a unified array of game objects.

- **website/assets/js/main.js**: SPA engine: view router, filter and selection state, D3 charts.

- **website/data/**: Copy of the final datasets served statically to the frontend.

- **dataset/processing/**: Python pipeline that produces the final datasets.
