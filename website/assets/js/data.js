function parseMonthStr(str) {
  if (!str) return null;
  // ISO format: YYYY-MM-DD
  if (/^\d{4}-\d{2}/.test(str)) {
    const [year, month] = str.split("-");
    const ts = new Date(+year, +month - 1, 1).getTime();
    return isNaN(ts) ? null : ts;
  }
  // Legacy format: Mon-YY
  const [mon, yr] = str.split("-");
  if (!mon || !yr) return null;
  const year = +yr + (+yr < 50 ? 2000 : 1900);
  const m = {
    Jan: 0,
    Feb: 1,
    Mar: 2,
    Apr: 3,
    May: 4,
    Jun: 5,
    Jul: 6,
    Aug: 7,
    Sep: 8,
    Oct: 9,
    Nov: 10,
    Dec: 11,
  }[mon];
  if (m === undefined) return null;
  return new Date(year, m, 1).getTime();
}

function normalizePlatforms(str) {
  if (!str) return [];
  return str
    .split("|")
    .map((p) => {
      p = p.trim();
      if (p === "Apple Macintosh") return "macOS";
      return p;
    })
    .filter(Boolean);
}

// Parse Steam categories string.
function parseCategories(str) {
  if (!str) return [];
  const matches = str.match(/'([^']+)'/g);
  if (matches) return matches.map((m) => m.slice(1, -1));
  return str
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((s) => s.trim().replace(/^'|'$/g, "").replace(/^"|"$/g, ""))
    .filter(Boolean);
}

function parsePublishers(raw) {
  if (!raw) return [];
  return String(raw)
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
}

function isAAAPublisher(publishers) {
  return publishers.some((p) => AAA_PUBLISHERS.has(p));
}

const THRESHOLDS = {
  IMMORTAL_YEAR_CUTOFF: 2022,
  ALIVE_MIN: null,
  IMMORTAL_MIN: 0.5,
  ALIVE_MEDIAN: null,
  FADING_AAA_ALIVE_MAX: 0.05,
  SLOW_BURN_PEAK_MAX: 100000,
  SLOW_BURN_ALIVE_MIN: 0.1,
  SLOW_BURN_MIN_SERIES_MONTHS: 12,
  SLOW_BURN_YEAR_CUTOFF: 2022,
  ENGAGEMENT_FLOOR: 30,
  PURE_ONLINE_PEAK_FLOOR: 1000,
};

// Fraction of months the game maintained >= 20% of its all-time peak.
function computeLongevityScore(timeseries) {
  if (!timeseries || timeseries.length === 0) return 0;
  const playerCounts = timeseries.map((m) => m.players || 0);
  const peak = Math.max(...playerCounts);
  if (peak === 0) return 0;
  const threshold = peak * 0.2;
  const aliveMonths = playerCounts.filter((p) => p >= threshold).length;
  const peakScale = Math.min(1, Math.log(1 + peak) / Math.log(1000000));
  return (aliveMonths / timeseries.length) * peakScale;
}

async function loadGameData() {
  const [rawgRows, chartsRows] = await Promise.all([
    d3.csv("data/rawg_steam_final.csv"),
    d3.csv("data/steamcharts_final.csv"),
  ]);

  // Group steamcharts time series by steam_appid
  const seriesByAppId = new Map();
  for (const row of chartsRows) {
    const appId = +row.steam_appid;
    if (!appId) continue;
    const ts = parseMonthStr(row.month);
    if (ts === null) continue;
    if (!seriesByAppId.has(appId)) seriesByAppId.set(appId, []);
    seriesByAppId.get(appId).push({
      month: ts,
      players: Math.max(0, +row.avg_players || 0),
      peak: Math.max(0, +row.peak_players || 0),
    });
  }
  // Sort each series chronologically
  seriesByAppId.forEach((s) => s.sort((a, b) => a.month - b.month));

  const games = [];
  rawgRows.forEach((row, idx) => {
    const appId = +row.steam_appid;
    const series = seriesByAppId.get(appId) || [];

    // Steam-derived peak: all-time max monthly peak
    const peakPlayers = series.reduce((max, s) => Math.max(max, s.peak), 0);
    const currentPlayers =
      series.length > 0 ? series[series.length - 1].players : 0;
    const averagePlayers =
      series.length > 0
        ? Math.round(
            series.reduce((sum, item) => sum + item.players, 0) / series.length,
          )
        : 0;

    const year =
      +row.release_year || (row.released ? +row.released.slice(0, 4) : null);
    if (!year) return;

    const parsedDate = new Date(row.released || "");
    const release_month = isNaN(parsedDate.getTime())
      ? 5
      : parsedDate.getMonth();

    const genres = (row.genres || "").split("|").filter(Boolean);
    if (genres.length === 0) genres.push("Unknown");

    const tags = (row.tags || "").split("|").filter(Boolean);

    const categories = parseCategories(row.categories || "");
    const hasSinglePlayer = categories.some((c) => c === "Single-player");
    const hasOnline = categories.some(
      (c) => c.includes("Online") || c === "Multi-player",
    );
    const isMMO = genres.includes("Massively Multiplayer");
    const isSports = genres.includes("Sports");
    const isRacing = genres.includes("Racing");
    const isStructurallyEndless = isMMO || isSports || isRacing;

    const statusPlaying = Math.max(0, +row.status_playing || 0);
    const statusBeaten = Math.max(0, +row.status_beaten || 0);
    const statusDropped = Math.max(0, +row.status_dropped || 0);
    const statusOwned = Math.max(0, +row.status_owned || 0);
    const engagementTotal = statusPlaying + statusBeaten + statusDropped;
    const positiveOutcome = statusBeaten + statusPlaying;
    const scaleSignal = Math.min(
      1,
      Math.log(1 + engagementTotal) / Math.log(100000),
    );

    let game_type;
    let alive_ratio;
    const longevityScore = computeLongevityScore(series);
    const positiveOutcomeScore =
      engagementTotal > 0
        ? (positiveOutcome / engagementTotal) * scaleSignal
        : 0;
    if (isStructurallyEndless || (!hasSinglePlayer && hasOnline)) {
      game_type = "pure_online";
      alive_ratio = longevityScore;
    } else if (hasSinglePlayer && hasOnline) {
      game_type = "hybrid";
      alive_ratio = 0.7 * longevityScore + 0.3 * positiveOutcomeScore;
    } else {
      game_type = "story";
      alive_ratio = positiveOutcomeScore;
    }

    let months_to_peak = null;
    if (series.length > 0) {
      const peakIdx = series.reduce(
        (mi, s, i) => (s.players > series[mi].players ? i : mi),
        0,
      );
      const relDate = new Date(year, release_month, 1);
      const obsDate = new Date(series[peakIdx].month);
      const mtp =
        (obsDate.getFullYear() - relDate.getFullYear()) * 12 +
        (obsDate.getMonth() - relDate.getMonth());
      months_to_peak = Math.max(0, mtp);
    }

    games.push({
      id: appId || idx + 1,
      name: row.name || `Game ${idx + 1}`,
      year,
      release_month,
      peak_players: peakPlayers,
      avg_players: averagePlayers,
      alive_ratio,
      months_to_peak,
      genres,
      platforms: normalizePlatforms(row.parent_platforms || row.platforms),
      rating: +row.rating || 0,
      metacritic: +row.metacritic || 0,
      completion_rate: +row.completion_rate || 0,
      tags,
      drop_rate: +row.drop_rate || 0,
      youtube_count: +row.youtube_count || 0,
      reddit_count: +row.reddit_count || 0,
      twitch_count: +row.twitch_count || 0,
      playtime: +row.playtime || 0,
      rating_delta: +row.rating_delta || 0,
      price: +row.price || 0,
      release_year: year,
      series: series.map((s) => ({
        month: s.month,
        players: s.players,
        peak: s.peak,
      })),
      current_players: currentPlayers,
      // RAWG engagement fields
      engagement_total: engagementTotal,
      positive_outcome: positiveOutcome,
      status_playing: statusPlaying,
      status_beaten: statusBeaten,
      status_dropped: statusDropped,
      status_owned: statusOwned,

      game_type, // story | hybrid | pure_online
      categories,
      ratings_count: +row.ratings_count || 0,
      publishers: parsePublishers(row.publishers),
    });
  });

  const _sorted = games
    .map((g) => g.alive_ratio)
    .filter(isFinite)
    .sort((a, b) => a - b);
  THRESHOLDS.ALIVE_MEDIAN = d3.quantile(_sorted, 0.5) || 0.05;
  THRESHOLDS.ALIVE_MIN = THRESHOLDS.ALIVE_MEDIAN;
  THRESHOLDS.FADING_AAA_ALIVE_MAX = THRESHOLDS.ALIVE_MIN;
  THRESHOLDS.SLOW_BURN_ALIVE_MIN = THRESHOLDS.ALIVE_MIN;

  ALIVE_SCALE.domain([0, THRESHOLDS.ALIVE_MIN, THRESHOLDS.IMMORTAL_MIN]);

  // Classify each game into an archetype using centralized THRESHOLDS.
  games.forEach((g) => {
    const isOld = g.year <= THRESHOLDS.IMMORTAL_YEAR_CUTOFF;
    const hasEngagement =
      g.game_type === "pure_online"
        ? g.peak_players >= THRESHOLDS.PURE_ONLINE_PEAK_FLOOR
        : g.engagement_total >= THRESHOLDS.ENGAGEMENT_FLOOR;

    const aaaPublished = isAAAPublisher(g.publishers);

    // Slow-burn guard: require the game has a meaningful history (>=12 months of SteamCharts
    // data) and was released before SLOW_BURN_YEAR_CUTOFF so brand-new games still climbing
    // their launch curve are not mis-tagged as slow burns.
    const isSlowBurnCandidate =
      g.peak_players < THRESHOLDS.SLOW_BURN_PEAK_MAX &&
      g.year <= THRESHOLDS.SLOW_BURN_YEAR_CUTOFF &&
      g.series.length >= THRESHOLDS.SLOW_BURN_MIN_SERIES_MONTHS;

    if (g.alive_ratio > THRESHOLDS.IMMORTAL_MIN && isOld && hasEngagement)
      g.archetype = "immortal";
    else if (aaaPublished && g.alive_ratio < THRESHOLDS.FADING_AAA_ALIVE_MAX)
      g.archetype = "fading_aaa";
    else if (aaaPublished) g.archetype = "aaa";
    else if (
      isSlowBurnCandidate &&
      g.alive_ratio > THRESHOLDS.SLOW_BURN_ALIVE_MIN &&
      hasEngagement
    )
      g.archetype = "slow_burn";
    else g.archetype = "mid";
  });

  console.log(`Loaded ${games.length} games from real dataset`);
  return games;
}
