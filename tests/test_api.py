"""Integration and regression test suite for MachinePulse AI FastAPI Prediction API.

Covers:
1. Health check endpoint (GET /api/health)
2. Model info endpoint (GET /api/model/info)
3. Prediction endpoint with friendly field names (POST /api/predict)
4. Prediction endpoint with exact AI4I column names (POST /api/predict)
5. Strict anti-leakage rejection of forbidden columns (Machine failure, TWF, etc.)
6. Pydantic range and physical temperature validation
7. Missing and unexpected field handling
8. Probability boundaries [0, 1] and prediction logic
9. Graceful handling of missing or unloaded model artifacts
"""

from __future__ import annotations

from pathlib import Path
from typing import Generator

import pytest
from fastapi.testclient import TestClient

from backend.app.main import app
from backend.app.services.inference import InferenceService, ModelNotLoadedError, inference_service


@pytest.fixture(scope="session")
def client() -> Generator[TestClient, None, None]:
    """TestClient fixture with application lifespan context executed."""
    with TestClient(app) as test_client:
        yield test_client


# 1. Root and discovery endpoint
def test_root_endpoint(client: TestClient):
    """Verify service root returns 200 with discovery URLs."""
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "online"
    assert "health_url" in data
    assert "predict_url" in data
    assert "docs_url" in data


# 2. Health check endpoint
def test_health_endpoint_healthy(client: TestClient):
    """Verify /api/health returns 200, healthy status, and model metadata."""
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["model_loaded"] is True
    assert data["model_name"] == "HistGradientBoosting"
    assert data["model_version"] == "1.0.0"
    assert data["selected_threshold"] == 0.66


# 3. Model info endpoint
def test_model_info_endpoint(client: TestClient):
    """Verify /api/model/info returns dynamic threshold and full training audit."""
    response = client.get("/api/model/info")
    assert response.status_code == 200
    data = response.json()
    assert data["model_name"] == "HistGradientBoosting"
    assert data["selected_classification_threshold"] == 0.66
    assert data["target_column"] == "Machine failure"
    assert len(data["input_features"]) == 6
    assert "TWF" in data["excluded_features"]
    assert "UDI" in data["excluded_features"]
    assert "Product ID" in data["excluded_features"]
    assert "evaluation_metrics" in data
    assert data["evaluation_metrics"]["precision"] > 0.0
    assert data["evaluation_metrics"]["recall"] > 0.0


# 4. Valid prediction using friendly snake_case field names
def test_predict_friendly_field_names(client: TestClient):
    """Verify prediction works with friendly names and returns all expected fields."""
    payload = {
        "type": "M",
        "air_temperature": 298.5,
        "process_temperature": 308.7,
        "rotational_speed": 1400.0,
        "torque": 45.0,
        "tool_wear": 110.0,
    }
    response = client.post("/api/predict", json=payload)
    assert response.status_code == 200
    data = response.json()

    assert "failure_probability" in data
    assert 0.0 <= data["failure_probability"] <= 1.0
    assert isinstance(data["failure_predicted"], bool)
    assert data["predicted_class"] in (0, 1)
    assert data["decision_threshold"] == 0.66
    assert data["risk_level"] in ("LOW", "MEDIUM", "HIGH", "CRITICAL")
    assert len(data["recommendation"]) > 0
    assert data["model_name"] == "HistGradientBoosting"
    assert data["model_version"] == "1.0.0"
    assert "timestamp" in data
    assert "AI4I 2020" in data["data_source"]

    # Verify input features were properly mapped internally
    features_used = data["features_used"]
    assert features_used["Type"] == "M"
    assert features_used["Air temperature [K]"] == 298.5
    assert features_used["Process temperature [K]"] == 308.7


# 5. Valid prediction using original AI4I dataset column names
def test_predict_original_ai4i_column_names(client: TestClient):
    """Verify prediction works with raw AI4I column names containing spaces and brackets."""
    payload = {
        "Type": "L",
        "Air temperature [K]": 298.1,
        "Process temperature [K]": 308.6,
        "Rotational speed [rpm]": 1551.0,
        "Torque [Nm]": 42.8,
        "Tool wear [min]": 0.0,
    }
    response = client.post("/api/predict", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert 0.0 <= data["failure_probability"] <= 1.0
    assert data["failure_predicted"] is False  # Fresh tool and nominal conditions
    assert data["risk_level"] == "LOW"


# 6. Prediction on high-stress machine triggers elevated probability
def test_predict_high_stress_machine(client: TestClient):
    """Verify extreme tool wear and torque trigger high failure probability."""
    payload = {
        "type": "H",
        "air_temperature": 302.5,
        "process_temperature": 311.5,
        "rotational_speed": 1280.0,
        "torque": 72.0,       # High torque
        "tool_wear": 235.0,    # Critical tool wear
    }
    response = client.post("/api/predict", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["failure_probability"] > 0.50
    assert data["risk_level"] in ("HIGH", "CRITICAL")
    assert data["failure_predicted"] is True


# 7. Strict Anti-Leakage: Forbid 'Machine failure' and failure modes
@pytest.mark.parametrize(
    "forbidden_field",
    [
        "Machine failure",
        "machine_failure",
        "TWF",
        "HDF",
        "PWF",
        "OSF",
        "RNF",
        "UDI",
        "Product ID",
    ],
)
def test_predict_rejects_leakage_fields(client: TestClient, forbidden_field: str):
    """Verify that any attempt to inject target or failure modes returns 422 Unprocessable Entity."""
    payload = {
        "type": "M",
        "air_temperature": 298.5,
        "process_temperature": 308.7,
        "rotational_speed": 1400.0,
        "torque": 45.0,
        "tool_wear": 100.0,
        forbidden_field: 1,  # Leakage attempt
    }
    response = client.post("/api/predict", json=payload)
    assert response.status_code == 422
    data = response.json()
    assert "error" in data or "detail" in data


# 8. Pydantic validation: Reject invalid product type
def test_predict_rejects_invalid_type(client: TestClient):
    """Verify invalid product type (not in L, M, H) is rejected."""
    payload = {
        "type": "UNKNOWN_TYPE",
        "air_temperature": 298.5,
        "process_temperature": 308.7,
        "rotational_speed": 1400.0,
        "torque": 45.0,
        "tool_wear": 100.0,
    }
    response = client.post("/api/predict", json=payload)
    assert response.status_code == 422


# 9. Pydantic validation: Out-of-range sensor values
@pytest.mark.parametrize(
    "field,value",
    [
        ("air_temperature", 150.0),    # Unrealistic Kelvin temp
        ("air_temperature", 450.0),    # Too high
        ("rotational_speed", -10.0),   # Negative speed
        ("torque", -5.0),              # Negative torque
        ("tool_wear", -1.0),           # Negative wear
        ("tool_wear", 999.0),          # Impossibly high wear
    ],
)
def test_predict_rejects_out_of_range_values(client: TestClient, field: str, value: float):
    """Verify out-of-physical-range sensor values return 422."""
    payload = {
        "type": "M",
        "air_temperature": 298.5,
        "process_temperature": 308.7,
        "rotational_speed": 1400.0,
        "torque": 45.0,
        "tool_wear": 100.0,
    }
    payload[field] = value
    response = client.post("/api/predict", json=payload)
    assert response.status_code == 422


# 10. Physical consistency check: Process temp < Air temp
def test_predict_rejects_temperature_inversion(client: TestClient):
    """Verify that process temperature below air temperature returns 422."""
    payload = {
        "type": "M",
        "air_temperature": 312.0,
        "process_temperature": 295.0,  # Physically impossible under cutting operation
        "rotational_speed": 1400.0,
        "torque": 45.0,
        "tool_wear": 50.0,
    }
    response = client.post("/api/predict", json=payload)
    assert response.status_code == 422
    data = response.json()
    assert "Physical consistency violation" in str(data)


# 11. Missing required field
def test_predict_rejects_missing_field(client: TestClient):
    """Verify payload missing required field returns 422."""
    payload = {
        "type": "M",
        "air_temperature": 298.5,
        "process_temperature": 308.7,
        "rotational_speed": 1400.0,
        # missing torque and tool_wear
    }
    response = client.post("/api/predict", json=payload)
    assert response.status_code == 422


# 12. Missing model artifact error handling
def test_missing_model_artifact_service():
    """Verify InferenceService raises appropriate exceptions when artifacts are missing."""
    service = InferenceService(
        pipeline_path=Path("non_existent_pipeline.joblib"),
        metadata_path=Path("non_existent_metadata.json"),
    )
    assert service.is_ready is False

    with pytest.raises(FileNotFoundError):
        service.load_model()

    with pytest.raises(ModelNotLoadedError):
        service.get_model_info()
