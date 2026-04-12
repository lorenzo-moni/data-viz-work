// ==========================================================
// DUMMY DATA — obviously synthetic placeholders.
// Game names are Game 01 through Game 20. Genres, platforms,
// ratings and player counts are randomly generated within
// plausible ranges. Time series are synthesized from the
// summary stats below using an exponential decay model.
//
// For Milestone 3, replace this entire file with JSON exported
// from the Python pipeline (rawg_clean.parquet + steamcharts).
// ==========================================================

const GENRE_POOL = ['Action', 'Adventure', 'RPG', 'Strategy', 'Simulation', 'Shooter', 'Indie', 'Puzzle', 'Platformer', 'Racing'];
const PLATFORM_POOL = ['PC', 'PlayStation', 'Xbox', 'Nintendo', 'iOS'];

// Twenty games, hand-tuned to span the four archetypes so
// the chart has a visible spread rather than a blob.
// Each archetype is seeded differently:
//   immortal   — old, high alive_ratio, medium-to-large peak
//   fading_aaa — recent, big peak, low alive_ratio
//   slow_burn  — old-ish, low peak, steady mid alive_ratio
//   mid        — everything else
const GAMES_DATA = [
  // --- Immortals (8) ---
  { id: 1,  name: 'Game 01', archetype: 'immortal',   year: 2012, peak_players: 1500000, alive_ratio: 0.42 },
  { id: 2,  name: 'Game 02', archetype: 'immortal',   year: 2013, peak_players: 1200000, alive_ratio: 0.38 },
  { id: 3,  name: 'Game 03', archetype: 'immortal',   year: 2013, peak_players: 245000,  alive_ratio: 0.27 },
  { id: 4,  name: 'Game 04', archetype: 'immortal',   year: 2015, peak_players: 489000,  alive_ratio: 0.22 },
  { id: 5,  name: 'Game 05', archetype: 'immortal',   year: 2014, peak_players: 34000,   alive_ratio: 0.24 },
  { id: 6,  name: 'Game 06', archetype: 'immortal',   year: 2012, peak_players: 79000,   alive_ratio: 0.29 },
  { id: 7,  name: 'Game 07', archetype: 'immortal',   year: 2016, peak_players: 236000,  alive_ratio: 0.17 },
  { id: 8,  name: 'Game 08', archetype: 'immortal',   year: 2018, peak_players: 162000,  alive_ratio: 0.22 },

  // --- Fading AAA (6) ---
  { id: 9,  name: 'Game 09', archetype: 'fading_aaa', year: 2020, peak_players: 1054000, alive_ratio: 0.04 },
  { id: 10, name: 'Game 10', archetype: 'fading_aaa', year: 2019, peak_players: 83000,   alive_ratio: 0.05 },
  { id: 11, name: 'Game 11', archetype: 'fading_aaa', year: 2022, peak_players: 953000,  alive_ratio: 0.08 },
  { id: 12, name: 'Game 12', archetype: 'fading_aaa', year: 2020, peak_players: 330000,  alive_ratio: 0.03 },
  { id: 13, name: 'Game 13', archetype: 'fading_aaa', year: 2021, peak_players: 502000,  alive_ratio: 0.06 },
  { id: 14, name: 'Game 14', archetype: 'fading_aaa', year: 2023, peak_players: 879000,  alive_ratio: 0.04 },

  // --- Slow burn (4) ---
  { id: 15, name: 'Game 15', archetype: 'slow_burn',  year: 2018, peak_players: 20000,   alive_ratio: 0.14 },
  { id: 16, name: 'Game 16', archetype: 'slow_burn',  year: 2016, peak_players: 36000,   alive_ratio: 0.19 },
  { id: 17, name: 'Game 17', archetype: 'slow_burn',  year: 2014, peak_players: 45000,   alive_ratio: 0.18 },
  { id: 18, name: 'Game 18', archetype: 'slow_burn',  year: 2013, peak_players: 70000,   alive_ratio: 0.22 },

  // --- Middle of the pack (2) ---
  { id: 19, name: 'Game 19', archetype: 'mid',        year: 2017, peak_players: 105000,  alive_ratio: 0.09 },
  { id: 20, name: 'Game 20', archetype: 'mid',        year: 2021, peak_players: 258000,  alive_ratio: 0.11 },
];

// ----------------------------------------------------------
// Seeded RNG so the dummy data is stable across reloads
// ----------------------------------------------------------
function mulberry32(seed) {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ----------------------------------------------------------
// Flesh out each game with synthetic attributes
// ----------------------------------------------------------
GAMES_DATA.forEach((g, idx) => {
  const rand = mulberry32(g.id * 1000);

  // 1-3 genres pulled from the pool
  const nGenres = 1 + Math.floor(rand() * 3);
  const genres = [];
  while (genres.length < nGenres) {
    const pick = GENRE_POOL[Math.floor(rand() * GENRE_POOL.length)];
    if (!genres.includes(pick)) genres.push(pick);
  }
  g.genres = genres;

  // 1-4 platforms
  const nPlat = 1 + Math.floor(rand() * 4);
  const platforms = [];
  while (platforms.length < nPlat) {
    const pick = PLATFORM_POOL[Math.floor(rand() * PLATFORM_POOL.length)];
    if (!platforms.includes(pick)) platforms.push(pick);
  }
  g.platforms = platforms;

  // Ratings — immortals tend to score higher on RAWG, fading AAA moderate
  const baseRating = { immortal: 4.2, slow_burn: 4.1, fading_aaa: 3.6, mid: 3.8 }[g.archetype];
  g.rating = Math.min(5, Math.max(1, baseRating + (rand() - 0.5) * 0.8));

  g.metacritic = Math.round(60 + rand() * 35);

  // Completion rate — inversely related to alive_ratio for the narrative
  g.completion_rate = Math.max(0.01, Math.min(0.65, 0.4 - g.alive_ratio * 0.7 + (rand() - 0.5) * 0.15));

  // Drop rate
  g.drop_rate = Math.max(0.01, 0.1 + (rand() - 0.5) * 0.08);

  // Average current players = peak × alive_ratio with some noise
  g.avg_players = Math.round(g.peak_players * g.alive_ratio * (0.8 + rand() * 0.4));

  // Survivability = current / peak as %
  g.survivability = Math.round((g.avg_players / g.peak_players) * 100);
});

// ----------------------------------------------------------
// Build monthly time series for each game (synthetic decay)
// ----------------------------------------------------------
GAMES_DATA.forEach(g => {
  const rand = mulberry32(g.id * 7919);
  const monthsSinceRelease = (2025 - g.year) * 12;
  const series = [];

  // Peak is reached 1-6 months after release, then decays to
  // floor = alive_ratio × peak with half-life proportional to survivability
  const peakMonth = Math.min(6, Math.max(1, Math.floor(monthsSinceRelease * 0.08)));
  const halfLifeMonths = 4 + g.survivability * 1.2;

  for (let m = 0; m < monthsSinceRelease; m++) {
    let p;
    if (m <= peakMonth) {
      p = g.peak_players * ((m + 1) / (peakMonth + 1));
    } else {
      const monthsAfterPeak = m - peakMonth;
      const decay = Math.exp(-monthsAfterPeak * Math.LN2 / halfLifeMonths);
      const floor = g.alive_ratio * g.peak_players;
      p = floor + (g.peak_players - floor) * decay;
    }
    // Small noise (using deterministic RNG so it's stable across renders)
    p *= 0.9 + rand() * 0.2;

    const releaseDate = new Date(g.year, 0, 1).getTime();
    const ts = releaseDate + m * 30.44 * 24 * 3600 * 1000;
    series.push({ month: ts, players: Math.max(0, Math.round(p)) });
  }

  g.series = series;
  g.current_players = series[series.length - 1]?.players || 0;
});

console.log(`Loaded ${GAMES_DATA.length} dummy games`);
