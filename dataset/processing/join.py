"""
RAWG ↔ Steam ↔ Steamcharts bridge.

Three-pass fuzzy matching to assign Steam app IDs to RAWG games, then
intersect with Steamcharts to keep only games present in all three sources.

Exported:
    normalize(s)                              -> str
    match_rawg_steam(rawg_df, steam_df)       -> pd.DataFrame
    filter_by_steamcharts(matched_df, sc_df)  -> tuple[pd.DataFrame, pd.DataFrame]
"""

import re
import unicodedata

import pandas as pd
from rapidfuzz import fuzz, process


RAWG_NAME_COL = "name"
RAWG_DATE_COL = "released"
STEAM_ID_COL = "appID"
STEAM_NAME_COL = "name"
STEAM_DATE_COL = "release_date"

STEAM_DROP_COLS = [
    "detailed_description",
    "short_description",
    "reviews",
    "notes",
    "about_the_game",
    "header_image",
    "website",
    "support_url",
    "support_email",
    "metacritic_url",
    "screenshots",
    "movies",
    "supported_languages",
    "full_audio_languages",
    "packages",
    "score_rank",
    "recommendations",
    "required_age",
]

EDITION_RE = re.compile(
    r"\b(goty|game of the year|definitive|remastered|remaster|deluxe|"
    r"complete|ultimate|enhanced|anniversary|collectors?|standard|"
    r"digital|gold|platinum|premium|legendary)\s*(edition|bundle|pack)?\b",
    flags=re.IGNORECASE,
)
TRADEMARK_RE = re.compile(r"[®™©]")
NONALNUM_RE = re.compile(r"[^a-z0-9]+")


def normalize(s: str) -> str:
    """Normalize a game name for fuzzy matching."""
    if pd.isna(s):
        return ""
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode()
    s = s.lower()
    s = TRADEMARK_RE.sub("", s)
    s = EDITION_RE.sub("", s)
    s = NONALNUM_RE.sub(" ", s).strip()
    return s


def match_rawg_steam(rawg_df: pd.DataFrame, steam_df: pd.DataFrame) -> pd.DataFrame:
    """
    Match RAWG games to Steam app IDs via three passes:
      1. Exact (normalized key + year)
      2. Exact key + year +- 1
      3. Fuzzy ratio >= 95 + year +- 1

    Parameters
    ----------
    rawg_df  : cleaned RAWG DataFrame (output of rawg.process_rawg)
    steam_df : raw Steam dataset DataFrame (from FronkonGames/steam-games-dataset)

    Returns
    -------
    DataFrame with all RAWG columns + steam_appid + match_type columns,
    filtered to matched games only.
    """
    # Drop heavy columns from Steam
    steam_df = steam_df.drop(
        columns=[c for c in STEAM_DROP_COLS if c in steam_df.columns]
    )

    # Normalize keys and parse years
    rawg_df = rawg_df.copy()
    steam_df = steam_df.copy()

    rawg_df["key"] = rawg_df[RAWG_NAME_COL].map(normalize)
    steam_df["key"] = steam_df[STEAM_NAME_COL].map(normalize)

    rawg_df["year"] = pd.to_datetime(rawg_df[RAWG_DATE_COL], errors="coerce").dt.year
    steam_df["year"] = pd.to_datetime(steam_df[STEAM_DATE_COL], errors="coerce").dt.year

    steam_clean = (
        steam_df.dropna(subset=["key", "year"])
        .query("key != ''")
        .sort_values(STEAM_ID_COL)
        .drop_duplicates(subset=["key", "year"], keep="first")
        .reset_index(drop=True)
    )
    print(f"[join] RAWG rows: {len(rawg_df)}  |  Steam clean rows: {len(steam_clean)}")

    # Pass 1
    p1 = rawg_df.merge(
        steam_clean[[STEAM_ID_COL, "key", "year"]],
        on=["key", "year"],
        how="left",
    ).rename(columns={STEAM_ID_COL: "steam_appid"})
    p1["match_type"] = p1["steam_appid"].notna().map({True: "exact", False: None})
    print(f"[join] Pass 1:  {p1['steam_appid'].notna().sum():>6}")

    #  Pass 2
    missing_mask = p1["steam_appid"].isna()
    steam_by_key = (
        steam_clean.groupby("key")
        .apply(lambda g: list(zip(g[STEAM_ID_COL], g["year"])))
        .to_dict()
    )

    def _match_year_tolerant(row):
        candidates = steam_by_key.get(row["key"])
        if not candidates or pd.isna(row["year"]):
            return None
        best = min(candidates, key=lambda x: abs(x[1] - row["year"]))
        return best[0] if abs(best[1] - row["year"]) <= 1 else None

    p2_ids = p1.loc[missing_mask, ["key", "year"]].apply(_match_year_tolerant, axis=1)
    p1.loc[missing_mask & p2_ids.notna(), "steam_appid"] = p2_ids[p2_ids.notna()]
    p1.loc[missing_mask & p2_ids.notna(), "match_type"] = "year_tolerant"
    print(f"[join] Pass 2:         {(p1['match_type'] == 'year_tolerant').sum():>6}")

    # Pass 3
    still_missing = p1["steam_appid"].isna() & p1["key"].str.len().gt(3)
    missing_idx = p1.index[still_missing]

    steam_by_year = {
        y: g.reset_index(drop=True) for y, g in steam_clean.groupby("year")
    }

    def _fuzzy_match(row):
        if pd.isna(row["year"]):
            return None
        pool_frames = [steam_by_year.get(row["year"] + dy) for dy in (-1, 0, 1)]
        pool_frames = [f for f in pool_frames if f is not None]
        if not pool_frames:
            return None
        pool = pd.concat(pool_frames, ignore_index=True)
        match = process.extractOne(
            row["key"],
            pool["key"].tolist(),
            scorer=fuzz.ratio,
            score_cutoff=95,
        )
        if match is None:
            return None
        _, _, idx = match
        return pool.iloc[idx][STEAM_ID_COL]

    for i, idx in enumerate(missing_idx):
        if i % 500 == 0:
            print(f"  [join] fuzzy {i}/{len(missing_idx)}")
        result = _fuzzy_match(p1.loc[idx])
        if result is not None:
            p1.at[idx, "steam_appid"] = result
            p1.at[idx, "match_type"] = "fuzzy"

    print(f"[join] Pass 3:      {(p1['match_type'] == 'fuzzy').sum():>6}")

    # Filter to matched only & attach full Steam metadata
    matched = p1[p1["steam_appid"].notna()].copy()
    matched["steam_appid"] = matched["steam_appid"].astype(str)

    steam_meta = steam_df.drop_duplicates(subset=[STEAM_ID_COL]).copy()
    steam_meta[STEAM_ID_COL] = steam_meta[STEAM_ID_COL].astype(str)
    steam_meta = steam_meta.drop(columns=["key", "year"], errors="ignore")

    rawg_steam = matched.merge(
        steam_meta,
        left_on="steam_appid",
        right_on=STEAM_ID_COL,
        how="left",
        suffixes=("", "_steam"),
    ).drop(columns=[STEAM_ID_COL], errors="ignore")

    # Flatten any list columns
    for col in rawg_steam.columns:
        if rawg_steam[col].apply(lambda x: isinstance(x, list)).any():
            rawg_steam[col] = rawg_steam[col].map(
                lambda x: ",".join(map(str, x)) if isinstance(x, list) else x
            )

    print(f"\n[join] RAWG total:        {len(rawg_df)}")
    print(
        f"[join] Matched to Steam:  {len(rawg_steam)}  ({len(rawg_steam)/len(rawg_df):.1%})"
    )
    print(f"[join] Match breakdown:\n{rawg_steam['match_type'].value_counts()}")

    return rawg_steam


def filter_by_steamcharts(
    matched_df: pd.DataFrame, sc_df: pd.DataFrame
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    Keep only games present in both matched_df and the Steamcharts time series.

    Parameters
    ----------
    matched_df : output of match_rawg_steam, with steam_appid
    sc_df      : output of steamcharts.build_timeseries, with app_id

    Returns
    -------
    (rawg_steam_final, sc_final) — both filtered to the common intersection.
    """
    sc_df = sc_df.copy()
    sc_df["steam_appid"] = sc_df["app_id"].astype(str)

    ids_rawg_steam = set(matched_df["steam_appid"].unique())
    ids_sc = set(sc_df["steam_appid"].unique())
    common_ids = ids_rawg_steam & ids_sc

    print(f"\n[join] Games in rawg+steam: {len(ids_rawg_steam)}")
    print(f"[join] Games in steamcharts: {len(ids_sc)}")
    print(f"[join] Games in BOTH:   {len(common_ids)}")

    rawg_steam_final = matched_df[
        matched_df["steam_appid"].isin(common_ids)
    ].reset_index(drop=True)
    sc_final = sc_df[sc_df["steam_appid"].isin(common_ids)].reset_index(drop=True)

    return rawg_steam_final, sc_final
