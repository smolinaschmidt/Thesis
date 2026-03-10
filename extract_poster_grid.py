"""Extract a color grid from each Carrie poster (dominant color per cell)."""
import cv2
import json
import numpy as np
import requests
from sklearn.cluster import KMeans

TMDB_API_KEY = "18dea89aea654fde541b73b5f34e97da"
GRID_COLS = 5
GRID_ROWS = 7

MOVIES = [
    {"id": 7340, "year": "1976"},
    {"id": 7342, "year": "2002"},
    {"id": 133805, "year": "2013"},
]


def extract_poster_grid(img_path):
    img = cv2.imread(img_path)
    h, w = img.shape[:2]
    cell_h = h // GRID_ROWS
    cell_w = w // GRID_COLS
    grid = []
    for r in range(GRID_ROWS):
        row = []
        for c in range(GRID_COLS):
            y1, y2 = r * cell_h, (r + 1) * cell_h
            x1, x2 = c * cell_w, (c + 1) * cell_w
            cell = img[y1:y2, x1:x2]
            pixels = cell.reshape(-1, 3).astype(np.float32)
            km = KMeans(n_clusters=1, n_init=1, max_iter=20, random_state=0)
            km.fit(pixels)
            d = km.cluster_centers_[0]
            row.append([int(d[2]), int(d[1]), int(d[0])])
        grid.append(row)
    return grid


for m in MOVIES:
    resp = requests.get(
        f"https://api.themoviedb.org/3/movie/{m['id']}?api_key={TMDB_API_KEY}",
        timeout=15,
    )
    data = resp.json()
    poster_url = f"https://image.tmdb.org/t/p/w500{data['poster_path']}"
    img_data = requests.get(poster_url, timeout=15).content
    poster_file = f"poster_{m['year']}.jpg"
    with open(poster_file, "wb") as f:
        f.write(img_data)
    print(f"Downloaded {poster_file}")

    grid = extract_poster_grid(poster_file)
    out = {"year": m["year"], "grid": grid}
    json_file = f"poster_grid_{m['year']}.json"
    with open(json_file, "w") as f:
        json.dump(out, f)
    print(f"Saved {json_file} ({len(grid)}x{len(grid[0])} grid)")

print("Done!")
