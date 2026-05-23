function parseMonthStr(str) {
  if (!str) return null;
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
// The column is stored as a numpy array repr: "['Single-player' 'Online PvP' ...]"
// (space-separated single-quoted tokens, NOT comma-separated)
function parseCategories(str) {
  if (!str) return [];
  // Extract all single-quoted tokens, e.g. 'Online PvP' → "Online PvP"
  const matches = str.match(/'([^']+)'/g);
  if (matches) return matches.map((m) => m.slice(1, -1));
  // Fallback: try comma-split (older format)
  return str
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((s) => s.trim().replace(/^'|'$/g, "").replace(/^"|"$/g, ""))
    .filter(Boolean);
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

    // alive_ratio: RAWG engagement definition (from notebooks/eda_immortal_games.ipynb)
    // engagement_total = status_playing + status_beaten + status_dropped
    // alive_ratio = status_playing / engagement_total
    const statusPlaying = Math.max(0, +row.status_playing || 0);
    const statusBeaten = Math.max(0, +row.status_beaten || 0);
    const statusDropped = Math.max(0, +row.status_dropped || 0);
    const engagementTotal = statusPlaying + statusBeaten + statusDropped;
    const alive_ratio =
      engagementTotal > 0 ? statusPlaying / engagementTotal : 0;

    // Steam-derived peak (still used for slow-burn / fading-AAA classification and series charts)
    const peakPlayers = series.reduce((max, s) => Math.max(max, s.peak), 0);

    // Current avg players from steamcharts (used for sparklines / Act 13)
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

    // Parse Steam categories for game-type classification.

    const categories = parseCategories(row.categories || "");

    const hasSinglePlayer = categories.some((c) => c === "Single-player");
    console.log(hasSinglePlayer);
    const hasOnline = categories.some(
      (c) => c.includes("Online") || c === "Multi-player",
    );

    console.log(row.name, categories, genres);

    const isMMO = genres.includes("Massively Multiplayer");
    const isSports = genres.includes("Sports");
    const isRacing = genres.includes("Racing");
    const isStructurallyEndless = isMMO || isSports || isRacing;

    let game_type;
    if (isStructurallyEndless || (!hasSinglePlayer && hasOnline)) {
      game_type = "pure_online";
    } else if (hasSinglePlayer && hasOnline) {
      game_type = "hybrid";
    } else {
      game_type = "story";
    }

    console.log("AASD", row.youtube_count);

    games.push({
      id: appId || idx + 1,
      name: row.name || `Game ${idx + 1}`,
      year,
      release_month,
      peak_players: peakPlayers,
      avg_players: averagePlayers,
      alive_ratio,
      survivability: Math.round(alive_ratio * 100),
      genres,
      platforms: normalizePlatforms(row.parent_platforms || row.platforms),
      rating: +row.rating || 0,
      metacritic: +row.metacritic || 0,
      completion_rate: +row.completion_rate || 0,
      drop_rate: +row.drop_rate || 0,
      youtube_count: +row.youtube_count || 0,
      rating_delta: +row.rating_delta || 0,
      price: +row.price || 0,
      release_year: year,
      series: series.map((s) => ({
        month: s.month,
        players: s.players,
        peak: s.peak,
      })),
      current_players: currentPlayers,
      // RAWG engagement fields (used by Acts 3, 7, 11, 15 for small-N filtering)
      engagement_total: engagementTotal,
      status_playing: statusPlaying,
      status_beaten: statusBeaten,
      status_dropped: statusDropped,
      game_type, // "story" | "hybrid" | "live_service"
      categories,
      ratings_count: +row.ratings_count || 0,
    });
  });

  // Classify each game into an archetype — aligned with notebook thresholds
  // (eda_immortal_games.ipynb cell 30: alive_ratio > 0.10, year <= 2018, engagement >= 30)
  games.forEach((g) => {
    const isOld = g.year <= 2018;
    const hasEngagement = g.engagement_total >= 30;
    if (g.alive_ratio > 0.1 && isOld && hasEngagement) g.archetype = "immortal";
    else if (g.peak_players > 100000 && g.alive_ratio < 0.05)
      g.archetype = "fading_aaa";
    else if (g.peak_players < 100000 && g.alive_ratio > 0.1 && hasEngagement)
      g.archetype = "slow_burn";
    else g.archetype = "mid";
  });

  console.log(`Loaded ${games.length} games from real dataset`);
  return games;
}
