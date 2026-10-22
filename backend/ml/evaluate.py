"""Evaluation module for MachinePulse AI failure classification model.

Computes precision, recall, F1, PR-AUC, ROC-AUC, confusion matrix, and PR curve
on held-out test data. Generates reports and simple explanations of FP and FN.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

# Ensure project root is in sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import joblib
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns
from sklearn.metrics import (
    average_precision_score,
    classification_report,
    confusion_matrix,
    f1_score,
    precision_recall_curve,
    precision_score,
    recall_score,
    roc_auc_score,
)

from backend.ml.preprocess import split_data


def get_artifacts_dir() -> Path:
    """Return backend/artifacts/ directory."""
    path = Path(__file__).resolve().parent.parent / "artifacts"
    path.mkdir(parents=True, exist_ok=True)
    return path


def get_reports_dir() -> Path:
    """Return backend/reports/ directory."""
    path = Path(__file__).resolve().parent.parent / "reports"
    path.mkdir(parents=True, exist_ok=True)
    return path


def explain_predictions_for_beginners(cm: np.ndarray) -> str:
    """Produce beginner-friendly explanations of False Positives and False Negatives."""
    tn, fp, fn, tp = cm.ravel()
    explanation = f"""
================================================================================
 BEGINNER'S GUIDE TO CONFUSION MATRIX IN PREDICTIVE MAINTENANCE
================================================================================
True Negatives  (TN = {tn:4d}): Healthy machine correctly predicted as Healthy.
True Positives  (TP = {tp:4d}): Failing machine correctly predicted as Failing.
--------------------------------------------------------------------------------
False Positives (FP = {fp:4d}): "False Alarm"
  - The model predicted the machine would fail, but it is actually healthy.
  - Operational impact: A maintenance technician is dispatched to inspect a
    machine that does not need immediate repair.
  - Business cost: Modest inspection time, temporary brief shutdown for inspection.

False Negatives (FN = {fn:4d}): "Missed Catastrophic Breakdown"
  - The model predicted the machine was healthy, but it actually failed!
  - Operational impact: The machine breaks down unexpectedly in production.
  - Business cost: Massive unplanned factory downtime, broken tooling, damaged
    workpieces, potential safety risks, and expensive emergency repairs.

CRITICAL TAKEAWAY:
In industrial predictive maintenance, FALSE NEGATIVES are far more dangerous
and expensive than False Positives. That is why we tune our decision threshold
to maximize Recall and F1-score rather than blindly relying on default 0.50.
================================================================================
"""
    return explanation


def compute_evaluation_metrics(
    y_true: pd.Series | np.ndarray,
    y_prob: np.ndarray,
    threshold: float = 0.50,
) -> Dict[str, Any]:
    """Compute precision, recall, F1, PR-AUC, ROC-AUC, and confusion matrix.

    Args:
        y_true: Ground truth binary labels (0 or 1).
        y_prob: Predicted probability for the positive class (class 1).
        threshold: Decision boundary probability to assign class 1.

    Returns:
        Dictionary of formatted evaluation metrics.
    """
    y_pred = (y_prob >= threshold).astype(int)
    cm = confusion_matrix(y_true, y_pred)
    tn, fp, fn, tp = cm.ravel()

    precision = float(precision_score(y_true, y_pred, zero_division=0))
    recall = float(recall_score(y_true, y_pred, zero_division=0))
    f1 = float(f1_score(y_true, y_pred, zero_division=0))

    try:
        pr_auc = float(average_precision_score(y_true, y_prob))
    except Exception:
        pr_auc = 0.0

    try:
        roc_auc = float(roc_auc_score(y_true, y_prob))
    except Exception:
        roc_auc = 0.0

    clf_report = classification_report(
        y_true, y_pred, target_names=["No Failure", "Failure"], output_dict=True, zero_division=0
    )

    metrics: Dict[str, Any] = {
        "decision_threshold": round(threshold, 4),
        "total_test_samples": int(len(y_true)),
        "actual_failures": int((y_true == 1).sum()),
        "actual_healthy": int((y_true == 0).sum()),
        "predicted_failures": int((y_pred == 1).sum()),
        "predicted_healthy": int((y_pred == 0).sum()),
        "true_positives": int(tp),
        "false_positives": int(fp),
        "true_negatives": int(tn),
        "false_negatives": int(fn),
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1_score": round(f1, 4),
        "pr_auc": round(pr_auc, 4),
        "roc_auc": round(roc_auc, 4),
        "confusion_matrix": [[int(tn), int(fp)], [int(fn), int(tp)]],
        "classification_report": clf_report,
    }
    return metrics


def plot_confusion_matrix(cm: np.ndarray, output_path: Path, threshold: float) -> Path:
    """Plot and save confusion matrix heatmap."""
    plt.figure(figsize=(6, 5))
    labels = ["Healthy (0)", "Failure (1)"]
    sns.heatmap(
        cm,
        annot=True,
        fmt="d",
        cmap="Blues",
        xticklabels=labels,
        yticklabels=labels,
        cbar=False,
        annot_kws={"size": 14, "weight": "bold"},
    )
    plt.title(f"Test Confusion Matrix (Threshold = {threshold:.2f})", fontsize=12, fontweight="bold")
    plt.xlabel("Predicted Label", fontweight="bold")
    plt.ylabel("Actual True Label", fontweight="bold")
    plt.tight_layout()
    plt.savefig(output_path, dpi=200)
    plt.close()
    return output_path


def plot_precision_recall_curve_eval(
    y_true: pd.Series | np.ndarray,
    y_prob: np.ndarray,
    threshold: float,
    output_path: Path,
) -> Path:
    """Plot and save Precision-Recall curve with selected operating point."""
    precision, recall, thresholds = precision_recall_curve(y_true, y_prob)
    pr_auc = average_precision_score(y_true, y_prob)

    # Calculate precision and recall at the selected threshold
    y_pred = (y_prob >= threshold).astype(int)
    op_prec = precision_score(y_true, y_pred, zero_division=0)
    op_rec = recall_score(y_true, y_pred, zero_division=0)

    plt.figure(figsize=(7, 5))
    plt.plot(recall, precision, color="#2b5c8f", lw=2.5, label=f"PR Curve (PR-AUC = {pr_auc:.3f})")
    plt.scatter(
        [op_rec],
        [op_prec],
        color="#d9534f",
        s=120,
        zorder=5,
        label=f"Selected Threshold ({threshold:.2f}): Prec={op_prec:.2f}, Rec={op_rec:.2f}",
    )
    # Baseline: proportion of positive class in test set
    baseline = (y_true == 1).sum() / len(y_true)
    plt.axhline(
        y=baseline,
        color="gray",
        linestyle="--",
        label=f"No-Skill Baseline ({baseline:.3f})",
    )

    plt.xlabel("Recall (Detection Rate)", fontweight="bold")
    plt.ylabel("Precision", fontweight="bold")
    plt.title("Precision-Recall Curve (Held-Out Test Set)", fontsize=12, fontweight="bold")
    plt.legend(loc="lower left", frameon=True)
    plt.ylim([0.0, 1.05])
    plt.xlim([0.0, 1.0])
    plt.grid(True, linestyle=":", alpha=0.6)
    plt.tight_layout()
    plt.savefig(output_path, dpi=200)
    plt.close()
    return output_path


def evaluate_pipeline(
    pipeline: Any,
    X_test: pd.DataFrame,
    y_test: pd.Series,
    threshold: float = 0.50,
    save_reports: bool = True,
) -> Dict[str, Any]:
    """Execute complete evaluation on held-out test data.

    Args:
        pipeline: Fitted scikit-learn Pipeline.
        X_test: Held-out test features.
        y_test: Held-out test targets.
        threshold: Classification decision boundary.
        save_reports: Whether to save JSON, CSV, and PNG reports.

    Returns:
        Evaluation metrics dictionary.
    """
    y_prob = pipeline.predict_proba(X_test)[:, 1]
    metrics = compute_evaluation_metrics(y_test, y_prob, threshold=threshold)
    cm = np.array(metrics["confusion_matrix"])

    print("\n" + "=" * 80)
    print(" HELD-OUT TEST SET EVALUATION RESULTS")
    print("=" * 80)
    print(f"Decision Threshold:    {metrics['decision_threshold']:.2f}")
    print(f"Precision:             {metrics['precision']:.4f}")
    print(f"Recall:                {metrics['recall']:.4f}")
    print(f"F1-Score:              {metrics['f1_score']:.4f}")
    print(f"PR-AUC:                {metrics['pr_auc']:.4f}")
    print(f"ROC-AUC:               {metrics['roc_auc']:.4f}")
    print(f"Total Test Samples:    {metrics['total_test_samples']}")
    print(f"Actual Failures:       {metrics['actual_failures']}")
    print(f"Detected Failures(TP): {metrics['true_positives']}")
    print(f"Missed Failures(FN):   {metrics['false_negatives']}")
    print(f"False Alarms(FP):      {metrics['false_positives']}")
    print("-" * 80)

    # Print explanation
    print(explain_predictions_for_beginners(cm))

    if save_reports:
        reports_dir = get_reports_dir()

        # Save JSON
        json_path = reports_dir / "test_metrics.json"
        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(metrics, f, indent=2)
        print(f"[REPORT] Saved metrics JSON: {json_path}")

        # Save CSV
        csv_flat_records = [{
            "decision_threshold": metrics["decision_threshold"],
            "precision": metrics["precision"],
            "recall": metrics["recall"],
            "f1_score": metrics["f1_score"],
            "pr_auc": metrics["pr_auc"],
            "roc_auc": metrics["roc_auc"],
            "true_positives": metrics["true_positives"],
            "false_positives": metrics["false_positives"],
            "true_negatives": metrics["true_negatives"],
            "false_negatives": metrics["false_negatives"],
        }]
        csv_path = reports_dir / "test_metrics.csv"
        pd.DataFrame(csv_flat_records).to_csv(csv_path, index=False)
        print(f"[REPORT] Saved metrics CSV: {csv_path}")

        # Save Confusion Matrix Plot
        cm_plot = plot_confusion_matrix(cm, reports_dir / "confusion_matrix.png", threshold)
        print(f"[REPORT] Saved confusion matrix plot: {cm_plot}")

        # Save PR Curve Plot
        pr_plot = plot_precision_recall_curve_eval(
            y_test, y_prob, threshold, reports_dir / "precision_recall_curve.png"
        )
        print(f"[REPORT] Saved PR-Curve plot: {pr_plot}")

    return metrics


def run_standalone_evaluation(
    data_path: Optional[str] = None,
    pipeline_path: Optional[str] = None,
    threshold: Optional[float] = None,
) -> Dict[str, Any]:
    """Load saved artifacts and evaluate on the strictly held-out test split."""
    artifacts_dir = get_artifacts_dir()
    default_pipe_path = artifacts_dir / "failure_pipeline.joblib"
    default_meta_path = artifacts_dir / "model_metadata.json"

    pipe_file = Path(pipeline_path) if pipeline_path else default_pipe_path
    if not pipe_file.exists():
        raise FileNotFoundError(
            f"Fitted pipeline not found at {pipe_file}. Run backend/ml/train_failure.py first."
        )

    print(f"[INFO] Loading fitted pipeline from: {pipe_file}")
    pipeline = joblib.load(pipe_file)

    # Determine threshold
    eval_threshold = threshold
    if eval_threshold is None:
        if default_meta_path.exists():
            with open(default_meta_path, "r", encoding="utf-8") as f:
                meta = json.load(f)
                eval_threshold = meta.get("selected_classification_threshold", 0.50)
                print(f"[INFO] Using selected threshold from metadata: {eval_threshold:.2f}")
        else:
            eval_threshold = 0.50

    # Load dataset & partition test set
    root_dir = Path(__file__).resolve().parent.parent.parent
    csv_path = Path(data_path) if data_path else root_dir / "data" / "ai4i2020.csv"
    if not csv_path.exists():
        raise FileNotFoundError(f"Dataset not found at: {csv_path}")

    df = pd.read_csv(csv_path)
    _, _, (X_test, y_test) = split_data(df, test_size=0.15, val_size=0.15, random_state=42)

    return evaluate_pipeline(pipeline, X_test, y_test, threshold=eval_threshold, save_reports=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Evaluate MachinePulse AI failure pipeline on held-out test data.")
    parser.add_argument("--data-path", type=str, default=None, help="Path to ai4i2020.csv")
    parser.add_argument("--pipeline-path", type=str, default=None, help="Path to failure_pipeline.joblib")
    parser.add_argument("--threshold", type=float, default=None, help="Custom probability threshold")
    args = parser.parse_args()
    run_standalone_evaluation(args.data_path, args.pipeline_path, args.threshold)
