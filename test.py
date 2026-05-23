import pandas as pd
from datasets import load_dataset

steam_df = load_dataset("FronkonGames/steam-games-dataset", split="train").to_pandas()

# Cerca CSGO (case-insensitive, cerca substring)
print(steam_df.columns.tolist())
csgo = steam_df[steam_df["appID"] == "570"]
print(csgo[["name", "appID"]].to_string())
