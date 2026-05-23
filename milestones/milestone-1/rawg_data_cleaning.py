"""
RAWG Dataset — Preprocessing
Cleans rawg-games-dataset (890K rows, 54 cols) down to about 10-20K usable games.
"""

import pandas as pd
import numpy as np
import json
import re

# Load
df = pd.read_csv('rawg-games-dataset.csv', low_memory=False)
print(f"Loaded: {df.shape}")

# Drop useless columns (images, colors, sparse/irrelevant)
DROP_COLS = [
    'background_image', 'background_image_additional',
    'saturated_color', 'dominant_color', 'short_screenshots',
    'clip',                     # always null
    'description',              # HTML — keep description_raw instead (dropped later)
    'metacritic_url', 'reddit_url', 'reddit_name',
    'reddit_description', 'reddit_logo', 'website',
    'reactions',                # opaque numeric ID map
]
df.drop(columns=[c for c in DROP_COLS if c in df.columns], inplace=True)

# Normalize nulls ("nan" strings, empty strings all map to NaN)
df.replace({'nan': np.nan, '': np.nan}, inplace=True)

# Filter to games with meaningful data
n_before = len(df)
df = df[
    df['rating'].notna() &
    df['genres'].notna() &
    df['released'].notna() &
    (pd.to_numeric(df['ratings_count'], errors='coerce') > 10)
].copy()
print(f"Filtered: {n_before:,} to {len(df):,} games ({len(df)/n_before*100:.1f}% kept)")

# Parse ESRB rating (JSON dict to name string)
def parse_esrb(val):
    if pd.isna(val):
        return np.nan
    try:
        return json.loads(val.replace('""', '"')).get('name', np.nan)
    except Exception:
        return np.nan

df['esrb_rating'] = df['esrb_rating'].apply(parse_esrb)

# Parse added_by_status to separate columns
def parse_json_safe(val):
    if pd.isna(val):
        return {}
    try:
        return json.loads(val.replace('""', '"'))
    except Exception:
        return {}

status_df = df['added_by_status'].apply(parse_json_safe).apply(pd.Series)
for col in ['owned', 'beaten', 'playing', 'toplay', 'dropped', 'yet']:
    if col in status_df.columns:
        df[f'status_{col}'] = status_df[col]
df.drop(columns=['added_by_status'], inplace=True)

# Parse ratings distribution (pipe-delimited pseudo-JSON to pct columns)
def parse_ratings(val):
    result = {'exceptional': np.nan, 'recommended': np.nan, 'meh': np.nan, 'skip': np.nan}
    if pd.isna(val):
        return result
    for chunk in str(val).split('|'):
        title_m = re.search(r'title:\s*(\w+)', chunk)
        pct_m = re.search(r'percent:\s*([\d.]+)', chunk)
        if title_m and pct_m:
            title = title_m.group(1)
            if title in result:
                result[title] = float(pct_m.group(1))
    return result

ratings_df = df['ratings'].apply(parse_ratings).apply(pd.Series)
for col in ratings_df.columns:
    df[f'pct_{col}'] = ratings_df[col]
df.drop(columns=['ratings'], inplace=True)

# Fix dtypes
df['released'] = pd.to_datetime(df['released'], errors='coerce')
df['updated'] = pd.to_datetime(df['updated'], errors='coerce')
df['release_year'] = df['released'].dt.year

int_candidates = [
    'id', 'ratings_count', 'reviews_count', 'reviews_text_count',
    'added', 'suggestions_count', 'reddit_count', 'youtube_count',
    'twitch_count', 'creators_count', 'screenshots_count',
    'achievements_count', 'parent_achievements_count',
    'game_series_count', 'additions_count', 'movies_count', 'parents_count',
]
for col in int_candidates:
    if col in df.columns:
        df[col] = pd.to_numeric(df[col], errors='coerce')

for col in ['metacritic', 'playtime', 'rating', 'rating_top', 'tba']:
    if col in df.columns:
        df[col] = pd.to_numeric(df[col], errors='coerce')

# Clean multi-value string fields (stay pipe-delimited)
MULTI_VALUE_COLS = ['platforms', 'parent_platforms', 'stores', 'developers',
                    'genres', 'tags', 'publishers']
for col in MULTI_VALUE_COLS:
    if col in df.columns:
        df[col] = df[col].apply(
            lambda x: '|'.join(v.strip() for v in str(x).split('|')) if pd.notna(x) else np.nan
        )

# Count helpers
for col in ['genres', 'platforms', 'tags']:
    if col in df.columns:
        df[f'n_{col}'] = df[col].apply(lambda x: len(x.split('|')) if pd.notna(x) else 0)

# Derived features
df['completion_rate'] = np.where(df['status_owned'] > 0, df['status_beaten'] / df['status_owned'], np.nan)
df['drop_rate'] = np.where(df['status_owned'] > 0, df['status_dropped'] / df['status_owned'], np.nan)
df['has_metacritic'] = df['metacritic'].notna()
df['metacritic_norm'] = df['metacritic'] / 20  # 0-100 to 0-5
df['rating_delta'] = df['rating'] - df['metacritic_norm']

# Final column cleanup
FINAL_DROP = [
    'slug', 'name_original', 'rating_top', 'metacritic_platforms',
    'alternative_names', 'description_raw', 'tba', 'parents_count',
]
df.drop(columns=[c for c in FINAL_DROP if c in df.columns], inplace=True)

# Export
df.to_csv('rawg_clean.csv', index=False)
print(f"Exported {len(df)} rows × {df.shape[1]} cols saved to rawg_clean.csv")
