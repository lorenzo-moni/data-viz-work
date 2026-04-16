"""
Fase 1: RAWG ↔ Steam ↔ Steamcharts bridge.
Outputs:
  - rawg_steam_matched.csv         (solo giochi RAWG con match Steam, tutte le colonne RAWG + tutte le colonne Steam)
  - rawg_steam_final.csv           (solo giochi presenti ANCHE in steamcharts)
  - steamcharts_final.csv          (solo record steamcharts dei giochi sopra)
"""

import re
import unicodedata
import pandas as pd
from rapidfuzz import process, fuzz
from datasets import load_dataset


# ============================================================
# 1. LOAD
# ============================================================
rawg_pd = pd.read_csv("../input/rawg_clean.csv")
steam_pd = load_dataset("FronkonGames/steam-games-dataset", split="train").to_pandas()

RAWG_NAME_COL = "name"
RAWG_DATE_COL = "released"
STEAM_ID_COL = "appID"
STEAM_NAME_COL = "name"
STEAM_DATE_COL = "release_date"

DROP_COLS = [
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
steam_pd = steam_pd.drop(columns=[c for c in DROP_COLS if c in steam_pd.columns])
print(f"Steam columns dopo drop: {len(steam_pd.columns)}")

# ============================================================
# 2. NORMALIZE
# ============================================================
EDITION_RE = re.compile(
    r"\b(goty|game of the year|definitive|remastered|remaster|deluxe|"
    r"complete|ultimate|enhanced|anniversary|collectors?|standard|"
    r"digital|gold|platinum|premium|legendary)\s*(edition|bundle|pack)?\b",
    flags=re.IGNORECASE,
)
TRADEMARK_RE = re.compile(r"[®™©]")
NONALNUM_RE = re.compile(r"[^a-z0-9]+")


def normalize(s):
    if pd.isna(s):
        return ""
    s = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode()
    s = s.lower()
    s = TRADEMARK_RE.sub("", s)
    s = EDITION_RE.sub("", s)
    s = NONALNUM_RE.sub(" ", s).strip()
    return s


rawg_pd["key"] = rawg_pd[RAWG_NAME_COL].map(normalize)
steam_pd["key"] = steam_pd[STEAM_NAME_COL].map(normalize)

rawg_pd["year"] = pd.to_datetime(rawg_pd[RAWG_DATE_COL], errors="coerce").dt.year
steam_pd["year"] = pd.to_datetime(steam_pd[STEAM_DATE_COL], errors="coerce").dt.year

steam_clean = (
    steam_pd.dropna(subset=["key", "year"])
    .query("key != ''")
    .sort_values(STEAM_ID_COL)
    .drop_duplicates(subset=["key", "year"], keep="first")
    .reset_index(drop=True)
)
print(f"RAWG rows: {len(rawg_pd)}  |  Steam clean rows: {len(steam_clean)}")


# ============================================================
# 3. PASS 1 — exact (key, year)
# ============================================================
p1 = rawg_pd.merge(
    steam_clean[[STEAM_ID_COL, "key", "year"]],
    on=["key", "year"],
    how="left",
).rename(columns={STEAM_ID_COL: "steam_appid"})
p1["match_type"] = p1["steam_appid"].notna().map({True: "exact", False: None})
print(f"Pass 1 (exact key+year):  {p1['steam_appid'].notna().sum():>6}")


# ============================================================
# 4. PASS 2 — key + year +- 1
# ============================================================
missing_mask = p1["steam_appid"].isna()
steam_by_key = (
    steam_clean.groupby("key")
    .apply(lambda g: list(zip(g[STEAM_ID_COL], g["year"])))
    .to_dict()
)


def match_year_tolerant(row):
    candidates = steam_by_key.get(row["key"])
    if not candidates or pd.isna(row["year"]):
        return None
    best = min(candidates, key=lambda x: abs(x[1] - row["year"]))
    return best[0] if abs(best[1] - row["year"]) <= 1 else None


p2_ids = p1.loc[missing_mask, ["key", "year"]].apply(match_year_tolerant, axis=1)
p1.loc[missing_mask & p2_ids.notna(), "steam_appid"] = p2_ids[p2_ids.notna()]
p1.loc[missing_mask & p2_ids.notna(), "match_type"] = "year_tolerant"
print(f"Pass 2 (year ±1):         {(p1['match_type'] == 'year_tolerant').sum():>6}")


# ============================================================
# 5. PASS 3 — fuzzy (ratio >= 95) + year +- 1
# ============================================================
still_missing = p1["steam_appid"].isna() & p1["key"].str.len().gt(3)
missing_idx = p1.index[still_missing]

steam_by_year = {y: g.reset_index(drop=True) for y, g in steam_clean.groupby("year")}


def fuzzy_match(row):
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
        print(f"  fuzzy {i}/{len(missing_idx)}")
    result = fuzzy_match(p1.loc[idx])
    if result is not None:
        p1.at[idx, "steam_appid"] = result
        p1.at[idx, "match_type"] = "fuzzy"

print(f"Pass 3 (fuzzy ≥95):       {(p1['match_type'] == 'fuzzy').sum():>6}")


# ============================================================
# 6. FILTER TO MATCHED ONLY
# ============================================================
matched = p1[p1["steam_appid"].notna()].copy()
matched["steam_appid"] = matched["steam_appid"].astype(str)


steam_meta = steam_pd.drop_duplicates(subset=[STEAM_ID_COL]).copy()
steam_meta[STEAM_ID_COL] = steam_meta[STEAM_ID_COL].astype(str)


steam_meta = steam_meta.drop(columns=["key", "year"], errors="ignore")

rawg_steam = matched.merge(
    steam_meta,
    left_on="steam_appid",
    right_on=STEAM_ID_COL,
    how="left",
    suffixes=("", "_steam"),
).drop(columns=[STEAM_ID_COL], errors="ignore")


for col in rawg_steam.columns:
    if rawg_steam[col].apply(lambda x: isinstance(x, list)).any():
        rawg_steam[col] = rawg_steam[col].map(
            lambda x: ",".join(map(str, x)) if isinstance(x, list) else x
        )

print(f"\n=== MATCHED ===")
print(f"RAWG total:        {len(rawg_pd)}")
print(f"Matched to Steam:  {len(rawg_steam)}  ({len(rawg_steam)/len(rawg_pd):.1%})")
print(f"Columns in output: {len(rawg_steam.columns)}")
print(rawg_steam["match_type"].value_counts())


# ============================================================
# 7. JOIN WITH STEAMCHARTS — keep only games in BOTH
# ============================================================
sc = pd.read_csv("../input/steamcharts.csv")
sc["steam_appid"] = sc["steam_appid"].astype(str)

ids_rawg_steam = set(rawg_steam["steam_appid"].unique())
ids_sc = set(sc["steam_appid"].unique())
common_ids = ids_rawg_steam & ids_sc

print(f"\n=== FINAL INTERSECTION ===")
print(f"Games in rawg_steam_matched: {len(ids_rawg_steam)}")
print(f"Games in steamcharts:        {len(ids_sc)}")
print(f"Games in BOTH:               {len(common_ids)}")

rawg_steam_final = rawg_steam[rawg_steam["steam_appid"].isin(common_ids)].reset_index(
    drop=True
)
sc_final = sc[sc["steam_appid"].isin(common_ids)].reset_index(drop=True)

rawg_steam_final.to_csv("../output/rawg_steam_final.csv", index=False)
sc_final.to_csv("../output/steamcharts_final.csv", index=False)

print(f"\nSaved: rawg_steam_final.csv   ({len(rawg_steam_final)} games)")
print(f"Saved: steamcharts_final.csv  ({len(sc_final)} monthly records)")
