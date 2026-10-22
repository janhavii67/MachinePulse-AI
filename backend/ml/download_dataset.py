"""Dataset downloader and verifier for MachinePulse AI.

Downloads the official AI4I 2020 Predictive Maintenance Dataset from the UCI
Machine Learning Repository and extracts it into the data/ directory.
"""

from __future__ import annotations

import io
import os
import sys
import urllib.request
import zipfile
from pathlib import Path

import pandas as pd

# UCI ML Repository direct download URL for Dataset #601
UCI_DATASET_URL = (
    "https://archive.ics.uci.edu/static/public/601/"
    "ai4i+2020+predictive+maintenance+dataset.zip"
)
UCI_PORTAL_URL = (
    "https://archive.ics.uci.edu/dataset/601/"
    "ai4i+2020+predictive+maintenance+dataset"
)
EXPECTED_FILENAME = "ai4i2020.csv"
EXPECTED_ROWS = 10000
EXPECTED_COLS = 14


def get_project_root() -> Path:
    """Resolve the project root directory reliably regardless of invocation path."""
    current_dir = Path(__file__).resolve().parent
    # ml is at backend/ml -> project root is 2 levels up
    return current_dir.parent.parent


def get_default_data_path() -> Path:
    """Return the default path to data/ai4i2020.csv."""
    return get_project_root() / "data" / EXPECTED_FILENAME


def verify_dataset(csv_path: Path) -> pd.DataFrame:
    """Verify that the CSV exists, can be read, and conforms to expected structure."""
    if not csv_path.exists():
        raise FileNotFoundError(f"Dataset file not found at: {csv_path}")

    df = pd.read_csv(csv_path)
    if len(df) != EXPECTED_ROWS or df.shape[1] != EXPECTED_COLS:
        print(
            f"[WARNING] Expected shape ({EXPECTED_ROWS}, {EXPECTED_COLS}), "
            f"got {df.shape}."
        )
    return df


def download_dataset(
    dest_path: Path | None = None, force: bool = False
) -> Path:
    """Download and extract ai4i2020.csv from the official UCI repository.

    Args:
        dest_path: Target path for the CSV. Defaults to data/ai4i2020.csv.
        force: If True, re-download even if the file exists.

    Returns:
        Path to the verified CSV file.
    """
    if dest_path is None:
        dest_path = get_default_data_path()

    dest_path.parent.mkdir(parents=True, exist_ok=True)

    if dest_path.exists() and not force:
        print(f"[INFO] Dataset already present at: {dest_path}")
        try:
            df = verify_dataset(dest_path)
            print(f"[INFO] Verified dataset: {df.shape[0]} rows, {df.shape[1]} columns.")
            return dest_path
        except Exception as e:
            print(f"[WARNING] Existing dataset verification failed: {e}. Re-downloading...")

    print(f"[INFO] Fetching official AI4I 2020 dataset from UCI repository...")
    print(f"[INFO] URL: {UCI_DATASET_URL}")

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "MachinePulseAI/1.0 DatasetFetcher"
        )
    }

    try:
        req = urllib.request.Request(UCI_DATASET_URL, headers=headers)
        with urllib.request.urlopen(req, timeout=30) as response:
            zip_bytes = response.read()

        print(f"[INFO] Download completed ({len(zip_bytes) / 1024:.1f} KB). Extracting...")
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as z:
            namelist = z.namelist()
            if EXPECTED_FILENAME not in namelist:
                # Fallback: search for any .csv inside
                csv_files = [f for f in namelist if f.endswith(".csv")]
                if not csv_files:
                    raise ValueError(
                        f"No CSV found in downloaded archive. Contents: {namelist}"
                    )
                target_member = csv_files[0]
            else:
                target_member = EXPECTED_FILENAME

            with z.open(target_member) as source, open(dest_path, "wb") as target:
                target.write(source.read())

        print(f"[SUCCESS] Dataset successfully saved to: {dest_path}")
        df = verify_dataset(dest_path)
        print(f"[INFO] Verified dataset: {df.shape[0]} rows, {df.shape[1]} columns.")
        return dest_path

    except Exception as exc:
        print("\n" + "=" * 70)
        print("[ERROR] Automated dataset download failed!")
        print(f"Reason: {exc}")
        print("\nPlease download the official dataset manually:")
        print(f"1. Visit the official UCI page: {UCI_PORTAL_URL}")
        print(f"2. Download 'ai4i+2020+predictive+maintenance+dataset.zip'")
        print(f"3. Extract '{EXPECTED_FILENAME}' and place it at:")
        print(f"   {dest_path.resolve()}")
        print("=" * 70 + "\n")
        raise RuntimeError(
            f"Dataset download failed. Please place '{EXPECTED_FILENAME}' into {dest_path.parent} manually."
        ) from exc


if __name__ == "__main__":
    force_download = "--force" in sys.argv
    path = download_dataset(force=force_download)
    print(f"[READY] Dataset is ready at: {path}")
