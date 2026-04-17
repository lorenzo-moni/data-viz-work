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

    // Peak players: max between RAWG peak_ccu and all monthly peaks in steamcharts
    const rawgPeak = +row.peak_ccu || 0;
    const chartsPeak = series.reduce((max, s) => Math.max(max, s.peak), 0);
    const peakPlayers = Math.max(rawgPeak, chartsPeak, 1);

    // Current avg players: most recent month in steamcharts
    const currentAvg =
      series.length > 0 ? series[series.length - 1].players : 0;
    const aliveRatio = Math.min(1, Math.max(0, currentAvg / peakPlayers));

    const year =
      +row.release_year || (row.released ? +row.released.slice(0, 4) : null);
    if (!year) return; // skip games without a release year

    const genres = (row.genres || "").split("|").filter(Boolean);
    if (genres.length === 0) genres.push("Unknown");

    games.push({
      id: appId || idx + 1,
      name: row.name || `Game ${idx + 1}`,
      year,
      peak_players: peakPlayers,
      avg_players: currentAvg,
      alive_ratio: aliveRatio,
      survivability: Math.round(aliveRatio * 100),
      genres,
      platforms: normalizePlatforms(row.parent_platforms || row.platforms),
      rating: +row.rating || 0,
      metacritic: +row.metacritic || 0,
      completion_rate: +row.completion_rate || 0,
      drop_rate: +row.drop_rate || 0,
      series: series.map((s) => ({ month: s.month, players: s.players })),
      current_players: currentAvg,
    });
  });

  // Classify each game into an archetype (used by analysis charts)
  games.forEach((g) => {
    const isOld = g.year <= 2018;
    if (g.alive_ratio > 0.15 && isOld) g.archetype = "immortal";
    else if (g.peak_players > 100000 && g.alive_ratio < 0.08)
      g.archetype = "fading_aaa";
    else if (g.peak_players < 100000 && g.alive_ratio > 0.12)
      g.archetype = "slow_burn";
    else g.archetype = "mid";
  });

  console.log(`Loaded ${games.length} games from real dataset`);
  return games;
}
