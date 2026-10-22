"""Script to generate explainability artifacts for MachinePulse AI.

Computes:
1. Healthy baseline values (medians for numeric features, mode for product type)
   calculated strictly from non-failure rows (Machine failure == 0) in the AI4I 2020 dataset.
   Saved to backend/artifacts/explain_baseline.json.
2. Global feature importance using scikit-learn Permutation Importance on a held-out
   stratified test split (20%) using the fitted pipeline artifact.
   Saved to backend/artifacts/global_importance.json.
"""

from __future__ import annotations

import argparse
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict

import joblib
import numpy as np
import pandas as pd
from sklearn.inspection import permutation_importance
from sklearn.model_selection import train_test_split

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("build_explain_artifacts")

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_DATASET = PROJECT_ROOT / "data" / "ai4i2020.csv"
DEFAULT_PIPELINE = PROJECT_ROOT / "backend" / "artifacts" / "failure_pipeline.joblib"
DEFAULT_BASELINE_OUT = PROJECT_ROOT / "backend" / "artifacts" / "explain_baseline.json"
DEFAULT_GLOBAL_OUT = PROJECT_ROOT / "backend" / "artifacts" / "global_importance.json"

FEATURE_COLUMNS = [
    "Type",
    "Air temperature [K]",
    "Process temperature [K]",
    "Rotational speed [rpm]",
    "Torque [Nm]",
    "Tool wear [min]",
]
NUMERIC_FEATURES = [
    "Air temperature [K]",
    "Process temperature [K]",
    "Rotational speed [rpm]",
    "Torque [Nm]",
    "Tool wear [min]",
]


def build_healthy_baseline(df: pd.DataFrame) -> Dict[str, Any]:
    """Compute healthy non-failure baselines and observed feature distributions."""
    logger.info("Computing healthy non-failure baselines...")
    non_failures = df[df["Machine failure"] == 0]
    total_count = len(df)
    non_fail_count = len(non_failures)
    fail_count = total_count - non_fail_count

    logger.info(
        f"Dataset rows: {total_count} total | {non_fail_count} non-failures (96.6%) | {fail_count} failures (3.4%)"
    )

    # 1. Healthy baseline values
    mode_type = str(non_failures["Type"].mode()[0])
    medians = non_failures[NUMERIC_FEATURES].median().to_dict()

    baseline_values: Dict[str, Any] = {
        "Type": mode_type,
        "Air temperature [K]": round(float(medians["Air temperature [K]"]), 2),
        "Process temperature [K]": round(float(medians["Process temperature [K]"]), 2),
        "Rotational speed [rpm]": round(float(medians["Rotational speed [rpm]"]), 1),
        "Torque [Nm]": round(float(medians["Torque [Nm]"]), 2),
        "Tool wear [min]": round(float(medians["Tool wear [min]"]), 1),
    }

    # 2. Observed training ranges (all rows) for boundary checks and UI sliders
    training_ranges: Dict[str, Any] = {}
    for col in NUMERIC_FEATURES:
        training_ranges[col] = {
            "min": round(float(df[col].min()), 2),
            "max": round(float(df[col].max()), 2),
            "q25": round(float(df[col].quantile(0.25)), 2),
            "median": round(float(df[col].median()), 2),
            "q75": round(float(df[col].quantile(0.75)), 2),
            "std": round(float(df[col].std()), 2),
            "non_fail_median": round(float(non_failures[col].median()), 2),
        }

    type_dist = df["Type"].value_counts(normalize=True).to_dict()
    training_ranges["Type"] = {
        "allowed_values": ["L", "M", "H"],
        "distribution": {k: round(float(v), 3) for k, v in type_dist.items()},
        "mode": mode_type,
    }

    now_utc = datetime.now(timezone.utc).isoformat()
    return {
        "method": "healthy_median_mode_baseline",
        "description": (
            "Healthy baselines computed from non-failure rows (Machine failure == 0) in AI4I 2020. "
            "Used as reference point for occlusion-based local feature attribution."
        ),
        "source_dataset": "AI4I 2020 Predictive Maintenance Dataset",
        "generated_at": now_utc,
        "total_records": total_count,
        "non_failure_records": non_fail_count,
        "failure_records": fail_count,
        "baseline_values": baseline_values,
        "training_ranges": training_ranges,
        "limitations_note": (
            "Baseline substitution isolates univariate deviation from healthy medians. "
            "Feature interactions and correlated multi-sensor shifts are not decomposed."
        ),
    }


def build_global_importance(
    df: pd.DataFrame, pipeline_path: Path, n_repeats: int = 15, random_state: int = 42
) -> Dict[str, Any]:
    """Calculate permutation importance on held-out stratified test split."""
    logger.info(f"Loading pipeline from {pipeline_path}...")
    pipeline = joblib.load(pipeline_path)

    X = df[FEATURE_COLUMNS]
    y = df["Machine failure"]

    logger.info("Splitting held-out test set (20%, stratified, random_state=42)...")
    _, X_test, _, y_test = train_test_split(
        X, y, test_size=0.20, random_state=random_state, stratify=y
    )

    logger.info(f"Computing permutation importance ({n_repeats} repeats, metric=roc_auc)...")
    perm_result = permutation_importance(
        pipeline,
        X_test,
        y_test,
        scoring="roc_auc",
        n_repeats=n_repeats,
        random_state=random_state,
        n_jobs=-1,
    )

    importances_list = []
    sorted_idx = perm_result.importances_mean.argsort()[::-1]

    for rank, idx in enumerate(sorted_idx, start=1):
        feature_name = FEATURE_COLUMNS[idx]
        mean_score = float(perm_result.importances_mean[idx])
        std_score = float(perm_result.importances_std[idx])
        importances_list.append(
            {
                "feature": feature_name,
                "importance_mean": round(mean_score, 4),
                "importance_std": round(std_score, 4),
                "rank": rank,
            }
        )

    now_utc = datetime.now(timezone.utc).isoformat()
    return {
        "method": "permutation_importance",
        "description": (
            "Permutation feature importance evaluated on held-out stratified test data (20%). "
            "Measures mean decrease in ROC-AUC when each feature column is randomly shuffled."
        ),
        "metric": "roc_auc",
        "n_repeats": n_repeats,
        "random_state": random_state,
        "evaluation_split": "held_out_stratified_test_20_percent",
        "test_sample_size": len(X_test),
        "pipeline_artifact": pipeline_path.name,
        "generated_at": now_utc,
        "importances": importances_list,
        "interpretation": (
            "Higher importance_mean indicates that shuffling this sensor value significantly degrades "
            "the model's ability to distinguish failure from healthy states. "
            "Explanations describe model decision drivers, not definitive physical root causes."
        ),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate explainability baseline & importance artifacts.")
    parser.add_argument("--dataset", type=Path, default=DEFAULT_DATASET, help="Path to AI4I 2020 CSV")
    parser.add_argument("--pipeline", type=Path, default=DEFAULT_PIPELINE, help="Path to pipeline joblib")
    parser.add_argument("--out-baseline", type=Path, default=DEFAULT_BASELINE_OUT, help="Output path for baseline JSON")
    parser.add_argument("--out-importance", type=Path, default=DEFAULT_GLOBAL_OUT, help="Output path for importance JSON")
    parser.add_argument("--n-repeats", type=int, default=15, help="Permutation repeats")
    parser.add_argument("--seed", type=int, default=42, help="Random state seed")

    args = parser.parse_args()

    if not args.dataset.exists():
        raise FileNotFoundError(f"Dataset not found at {args.dataset}")
    if not args.pipeline.exists():
        raise FileNotFoundError(f"Fitted pipeline artifact not found at {args.pipeline}")

    logger.info(f"Reading dataset: {args.dataset}")
    df = pd.read_csv(args.dataset)

    # 1. Baseline artifact
    baseline_data = build_healthy_baseline(df)
    args.out_baseline.parent.mkdir(parents=True, exist_ok=True)
    with open(args.out_baseline, "w", encoding="utf-8") as f:
        json.dump(baseline_data, f, indent=2)
    logger.info(f"Saved healthy baseline artifact to: {args.out_baseline}")

    # 2. Global importance artifact
    importance_data = build_global_importance(
        df=df, pipeline_path=args.pipeline, n_repeats=args.n_repeats, random_state=args.seed
    )
    args.out_importance.parent.mkdir(parents=True, exist_ok=True)
    with open(args.out_importance, "w", encoding="utf-8") as f:
        json.dump(importance_data, f, indent=2)
    logger.info(f"Saved global permutation importance artifact to: {args.out_importance}")

    logger.info("Explainability artifacts generation completed successfully!")


if __name__ == "__main__":
    main()
