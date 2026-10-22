"""Data preprocessing pipeline for MachinePulse AI.

Provides reusable scikit-learn ColumnTransformer pipelines, feature schema
definitions, safe unknown category handling, and stratified data splitting
without data leakage.
"""

from __future__ import annotations

from typing import Dict, List, Tuple, Union

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

# Target column
TARGET_COLUMN = "Machine failure"

# Allowed input features for the primary machine failure classifier
CATEGORICAL_FEATURES = ["Type"]
NUMERIC_FEATURES = [
    "Air temperature [K]",
    "Process temperature [K]",
    "Rotational speed [rpm]",
    "Torque [Nm]",
    "Tool wear [min]",
]
INPUT_FEATURES = CATEGORICAL_FEATURES + NUMERIC_FEATURES

# Excluded columns that must NEVER be inputs to the failure classifier
EXCLUDED_COLUMNS = [
    "UDI",
    "Product ID",
    "TWF",
    "HDF",
    "PWF",
    "OSF",
    "RNF",
]

# Known categories for product Type in AI4I 2020
KNOWN_PRODUCT_TYPES = ["L", "M", "H"]


def build_preprocessor(scale_numeric: bool = True) -> ColumnTransformer:
    """Construct a reusable scikit-learn ColumnTransformer.

    Key design rules:
    - Encodes 'Type' via OneHotEncoder with handle_unknown='ignore'.
      This ensures any unseen product category in production (e.g. 'X' or 'Custom')
      will safely encode as all zeros instead of raising a runtime exception.
    - Imputes missing values gracefully (SimpleImputer with 'most_frequent' for
      categoricals and 'median' for numeric features).
    - Optionally scales numeric features using StandardScaler.
    - Sparse output is disabled (sparse_output=False) to ensure uniform numpy
      array flow through tree-based and linear estimators.

    Args:
        scale_numeric: Whether to apply StandardScaler to numeric features.

    Returns:
        Unfitted ColumnTransformer instance.
    """
    cat_pipeline_steps = [
        ("imputer", SimpleImputer(strategy="most_frequent")),
        (
            "onehot",
            OneHotEncoder(
                categories=[KNOWN_PRODUCT_TYPES],
                handle_unknown="ignore",
                sparse_output=False,
            ),
        ),
    ]
    cat_pipeline = Pipeline(steps=cat_pipeline_steps)

    num_pipeline_steps = [
        ("imputer", SimpleImputer(strategy="median")),
    ]
    if scale_numeric:
        num_pipeline_steps.append(("scaler", StandardScaler()))
    num_pipeline = Pipeline(steps=num_pipeline_steps)

    preprocessor = ColumnTransformer(
        transformers=[
            ("cat", cat_pipeline, CATEGORICAL_FEATURES),
            ("num", num_pipeline, NUMERIC_FEATURES),
        ],
        remainder="drop",  # Drops any extra columns that might accidentally leak
    )
    return preprocessor


def split_data(
    df: pd.DataFrame,
    test_size: float = 0.15,
    val_size: float = 0.15,
    random_state: int = 42,
) -> Tuple[
    Tuple[pd.DataFrame, pd.Series],
    Tuple[pd.DataFrame, pd.Series],
    Tuple[pd.DataFrame, pd.Series],
]:
    """Perform a stratified 70/15/15 train/validation/test split.

    Strict leakage prevention:
    - Only features in `INPUT_FEATURES` are included in X.
    - Preprocessing is NEVER fit here. Only raw feature DataFrames and target
      Series are partitioned.
    - Stratification on `y` preserves the 3.4% failure proportion across
      train, validation, and test subsets.

    Args:
        df: Raw DataFrame containing at least INPUT_FEATURES and TARGET_COLUMN.
        test_size: Fraction of total data for test set (default 0.15).
        val_size: Fraction of total data for validation set (default 0.15).
        random_state: Random seed for reproducibility.

    Returns:
        ((X_train, y_train), (X_val, y_val), (X_test, y_test))
    """
    # Verify target existence
    if TARGET_COLUMN not in df.columns:
        raise KeyError(f"Target column '{TARGET_COLUMN}' not found in DataFrame.")

    # Verify all input features exist
    missing_feats = [col for col in INPUT_FEATURES if col not in df.columns]
    if missing_feats:
        raise KeyError(f"Missing required input features in DataFrame: {missing_feats}")

    # Extract strictly permitted features
    X = df[INPUT_FEATURES].copy()
    y = df[TARGET_COLUMN].copy().astype(int)

    # First split: Hold out the test set (15%)
    # Train + Val = 85%
    X_train_val, X_test, y_train_val, y_test = train_test_split(
        X,
        y,
        test_size=test_size,
        stratify=y,
        random_state=random_state,
    )

    # Second split: From the 85%, carve out validation set
    # val_ratio = 0.15 / 0.85 approx 0.17647 -> yields exactly 15% of total
    val_ratio = val_size / (1.0 - test_size)
    X_train, X_val, y_train, y_val = train_test_split(
        X_train_val,
        y_train_val,
        test_size=val_ratio,
        stratify=y_train_val,
        random_state=random_state,
    )

    return (X_train, y_train), (X_val, y_val), (X_test, y_test)


def validate_inference_input(
    data: Union[pd.DataFrame, Dict[str, Union[str, float, int]], List[Dict]]
) -> pd.DataFrame:
    """Validate and align raw inference input against the canonical feature schema.

    Ensures that FastAPI endpoints or client batches match the exact columns,
    types, and ordering required by the preprocessing pipeline.

    Args:
        data: A dict, list of dicts, or pandas DataFrame.

    Returns:
        A pd.DataFrame guaranteed to contain exactly INPUT_FEATURES.
    """
    if isinstance(data, dict):
        df = pd.DataFrame([data])
    elif isinstance(data, list):
        df = pd.DataFrame(data)
    elif isinstance(data, pd.DataFrame):
        df = data.copy()
    else:
        raise TypeError(f"Unsupported data type for inference: {type(data)}")

    # Check for missing features
    missing = [c for c in INPUT_FEATURES if c not in df.columns]
    if missing:
        raise ValueError(
            f"Input is missing required features: {missing}. Expected features: {INPUT_FEATURES}"
        )

    # Select and order exactly by INPUT_FEATURES
    clean_df = df[INPUT_FEATURES].copy()

    # Enforce numeric types
    for num_col in NUMERIC_FEATURES:
        clean_df[num_col] = pd.to_numeric(clean_df[num_col], errors="coerce")

    # Enforce string type for categorical
    clean_df[CATEGORICAL_FEATURES[0]] = clean_df[CATEGORICAL_FEATURES[0]].astype(str)

    return clean_df
