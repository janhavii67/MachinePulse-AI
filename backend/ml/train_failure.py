"""Model training and selection pipeline for MachinePulse AI.

Trains and compares:
1. Logistic Regression (Baseline)
2. Random Forest Classifier
3. HistGradientBoostingClassifier

Features strict leakage prevention (stratified 70/15/15 split), class weighting,
threshold optimization on validation data, and comprehensive artifact generation.
"""

from __future__ import annotations

import argparse
import datetime
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Tuple

# Ensure project root is in sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, f1_score, precision_score, recall_score, roc_auc_score
from sklearn.pipeline import Pipeline

from backend.ml.download_dataset import download_dataset
from backend.ml.evaluate import evaluate_pipeline
from backend.ml.preprocess import (
    CATEGORICAL_FEATURES,
    EXCLUDED_COLUMNS,
    INPUT_FEATURES,
    NUMERIC_FEATURES,
    TARGET_COLUMN,
    build_preprocessor,
    split_data,
)


def get_project_root() -> Path:
    """Resolve project root directory."""
    return Path(__file__).resolve().parent.parent.parent


def get_artifacts_dir() -> Path:
    """Return backend/artifacts/ directory, creating it if needed."""
    path = Path(__file__).resolve().parent.parent / "artifacts"
    path.mkdir(parents=True, exist_ok=True)
    return path


def get_reports_dir() -> Path:
    """Return backend/reports/ directory, creating it if needed."""
    path = Path(__file__).resolve().parent.parent / "reports"
    path.mkdir(parents=True, exist_ok=True)
    return path


def create_candidate_pipelines() -> Dict[str, Pipeline]:
    """Define candidate ML pipelines combining preprocessing and classifiers.

    Notice: Preprocessing is bundled inside each Pipeline, guaranteeing that
    StandardScaler and OneHotEncoder fit strictly on the training partition.
    """
    candidates = {
        "LogisticRegression_Baseline": Pipeline(
            steps=[
                ("preprocessor", build_preprocessor(scale_numeric=True)),
                (
                    "classifier",
                    LogisticRegression(
                        class_weight="balanced",
                        max_iter=1000,
                        random_state=42,
                        solver="lbfgs",
                    ),
                ),
            ]
        ),
        "RandomForest": Pipeline(
            steps=[
                ("preprocessor", build_preprocessor(scale_numeric=True)),
                (
                    "classifier",
                    RandomForestClassifier(
                        n_estimators=150,
                        max_depth=10,
                        min_samples_split=5,
                        min_samples_leaf=2,
                        class_weight="balanced",
                        random_state=42,
                        n_jobs=-1,
                    ),
                ),
            ]
        ),
        "HistGradientBoosting": Pipeline(
            steps=[
                ("preprocessor", build_preprocessor(scale_numeric=True)),
                (
                    "classifier",
                    HistGradientBoostingClassifier(
                        class_weight="balanced",
                        max_iter=120,
                        learning_rate=0.08,
                        max_leaf_nodes=31,
                        min_samples_leaf=15,
                        random_state=42,
                    ),
                ),
            ]
        ),
    }
    return candidates


def optimize_threshold_on_validation(
    y_val: pd.Series,
    y_prob_val: np.ndarray,
    threshold_range: Tuple[float, float, float] = (0.10, 0.90, 0.02),
) -> Tuple[float, float, float, float]:
    """Search for the decision threshold that maximizes validation F1-score.

    Returns:
        (best_threshold, best_f1, precision_at_best, recall_at_best)
    """
    start, stop, step = threshold_range
    best_thresh = 0.50
    best_f1 = -1.0
    best_prec = 0.0
    best_rec = 0.0

    thresholds = np.arange(start, stop + step, step)
    for t in thresholds:
        y_pred = (y_prob_val >= t).astype(int)
        f1 = f1_score(y_val, y_pred, zero_division=0)
        if f1 > best_f1:
            best_f1 = f1
            best_thresh = float(t)
            best_prec = float(precision_score(y_val, y_pred, zero_division=0))
            best_rec = float(recall_score(y_val, y_pred, zero_division=0))

    return best_thresh, best_f1, best_prec, best_rec


def train_and_compare_models(
    X_train: pd.DataFrame,
    y_train: pd.Series,
    X_val: pd.DataFrame,
    y_val: pd.Series,
) -> Tuple[str, Pipeline, float, pd.DataFrame]:
    """Train candidate pipelines, tune threshold on validation data, and select champion.

    Selection Criterion:
    1. Models are compared on Validation PR-AUC (Precision-Recall Area Under Curve),
       which summarizes performance across all operating thresholds for imbalanced data.
    2. Decision threshold is tuned on Validation F1-score to balance missed breakdowns
       (recall) against false alarms (precision).
    """
    candidates = create_candidate_pipelines()
    records: List[Dict[str, Any]] = []
    fitted_pipelines: Dict[str, Pipeline] = {}
    best_thresholds: Dict[str, float] = {}

    print("\n" + "=" * 80)
    print(" TRAINING & VALIDATION MODEL SELECTION")
    print("=" * 80)

    for name, pipeline in candidates.items():
        print(f"--> Training candidate: {name} ...")
        # Preprocessor fits ONLY on X_train here!
        pipeline.fit(X_train, y_train)
        fitted_pipelines[name] = pipeline

        # Predict probabilities on validation partition
        y_prob_val = pipeline.predict_proba(X_val)[:, 1]

        # Metric calculations on validation set
        pr_auc = float(average_precision_score(y_val, y_prob_val))
        roc_auc = float(roc_auc_score(y_val, y_prob_val))

        # Tune threshold on validation set
        opt_thresh, opt_f1, opt_prec, opt_rec = optimize_threshold_on_validation(
            y_val, y_prob_val
        )
        best_thresholds[name] = opt_thresh

        # Standard default 0.50 threshold F1 for comparison
        y_pred_default = (y_prob_val >= 0.50).astype(int)
        default_f1 = float(f1_score(y_val, y_pred_default, zero_division=0))

        records.append({
            "model_name": name,
            "val_pr_auc": round(pr_auc, 4),
            "val_roc_auc": round(roc_auc, 4),
            "val_f1_default_0.50": round(default_f1, 4),
            "val_f1_tuned": round(opt_f1, 4),
            "tuned_threshold": round(opt_thresh, 4),
            "val_precision_at_thresh": round(opt_prec, 4),
            "val_recall_at_thresh": round(opt_rec, 4),
        })

    comparison_df = pd.DataFrame(records).sort_values(by="val_pr_auc", ascending=False)
    print("\nValidation Comparison Table:")
    print(comparison_df.to_string(index=False))

    # Champion selection rule: highest PR-AUC on validation set
    champion_name = comparison_df.iloc[0]["model_name"]
    champion_pipeline = fitted_pipelines[champion_name]
    champion_threshold = best_thresholds[champion_name]

    print("\n" + "-" * 80)
    print(f"SELECTED CHAMPION: {champion_name}")
    print(f"Documented Selection Criterion: Highest validation PR-AUC ({comparison_df.iloc[0]['val_pr_auc']:.4f})")
    print(f"Optimized Decision Threshold:    {champion_threshold:.2f} (Val F1: {comparison_df.iloc[0]['val_f1_tuned']:.4f})")
    print("-" * 80)

    return champion_name, champion_pipeline, champion_threshold, comparison_df


def save_artifacts_and_metadata(
    champion_name: str,
    champion_pipeline: Pipeline,
    champion_threshold: float,
    comparison_df: pd.DataFrame,
    test_metrics: Dict[str, Any],
) -> Tuple[Path, Path]:
    """Persist the champion pipeline artifact and model metadata JSON."""
    artifacts_dir = get_artifacts_dir()
    reports_dir = get_reports_dir()

    # 1. Save comparison reports
    comparison_csv = reports_dir / "model_comparison.csv"
    comparison_json = reports_dir / "model_comparison.json"
    comparison_df.to_csv(comparison_csv, index=False)
    comparison_df.to_json(comparison_json, orient="records", indent=2)
    print(f"[REPORT] Saved model comparison table to: {comparison_csv}")

    # 2. Save fitted pipeline
    pipeline_path = artifacts_dir / "failure_pipeline.joblib"
    joblib.dump(champion_pipeline, pipeline_path)
    print(f"[ARTIFACT] Saved production pipeline to: {pipeline_path}")

    # 3. Save model metadata JSON
    metadata = {
        "model_name": champion_name,
        "model_type": type(champion_pipeline.named_steps["classifier"]).__name__,
        "model_version": "1.0.0",
        "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "dataset_source": "AI4I 2020 Predictive Maintenance Dataset (UCI Machine Learning Repository #601)",
        "target_column": TARGET_COLUMN,
        "input_features": INPUT_FEATURES,
        "categorical_features": CATEGORICAL_FEATURES,
        "numeric_features": NUMERIC_FEATURES,
        "excluded_features": EXCLUDED_COLUMNS,
        "selected_classification_threshold": champion_threshold,
        "selection_criterion": (
            "Ranked candidate models by validation set PR-AUC; "
            "tuned decision threshold by maximizing validation F1-score to balance "
            "missed breakdowns (Recall) against false alarms (Precision)."
        ),
        "evaluation_metrics": test_metrics,
        "known_limitations": [
            "Trained on AI4I 2020 synthetic milling machine simulation dataset.",
            "Contains 3.39% minority failure class rate; performance may vary under severe operational shift.",
            "Does not contain direct continuous run-to-failure degradation trajectories for true RUL estimation.",
            "Failure modes (TWF, HDF, PWF, OSF, RNF) are physical causes and must not be fed as classifier features.",
        ],
    }

    metadata_path = artifacts_dir / "model_metadata.json"
    with open(metadata_path, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)
    print(f"[ARTIFACT] Saved model metadata JSON to: {metadata_path}")

    return pipeline_path, metadata_path


def run_training_pipeline(data_path: Path | str | None = None) -> None:
    """Execute complete training, threshold tuning, test evaluation, and serialization."""
    root_dir = get_project_root()
    if data_path is None:
        data_path = root_dir / "data" / "ai4i2020.csv"
    data_path = Path(data_path)

    # Ensure dataset is available
    if not data_path.exists():
        print(f"[INFO] Dataset not found at {data_path}. Attempting download...")
        data_path = download_dataset(data_path)

    print(f"[INFO] Loading dataset from: {data_path}")
    df = pd.read_csv(data_path)

    # Report class imbalance
    n_total = len(df)
    n_fail = (df[TARGET_COLUMN] == 1).sum()
    n_healthy = (df[TARGET_COLUMN] == 0).sum()
    pct_fail = (n_fail / n_total) * 100
    print("\n" + "=" * 80)
    print(" CLASS IMBALANCE AUDIT")
    print("=" * 80)
    print(f"Total Samples:    {n_total:,}")
    print(f"Healthy (0):      {n_healthy:,} ({100 - pct_fail:.2f}%)")
    print(f"Failure (1):      {n_fail:,} ({pct_fail:.2f}%)")
    print(f"Imbalance Ratio:  {n_healthy / n_fail:.2f}:1")
    print("Strategy: Built-in 'balanced' class weights applied; SMOTE avoided to prevent synthetic artifacts.")
    print("-" * 80)

    # Split: 70% Train, 15% Validation, 15% Test
    (X_train, y_train), (X_val, y_val), (X_test, y_test) = split_data(
        df, test_size=0.15, val_size=0.15, random_state=42
    )
    print(f"Partition Sizes:")
    print(f"  Training set:   {len(X_train):4d} samples (Failures: {(y_train == 1).sum():2d})")
    print(f"  Validation set: {len(X_val):4d} samples (Failures: {(y_val == 1).sum():2d})")
    print(f"  Test set:       {len(X_test):4d} samples (Failures: {(y_test == 1).sum():2d})")

    # Train and select champion
    champion_name, champion_pipeline, champion_threshold, comparison_df = train_and_compare_models(
        X_train, y_train, X_val, y_val
    )

    # Strictly held-out test set evaluation
    test_metrics = evaluate_pipeline(
        champion_pipeline,
        X_test,
        y_test,
        threshold=champion_threshold,
        save_reports=True,
    )

    # Persist artifacts and metadata
    pipe_path, meta_path = save_artifacts_and_metadata(
        champion_name,
        champion_pipeline,
        champion_threshold,
        comparison_df,
        test_metrics,
    )

    print("\n" + "=" * 80)
    print(" [SUCCESS] MODULE 1 TRAINING & EVALUATION COMPLETED")
    print("=" * 80)
    print(f"Pipeline saved to: {pipe_path}")
    print(f"Metadata saved to: {meta_path}")
    print(f"Optimal Threshold: {champion_threshold:.2f}")
    print(f"Test Recall:       {test_metrics['recall']:.4f}")
    print(f"Test Precision:    {test_metrics['precision']:.4f}")
    print(f"Test F1-Score:     {test_metrics['f1_score']:.4f}")
    print(f"Test PR-AUC:       {test_metrics['pr_auc']:.4f}")
    print("=" * 80 + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Train MachinePulse AI machine failure model.")
    parser.add_argument("--data-path", type=str, default=None, help="Path to ai4i2020.csv")
    args = parser.parse_args()
    run_training_pipeline(args.data_path)
