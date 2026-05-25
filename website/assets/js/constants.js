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

const ALL_ARCHETYPES = ["immortal", "aaa", "slow_burn", "fading_aaa", "mid"];

const ARCHETYPE_LABELS = {
  immortal: "Immortal",
  aaa: "AAA",
  slow_burn: "Slow burn",
  fading_aaa: "Fading AAA",
  mid: "Mid",
};

let ARCHETYPE_COLOR = {
  immortal: "#7fc97f",
  aaa: "#e6a356",
  slow_burn: "#8ab4ff",
  fading_aaa: "#d96c6c",
  mid: "#a69a8c",
};

let TS_PALETTE = d3.schemeTableau10;

let GENRE_PALETTE = ["#e6a356", "#7fc97f", "#d96c6c", "#a5b1e4", "#ddb892", "#c8a2d6"];

let CB_MODE = localStorage.getItem("mobava_colorblind") === "1";

const _CB_ARCHETYPE = {
  immortal: "#009E73",
  aaa: "#E69F00",
  slow_burn: "#56B4E9",
  fading_aaa: "#D55E00",
  mid: "#999999",
};

const _DEFAULT_ARCHETYPE = {
  immortal: "#7fc97f",
  aaa: "#e6a356",
  slow_burn: "#8ab4ff",
  fading_aaa: "#d96c6c",
  mid: "#a69a8c",
};

const _CB_TS_PALETTE = ["#E69F00", "#56B4E9", "#009E73", "#F0E442", "#0072B2", "#D55E00", "#CC79A7", "#000000"];
const _DEFAULT_TS_PALETTE = d3.schemeTableau10;

const _CB_GENRE_PALETTE = ["#E69F00", "#56B4E9", "#009E73", "#F0E442", "#0072B2", "#CC79A7"];
const _DEFAULT_GENRE_PALETTE = ["#e6a356", "#7fc97f", "#d96c6c", "#a5b1e4", "#ddb892", "#c8a2d6"];

function _applyCBMode() {
  if (CB_MODE) {
    ARCHETYPE_COLOR = { ..._CB_ARCHETYPE };
    TS_PALETTE = _CB_TS_PALETTE;
    GENRE_PALETTE = _CB_GENRE_PALETTE;
  } else {
    ARCHETYPE_COLOR = { ..._DEFAULT_ARCHETYPE };
    TS_PALETTE = _DEFAULT_TS_PALETTE;
    GENRE_PALETTE = _DEFAULT_GENRE_PALETTE;
  }
}
_applyCBMode();

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

const TYPE_COLORS = {
  story: "#d96c6c",
  hybrid: "#e6a356",
  pure_online: "#7fc97f",
};
const TYPE_LABELS = {
  story: "Story",
  hybrid: "Hybrid",
  pure_online: "Pure Online",
};

const TYPES = ["story", "hybrid", "pure_online"];

const AAA_PUBLISHERS = new Set([
  "Activision",
  "Activision Blizzard",
  "Blizzard Entertainment",
  "Electronic Arts",
  "EA",
  "EA Sports",
  "Ubisoft",
  "Ubisoft Entertainment",
  "Sony Interactive Entertainment",
  "Sony Computer Entertainment",
  "Microsoft Studios",
  "Xbox Game Studios",
  "Microsoft",
  "Take-Two Interactive",
  "Rockstar Games",
  "2K",
  "2K Games",
  "Bethesda Softworks",
  "Bethesda",
  "ZeniMax",
  "Square Enix",
  "Square Enix Co., Ltd.",
  "Capcom",
  "Capcom Co., Ltd.",
  "Bandai Namco Entertainment",
  "Bandai Namco",
  "Sega",
  "Sega Games",
  "Konami",
  "Konami Digital Entertainment",
  "Warner Bros. Games",
  "Warner Bros. Interactive Entertainment",
  "Nintendo",
  "Nintendo of America",
  "CD Projekt",
  "CD PROJEKT S.A.",
  "Ubisoft Montreal",
  "Epic Games",
]);

const MONTHS_SHORTNAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
