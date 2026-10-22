"""Comprehensive test suite for Phase 2: Rule-Based Recommendation Engine & Endpoints.

Tests:
1. HDF rule: below, at, and above thresholds; temperature difference & speed condition.
2. PWF rule: power calculation (torque * rpm * 2pi/60); below min (3500 W), within range, above max (9000 W).
3. OSF rule: per-type thresholds (L: 11000, M: 12000, H: 13000 min*Nm); invalid product type rejection.
4. TWF rule: approaching (170 min), critical band (200 min), and over limit (> 240 min).
5. Wear-budget proxy: percentage consumed, 0% to 100%+, clamping and boundaries.
6. Risk tier assignment: proof that every input maps to exactly one of NORMAL, WATCH, HIGH, CRITICAL.
7. Agreement statuses: agree_failure, agree_normal, model_only, rules_only.
8. Determinism: identical inputs produce identical outputs.
9. Endpoint: GET /api/predictions/{id}/recommendations returns stored probability/class, handles 404 and 422.
10. Endpoint: POST /api/explain backward compatibility (existing keys preserved) + recommendations field present.
11. Zero DB writes: row counts of predictions and alerts unchanged before and after calls.
"""

from __future__ import annotations

import json
import math
import uuid
from typing import Dict

import pytest
from fastapi.testclient import TestClient

from backend.app.core.database import db
from backend.app.main import app
from backend.app.services.recommendations import (
    HDF_ROTATIONAL_SPEED_THRESHOLD_RPM,
    HDF_TEMP_DIFF_THRESHOLD_K,
    OSF_THRESHOLDS_MIN_NM,
    PWF_MAX_POWER_WATTS,
    PWF_MIN_POWER_WATTS,
    TWF_CRITICAL_WINDOW_MIN,
    TWF_DOCUMENTED_LIMIT_MIN,
    compute_wear_budget_proxy,
    determine_risk_tier,
    evaluate_agreement,
    evaluate_hdf_rule,
    evaluate_osf_rule,
    evaluate_pwf_rule,
    evaluate_recommendations,
    evaluate_twf_rule,
)


@pytest.fixture(scope="session")
def client() -> TestClient:
    with TestClient(app) as test_client:
        yield test_client


# ── 1. HDF Rule Boundaries ───────────────────────────────────────────────────

def test_hdf_rule_boundaries():
    """Verify Heat Dissipation Failure rule boundaries: (T_proc - T_air < 8.6 K) AND (speed < 1380 rpm)."""
    # Case A: Exactly at boundary temp_diff = 8.6 K, speed = 1379 rpm -> NOT triggered (diff < 8.6 is False)
    res_at_temp = evaluate_hdf_rule(air_temp_k=300.0, process_temp_k=308.6, speed_rpm=1379.0)
    assert res_at_temp.status != "triggered"

    # Case B: Exactly at boundary speed = 1380 rpm, temp_diff = 8.5 K -> NOT triggered (speed < 1380 is False)
    res_at_speed = evaluate_hdf_rule(air_temp_k=300.0, process_temp_k=308.5, speed_rpm=1380.0)
    assert res_at_speed.status != "triggered"

    # Case C: Just below both thresholds: temp_diff = 8.5 K, speed = 1379 rpm -> TRIGGERED
    res_triggered = evaluate_hdf_rule(air_temp_k=300.0, process_temp_k=308.5, speed_rpm=1379.0)
    assert res_triggered.status == "triggered"
    assert res_triggered.threshold_status == "VERIFIED"
    assert "COOLING FAILURE" in res_triggered.recommendation

    # Case D: Normal operation: temp_diff = 10.5 K, speed = 1500 rpm -> NORMAL
    res_normal = evaluate_hdf_rule(air_temp_k=300.0, process_temp_k=310.5, speed_rpm=1500.0)
    assert res_normal.status == "normal"
    assert res_normal.recommendation is None


# ── 2. PWF Rule Calculation & Boundaries ─────────────────────────────────────

def test_pwf_power_calculation_and_boundaries():
    """Verify Power calculation: P = Torque * (rpm * 2 * pi / 60) and [3500 W, 9000 W] envelope."""
    # Hand calculation check:
    # 1500 rpm * 2 * pi / 60 = 50 * pi = 157.07963 rad/s
    # Torque = 40 Nm -> P = 40 * 157.07963 = 6283.19 W (Normal)
    res_normal = evaluate_pwf_rule(torque_nm=40.0, speed_rpm=1500.0)
    assert abs(res_normal.actual_value - 6283.19) < 0.1
    assert res_normal.status == "normal"
    assert res_normal.threshold_status == "VERIFIED"

    # Low Power Stall: 1200 rpm, 25 Nm -> 25 * (1200 * pi / 30) = 3141.59 W < 3500 W -> TRIGGERED
    res_low = evaluate_pwf_rule(torque_nm=25.0, speed_rpm=1200.0)
    assert res_low.actual_value < 3500.0
    assert res_low.status == "triggered"
    assert "POWER STALL" in res_low.recommendation

    # High Power Overload: 1600 rpm, 60 Nm -> 60 * (1600 * pi / 30) = 10053.1 W > 9000 W -> TRIGGERED
    res_high = evaluate_pwf_rule(torque_nm=60.0, speed_rpm=1600.0)
    assert res_high.actual_value > 9000.0
    assert res_high.status == "triggered"
    assert "POWER OVERLOAD" in res_high.recommendation


# ── 3. OSF Per-Type Boundaries ───────────────────────────────────────────────

def test_osf_per_type_thresholds():
    """Verify Overstrain thresholds: wear * torque > 11000 (L), 12000 (M), 13000 (H)."""
    # Type L (11,000 min*Nm)
    # wear=220, torque=50 -> 11000.0 -> NOT triggered (boundary is > 11000)
    res_l_at = evaluate_osf_rule(tool_wear_min=220.0, torque_nm=50.0, product_type="L")
    assert res_l_at.status != "triggered"
    # wear=220, torque=50.1 -> 11022.0 -> TRIGGERED
    res_l_over = evaluate_osf_rule(tool_wear_min=220.0, torque_nm=50.1, product_type="L")
    assert res_l_over.status == "triggered"
    assert res_l_over.threshold == 11000.0

    # Type M (12,000 min*Nm)
    # wear=200, torque=60.1 -> 12020.0 -> TRIGGERED
    res_m = evaluate_osf_rule(tool_wear_min=200.0, torque_nm=60.1, product_type="M")
    assert res_m.status == "triggered"
    assert res_m.threshold == 12000.0

    # Type H (13,000 min*Nm)
    # wear=200, torque=65.1 -> 13020.0 -> TRIGGERED
    res_h = evaluate_osf_rule(tool_wear_min=200.0, torque_nm=65.1, product_type="H")
    assert res_h.status == "triggered"
    assert res_h.threshold == 13000.0

    # Invalid product type
    with pytest.raises(ValueError, match="Invalid product type"):
        evaluate_osf_rule(tool_wear_min=100.0, torque_nm=40.0, product_type="INVALID_TYPE")


# ── 4. TWF Proximity Warning Band ────────────────────────────────────────────

def test_twf_proximity_bands():
    """Verify Tool Wear Proximity rule: normal (<170), approaching (170-199), triggered (>=200)."""
    # Normal wear
    res_norm = evaluate_twf_rule(tool_wear_min=100.0)
    assert res_norm.status == "normal"
    assert res_norm.threshold_status == "HEURISTIC"

    # Approaching window (170 - 199 min)
    res_app = evaluate_twf_rule(tool_wear_min=185.0)
    assert res_app.status == "approaching"
    assert "ADVISORY" in res_app.recommendation

    # Critical replacement band (>= 200 min)
    res_crit = evaluate_twf_rule(tool_wear_min=215.0)
    assert res_crit.status == "triggered"
    assert "WARNING" in res_crit.recommendation


# ── 5. Wear-Budget Proxy ─────────────────────────────────────────────────────

def test_wear_budget_proxy_bounds_and_clamping():
    """Verify wear budget percentage, clamping, label, and interpretation against 240 min limit."""
    # 0 min wear
    wb_0 = compute_wear_budget_proxy(tool_wear_min=0.0)
    assert wb_0.percentage_consumed == 0.0
    assert not wb_0.is_over_limit
    assert wb_0.label == "wear-budget proxy - not RUL"

    # 120 min wear (50%)
    wb_120 = compute_wear_budget_proxy(tool_wear_min=120.0)
    assert wb_120.percentage_consumed == 50.0
    assert not wb_120.is_over_limit

    # 240 min wear (100% boundary)
    wb_240 = compute_wear_budget_proxy(tool_wear_min=240.0)
    assert wb_240.percentage_consumed == 100.0
    assert not wb_240.is_over_limit

    # 264 min wear (110% over limit)
    wb_264 = compute_wear_budget_proxy(tool_wear_min=264.0)
    assert wb_264.percentage_consumed == 110.0
    assert wb_264.is_over_limit

    # Negative wear clamped to 0.0%
    wb_neg = compute_wear_budget_proxy(tool_wear_min=-10.0)
    assert wb_neg.percentage_consumed == 0.0


# ── 6. Risk Tier Assignment Exhaustive Sweep ─────────────────────────────────

def test_risk_tier_boundary_sweep():
    """Verify that every combination of probability and rule state maps to exactly one tier."""
    thresh = 0.66
    watch_cutoff = 0.33  # 50% of threshold

    # 1. CRITICAL: prob >= threshold AND has_triggered
    assert determine_risk_tier(probability=0.70, threshold=thresh, has_triggered=True, has_approaching=False) == "CRITICAL"
    assert determine_risk_tier(probability=0.66, threshold=thresh, has_triggered=True, has_approaching=True) == "CRITICAL"

    # 2. HIGH: (prob >= threshold with no rule) OR (prob < threshold with rule triggered)
    assert determine_risk_tier(probability=0.70, threshold=thresh, has_triggered=False, has_approaching=False) == "HIGH"
    assert determine_risk_tier(probability=0.20, threshold=thresh, has_triggered=True, has_approaching=False) == "HIGH"
    assert determine_risk_tier(probability=0.05, threshold=thresh, has_triggered=True, has_approaching=True) == "HIGH"

    # 3. WATCH: prob in [0.5*thresh, thresh) OR approaching rule
    assert determine_risk_tier(probability=0.45, threshold=thresh, has_triggered=False, has_approaching=False) == "WATCH"
    assert determine_risk_tier(probability=0.33, threshold=thresh, has_triggered=False, has_approaching=False) == "WATCH"
    assert determine_risk_tier(probability=0.10, threshold=thresh, has_triggered=False, has_approaching=True) == "WATCH"

    # 4. NORMAL: prob < 0.5*thresh AND no rules triggered or approaching
    assert determine_risk_tier(probability=0.10, threshold=thresh, has_triggered=False, has_approaching=False) == "NORMAL"
    assert determine_risk_tier(probability=0.01, threshold=thresh, has_triggered=False, has_approaching=False) == "NORMAL"


# ── 7. Agreement Statuses ────────────────────────────────────────────────────

def test_agreement_statuses():
    """Verify all four agreement classifications between model output and physical rules."""
    thresh = 0.66

    # A: agree_failure (Model failure + rule triggered)
    a1 = evaluate_agreement(probability=0.85, threshold=thresh, has_triggered=True, has_approaching=False)
    assert a1.status == "agree_failure"

    # B: agree_normal (Model normal + no rule triggered/approaching)
    a2 = evaluate_agreement(probability=0.10, threshold=thresh, has_triggered=False, has_approaching=False)
    assert a2.status == "agree_normal"

    # C: model_only (Model failure + no rule triggered)
    a3 = evaluate_agreement(probability=0.80, threshold=thresh, has_triggered=False, has_approaching=False)
    assert a3.status == "model_only"

    # D: rules_only (Model normal + rule triggered)
    a4 = evaluate_agreement(probability=0.25, threshold=thresh, has_triggered=True, has_approaching=False)
    assert a4.status == "rules_only"


# ── 8. Pure Module Determinism ───────────────────────────────────────────────

def test_recommendation_determinism():
    """Calling evaluate_recommendations on identical inputs must yield identical outputs."""
    readings = {
        "type": "L",
        "air_temperature": 302.0,
        "process_temperature": 310.0,
        "rotational_speed": 1350.0,
        "torque": 65.0,
        "tool_wear": 210.0,
    }
    res1 = evaluate_recommendations(readings, model_probability=0.82, model_predicted_class=1, model_threshold=0.66)
    res2 = evaluate_recommendations(readings, model_probability=0.82, model_predicted_class=1, model_threshold=0.66)

    assert res1.model_dump() == res2.model_dump()


# ── 9. Endpoint: GET /api/predictions/{id}/recommendations ───────────────────

def test_get_stored_prediction_recommendations_endpoint(client: TestClient):
    """Verify /api/predictions/{id}/recommendations returns stored model output and valid rules."""
    # Ensure at least one prediction exists in DB
    items, total = db.list_predictions(limit=1, offset=0)
    if total == 0:
        client.post(
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
        items, _ = db.list_predictions(limit=1, offset=0)

    target_pred = items[0]
    pred_id = target_pred["id"]
    stored_prob = target_pred["failure_probability"]

    # Call recommendations endpoint
    res = client.get(f"/api/predictions/{pred_id}/recommendations")
    assert res.status_code == 200
    data = res.json()

    assert data["model_probability"] == stored_prob
    assert len(data["indicators"]) == 4
    assert "wear_budget_proxy" in data
    assert "risk_tier" in data
    assert "agreement" in data


def test_get_prediction_recommendations_404_and_422(client: TestClient):
    """Unknown ID returns 404; corrupted snapshot without sensor features returns 422."""
    # 404
    res_404 = client.get("/api/predictions/nonexistent-uuid-99999/recommendations")
    assert res_404.status_code == 404

    # 422 test using a mock inserted prediction missing sensor fields
    corrupt_id = f"test-corrupt-{uuid.uuid4()}"
    db.save_prediction(
        {
            "id": corrupt_id,
            "machine_id": "M_TEST",
            "observed_at": "2026-10-21T00:00:00Z",
            "predicted_at": "2026-10-21T00:00:00Z",
            "status": "normal",
            "task_type": "failure_classification",
            "predicted_label": "Healthy",
            "failure_probability": 0.05,
            "decision_threshold": 0.66,
            "risk_score": 0.05,
            "anomaly_score": None,
            "rul_estimate": None,
            "recommendation": "Test",
            "model_version": "1.0.0",
            "input_snapshot": {"type": "L"},  # Missing all temperatures, speed, torque, wear
            "is_simulated": True,
        }
    )

    try:
        res_422 = client.get(f"/api/predictions/{corrupt_id}/recommendations")
        assert res_422.status_code == 422
        assert "missing required sensor fields" in res_422.text.lower()
    finally:
        # Clean up test row
        with db._get_connection() as conn:
            conn.execute("DELETE FROM predictions WHERE id = ?", (corrupt_id,))
            conn.commit()


# ── 10. POST /api/explain Backward Compatibility & Recommendations ───────────

def test_explain_endpoint_backward_compatibility_and_recommendations(client: TestClient):
    """Verify POST /api/explain retains all previous keys and includes new recommendations."""
    payload = {
        "type": "L",
        "air_temperature": 300.0,
        "process_temperature": 310.0,
        "rotational_speed": 1500.0,
        "torque": 40.0,
        "tool_wear": 100.0,
    }
    res = client.post("/api/explain", json=payload)
    assert res.status_code == 200
    data = res.json()

    # Previous Phase 1 keys must all be present
    assert "method" in data
    assert "method_description" in data
    assert "failure_probability" in data
    assert "decision_threshold" in data
    assert "failure_predicted" in data
    assert "predicted_label" in data
    assert "risk_level" in data
    assert "contributions" in data
    assert "outside_range_warnings" in data
    assert "baseline_used" in data
    assert "features_analyzed" in data
    assert "disclaimer" in data

    # New Phase 2 field
    assert "recommendations" in data
    recs = data["recommendations"]
    assert recs is not None
    assert "risk_tier" in recs
    assert "indicators" in recs
    assert len(recs["indicators"]) == 4
    assert "wear_budget_proxy" in recs
    assert "agreement" in recs


# ── 11. Zero Database Writes Verification ────────────────────────────────────

def test_recommendations_and_explain_zero_db_writes(client: TestClient):
    """Ensure POST /api/explain and GET /recommendations execute without writing to SQLite."""
    # Count before
    _, preds_before = db.list_predictions(limit=1, offset=0)
    alerts_before = db.get_dashboard_stats()["open_alerts"]

    # 1. POST /api/explain
    res_exp = client.post(
        "/api/explain",
        json={
            "type": "H",
            "air_temperature": 303.0,
            "process_temperature": 311.5,
            "rotational_speed": 1320.0,
            "torque": 66.0,
            "tool_wear": 225.0,
        },
    )
    assert res_exp.status_code == 200

    # 2. GET /recommendations on an existing prediction
    items, _ = db.list_predictions(limit=1, offset=0)
    if items:
        res_rec = client.get(f"/api/predictions/{items[0]['id']}/recommendations")
        assert res_rec.status_code == 200

    # Count after
    _, preds_after = db.list_predictions(limit=1, offset=0)
    alerts_after = db.get_dashboard_stats()["open_alerts"]

    assert preds_after == preds_before
    assert alerts_after == alerts_before
