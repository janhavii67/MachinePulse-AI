"""Exploratory Data Analysis (EDA) module for MachinePulse AI.

Inspects the AI4I 2020 Predictive Maintenance Dataset, analyzes target
imbalance, inspects failure modes, validates numeric ranges, and generates
diagnostic plots saved to backend/reports/.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Dict, List

import matplotlib
matplotlib.use("Agg")  # Non-interactive backend suitable for scripts and servers
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns

# Documented column name constants
COL_UDI = "UDI"
COL_PRODUCT_ID = "Product ID"
COL_TYPE = "Type"
COL_AIR_TEMP = "Air temperature [K]"
COL_PROCESS_TEMP = "Process temperature [K]"
COL_ROTATIONAL_SPEED = "Rotational speed [rpm]"
COL_TORQUE = "Torque [Nm]"
COL_TOOL_WEAR = "Tool wear [min]"
COL_TARGET = "Machine failure"

# The 5 specific failure modes in AI4I 2020
FAILURE_MODES = ["TWF", "HDF", "PWF", "OSF", "RNF"]
FAILURE_MODE_NAMES: Dict[str, str] = {
    "TWF": "Tool Wear Failure",
    "HDF": "Heat Dissipation Failure",
    "PWF": "Power Failure",
    "OSF": "Overstrain Failure",
    "RNF": "Random Failure",
}

# Feature definitions for the classifier
FEATURE_COLS_CATEGORICAL = [COL_TYPE]
FEATURE_COLS_NUMERIC = [
    COL_AIR_TEMP,
    COL_PROCESS_TEMP,
    COL_ROTATIONAL_SPEED,
    COL_TORQUE,
    COL_TOOL_WEAR,
]
FEATURE_COLS_ALL = FEATURE_COLS_CATEGORICAL + FEATURE_COLS_NUMERIC

# Columns that MUST NOT be used as input features to the failure classifier
EXCLUDED_COLS = [
    COL_UDI,
    COL_PRODUCT_ID,
    "TWF",
    "HDF",
    "PWF",
    "OSF",
    "RNF",
]


def get_project_root() -> Path:
    """Resolve project root directory."""
    return Path(__file__).resolve().parent.parent.parent


def get_reports_dir() -> Path:
    """Return backend/reports/ directory, creating it if needed."""
    reports_dir = Path(__file__).resolve().parent.parent / "reports"
    reports_dir.mkdir(parents=True, exist_ok=True)
    return reports_dir


def load_dataset(data_path: Path | str) -> pd.DataFrame:
    """Load dataset from path with validation."""
    path = Path(data_path)
    if not path.exists():
        raise FileNotFoundError(
            f"Dataset not found at {path}. Run backend/ml/download_dataset.py first."
        )
    df = pd.read_csv(path)
    return df


def inspect_overview(df: pd.DataFrame) -> None:
    """Print dataset shape, columns, dtypes, missing values, and duplicates."""
    print("=" * 80)
    print(" MACHINEPULSE AI — DATASET OVERVIEW (AI4I 2020)")
    print("=" * 80)
    print(f"Shape: {df.shape[0]} rows x {df.shape[1]} columns\n")

    print("Columns & Data Types:")
    summary_df = pd.DataFrame({
        "Column Name": df.columns,
        "Data Type": [str(t) for t in df.dtypes],
        "Non-Null Count": df.notnull().sum().values,
        "Null Count": df.isnull().sum().values,
        "Null %": (df.isnull().sum().values / len(df) * 100).round(2),
        "Unique Values": [df[c].nunique() for c in df.columns],
    })
    print(summary_df.to_string(index=False))
    print()

    duplicates = df.duplicated().sum()
    print(f"Duplicate rows count: {duplicates} ({duplicates / len(df) * 100:.2f}%)")
    udi_unique = df[COL_UDI].nunique() if COL_UDI in df.columns else "N/A"
    print(f"UDI column uniqueness: {udi_unique} / {len(df)}")
    print("-" * 80)


def inspect_target_distribution(df: pd.DataFrame) -> Dict[str, float]:
    """Analyze target distribution and class imbalance."""
    print("\n" + "=" * 80)
    print(f" TARGET DISTRIBUTION: '{COL_TARGET}'")
    print("=" * 80)

    counts = df[COL_TARGET].value_counts().sort_index()
    percentages = df[COL_TARGET].value_counts(normalize=True).sort_index() * 100

    n_normal = counts.get(0, 0)
    n_failure = counts.get(1, 0)
    pct_normal = percentages.get(0, 0.0)
    pct_failure = percentages.get(1, 0.0)
    imbalance_ratio = (n_normal / n_failure) if n_failure > 0 else float("inf")

    print(f"Non-Failure (0): {n_normal:5d} observations ({pct_normal:6.2f}%)")
    print(f"Failure     (1): {n_failure:5d} observations ({pct_failure:6.2f}%)")
    print(f"Imbalance Ratio: {imbalance_ratio:.2f} : 1 (Majority to Minority)")
    print(
        "\n[KEY INSIGHT] The dataset is highly imbalanced (~3.4% failure rate). "
        "Accuracy is misleading here: a dummy model predicting all 0s achieves ~96.6% accuracy "
        "while detecting 0 failures. Precision, Recall, PR-AUC, and custom decision thresholds "
        "must be used instead."
    )
    print("-" * 80)

    return {
        "n_normal": int(n_normal),
        "n_failure": int(n_failure),
        "pct_normal": float(pct_normal),
        "pct_failure": float(pct_failure),
        "imbalance_ratio": float(imbalance_ratio),
    }


def inspect_failure_modes(df: pd.DataFrame) -> pd.DataFrame:
    """Summarize the five specific failure mode indicators."""
    print("\n" + "=" * 80)
    print(" FIVE FAILURE-MODE BREAKDOWN (AI4I 2020)")
    print("=" * 80)
    print("Note: These five columns represent specific physical failure causes.")
    print("They MUST NOT be used as inputs to the primary failure classifier.\n")

    mode_records = []
    for code in FAILURE_MODES:
        if code in df.columns:
            count = int(df[code].sum())
            pct_dataset = (count / len(df)) * 100
            # Also calculate percentage among actual failures
            failures_only = df[df[COL_TARGET] == 1]
            pct_of_failures = (count / len(failures_only) * 100) if len(failures_only) > 0 else 0.0
            mode_records.append({
                "Code": code,
                "Failure Mode": FAILURE_MODE_NAMES.get(code, code),
                "Total Count": count,
                "% of Dataset": round(pct_dataset, 3),
                "% of Failures": round(pct_of_failures, 2),
            })

    mode_df = pd.DataFrame(mode_records)
    print(mode_df.to_string(index=False))

    # Cross-tabulate with Machine failure
    active_modes = [c for c in FAILURE_MODES if c in df.columns]
    df_modes_sum = df[active_modes].sum(axis=1)

    fail_with_mode = ((df[COL_TARGET] == 1) & (df_modes_sum > 0)).sum()
    fail_without_mode = ((df[COL_TARGET] == 1) & (df_modes_sum == 0)).sum()
    mode_without_fail = ((df[COL_TARGET] == 0) & (df_modes_sum > 0)).sum()

    print("\nInter-relationship between 'Machine failure' and Failure Modes:")
    print(f"  Failures with at least 1 failure mode flagged: {fail_with_mode}")
    print(f"  Failures with NO specific failure mode flagged: {fail_without_mode}")
    print(f"  Non-failures with a failure mode flagged:      {mode_without_fail} (e.g. false alarm or transient sensor spike)")
    print("-" * 80)
    return mode_df


def inspect_data_validity(df: pd.DataFrame) -> None:
    """Check for physical range validity and unexpected values."""
    print("\n" + "=" * 80)
    print(" PHYSICAL RANGE AND DATA SANITY CHECKS")
    print("=" * 80)

    checks = [
        ("Air temperature [K] > 0", (df[COL_AIR_TEMP] > 0).all()),
        ("Process temperature [K] > 0", (df[COL_PROCESS_TEMP] > 0).all()),
        ("Process temp >= Air temp", (df[COL_PROCESS_TEMP] >= df[COL_AIR_TEMP]).all()),
        ("Rotational speed [rpm] >= 0", (df[COL_ROTATIONAL_SPEED] >= 0).all()),
        ("Torque [Nm] >= 0", (df[COL_TORQUE] >= 0).all()),
        ("Tool wear [min] >= 0", (df[COL_TOOL_WEAR] >= 0).all()),
        ("Type in {'L', 'M', 'H'}", set(df[COL_TYPE].unique()).issubset({"L", "M", "H"})),
        ("Machine failure in {0, 1}", set(df[COL_TARGET].unique()).issubset({0, 1})),
    ]

    all_passed = True
    for desc, passed in checks:
        status = "PASSED" if passed else "FAILED"
        print(f"  [{status}] {desc}")
        if not passed:
            all_passed = False

    print("\nDescriptive statistics for numeric features:")
    print(df[FEATURE_COLS_NUMERIC].describe().round(2).to_string())

    temp_diff = df[COL_PROCESS_TEMP] - df[COL_AIR_TEMP]
    print(f"\nTemperature difference (Process - Air):")
    print(f"  Min: {temp_diff.min():.2f} K, Mean: {temp_diff.mean():.2f} K, Max: {temp_diff.max():.2f} K")
    print(f"  All sanity checks overall: {'ALL PASSED' if all_passed else 'SOME FAILED'}")
    print("-" * 80)


def generate_eda_plots(df: pd.DataFrame, output_dir: Path) -> List[Path]:
    """Generate high-quality diagnostic visualizations and save to backend/reports/."""
    output_dir.mkdir(parents=True, exist_ok=True)
    generated_files: List[Path] = []

    # Configure plot aesthetic
    sns.set_theme(style="whitegrid", palette="muted")
    plt.rcParams.update({"font.size": 10, "figure.autolayout": True})

    # 1. Target Distribution Plot
    fig, ax = plt.subplots(figsize=(6, 5))
    counts = df[COL_TARGET].value_counts().sort_index()
    palette = ["#2b5c8f", "#d9534f"]
    bars = ax.bar(["No Failure (0)", "Failure (1)"], counts.values, color=palette, edgecolor="black", width=0.5)
    for bar in bars:
        h = bar.get_height()
        ax.annotate(
            f"{h:,}\n({h/len(df)*100:.1f}%)",
            xy=(bar.get_x() + bar.get_width() / 2, h),
            xytext=(0, 4),
            textcoords="offset points",
            ha="center",
            va="bottom",
            fontweight="bold",
        )
    ax.set_title("AI4I 2020: Target Imbalance (Machine Failure)", fontsize=12, fontweight="bold")
    ax.set_ylabel("Count")
    ax.set_ylim(0, max(counts.values) * 1.15)
    target_plot_path = output_dir / "eda_target_distribution.png"
    plt.savefig(target_plot_path, dpi=200)
    plt.close()
    generated_files.append(target_plot_path)

    # 2. Failure Modes Breakdown Plot
    fig, ax = plt.subplots(figsize=(8, 5))
    mode_counts = [df[m].sum() for m in FAILURE_MODES if m in df.columns]
    mode_labels = [f"{m}\n({FAILURE_MODE_NAMES.get(m, m)})" for m in FAILURE_MODES if m in df.columns]
    colors = sns.color_palette("rocket", len(mode_counts))
    bars = ax.bar(mode_labels, mode_counts, color=colors, edgecolor="black")
    for bar in bars:
        h = bar.get_height()
        ax.annotate(f"{h}", xy=(bar.get_x() + bar.get_width() / 2, h),
                    xytext=(0, 4), textcoords="offset points", ha="center", va="bottom", fontweight="bold")
    ax.set_title("Counts of Specific Physical Failure Modes", fontsize=12, fontweight="bold")
    ax.set_ylabel("Occurrences")
    failure_mode_plot_path = output_dir / "eda_failure_modes.png"
    plt.savefig(failure_mode_plot_path, dpi=200)
    plt.close()
    generated_files.append(failure_mode_plot_path)

    # 3. Numeric Features by Failure Status (Boxplots / Violins)
    fig, axes = plt.subplots(2, 3, figsize=(14, 8))
    axes = axes.flatten()
    for idx, feature in enumerate(FEATURE_COLS_NUMERIC):
        ax = axes[idx]
        sns.boxplot(
            data=df,
            x=COL_TARGET,
            y=feature,
            hue=COL_TARGET,
            palette=["#3498db", "#e74c3c"],
            legend=False,
            ax=ax,
        )
        ax.set_xticks([0, 1])
        ax.set_xticklabels(["No Failure", "Failure"])
        ax.set_title(feature, fontsize=11, fontweight="bold")
        ax.set_xlabel("")

    # Use 6th subplot for Type distribution vs failure rate
    ax = axes[5]
    type_fail = df.groupby(COL_TYPE, as_index=False)[COL_TARGET].mean()
    type_fail["failure_rate_pct"] = type_fail[COL_TARGET] * 100
    sns.barplot(
        data=type_fail,
        x=COL_TYPE,
        y="failure_rate_pct",
        hue=COL_TYPE,
        palette="viridis",
        legend=False,
        ax=ax,
        edgecolor="black",
    )
    for p in ax.patches:
        h = p.get_height()
        ax.annotate(f"{h:.2f}%", (p.get_x() + p.get_width() / 2, h),
                    xytext=(0, 3), textcoords="offset points", ha="center", va="bottom", fontweight="bold")
    ax.set_title("Failure Rate (%) by Machine Type (L, M, H)", fontsize=11, fontweight="bold")
    ax.set_ylabel("Failure Rate (%)")
    ax.set_xlabel("Product Type")

    distributions_plot_path = output_dir / "eda_feature_distributions.png"
    plt.savefig(distributions_plot_path, dpi=200)
    plt.close()
    generated_files.append(distributions_plot_path)

    # 4. Correlation Heatmap
    corr_cols = FEATURE_COLS_NUMERIC + [COL_TARGET] + [m for m in FAILURE_MODES if m in df.columns]
    corr_matrix = df[corr_cols].corr()

    fig, ax = plt.subplots(figsize=(10, 8))
    sns.heatmap(
        corr_matrix,
        annot=True,
        fmt=".2f",
        cmap="coolwarm",
        center=0,
        square=True,
        linewidths=0.5,
        cbar_kws={"shrink": 0.8},
        ax=ax,
    )
    ax.set_title("Correlation Heatmap: Features, Target & Failure Modes", fontsize=12, fontweight="bold")
    corr_plot_path = output_dir / "eda_feature_correlations.png"
    plt.savefig(corr_plot_path, dpi=200)
    plt.close()
    generated_files.append(corr_plot_path)

    return generated_files


def run_eda(data_path: Path | str | None = None) -> None:
    """Run full exploratory data analysis workflow."""
    if data_path is None:
        data_path = get_project_root() / "data" / "ai4i2020.csv"
    data_path = Path(data_path)

    print(f"[INFO] Loading dataset from: {data_path}")
    df = load_dataset(data_path)

    inspect_overview(df)
    inspect_target_distribution(df)
    inspect_failure_modes(df)
    inspect_data_validity(df)

    reports_dir = get_reports_dir()
    print(f"\n[INFO] Generating EDA plots in: {reports_dir}")
    plots = generate_eda_plots(df, reports_dir)
    print(f"[SUCCESS] Saved {len(plots)} diagnostic plots:")
    for p in plots:
        print(f"  - {p.name}")
    print("=" * 80)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run Exploratory Data Analysis for MachinePulse AI.")
    parser.add_argument(
        "--data-path",
        type=str,
        default=None,
        help="Path to ai4i2020.csv. Defaults to data/ai4i2020.csv",
    )
    args = parser.parse_args()
    run_eda(args.data_path)
