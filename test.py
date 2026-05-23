import pandas as pd
from datasets import load_dataset
from io import StringIO

# steam_df = load_dataset("FronkonGames/steam-games-dataset", split="train").to_pandas()
from curl_cffi import requests

# # Cerca CSGO (case-insensitive, cerca substring)
# print(steam_df.columns.tolist())
# csgo = steam_df[steam_df["appID"] == "570"]
# print(csgo[["name", "appID"]].to_string())


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


print(fetch_steamcharts(34330, "TUMA"))
