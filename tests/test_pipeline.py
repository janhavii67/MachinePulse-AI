"""Automated unit and integration test suite for MachinePulse AI Module 1.

Tests cover:
1. Expected feature schema and definitions.
2. Binary target validity.
3. Strict exclusion of failure modes and IDs from classifier features.
4. Loading and integrity of the saved serialized pipeline artifact.
5. Prediction and probability tensor shapes.
6. Probability value bounds [0, 1] and finiteness.
7. Graceful handling of unseen product types (no crashes).
8. Schema consistency and metadata file integrity.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
import pytest
from sklearn.pipeline import Pipeline

from backend.ml.download_dataset import download_dataset
from backend.ml.preprocess import (
    CATEGORICAL_FEATURES,
    EXCLUDED_COLUMNS,
    INPUT_FEATURES,
    KNOWN_PRODUCT_TYPES,
    NUMERIC_FEATURES,
    TARGET_COLUMN,
    validate_inference_input,
)


@pytest.fixture(scope="session")
def project_root() -> Path:
    return Path(__file__).resolve().parent.parent


@pytest.fixture(scope="session")
def dataset_df(project_root: Path) -> pd.DataFrame:
    csv_path = project_root / "data" / "ai4i2020.csv"
    if not csv_path.exists():
        csv_path = download_dataset(csv_path)
    return pd.read_csv(csv_path)


@pytest.fixture(scope="session")
def saved_pipeline(project_root: Path) -> Pipeline:
    artifact_path = project_root / "backend" / "artifacts" / "failure_pipeline.joblib"
    assert artifact_path.exists(), (
        f"Pipeline artifact not found at {artifact_path}. "
        "Run backend/ml/train_failure.py before running tests."
    )
    pipeline = joblib.load(artifact_path)
    return pipeline


@pytest.fixture(scope="session")
def model_metadata(project_root: Path) -> dict[str, Any]:
    meta_path = project_root / "backend" / "artifacts" / "model_metadata.json"
    assert meta_path.exists(), f"Metadata JSON not found at {meta_path}."
    with open(meta_path, "r", encoding="utf-8") as f:
        return json.load(f)


# Test 1: Verify expected features exist
def test_expected_features_exist(dataset_df: pd.DataFrame):
    """Verify that all required input features and target exist in the dataset."""
    for feature in INPUT_FEATURES:
        assert feature in dataset_df.columns, f"Required feature '{feature}' is missing from dataset!"
    assert TARGET_COLUMN in dataset_df.columns, f"Target column '{TARGET_COLUMN}' is missing from dataset!"
    assert len(INPUT_FEATURES) == 6, f"Expected exactly 6 input features, got {len(INPUT_FEATURES)}"


# Test 2: Failure labels are valid
def test_failure_labels_valid(dataset_df: pd.DataFrame):
    """Verify that failure labels contain only valid binary classes (0 and 1) without nulls."""
    unique_labels = set(dataset_df[TARGET_COLUMN].dropna().unique())
    assert unique_labels == {0, 1}, f"Target labels must be {{0, 1}}, found: {unique_labels}"
    assert dataset_df[TARGET_COLUMN].isnull().sum() == 0, "Target column contains missing/null values!"


# Test 3: Failure-mode labels and IDs are NOT included in classifier inputs
def test_failure_modes_not_in_inputs():
    """Verify that UDI, Product ID, and the five failure modes are strictly excluded from classifier inputs."""
    for excluded in EXCLUDED_COLUMNS:
        assert excluded not in INPUT_FEATURES, (
            f"LEAKAGE VIOLATION: '{excluded}' is present in classifier INPUT_FEATURES!"
        )


# Test 4: Saved pipeline can be loaded
def test_saved_pipeline_can_be_loaded(saved_pipeline: Pipeline):
    """Verify that the joblib artifact loads as a valid scikit-learn Pipeline with preprocessor and classifier."""
    assert isinstance(saved_pipeline, Pipeline), "Loaded object is not a scikit-learn Pipeline!"
    assert "preprocessor" in saved_pipeline.named_steps, "Pipeline is missing 'preprocessor' step!"
    assert "classifier" in saved_pipeline.named_steps, "Pipeline is missing 'classifier' step!"


# Test 5: Predictions and probabilities have valid shapes
def test_prediction_and_probability_shapes(saved_pipeline: Pipeline, dataset_df: pd.DataFrame):
    """Verify that batch predictions and probability outputs match expected row counts and dimensions."""
    sample_df = dataset_df[INPUT_FEATURES].head(25)
    preds = saved_pipeline.predict(sample_df)
    probs = saved_pipeline.predict_proba(sample_df)

    assert preds.shape == (25,), f"Expected preds shape (25,), got {preds.shape}"
    assert probs.shape == (25, 2), f"Expected probs shape (25, 2), got {probs.shape}"


# Test 6: Probability output is finite and between 0 and 1
def test_probability_values_finite_and_bounded(saved_pipeline: Pipeline, dataset_df: pd.DataFrame):
    """Verify that predicted failure probabilities are finite and strictly bounded within [0.0, 1.0]."""
    sample_df = dataset_df[INPUT_FEATURES].head(100)
    probs = saved_pipeline.predict_proba(sample_df)

    assert np.all(np.isfinite(probs)), "Predicted probabilities contain NaN, Inf, or non-finite values!"
    assert np.all(probs >= 0.0), "Predicted probabilities contain negative values (< 0.0)!"
    assert np.all(probs <= 1.0), "Predicted probabilities contain values exceeding 1.0!"

    # Verify rows sum to 1.0
    row_sums = probs.sum(axis=1)
    np.testing.assert_allclose(row_sums, 1.0, atol=1e-5, err_msg="Class probabilities do not sum to 1.0")


# Test 7: Unseen product type does not crash preprocessing
def test_unseen_product_type_handling(saved_pipeline: Pipeline):
    """Verify that an unseen product type (e.g. 'X' or 'Z') encodes safely as unknown without raising an error."""
    unseen_sample = pd.DataFrame([{
        "Type": "X",  # Unknown product type
        "Air temperature [K]": 300.0,
        "Process temperature [K]": 310.0,
        "Rotational speed [rpm]": 1500,
        "Torque [Nm]": 40.0,
        "Tool wear [min]": 100,
    }])

    try:
        prob = saved_pipeline.predict_proba(unseen_sample)
    except Exception as exc:
        pytest.fail(f"Pipeline crashed on unseen category 'Type=X': {exc}")

    assert prob.shape == (1, 2)
    assert 0.0 <= prob[0, 1] <= 1.0


# Test 8: Single-record inference and schema validator
def test_inference_schema_validation(saved_pipeline: Pipeline):
    """Verify that validate_inference_input accurately formats raw dict payloads for FastAPI scoring."""
    payload = {
        "Type": "M",
        "Air temperature [K]": 298.5,
        "Process temperature [K]": 308.7,
        "Rotational speed [rpm]": 1400,
        "Torque [Nm]": 45.0,
        "Tool wear [min]": 50,
        "extra_field_from_client": "ignored_value",
    }
    validated_df = validate_inference_input(payload)
    assert list(validated_df.columns) == INPUT_FEATURES

    prob = saved_pipeline.predict_proba(validated_df)[0, 1]
    assert isinstance(prob, (float, np.floating))
    assert 0.0 <= prob <= 1.0


# Test 9: Model metadata JSON integrity
def test_model_metadata_integrity(model_metadata: dict[str, Any]):
    """Verify that model_metadata.json contains all required audit fields."""
    required_keys = [
        "model_name",
        "model_type",
        "model_version",
        "created_at",
        "dataset_source",
        "target_column",
        "input_features",
        "categorical_features",
        "numeric_features",
        "excluded_features",
        "selected_classification_threshold",
        "selection_criterion",
        "evaluation_metrics",
        "known_limitations",
    ]
    for key in required_keys:
        assert key in model_metadata, f"Metadata JSON missing key: '{key}'"

    assert model_metadata["target_column"] == TARGET_COLUMN
    assert model_metadata["input_features"] == INPUT_FEATURES
    assert 0.0 < model_metadata["selected_classification_threshold"] < 1.0
    assert len(model_metadata["known_limitations"]) > 0
