"""
Processing Pipeline — Entry Point

Full workflow:
    1. rawg.py      → clean RAWG dataset (in memory)
    2. join.py      → match RAWG games to Steam app IDs (in memory)
    3. steamcharts.py → scrape player-count time series for matched games
    4. join.py      → intersect all three sources, save final outputs

Outputs saved to ../output/:
    rawg_steam_final.csv    — one row per game, RAWG + Steam metadata
    steamcharts_final.csv   — monthly player counts for the same games

Usage:
    python processing.py
"""

import os

import pandas as pd
from datasets import load_dataset

from rawg import process_rawg
from join import match_rawg_steam, filter_by_steamcharts
from steamcharts import scrape_to_disk, build_timeseries

OUTPUT_DIR = "../../website/data"
TMP_STEAMCHARTS = f"../tmp/tmp_steamcharts_raw.csv"


def run():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # Step 1: Clean RAWG
    print("STEP 1: Cleaning RAWG dataset")
    rawg_df = process_rawg()

    # Step 2: Match RAWG with Steam to obtain Steam app IDs
    print("STEP 2: Matching RAWG with Steam dataset")
    steam_df = load_dataset(
        "FronkonGames/steam-games-dataset", split="train"
    ).to_pandas()
    matched_df = match_rawg_steam(rawg_df, steam_df)

    # Step 3: Scrape Steamcharts for every matched Steam app ID
    print("STEP 3: Scraping Steamcharts time series")
    games_dict = (
        matched_df[matched_df["steam_appid"].notna()]
        .drop_duplicates(subset=["steam_appid"])
        .assign(appid_int=lambda d: pd.to_numeric(d["steam_appid"], errors="coerce"))
        .dropna(subset=["appid_int"])
        .set_index("appid_int")["name"]
        .rename(index=int)
        .to_dict()
    )
    # Keys must be plain Python ints for the URL builder
    games_dict = {int(k): v for k, v in games_dict.items()}

    # Scrape game by game, append immediately to a temp CSV
    scrape_to_disk(games_dict, TMP_STEAMCHARTS)
    sc_df = build_timeseries(TMP_STEAMCHARTS)

    # Step 4: Final intersection to keep only games in all three sources
    print("STEP 4: Final intersection & export")
    rawg_steam_final, sc_final = filter_by_steamcharts(matched_df, sc_df)

    rawg_path = f"{OUTPUT_DIR}/rawg_steam_final.csv"
    sc_path = f"{OUTPUT_DIR}/steamcharts_final.csv"
    rawg_steam_final.to_csv(rawg_path, index=False)
    sc_final.to_csv(sc_path, index=False)

    print(f"\nDone.")
    print(
        f"  {rawg_path}:  {len(rawg_steam_final)} games, {rawg_steam_final.shape[1]} columns"
    )
    print(f"  {sc_path}:  {len(sc_final)} monthly records")


if __name__ == "__main__":
    run()
