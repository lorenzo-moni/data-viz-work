const DESIGN_CATEGORIES = new Set([
  // Multiplayer modes (online)
  "PvP",
  "Online PvP",
  "Co-op",
  "Online Co-op",
  "Cross-Platform Multiplayer",
  "MMO",

  // Multiplayer modes (local)
  "LAN Co-op",
  "LAN PvP",

  // Tags

  "MOBA",
  "Battle Royale",
  "Auto Battler",
  "Tower Defense",
  "Card Game",
  "Roguelike",
  "Roguelite",
  "Souls-like",

  "Open World",
  "Sandbox",
  "Survival",
  "Crafting",
  "Procedural Generation",
  "Replay Value",
  "Moddable",

  "MMORPG",
  "Action RPG",
  "Visual Novel",
]);

const ARCHETYPE_COLOR = {
  immortal: "#7fc97f",
  aaa: "#e6a356",
  slow_burn: "#8ab4ff",
  fading_aaa: "#d96c6c",
  mid: "#a69a8c",
};

const TS_PALETTE = d3.schemeTableau10;

const FIELD_LABELS = {
  completion_rate: "Completion rate",
  alive_ratio: "Alive ratio",
  drop_rate: "Drop rate",
  rating: "Rating",
  metacritic: "Metacritic",
  year: "Release year",
  price: "Price (USD)",
  avg_players: "Avg players",
  peak_players: "Peak players",
  current_players: "Current players",
  reddit_count: "Reddit posts",
  engagement_total: "Total engagement",
  ratings_count: "# of ratings",
};

const LOG_FIELDS = new Set([
  "peak_players",
  "avg_players",
  "current_players",
  "reddit_count",
  "engagement_total",
  "ratings_count",
]);

const FIELD_DESCRIPTIONS = {
  completion_rate:
    'Share of RAWG players who marked the game as "beaten". Most meaningful for story-driven titles.',
  alive_ratio:
    "How long a game has stayed alive: for online games, the fraction of months with a critical player mass scaled by peak size; for story games, the share of RAWG users who finished or are still playing.",
  drop_rate:
    "Share of RAWG players who abandoned the game before finishing it.",
  rating: "Average user rating from RAWG, on a 0–5 scale.",
  metacritic: "Aggregated Metacritic critic score, 0–100.",
  year: "Calendar year of the Steam release.",
  price: "Current Steam price in USD.",
  avg_players:
    "Mean monthly concurrent players over the game's full SteamCharts history (log scale).",
  peak_players:
    "All-time peak of monthly concurrent players on Steam (log scale).",
  current_players:
    "Concurrent players in the most recent SteamCharts month (log scale).",
  reddit_count:
    "Number of Reddit posts referencing the game: a proxy for cultural footprint (log scale).",
  engagement_total:
    "Total RAWG players who tagged the game as playing, beaten, or dropped (log scale).",
  ratings_count:
    "Number of RAWG user ratings: a proxy for audience size (log scale).",
  color_genre: "Each dot is tinted by its primary RAWG genre.",
  color_alive_ratio:
    "Red, orange and green gradient mapping current alive ratio.",
  color_year: "Viridis gradient from 2012 (dark purple) to 2025 (yellow).",
};

const COLOR_LABELS = {
  genre: "Primary genre",
  alive_ratio: "Alive ratio gradient",
  year: "Release year gradient",
};
