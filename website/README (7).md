# Built to Last — Milestone 2 Prototype

Static single-page app prototype built with D3.js v7. Three views, view-transition navigation, obvious dummy data.

## Running locally

```bash
cd web && python3 -m http.server 8000
# open http://localhost:8000
```

Always serve via a local server — not `file://`.

## Architecture

Single-page app with **three views**, one active at a time. No scrolling between sections.

```
   Banner: PROTOTYPE notice
   Top bar: §01  §02 (gated)  §03
   ──────────────────────────────
             │
             ▼
   ┌──── VIEW 1: MAIN ──────┐
   │  filters + bubble chart│    default view
   │  click bubble → card   │
   │  + add to selection    │
   │                        │
   │  ↓ tray appears when   │
   │    ≥1 game selected    │
   └────────┬───────────────┘
            │
            ▼ click "Open sandbox"
   ┌──── VIEW 2: SANDBOX ───┐
   │  user-picked X/Y/color │
   │  clusters your picks   │
   │  ← back to landscape   │
   └────────┬───────────────┘
            │
            ▼ (or direct from topbar)
   ┌──── VIEW 3: ANALYSIS ──┐
   │  "our reading" — 4     │
   │  side-by-side time     │
   │  series comparisons    │
   │  ← back to landscape   │
   └────────────────────────┘
```

### Key UX rules

- **The sandbox is gated.** The top-nav button for §02 is disabled (dashed border, grayed out) until the user makes their first selection. Clicking it while disabled triggers a horizontal shake animation so the user sees it's gated, not broken.
- **Selection persists across views.** Picks made in the main view carry into the sandbox; cleared items there update the bubbles when you go back.
- **The floating tray only appears on the main view.** Once in the sandbox or analysis, it hides — each view owns its own chrome.
- **Every non-main view has a `← Back to the landscape` footer.** The analysis view additionally offers `Build your own reading →` linking to the sandbox, so the static analysis feels like a closing argument that can still bounce the user back into exploration.
- **The prototype banner is always visible** at the top so there's zero confusion about the dummy data.

## Dummy data

20 games, named `Game 01` through `Game 20`. Four archetypes:

- **Immortal** (8 games) — released 2012–2018, high alive_ratio, steady survivability
- **Fading AAA** (6 games) — released 2019–2023, huge peak, near-zero alive_ratio
- **Slow burn** (4 games) — mid-catalog with quiet long-tail persistence
- **Mid** (2 games) — generic middle of the pack

Each game's time series is synthesized at load from its peak + alive_ratio + archetype using a deterministic seeded RNG (so the dummy data is stable across reloads). Genres, platforms, ratings, and completion rates are randomized within ranges that match each archetype's narrative.

**Every string in the UI that names a game is `Game NN`.** No real game names anywhere — this makes it unambiguous that the prototype is a scaffold and the real data wires in for Milestone 3.

## Replacing with real data in Milestone 3

The replacement is just `data.js`. Export from your Python pipeline:

```python
records = []
for _, row in df.iterrows():
    records.append({
        'id': int(row['id']),
        'name': row['name'],
        'year': int(row['release_year']),
        'genres': row['genres'].split('|'),
        'platforms': row['parent_platforms'].split('|'),
        'rating': float(row['rating']),
        'metacritic': float(row['metacritic']) if pd.notna(row['metacritic']) else None,
        'alive_ratio': float(row['alive_ratio']),
        'completion_rate': float(row['completion_rate']),
        'avg_players': int(row['avg_players']),
        'peak_players': int(row['peak_players']),
        'series': steamcharts_for_game(row['id']),  # list of {month, players}
    })

import json
with open('web/data.json', 'w') as f:
    json.dump(records, f)
```

Then in `main.js`, wrap the bootstrap in a fetch. Nothing else changes.

## Files

```
web/
├── index.html   — 3-view layout + topbar + tray + card
├── style.css    — editorial dark theme, SPA transitions
├── data.js      — 20 synthetic games with time series
├── main.js      — view router, D3 charts, selection state
└── README.md    — this file
```