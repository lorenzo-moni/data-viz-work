"""


Scrapes monthly player count data from steamcharts.com for a given set of
Steam app IDs and writes results incrementally to disk to avoid memory issues.

Exported:
    fetch_steamcharts(app_id, name)              -> pd.DataFrame | None
    scrape_to_disk(games, output_path, delay)    -> int  (rows written)
    build_timeseries(csv_path)                   -> pd.DataFrame
"""

import os
import time
from io import StringIO
import random

import pandas as pd
from curl_cffi import requests


def fetch_steamcharts(app_id: int, name: str) -> pd.DataFrame | None:
    """Fetch monthly player count history for a single game"""
    url = f"https://steamcharts.com/app/{app_id}"
    try:
        r = requests.get(url, impersonate="chrome136", timeout=15)
        if r.status_code != 200:
            print(f"{name}: HTTP {r.status_code}")
            return None
        tables = pd.read_html(StringIO(r.text))
        if not tables:
            print(f"{name}: no table found")
            return None
        df = tables[0].copy()
        df["app_id"] = app_id
        df["name"] = name
        return df
    except Exception as e:
        print(f"{name}: {e}")
        return None


def scrape_to_disk(games: dict, output_path: str, delay: float = 4) -> int:
    """
    Scrape steamcharts.com for every game in games, writing each result
    immediately to a CSV file in append mode to keep RAM usage minimal.

    Since scraping can be prone to connection error if `output_path` already exists,
    the last app_id in the file is always dropped and re-scraped (its rows may be truncated if the
    previous run was interrupted mid-write). All earlier app_ids are skipped.

    Parameters
    ----------
    games       : {app_id (int): game_name (str)}
    output_path : path to the CSV file to write (created or appended to)
    delay       : seconds between requests

    Returns
    -------
    Number of new rows written in this run.
    """
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    failed_path = output_path.replace(".csv", "_failed.csv")

    safely_done: set[int] = set()
    failed_ids: set[int] = set()
    header_written = False

    # Load permanently failed IDs from previous runs
    if os.path.exists(failed_path):
        failed_df = pd.read_csv(failed_path)
        failed_ids = set(failed_df["app_id"].dropna().astype(int).tolist())
        print(f"[steamcharts] Skipping {len(failed_ids)} permanently failed app_ids")

    if os.path.exists(output_path):
        try:
            existing = pd.read_csv(output_path)
            all_ids = existing["app_id"].dropna().astype(int).tolist()
            if all_ids:
                last_id = all_ids[-1]
                # Drop the last game's rows because they may be truncated
                existing_clean = existing[existing["app_id"].astype(int) != last_id]
                existing_clean.to_csv(output_path, index=False)
                safely_done = set(
                    existing_clean["app_id"].dropna().astype(int).unique()
                )
                header_written = True
                print(
                    f"[steamcharts] Resuming: {len(safely_done)} games safely done, "
                    f"re-scraping last game (appid={last_id}) in case it was partial"
                )
        except Exception:
            pass

    remaining = {
        k: v
        for k, v in sorted(games.items(), key=lambda x: x[1][1], reverse=True)
        if int(k) not in safely_done and int(k) not in failed_ids
    }
    print(f"[steamcharts] {len(remaining)} games to scrape: {output_path}")

    rows_written = 0
    fetched = 0

    for app_id, (name, _) in remaining.items():
        print(f"  ({len(safely_done) + fetched + 1}/{len(games)}) {name} {app_id}...")
        df_game = fetch_steamcharts(int(app_id), name)
        if df_game is not None:
            df_game.to_csv(
                output_path,
                mode="a",
                index=False,
                header=not header_written,
            )
            rows_written += len(df_game)
            header_written = True
            fetched += 1
        else:
            pd.DataFrame({"app_id": [int(app_id)], "name": [name]}).to_csv(
                failed_path,
                mode="a",
                index=False,
                header=not os.path.exists(failed_path),
            )
        time.sleep(delay + random.uniform(0, 2))

    print(
        f"[steamcharts] Done: {fetched} new games fetched, {rows_written} new rows written"
    )
    return rows_written


def build_timeseries(csv_path: str) -> pd.DataFrame:
    """
    Read the raw scraped CSV and return a clean time series DataFrame.

    Columns in output: app_id, name, month_str, avg_players, peak_players,
                       month, pct_of_peak, months_since_peak
    """
    if not os.path.exists(csv_path):
        raise FileNotFoundError(f"Scraped data not found at {csv_path}")

    raw = pd.read_csv(csv_path)
    if raw.empty:
        raise ValueError("Scraped CSV is empty: all scrapes may have failed")

    df = raw.rename(
        columns={
            "Month": "month_str",
            "Avg. Players": "avg_players",
            "Peak Players": "peak_players",
        }
    )[["app_id", "name", "month_str", "avg_players", "peak_players"]].copy()

    # Drop the "Last 30 Days" row (no parseable month)
    df = df[df["month_str"].str.contains(r"\d{4}", na=False)].copy()

    df["month"] = pd.to_datetime(df["month_str"], format="%B %Y", errors="coerce")
    df = df.dropna(subset=["month"])

    df["avg_players"] = pd.to_numeric(df["avg_players"], errors="coerce")
    df["peak_players"] = pd.to_numeric(df["peak_players"], errors="coerce")

    df = df.sort_values(["name", "month"]).reset_index(drop=True)

    # Normalize to peak
    df["pct_of_peak"] = df.groupby("name")["avg_players"].transform(
        lambda x: (x / x.max()) * 100
    )

    # Months since each game's peak
    def _months_since_peak(group):
        peak_month = group.loc[group["avg_players"].idxmax(), "month"]
        group["months_since_peak"] = (group["month"].dt.year - peak_month.year) * 12 + (
            group["month"].dt.month - peak_month.month
        )
        return group

    df = df.groupby("name", group_keys=False).apply(_months_since_peak)

    print(
        f"[steamcharts] Clean shape: {df.shape} | "
        f"{df['month'].min().date()} to {df['month'].max().date()}"
    )
    return df
