"""End-to-End dynamic functionality test suite for MachinePulse AI.

Verifies:
1. End-to-end data flow: sensor reading -> actual model prediction -> DB persistence -> alerts.
2. Simulator lifecycle: start, pause, resume, stop, reset, step.
3. Dashboard stats & KPIs: aggregated directly from actual database records.
4. Prediction history retrieval and detail inspection.
5. Alert lifecycle: generation, retrieval, acknowledging, resolving.
6. Dataset & active model metadata endpoints.
7. WebSocket live telemetry broadcasting.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.app.core.database import db
from backend.app.main import app
from backend.app.services.simulator import simulator


@pytest.fixture(scope="session")
def client() -> TestClient:
    """TestClient running application lifespan."""
    with TestClient(app) as test_client:
        yield test_client


# 1. Simulator step executes actual ML prediction and persists in SQLite
def test_simulator_step_data_flow(client: TestClient):
    """Verify that advancing a simulator step executes genuine model inference and persists."""
    import asyncio

    # Reset to known index
    simulator.reset()
    start_index = simulator.get_status()["current_index"]
    assert start_index == 0

    # Step once
    result = asyncio.run(simulator.step_once())
    assert result is not None
    assert "id" in result
    assert "failure_probability" in result
    assert 0.0 <= result["failure_probability"] <= 1.0
    assert result["is_simulated"] is True
    assert "Machine failure" not in result["input_snapshot"]

    # Verify state incremented
    new_status = simulator.get_status()
    assert new_status["current_index"] == 1
    assert new_status["simulated_count"] >= 1

    # Verify persistence in database
    persisted = db.get_prediction(result["id"])
    assert persisted is not None
    assert persisted["id"] == result["id"]
    assert persisted["failure_probability"] == result["failure_probability"]


# 2. Simulator REST API lifecycle controls
def test_simulator_api_lifecycle(client: TestClient):
    """Verify simulator start, pause, resume, stop, reset endpoints."""
    # Start
    res_start = client.post("/api/simulator/start", json={"speed_seconds": 2.0})
    assert res_start.status_code == 200
    assert res_start.json()["status"] == "running"

    # Status
    res_status = client.get("/api/simulator/status")
    assert res_status.status_code == 200
    assert res_status.json()["status"] == "running"

    # Pause
    res_pause = client.post("/api/simulator/pause")
    assert res_pause.status_code == 200
    assert res_pause.json()["status"] == "paused"

    # Resume
    res_resume = client.post("/api/simulator/resume")
    assert res_resume.status_code == 200
    assert res_resume.json()["status"] == "running"

    # Stop
    res_stop = client.post("/api/simulator/stop")
    assert res_stop.status_code == 200
    assert res_stop.json()["status"] == "stopped"

    # Reset
    res_reset = client.post("/api/simulator/reset")
    assert res_reset.status_code == 200
    assert res_reset.json()["status"] == "stopped"
    assert res_reset.json()["current_index"] == 0


# 3. Step endpoint advances and scores
def test_simulator_api_step(client: TestClient):
    """Verify POST /api/simulator/step executes single row replay and inference."""
    response = client.post("/api/simulator/step")
    assert response.status_code == 200
    data = response.json()
    assert "status" in data
    assert "prediction" in data
    assert data["status"]["current_index"] >= 1
    assert "failure_probability" in data["prediction"]


# 4. Real-time Dashboard KPIs reflect actual database counts
def test_dashboard_stats_endpoint(client: TestClient):
    """Verify /api/stats computes actual aggregated KPIs from database records."""
    response = client.get("/api/stats")
    assert response.status_code == 200
    stats = response.json()

    assert "total_predictions" in stats
    assert "normal_count" in stats
    assert "warning_count" in stats
    assert "critical_count" in stats
    assert "open_alerts" in stats
    assert "failure_rate_pct" in stats
    assert isinstance(stats["trend"], list)
    assert stats["total_predictions"] >= 1


# 5. Prediction history listing and detail inspection
def test_prediction_history_endpoints(client: TestClient):
    """Verify /api/predictions listing and single record detail."""
    res_list = client.get("/api/predictions?limit=10&offset=0")
    assert res_list.status_code == 200
    data = res_list.json()
    assert "items" in data
    assert "total" in data
    assert len(data["items"]) >= 1

    first_id = data["items"][0]["prediction_id"]
    res_detail = client.get(f"/api/predictions/{first_id}")
    assert res_detail.status_code == 200
    detail = res_detail.json()
    assert detail["prediction_id"] == first_id
    assert "input_snapshot" in detail
    assert "explanation" in detail
    assert "failure_probability" in detail


# 6. Alert lifecycle: listing, acknowledging, and resolving
def test_alert_lifecycle(client: TestClient):
    """Verify alert listing and status transitions (open -> acknowledged -> resolved)."""
    # Trigger an intentional high-stress prediction to guarantee an alert
    high_stress_payload = {
        "type": "H",
        "air_temperature": 303.0,
        "process_temperature": 312.0,
        "rotational_speed": 1250.0,
        "torque": 75.0,
        "tool_wear": 240.0,
    }
    client.post("/api/predict", json=high_stress_payload)

    # List alerts
    res_alerts = client.get("/api/alerts?limit=50")
    assert res_alerts.status_code == 200
    alert_data = res_alerts.json()
    assert alert_data["total"] >= 1
    assert len(alert_data["items"]) >= 1

    # Find an open alert to patch
    open_alerts = [a for a in alert_data["items"] if a["status"] == "open"]
    if open_alerts:
        alert_id = open_alerts[0]["id"]

        # Acknowledge
        res_ack = client.patch(f"/api/alerts/{alert_id}", json={"status": "acknowledged"})
        assert res_ack.status_code == 200
        assert res_ack.json()["status"] == "acknowledged"
        assert res_ack.json()["acknowledged_at"] is not None

        # Resolve
        res_res = client.patch(f"/api/alerts/{alert_id}", json={"status": "resolved"})
        assert res_res.status_code == 200
        assert res_res.json()["status"] == "resolved"
        assert res_res.json()["resolved_at"] is not None


# 7. Model version & dataset metadata
def test_model_versions_and_datasets_endpoints(client: TestClient):
    """Verify /api/model-versions and /api/datasets return real metadata."""
    res_mv = client.get("/api/model-versions")
    assert res_mv.status_code == 200
    mvs = res_mv.json()
    assert len(mvs) >= 1
    assert mvs[0]["metrics"]["model_name"] == "HistGradientBoosting"
    assert mvs[0]["metrics"]["threshold"] == 0.66

    res_active = client.get("/api/model-versions/active")
    assert res_active.status_code == 200
    assert res_active.json()["is_active"] is True

    res_ds = client.get("/api/datasets")
    assert res_ds.status_code == 200
    dss = res_ds.json()
    assert dss["total"] >= 1
    assert dss["items"][0]["original_filename"] == "ai4i2020.csv"


# 8. WebSocket live telemetry stream
def test_websocket_live_telemetry(client: TestClient):
    """Verify WebSocket connection receives initial state snapshot."""
    with client.websocket_connect("/api/ws/live") as websocket:
        initial = websocket.receive_json()
        assert initial["type"] == "init"
        assert "simulator" in initial["data"]
        assert "stats" in initial["data"]
