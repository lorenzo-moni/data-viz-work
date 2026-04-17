"""
RAWG Dataset Preprocessing

Minimal cleaning pipeline for the atalaydenknalbant/rawg-games-dataset
(890K rows, 54 cols) on Hugging Face.

This file does the following operations:
    1.  Drop useless columns
    2.  Normalize nulls
    3.  Filter to games with real data (has rating, genre, release date, >10 ratings)
    4.  Parse nested JSON fields (esrb_rating, added_by_status)
    5.  Parse ratings distribution into separate columns
    6.  Fix dtypes (dates, numerics)
    7.  Compute derived features like completion rate, drop rate, rating delta
"""

import json
import re

import numpy as np
import pandas as pd
from datasets import load_dataset

pd.set_option("display.max_columns", 60)
pd.set_option("display.max_colwidth", 80)


HF_DATASET = "atalaydenknalbant/rawg-games-dataset"
OUTPUT_CSV = "../input/rawg_clean.csv"

# Image URLs / color hex codes / irrelevant-for-viz columns
DROP_COLS = [
    "background_image",
    "background_image_additional",
    "saturated_color",
    "dominant_color",
    "short_screenshots",
    "clip",  # always null
    "description",  # HTML version - keep description_raw instead
    "metacritic_url",
    "reddit_url",
    "reddit_name",
    "reddit_description",
    "reddit_logo",
    "website",
    "reactions",  # opaque numeric ID map, not useful
]

# Columns dropped at the end (after feature derivation)
FINAL_DROP = [
    "slug",  # redundant with id+name
    "name_original",  # mostly same as name
    "rating_top",  # always 4 or 5, not informative
    "metacritic_platforms",  # sparse, complex
    "alternative_names",  # text, not useful for viz
    "description_raw",  # keep for NLP if needed, heavy for basic viz
    "tba",  # almost entirely null
    "parents_count",  # sparse, unclear meaning
]

STATUS_COLS = ["owned", "beaten", "playing", "toplay", "dropped", "yet"]

MULTI_VALUE_COLS = [
    "platforms",
    "parent_platforms",
    "stores",
    "developers",
    "genres",
    "tags",
    "publishers",
]

INT_CANDIDATES = [
    "id",
    "ratings_count",
    "reviews_count",
    "reviews_text_count",
    "added",
    "suggestions_count",
    "reddit_count",
    "youtube_count",
    "twitch_count",
    "creators_count",
    "screenshots_count",
    "achievements_count",
    "parent_achievements_count",
    "game_series_count",
    "additions_count",
    "movies_count",
    "parents_count",
]


# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------
def parse_esrb(val):
    """Extract the `name` field from the ESRB JSON-like string."""
    if pd.isna(val):
        return np.nan
    try:
        d = json.loads(val.replace('""', '"'))  # handle CSV double-quoting
        return d.get("name", np.nan)
    except Exception:
        return np.nan


def parse_json_safe(val):
    """Parse a JSON-like string to a dict, returning {} on failure."""
    if pd.isna(val):
        return {}
    try:
        return json.loads(val.replace('""', '"'))
    except Exception:
        return {}


def parse_ratings(val):
    """
    Parse the `ratings` field (not valid JSON, pipe-delimited) into a dict
    with keys: exceptional, recommended, meh, skip (percentage values).
    """
    result = {
        "exceptional": np.nan,
        "recommended": np.nan,
        "meh": np.nan,
        "skip": np.nan,
    }
    if pd.isna(val):
        return result
    for chunk in str(val).split("|"):
        title_m = re.search(r"title:\s*(\w+)", chunk)
        pct_m = re.search(r"percent:\s*([\d.]+)", chunk)
        if title_m and pct_m:
            title = title_m.group(1)
            if title in result:
                result[title] = float(pct_m.group(1))
    return result


def process_rawg() -> pd.DataFrame:
    """
    Run the full RAWG cleaning pipeline and return the cleaned DataFrame.
    """
    df = load_dataset(HF_DATASET, split="train").to_pandas()

    # Drop useless columns
    df.drop(columns=[c for c in DROP_COLS if c in df.columns], inplace=True)

    # Handle Nan
    df.replace({"nan": np.nan, "": np.nan}, inplace=True)

    n_before = len(df)

    # Only get games with miningful data
    df = df[
        df["rating"].notna()
        & df["genres"].notna()
        & df["released"].notna()
        & (pd.to_numeric(df["ratings_count"], errors="coerce") > 10)
    ].copy()

    print(f"[rawg] Filtered: {n_before:,} -> {len(df):,} games")

    # Parse esrb rating
    df["esrb_rating"] = df["esrb_rating"].apply(parse_esrb)

    # Parse added by status
    status_df = df["added_by_status"].apply(parse_json_safe).apply(pd.Series)
    for col in STATUS_COLS:
        if col in status_df.columns:
            df[f"status_{col}"] = status_df[col]
    df.drop(columns=["added_by_status"], inplace=True)

    # Parse rating distributions
    ratings_df = df["ratings"].apply(parse_ratings).apply(pd.Series)
    for col in ratings_df.columns:
        df[f"pct_{col}"] = ratings_df[col]
    df.drop(columns=["ratings"], inplace=True)

    # Fix dtypes
    df["released"] = pd.to_datetime(df["released"], errors="coerce")
    df["updated"] = pd.to_datetime(df["updated"], errors="coerce")
    df["release_year"] = df["released"].dt.year

    for col in INT_CANDIDATES:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    for col in ["metacritic", "playtime", "rating", "rating_top", "tba"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    # Clean multi-value string fields
    for col in MULTI_VALUE_COLS:
        if col in df.columns:
            df[col] = df[col].apply(
                lambda x: (
                    "|".join(v.strip() for v in str(x).split("|"))
                    if pd.notna(x)
                    else np.nan
                )
            )

    for col in ["genres", "platforms", "tags"]:
        if col in df.columns:
            df[f"n_{col}"] = df[col].apply(
                lambda x: len(x.split("|")) if pd.notna(x) else 0
            )

    # Compute derived features
    df["completion_rate"] = np.where(
        df["status_owned"] > 0,
        df["status_beaten"] / df["status_owned"],
        np.nan,
    )
    df["drop_rate"] = np.where(
        df["status_owned"] > 0,
        df["status_dropped"] / df["status_owned"],
        np.nan,
    )
    df["has_metacritic"] = df["metacritic"].notna()
    df["metacritic_norm"] = df["metacritic"] / 20
    df["rating_delta"] = df["rating"] - df["metacritic_norm"]

    df.drop(columns=[c for c in FINAL_DROP if c in df.columns], inplace=True)
    print(f"[rawg] Final shape: {df.shape}")

    return df
