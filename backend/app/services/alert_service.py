"""Alert evaluation and management service for MachinePulse AI.

Evaluates ML prediction results against maintenance safety rules, deduplicates
active alerts, and persists alert records to SQLite.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from backend.app.core.database import db

logger = logging.getLogger("machinepulse.alerts")


class AlertService:
    """Service to generate, deduplicate, and manage operational machine alerts."""

    def evaluate_prediction(
        self,
        prediction: Dict[str, Any],
        features: Dict[str, Any],
        machine_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Evaluate a prediction record and trigger alerts if failure rules match.

        Args:
            prediction: Prediction dictionary containing failure_probability,
                        failure_predicted, decision_threshold, and prediction_id.
            features: Raw sensor feature dictionary.
            machine_id: Identifier of the machine tool.

        Returns:
            List of newly created alert records.
        """
        prob = float(prediction.get("failure_probability", 0.0))
        is_failure = bool(prediction.get("failure_predicted", False))
        threshold = float(prediction.get("decision_threshold", 0.66))
        pred_id = prediction.get("prediction_id") or prediction.get("id")

        tool_wear = float(features.get("Tool wear [min]", features.get("tool_wear", 0.0)))
        torque = float(features.get("Torque [Nm]", features.get("torque", 0.0)))

        candidate_alerts: List[Dict[str, Any]] = []

        # Rule 1: Model predicted failure (Critical)
        if is_failure or prob >= threshold:
            candidate_alerts.append({
                "rule_id": "rule_failure_predicted",
                "severity": "critical",
                "reason": (
                    f"Machine failure predicted with {prob:.1%} probability "
                    f"(exceeds operational threshold of {threshold:.1%})."
                ),
                "observed_value": f"{prob:.4f}",
                "threshold_description": f"Failure probability >= {threshold:.2f}",
                "recommendation": (
                    "IMMINENT BREAKDOWN: Halt spindle rotation. Inspect cutting insert, "
                    "thermal dissipation, and workpiece clearances immediately."
                ),
            })
        # Rule 2: Elevated risk warning (0.35 <= prob < threshold)
        elif prob >= 0.35:
            candidate_alerts.append({
                "rule_id": "rule_elevated_risk",
                "severity": "warning",
                "reason": (
                    f"Elevated failure risk detected: {prob:.1%} failure probability."
                ),
                "observed_value": f"{prob:.4f}",
                "threshold_description": f"0.35 <= Failure probability < {threshold:.2f}",
                "recommendation": (
                    "ELEVATED OPERATIONAL STRESS: Machine telemetry approaching risk threshold. "
                    "Schedule tool inspection during next maintenance window."
                ),
            })

        # Rule 3: Extreme Tool Wear
        if tool_wear >= 200.0:
            candidate_alerts.append({
                "rule_id": "rule_tool_wear_critical",
                "severity": "warning" if not is_failure else "critical",
                "reason": (
                    f"Tool wear reached {tool_wear:.0f} minutes (near 253-minute maximum life)."
                ),
                "observed_value": f"{tool_wear:.0f} min",
                "threshold_description": "Tool wear >= 200 min",
                "recommendation": (
                    "TOOL END-OF-LIFE: Cumulative cutting wear is high. Replace cutting insert "
                    "to prevent tool breakage and surface finish degradation."
                ),
            })

        new_alerts = []
        for cand in candidate_alerts:
            rule_id = cand["rule_id"]
            existing = db.find_recent_alert(rule_id, machine_id)

            if existing:
                # Deduplicate: update last_seen_at instead of spamming duplicates
                db.update_alert_last_seen(existing["id"])
                logger.debug(f"Alert deduplicated: rule={rule_id}, machine={machine_id}")
            else:
                alert_record = {
                    "prediction_id": pred_id,
                    "machine_id": machine_id,
                    "rule_id": rule_id,
                    "severity": cand["severity"],
                    "reason": cand["reason"],
                    "observed_value": cand["observed_value"],
                    "threshold_description": cand["threshold_description"],
                    "recommendation": cand["recommendation"],
                    "status": "open",
                }
                saved = db.save_alert(alert_record)
                new_alerts.append(saved)
                logger.info(
                    f"Alert triggered: [{saved['severity'].upper()}] {saved['reason']} (machine={machine_id})"
                )

        return new_alerts


alert_service = AlertService()
