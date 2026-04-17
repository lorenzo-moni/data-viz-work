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

import pandas as pd
import requests
import random


USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64; rv:89.0) Gecko/20100101 Firefox/89.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.93 Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Mobile/15E148 Safari/604.1",
]


def fetch_steamcharts(app_id: int, name: str) -> pd.DataFrame | None:
    """Fetch monthly player count history for a single game"""
    url = f"https://steamcharts.com/app/{app_id}"
    headers = {
        "User-Agent": random.choice(USER_AGENTS),
    }
    try:
        r = requests.get(url, headers=headers, timeout=15)
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

    safely_done: set[int] = set()
    header_written = False

    if os.path.exists(output_path):
        try:
            existing = pd.read_csv(output_path)
            all_ids = existing["app_id"].dropna().astype(int).tolist()
            if all_ids:
                last_id = all_ids[-1]
                # Drop the last game's rows because it they may be truncated
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

    remaining = {k: v for k, v in games.items() if int(k) not in safely_done}
    print(f"[steamcharts] {len(remaining)} games to scrape: {output_path}")

    rows_written = 0
    fetched = 0

    for app_id, name in remaining.items():
        print(f"  ({len(safely_done) + fetched + 1}/{len(games)}) {name}...")
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
        time.sleep(delay)

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
