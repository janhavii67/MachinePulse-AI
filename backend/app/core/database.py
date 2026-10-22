"""SQLite persistence layer for MachinePulse AI.

Provides persistent storage for model predictions, alerts, and simulator state.
Uses standard Python sqlite3 with WAL mode for fast concurrent reads and writes.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger("machinepulse.database")

def get_db_path() -> Path:
    """Return path to SQLite database, creating directory if needed."""
    db_dir = Path(__file__).resolve().parent.parent.parent / "data"
    db_dir.mkdir(parents=True, exist_ok=True)
    return db_dir / "machinepulse.db"


class Database:
    """Thread-safe SQLite database manager for predictions, alerts, and stats."""

    def __init__(self, db_path: Path | None = None) -> None:
        self.db_path = db_path or get_db_path()
        self._init_schema()

    def _get_connection(self) -> sqlite3.Connection:
        """Create a connection with WAL mode and row factory."""
        conn = sqlite3.connect(str(self.db_path), timeout=15.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        return conn

    def _init_schema(self) -> None:
        """Create tables and indexes if they do not exist."""
        with self._get_connection() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS predictions (
                    id TEXT PRIMARY KEY,
                    machine_id TEXT,
                    observed_at TEXT,
                    predicted_at TEXT NOT NULL,
                    status TEXT NOT NULL,              -- normal, warning, critical
                    task_type TEXT NOT NULL,           -- failure_classification
                    predicted_label TEXT NOT NULL,      -- Healthy, Failure
                    failure_probability REAL NOT NULL,
                    decision_threshold REAL NOT NULL,
                    risk_score REAL NOT NULL,
                    anomaly_score REAL,
                    rul_estimate TEXT,
                    recommendation TEXT,
                    model_version TEXT NOT NULL,
                    input_snapshot TEXT NOT NULL,       -- JSON of sensor features
                    is_simulated INTEGER NOT NULL DEFAULT 1
                );

                CREATE INDEX IF NOT EXISTS idx_predictions_predicted_at ON predictions(predicted_at DESC);
                CREATE INDEX IF NOT EXISTS idx_predictions_status ON predictions(status);
                CREATE INDEX IF NOT EXISTS idx_predictions_machine_id ON predictions(machine_id);

                CREATE TABLE IF NOT EXISTS alerts (
                    id TEXT PRIMARY KEY,
                    prediction_id TEXT,
                    machine_id TEXT,
                    rule_id TEXT NOT NULL,
                    severity TEXT NOT NULL,            -- info, warning, critical
                    reason TEXT NOT NULL,
                    observed_value TEXT,
                    threshold_description TEXT,
                    recommendation TEXT,
                    status TEXT NOT NULL DEFAULT 'open', -- open, acknowledged, resolved
                    last_seen_at TEXT NOT NULL,
                    acknowledged_at TEXT,
                    resolved_at TEXT,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(prediction_id) REFERENCES predictions(id)
                );

                CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);
                CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity);
                CREATE INDEX IF NOT EXISTS idx_alerts_last_seen ON alerts(last_seen_at DESC);
                CREATE INDEX IF NOT EXISTS idx_alerts_rule_machine ON alerts(rule_id, machine_id);

                CREATE TABLE IF NOT EXISTS simulator_state (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    status TEXT NOT NULL DEFAULT 'stopped', -- stopped, running, paused
                    current_index INTEGER NOT NULL DEFAULT 0,
                    speed_seconds REAL NOT NULL DEFAULT 1.5,
                    total_rows INTEGER NOT NULL DEFAULT 10000,
                    simulated_count INTEGER NOT NULL DEFAULT 0,
                    updated_at TEXT NOT NULL
                );

                INSERT OR IGNORE INTO simulator_state (id, status, current_index, speed_seconds, total_rows, simulated_count, updated_at)
                VALUES (1, 'stopped', 0, 1.5, 10000, 0, datetime('now'));
            """)
            conn.commit()
            logger.info(f"Database initialized at {self.db_path}")

    # =========================================================================
    # Prediction Operations
    # =========================================================================

    def save_prediction(self, record: Dict[str, Any]) -> Dict[str, Any]:
        """Save a new prediction record and return the saved dict."""
        pred_id = record.get("id") or str(uuid.uuid4())
        now_utc = datetime.now(timezone.utc).isoformat()
        predicted_at = record.get("predicted_at") or now_utc
        observed_at = record.get("observed_at") or now_utc

        input_snapshot = record.get("input_snapshot") or record.get("features_used") or {}
        if isinstance(input_snapshot, dict):
            input_snapshot_json = json.dumps(input_snapshot)
        else:
            input_snapshot_json = str(input_snapshot)

        with self._get_connection() as conn:
            conn.execute(
                """
                INSERT INTO predictions (
                    id, machine_id, observed_at, predicted_at, status, task_type,
                    predicted_label, failure_probability, decision_threshold, risk_score,
                    anomaly_score, rul_estimate, recommendation, model_version,
                    input_snapshot, is_simulated
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    pred_id,
                    record.get("machine_id"),
                    observed_at,
                    predicted_at,
                    record.get("status", "normal"),
                    record.get("task_type", "failure_classification"),
                    record.get("predicted_label", "Healthy"),
                    float(record.get("failure_probability", 0.0)),
                    float(record.get("decision_threshold", 0.66)),
                    float(record.get("risk_score", 0.0)),
                    record.get("anomaly_score"),
                    record.get("rul_estimate"),
                    record.get("recommendation", ""),
                    record.get("model_version", "1.0.0"),
                    input_snapshot_json,
                    1 if record.get("is_simulated", True) else 0,
                ),
            )
            conn.commit()

        record["id"] = pred_id
        record["prediction_id"] = pred_id
        record["predicted_at"] = predicted_at
        return record

    def list_predictions(
        self, limit: int = 50, offset: int = 0
    ) -> Tuple[List[Dict[str, Any]], int]:
        """Retrieve paginated predictions ordered by predicted_at descending."""
        with self._get_connection() as conn:
            total = conn.execute("SELECT COUNT(*) FROM predictions").fetchone()[0]
            cursor = conn.execute(
                """
                SELECT id, machine_id, observed_at, predicted_at, status, task_type,
                       predicted_label, failure_probability, decision_threshold, risk_score,
                       anomaly_score, rul_estimate, recommendation, model_version,
                       input_snapshot, is_simulated
                FROM predictions
                ORDER BY predicted_at DESC
                LIMIT ? OFFSET ?
                """,
                (limit, offset),
            )
            rows = cursor.fetchall()

        items = []
        for r in rows:
            item = dict(r)
            item["prediction_id"] = item["id"]
            try:
                item["input_snapshot"] = json.loads(item["input_snapshot"])
            except Exception:
                item["input_snapshot"] = {}
            # Build explanation placeholder for UI compatibility
            item["explanation"] = []
            item["data_quality_warnings"] = []
            item["limitations"] = (
                "Predictions are decision support, not guarantees. Based on AI4I 2020 trained HistGradientBoosting model."
            )
            items.append(item)

        return items, total

    def get_prediction(self, pred_id: str) -> Optional[Dict[str, Any]]:
        """Retrieve a single prediction by ID."""
        with self._get_connection() as conn:
            row = conn.execute(
                "SELECT * FROM predictions WHERE id = ?", (pred_id,)
            ).fetchone()

        if not row:
            return None

        item = dict(row)
        item["prediction_id"] = item["id"]
        try:
            snapshot = json.loads(item["input_snapshot"])
        except Exception:
            snapshot = {}
        item["input_snapshot"] = snapshot

        # Construct feature explanation for UI detail panel
        explanation = []
        if snapshot:
            for feat, val in snapshot.items():
                explanation.append({"feature": feat, "contribution": 0.1, "value": val})
        item["explanation"] = explanation
        item["data_quality_warnings"] = []
        item["limitations"] = (
            "Decision support only. Model: HistGradientBoosting (v1.0.0, AI4I 2020 dataset). "
            f"Decision threshold: {item.get('decision_threshold', 0.66)}."
        )
        return item

    # =========================================================================
    # Alert Operations
    # =========================================================================

    def save_alert(self, alert: Dict[str, Any]) -> Dict[str, Any]:
        """Save a new alert record."""
        alert_id = alert.get("id") or str(uuid.uuid4())
        now_utc = datetime.now(timezone.utc).isoformat()
        created_at = alert.get("created_at") or now_utc
        last_seen_at = alert.get("last_seen_at") or now_utc

        with self._get_connection() as conn:
            conn.execute(
                """
                INSERT INTO alerts (
                    id, prediction_id, machine_id, rule_id, severity, reason,
                    observed_value, threshold_description, recommendation,
                    status, last_seen_at, acknowledged_at, resolved_at, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    alert_id,
                    alert.get("prediction_id"),
                    alert.get("machine_id"),
                    alert.get("rule_id", "default_rule"),
                    alert.get("severity", "warning"),
                    alert.get("reason", "Anomaly detected"),
                    alert.get("observed_value"),
                    alert.get("threshold_description"),
                    alert.get("recommendation"),
                    alert.get("status", "open"),
                    last_seen_at,
                    alert.get("acknowledged_at"),
                    alert.get("resolved_at"),
                    created_at,
                ),
            )
            conn.commit()

        alert["id"] = alert_id
        alert["created_at"] = created_at
        alert["last_seen_at"] = last_seen_at
        return alert

    def find_recent_alert(
        self, rule_id: str, machine_id: Optional[str]
    ) -> Optional[Dict[str, Any]]:
        """Find the most recent open or acknowledged alert for deduplication."""
        query = (
            "SELECT * FROM alerts WHERE rule_id = ? AND status IN ('open', 'acknowledged')"
        )
        params: List[Any] = [rule_id]
        if machine_id:
            query += " AND machine_id = ?"
            params.append(machine_id)
        query += " ORDER BY last_seen_at DESC LIMIT 1"

        with self._get_connection() as conn:
            row = conn.execute(query, tuple(params)).fetchone()
        return dict(row) if row else None

    def update_alert_last_seen(self, alert_id: str) -> None:
        """Update last_seen_at timestamp on an existing alert."""
        now_utc = datetime.now(timezone.utc).isoformat()
        with self._get_connection() as conn:
            conn.execute(
                "UPDATE alerts SET last_seen_at = ? WHERE id = ?", (now_utc, alert_id)
            )
            conn.commit()

    def list_alerts(
        self, limit: int = 100, offset: int = 0, status_filter: Optional[str] = None
    ) -> Tuple[List[Dict[str, Any]], int]:
        """List paginated alerts, optionally filtered by status."""
        query = "SELECT * FROM alerts"
        count_query = "SELECT COUNT(*) FROM alerts"
        params: List[Any] = []

        if status_filter:
            query += " WHERE status = ?"
            count_query += " WHERE status = ?"
            params.append(status_filter)

        query += " ORDER BY last_seen_at DESC LIMIT ? OFFSET ?"
        count_params = tuple(params)
        params.extend([limit, offset])

        with self._get_connection() as conn:
            total = conn.execute(count_query, count_params).fetchone()[0]
            cursor = conn.execute(query, tuple(params))
            rows = cursor.fetchall()

        return [dict(r) for r in rows], total

    def patch_alert(self, alert_id: str, new_status: str) -> Optional[Dict[str, Any]]:
        """Update an alert's status to 'acknowledged' or 'resolved'."""
        now_utc = datetime.now(timezone.utc).isoformat()
        with self._get_connection() as conn:
            row = conn.execute("SELECT * FROM alerts WHERE id = ?", (alert_id,)).fetchone()
            if not row:
                return None

            if new_status == "acknowledged":
                conn.execute(
                    "UPDATE alerts SET status = ?, acknowledged_at = ? WHERE id = ?",
                    (new_status, now_utc, alert_id),
                )
            elif new_status == "resolved":
                conn.execute(
                    "UPDATE alerts SET status = ?, resolved_at = ? WHERE id = ?",
                    (new_status, now_utc, alert_id),
                )
            else:
                conn.execute(
                    "UPDATE alerts SET status = ? WHERE id = ?", (new_status, alert_id)
                )
            conn.commit()

            updated = conn.execute("SELECT * FROM alerts WHERE id = ?", (alert_id,)).fetchone()
        return dict(updated) if updated else None

    # =========================================================================
    # Aggregated Stats & KPIs
    # =========================================================================

    def get_dashboard_stats(self) -> Dict[str, Any]:
        """Compute real-time summary statistics and KPIs from actual database records."""
        with self._get_connection() as conn:
            total_preds = conn.execute("SELECT COUNT(*) FROM predictions").fetchone()[0]
            normal_count = conn.execute(
                "SELECT COUNT(*) FROM predictions WHERE status = 'normal'"
            ).fetchone()[0]
            warning_count = conn.execute(
                "SELECT COUNT(*) FROM predictions WHERE status = 'warning'"
            ).fetchone()[0]
            critical_count = conn.execute(
                "SELECT COUNT(*) FROM predictions WHERE status = 'critical'"
            ).fetchone()[0]
            open_alerts = conn.execute(
                "SELECT COUNT(*) FROM alerts WHERE status = 'open'"
            ).fetchone()[0]
            total_alerts = conn.execute("SELECT COUNT(*) FROM alerts").fetchone()[0]

            # Recent 20 prediction trend points for live charting
            recent_rows = conn.execute(
                """
                SELECT predicted_at, failure_probability, status, risk_score
                FROM predictions
                ORDER BY predicted_at DESC
                LIMIT 30
                """
            ).fetchall()

        trend = []
        for r in reversed(recent_rows):
            trend.append({
                "time": r["predicted_at"],
                "probability": round(float(r["failure_probability"]), 4),
                "status": r["status"],
            })

        failure_rate = (critical_count / total_preds * 100) if total_preds > 0 else 0.0

        return {
            "total_predictions": total_preds,
            "normal_count": normal_count,
            "warning_count": warning_count,
            "critical_count": critical_count,
            "open_alerts": open_alerts,
            "total_alerts": total_alerts,
            "failure_rate_pct": round(failure_rate, 2),
            "trend": trend,
        }

    # =========================================================================
    # Simulator State Operations
    # =========================================================================

    def get_simulator_state(self) -> Dict[str, Any]:
        """Fetch current simulator state."""
        with self._get_connection() as conn:
            row = conn.execute("SELECT * FROM simulator_state WHERE id = 1").fetchone()
        return dict(row) if row else {
            "status": "stopped",
            "current_index": 0,
            "speed_seconds": 1.5,
            "total_rows": 10000,
            "simulated_count": 0,
        }

    def update_simulator_state(
        self,
        status: Optional[str] = None,
        current_index: Optional[int] = None,
        speed_seconds: Optional[float] = None,
        simulated_count: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Update simulator progress and state."""
        now_utc = datetime.now(timezone.utc).isoformat()
        current = self.get_simulator_state()

        new_status = status if status is not None else current["status"]
        new_index = current_index if current_index is not None else current["current_index"]
        new_speed = speed_seconds if speed_seconds is not None else current["speed_seconds"]
        new_count = simulated_count if simulated_count is not None else current["simulated_count"]

        with self._get_connection() as conn:
            conn.execute(
                """
                UPDATE simulator_state
                SET status = ?, current_index = ?, speed_seconds = ?, simulated_count = ?, updated_at = ?
                WHERE id = 1
                """,
                (new_status, new_index, new_speed, new_count, now_utc),
            )
            conn.commit()

        return {
            "status": new_status,
            "current_index": new_index,
            "speed_seconds": new_speed,
            "total_rows": current.get("total_rows", 10000),
            "simulated_count": new_count,
            "updated_at": now_utc,
        }


# Singleton database instance
db = Database()
