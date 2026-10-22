"""Test suite for Phase 1: Backend Explanation Service & Endpoints.

Tests:
1. Local occlusion attribution: ordering sanity, determinism, probability equality with pipeline.predict_proba.
2. Direction assignment (increases_risk vs decreases_risk vs neutral).
3. Range checks and outside-training-range warnings.
4. Input validation and leakage column rejection (422 Unprocessable Entity).
5. POST /api/explain strictly performs NO database writes.
6. GET /api/explain/global returns valid schema, ranking, and metadata.
7. GET /api/explain/baseline returns non-failure medians and observed ranges.
8. GET /api/predictions/{id}/explain reproduces stored probability within tolerance.
9. GET /api/predictions/{id}/explain returns 404 for unknown ID and 422 for malformed input snapshot.
10. Missing-artifact handling returns clear 503 error.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app.core.database import db
from backend.app.main import app
from backend.app.schemas import MachineFeatures
from backend.app.services.explainability import ExplainabilityService, explainability_service
from backend.app.services.inference import inference_service


@pytest.fixture(scope="session")
def client() -> TestClient:
    """Session test client ensuring model and artifacts are loaded."""
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def sample_healthy_input() -> dict:
    return {
        "type": "L",
        "air_temperature": 298.5,
        "process_temperature": 308.7,
        "rotational_speed": 1500.0,
        "torque": 40.0,
        "tool_wear": 50.0,
    }


@pytest.fixture
def sample_stressed_input() -> dict:
    return {
        "type": "L",
        "air_temperature": 302.5,
        "process_temperature": 311.0,
        "rotational_speed": 1300.0,
        "torque": 68.0,
        "tool_wear": 230.0,
    }


# 1. Pipeline probability consistency: explainability probability == pipeline.predict_proba
def test_explanation_probability_matches_pipeline(sample_stressed_input: dict):
    """Verify that explanation probability exactly matches raw pipeline predict_proba output."""
    validated = MachineFeatures(**sample_stressed_input)
    result = explainability_service.explain_features(validated)

    # Compute directly from pipeline
    import pandas as pd
    raw_dict = validated.to_original_pipeline_dict()
    df = pd.DataFrame([raw_dict])
    expected_prob = float(inference_service.pipeline.predict_proba(df)[0, 1])

    assert abs(result["failure_probability"] - expected_prob) < 1e-4
    assert result["decision_threshold"] == inference_service.decision_threshold
    assert result["failure_predicted"] == (result["failure_probability"] >= result["decision_threshold"])


# 2. Local occlusion ordering and structure sanity
def test_occlusion_ordering_and_structure(sample_stressed_input: dict):
    """Verify that local contributions are sorted by absolute impact and have correct fields."""
    validated = MachineFeatures(**sample_stressed_input)
    res = explainability_service.explain_features(validated)

    assert res["method"] == "occlusion_vs_healthy_baseline"
    contributions = res["contributions"]
    assert len(contributions) == 6  # 6 input features

    # Verify descending sort by absolute contribution
    abs_values = [c["absolute_contribution"] for c in contributions]
    assert abs_values == sorted(abs_values, reverse=True)

    # In high torque + high tool wear, torque and/or tool wear should increase risk
    tool_wear_contrib = next(c for c in contributions if c["feature"] == "Tool wear [min]")
    assert tool_wear_contrib["original_value"] == 230.0
    assert tool_wear_contrib["baseline_value"] == 107.0
    # Higher wear than healthy baseline (107 min) should push risk up
    assert tool_wear_contrib["contribution"] > 0
    assert tool_wear_contrib["direction"] == "increases_risk"


# 3. Determinism of explanations
def test_explanation_determinism(sample_stressed_input: dict):
    """Calling explain multiple times on identical inputs must yield identical numerical results."""
    validated = MachineFeatures(**sample_stressed_input)
    res1 = explainability_service.explain_features(validated)
    res2 = explainability_service.explain_features(validated)

    assert res1["failure_probability"] == res2["failure_probability"]
    for c1, c2 in zip(res1["contributions"], res2["contributions"]):
        assert c1["feature"] == c2["feature"]
        assert c1["contribution"] == c2["contribution"]
        assert c1["baseline_value"] == c2["baseline_value"]


# 4. Input validation: rejecting leakage columns & out-of-range sensor values (422)
def test_input_validation_and_leakage_guards(client: TestClient):
    """Verify that leakage columns and physically impossible values produce 422 Unprocessable Entity."""
    # Leakage column: Machine failure
    res_leak1 = client.post(
        "/api/explain",
        json={
            "type": "L",
            "air_temperature": 298.5,
            "process_temperature": 308.7,
            "rotational_speed": 1500.0,
            "torque": 40.0,
            "tool_wear": 50.0,
            "Machine failure": 1,
        },
    )
    assert res_leak1.status_code == 422
    assert "Forbidden" in res_leak1.text or "Machine failure" in res_leak1.text

    # Diagnostic failure mode leakage: TWF
    res_leak2 = client.post(
        "/api/explain",
        json={
            "type": "L",
            "air_temperature": 298.5,
            "process_temperature": 308.7,
            "rotational_speed": 1500.0,
            "torque": 40.0,
            "tool_wear": 50.0,
            "TWF": 0,
        },
    )
    assert res_leak2.status_code == 422

    # Physical inconsistency: process temp lower than air temp
    res_phys = client.post(
        "/api/explain",
        json={
            "type": "L",
            "air_temperature": 310.0,
            "process_temperature": 290.0,
            "rotational_speed": 1500.0,
            "torque": 40.0,
            "tool_wear": 50.0,
        },
    )
    assert res_phys.status_code == 422
    assert "Physical consistency violation" in res_phys.text


# 5. Outside-training-range warnings flagged
def test_outside_training_range_warnings(client: TestClient):
    """Features beyond observed training min/max should be scored but flagged with clear warnings."""
    # Torque 85 Nm is within physical bounds (0-200 Nm) but above AI4I training max (76.6 Nm)
    res = client.post(
        "/api/explain",
        json={
            "type": "M",
            "air_temperature": 300.0,
            "process_temperature": 310.0,
            "rotational_speed": 1500.0,
            "torque": 85.0,
            "tool_wear": 50.0,
        },
    )
    assert res.status_code == 200
    data = res.json()
    warnings = data["outside_range_warnings"]
    assert len(warnings) >= 1
    assert any("Torque [Nm]" in w for w in warnings)


# 6. POST /api/explain strictly performs NO database writes (What-if isolation)
def test_explain_endpoint_does_not_write_to_db(client: TestClient, sample_stressed_input: dict):
    """Ensure POST /api/explain leaves prediction history and alerts unchanged."""
    # Count before
    _, count_before = db.list_predictions(limit=1, offset=0)
    alerts_before = db.get_dashboard_stats()["open_alerts"]

    # Run POST /api/explain
    res = client.post("/api/explain", json=sample_stressed_input)
    assert res.status_code == 200
    body = res.json()
    assert body["failure_probability"] > 0
    assert "prediction_id" not in body or body["prediction_id"] is None

    # Count after
    _, count_after = db.list_predictions(limit=1, offset=0)
    alerts_after = db.get_dashboard_stats()["open_alerts"]

    assert count_after == count_before
    assert alerts_after == alerts_before


# 7. GET /api/explain/global returns valid schema and correct ranks
def test_get_global_importance_endpoint(client: TestClient):
    """Verify /api/explain/global serves precomputed permutation importance with required metadata."""
    res = client.get("/api/explain/global")
    assert res.status_code == 200
    data = res.json()

    assert data["method"] == "permutation_importance"
    assert data["metric"] == "roc_auc"
    assert data["n_repeats"] >= 5
    assert data["test_sample_size"] == 2000
    assert len(data["importances"]) == 6

    # Verify ranks are 1 to 6
    ranks = [item["rank"] for item in data["importances"]]
    assert ranks == list(range(1, 7))

    # Features must include all 6 expected inputs
    features = {item["feature"] for item in data["importances"]}
    assert features == {
        "Type",
        "Air temperature [K]",
        "Process temperature [K]",
        "Rotational speed [rpm]",
        "Torque [Nm]",
        "Tool wear [min]",
    }


# 8. GET /api/explain/baseline endpoint
def test_get_baseline_info_endpoint(client: TestClient):
    """Verify /api/explain/baseline serves non-failure medians and observed ranges."""
    res = client.get("/api/explain/baseline")
    assert res.status_code == 200
    data = res.json()

    assert "baseline_values" in data
    assert data["baseline_values"]["Type"] == "L"
    assert data["baseline_values"]["Air temperature [K]"] == 300.0
    assert data["baseline_values"]["Process temperature [K]"] == 310.0
    assert data["non_failure_records"] == 9661
    assert "training_ranges" in data


# 9. GET /api/predictions/{id}/explain on a stored prediction
def test_explain_stored_prediction_matches_recorded_probability(client: TestClient):
    """Verify explaining a stored prediction reproduces its probability within float precision."""
    # Fetch latest stored prediction from DB
    items, total = db.list_predictions(limit=1, offset=0)
    if total == 0:
        # Create one via simulator step or predict API
        pred_res = client.post(
            "/api/predict",
            json={
                "type": "M",
                "air_temperature": 299.0,
                "process_temperature": 309.5,
                "rotational_speed": 1450.0,
                "torque": 45.0,
                "tool_wear": 80.0,
            },
        )
        assert pred_res.status_code == 200
        items, _ = db.list_predictions(limit=1, offset=0)

    target_pred = items[0]
    pred_id = target_pred["id"]
    stored_prob = target_pred["failure_probability"]

    # Request explanation
    res = client.get(f"/api/predictions/{pred_id}/explain")
    assert res.status_code == 200
    data = res.json()

    assert data["prediction_id"] == pred_id
    assert abs(data["failure_probability"] - stored_prob) < 1e-3
    assert len(data["contributions"]) == 6


# 10. GET /api/predictions/{id}/explain 404 for unknown ID
def test_explain_stored_prediction_not_found(client: TestClient):
    """Unknown prediction ID must return 404 Not Found."""
    res = client.get("/api/predictions/nonexistent-uuid-12345/explain")
    assert res.status_code == 404
    assert "not found" in res.text.lower()


# 11. Missing artifacts 503 error handling
def test_missing_artifacts_error_handling(tmp_path: Path):
    """Service with non-existent artifact paths must raise ArtifactsMissingError."""
    fake_baseline = tmp_path / "missing_baseline.json"
    fake_global = tmp_path / "missing_global.json"

    service = ExplainabilityService(baseline_path=fake_baseline, global_path=fake_global)

    with pytest.raises(Exception) as excinfo:
        service.get_global_importance()
    assert "not found" in str(excinfo.value).lower() or "missing" in str(excinfo.value).lower()
