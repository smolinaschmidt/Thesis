"""
Extract the dominant color from every frame of each Carrie trailer.
Outputs a JSON file per movie: colors_1976.json, colors_2002.json, colors_2013.json

Usage:
    python extract_colors.py

Requirements:
    pip install opencv-python numpy scikit-learn yt-dlp requests
"""

import os
import json
import requests
import subprocess
import cv2
import numpy as np
from sklearn.cluster import KMeans

TMDB_API_KEY = "18dea89aea654fde541b73b5f34e97da"
OUTPUT_DIR = os.path.dirname(os.path.abspath(__file__))

MOVIES = [
    {"id": 7340,   "title": "Carrie", "year": "1976"},
    {"id": 7342,   "title": "Carrie", "year": "2002"},
    {"id": 133805, "title": "Carrie", "year": "2013"},
]


def get_trailer_url(tmdb_id):
    """Get the YouTube trailer URL from TMDB."""
    url = f"https://api.themoviedb.org/3/movie/{tmdb_id}/videos?api_key={TMDB_API_KEY}"
    resp = requests.get(url, timeout=15)
    data = resp.json()
    for video in data.get("results", []):
        if video["site"] == "YouTube" and video["type"] == "Trailer":
            return f"https://www.youtube.com/watch?v={video['key']}"
    # Fallback: any YouTube video associated with the movie
    for video in data.get("results", []):
        if video["site"] == "YouTube":
            return f"https://www.youtube.com/watch?v={video['key']}"
    return None


def download_trailer(url, output_path):
    """Download trailer using yt-dlp. Downloads best MP4 ≤360p with ffmpeg merge."""
    if os.path.exists(output_path):
        print(f"  Already downloaded: {output_path}")
        return True
    cmd = [
        "yt-dlp",
        "-f", "best[height<=360][ext=mp4]/best[height<=480]/best",
        "-o", output_path,
        url,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"  yt-dlp error: {result.stderr[:500]}")
        return False
    return True


def get_dominant_color(frame, k=1):
    """Get the single dominant color of a frame using KMeans."""
    # Resize to speed up clustering
    small = cv2.resize(frame, (80, 45))
    pixels = small.reshape(-1, 3).astype(np.float32)

    kmeans = KMeans(n_clusters=k, n_init=1, max_iter=20, random_state=0)
    kmeans.fit(pixels)
    dominant = kmeans.cluster_centers_[0]
    # OpenCV uses BGR → convert to RGB
    r, g, b = int(dominant[2]), int(dominant[1]), int(dominant[0])
    return [r, g, b]


def extract_colors_from_video(video_path, sample_every_n_frames=1):
    """
    Extract dominant color from each frame (or every Nth frame).
    Returns list of { frame, time, color } objects.
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(f"  Could not open video: {video_path}")
        return []

    fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    print(f"  Video: {total_frames} frames @ {fps:.1f} fps")

    colors = []
    frame_idx = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        if frame_idx % sample_every_n_frames == 0:
            color = get_dominant_color(frame)
            time_sec = round(frame_idx / fps, 3) if fps > 0 else 0
            colors.append({
                "frame": frame_idx,
                "time": time_sec,
                "color": color
            })

            if frame_idx % 100 == 0:
                print(f"    Frame {frame_idx}/{total_frames} → rgb({color[0]},{color[1]},{color[2]})")

        frame_idx += 1

    cap.release()
    return colors


def main():
    # Sample every 2 frames to keep it manageable (adjust as needed)
    SAMPLE_EVERY = 2

    for movie in MOVIES:
        print(f"\n{'='*50}")
        print(f"Processing: {movie['title']} ({movie['year']})")
        print(f"{'='*50}")

        # 1. Get trailer URL
        trailer_url = get_trailer_url(movie["id"])
        if not trailer_url:
            print(f"  No trailer found on TMDB for ID {movie['id']}")
            continue
        print(f"  Trailer: {trailer_url}")

        # 2. Download trailer
        video_path = os.path.join(OUTPUT_DIR, f"trailer_{movie['year']}.mp4")
        if not download_trailer(trailer_url, video_path):
            print(f"  Failed to download trailer.")
            continue

        # 3. Extract colors
        print(f"  Extracting colors (every {SAMPLE_EVERY} frames)...")
        colors = extract_colors_from_video(video_path, sample_every_n_frames=SAMPLE_EVERY)

        if not colors:
            print(f"  No colors extracted.")
            continue

        # 4. Save JSON
        output_file = os.path.join(OUTPUT_DIR, f"colors_{movie['year']}.json")
        output_data = {
            "title": movie["title"],
            "year": movie["year"],
            "tmdb_id": movie["id"],
            "trailer_url": trailer_url,
            "sample_every_n_frames": SAMPLE_EVERY,
            "total_colors": len(colors),
            "frames": colors
        }
        with open(output_file, "w") as f:
            json.dump(output_data, f)

        print(f"  Saved {len(colors)} colors → {output_file}")

    print("\nDone! JSON files ready for the web visualization.")


if __name__ == "__main__":
    main()
