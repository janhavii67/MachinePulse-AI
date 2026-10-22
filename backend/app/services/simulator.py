"""Sensor Simulator Service for MachinePulse AI.

Replays authentic machine operating rows from the official AI4I 2020 dataset,
scores every reading through the fitted ML model pipeline, persists predictions
and alerts, and broadcasts real-time telemetry over WebSockets.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

import pandas as pd

from backend.app.config import settings
from backend.app.core.database import db
from backend.app.schemas import MachineFeatures
from backend.app.services.alert_service import alert_service
from backend.app.services.inference import inference_service
from backend.app.services.websocket_manager import ws_manager

logger = logging.getLogger("machinepulse.simulator")


class SensorSimulator:
    """Manages playback of AI4I 2020 sensor records with asynchronous execution."""

    def __init__(self, dataset_path: Optional[Path] = None) -> None:
        self.dataset_path = dataset_path or (settings.PROJECT_ROOT / "data" / "ai4i2020.csv")
        self._df: Optional[pd.DataFrame] = None
        self._task: Optional[asyncio.Task] = None
        self._status: str = "stopped"  # stopped, running, paused
        self._current_index: int = 0
        self._speed_seconds: float = 1.5
        self._simulated_count: int = 0

        # Load persisted simulator state from database
        self._restore_state()

    def _restore_state(self) -> None:
        """Load last saved simulator progress from database."""
        state = db.get_simulator_state()
        self._current_index = state.get("current_index", 0)
        self._speed_seconds = state.get("speed_seconds", 1.5)
        self._simulated_count = state.get("simulated_count", 0)
        # On server startup, status starts stopped until explicitly started
        self._status = "stopped"
        db.update_simulator_state(status="stopped")

    def _ensure_dataset_loaded(self) -> pd.DataFrame:
        """Load and cache the AI4I 2020 CSV dataset."""
        if self._df is None:
            if not self.dataset_path.exists():
                raise FileNotFoundError(
                    f"AI4I dataset not found at {self.dataset_path}. "
                    "Run backend/ml/download_dataset.py first."
                )
            logger.info(f"Loading AI4I dataset for simulator from: {self.dataset_path}")
            self._df = pd.read_csv(self.dataset_path)
            logger.info(f"Simulator loaded {len(self._df)} rows.")
        return self._df

    @property
    def total_rows(self) -> int:
        """Total available rows in the AI4I dataset."""
        df = self._ensure_dataset_loaded()
        return len(df)

    def get_status(self) -> Dict[str, Any]:
        """Return current simulator telemetry and operational state."""
        return {
            "status": self._status,
            "current_index": self._current_index,
            "total_rows": self.total_rows,
            "speed_seconds": self._speed_seconds,
            "simulated_count": self._simulated_count,
            "is_dataset_loaded": self._df is not None,
            "data_source": "AI4I 2020 Predictive Maintenance Dataset (Simulated Telemetry Replay)",
        }

    async def step_once(self) -> Optional[Dict[str, Any]]:
        """Advance one row, execute actual model inference, persist, and broadcast."""
        df = self._ensure_dataset_loaded()
        if len(df) == 0:
            return None

        # Loop around if end of dataset reached
        if self._current_index >= len(df):
            logger.info("Simulator reached end of AI4I dataset. Looping back to index 0.")
            self._current_index = 0

        row = df.iloc[self._current_index]
        machine_id = str(row.get("Product ID", f"M_{self._current_index:05d}"))

        # Map to strictly required feature schema
        raw_features = {
            "type": str(row["Type"]),
            "air_temperature": float(row["Air temperature [K]"]),
            "process_temperature": float(row["Process temperature [K]"]),
            "rotational_speed": float(row["Rotational speed [rpm]"]),
            "torque": float(row["Torque [Nm]"]),
            "tool_wear": float(row["Tool wear [min]"]),
        }

        # 1. Run ACTUAL model prediction through inference service
        validated_input = MachineFeatures(**raw_features)
        pred_response = inference_service.predict(validated_input)

        # Map risk to status badge: normal, warning, critical
        if pred_response.risk_level == "CRITICAL":
            status = "critical"
        elif pred_response.risk_level in ("HIGH", "MEDIUM"):
            status = "warning"
        else:
            status = "normal"

        now_utc = datetime.now(timezone.utc).isoformat()

        # 2. Persist prediction in SQLite
        pred_record = {
            "machine_id": machine_id,
            "observed_at": now_utc,
            "predicted_at": now_utc,
            "status": status,
            "task_type": "failure_classification",
            "predicted_label": "Failure" if pred_response.failure_predicted else "Healthy",
            "failure_probability": pred_response.failure_probability,
            "decision_threshold": pred_response.decision_threshold,
            "risk_score": pred_response.failure_probability,
            "anomaly_score": None,
            "rul_estimate": f"Tool wear: {raw_features['tool_wear']:.0f} min (AI4I Replay)",
            "recommendation": pred_response.recommendation,
            "model_version": f"{pred_response.model_name} v{pred_response.model_version}",
            "input_snapshot": pred_response.features_used,
            "is_simulated": True,
        }
        saved_pred = db.save_prediction(pred_record)

        # 3. Evaluate alerts against safety rules and persist
        new_alerts = alert_service.evaluate_prediction(
            prediction=saved_pred,
            features=pred_response.features_used,
            machine_id=machine_id,
        )

        # 4. Advance counters
        self._current_index += 1
        self._simulated_count += 1
        db.update_simulator_state(
            current_index=self._current_index,
            simulated_count=self._simulated_count,
        )

        # 5. Broadcast live telemetry over WebSocket
        dashboard_stats = db.get_dashboard_stats()
        telemetry_event = {
            "type": "telemetry",
            "data": {
                "reading_index": self._current_index,
                "machine_id": machine_id,
                "raw_features": raw_features,
                "prediction": saved_pred,
                "stats": dashboard_stats,
                "simulator": self.get_status(),
                "is_simulated": True,
                "label": "AI4I 2020 Replay (Simulated Data)",
            },
        }
        await ws_manager.broadcast(telemetry_event)

        # Broadcast any newly generated alerts
        for alert in new_alerts:
            await ws_manager.broadcast({"type": "alert", "data": alert})

        return saved_pred

    async def _run_loop(self) -> None:
        """Background asynchronous playback loop."""
        logger.info(f"Simulator loop started at index {self._current_index} (speed={self._speed_seconds}s)")
        try:
            while self._status == "running":
                await self.step_once()
                await asyncio.sleep(self._speed_seconds)
        except asyncio.CancelledError:
            logger.info("Simulator loop cancelled.")
        except Exception as exc:
            logger.error(f"Simulator loop error: {exc}", exc_info=True)
            self._status = "stopped"
            db.update_simulator_state(status="stopped")

    def start(
        self, speed_seconds: Optional[float] = None, start_index: Optional[int] = None
    ) -> Dict[str, Any]:
        """Start or resume the live simulator."""
        if speed_seconds is not None:
            self._speed_seconds = max(0.1, float(speed_seconds))
        if start_index is not None:
            self._current_index = max(0, int(start_index))

        if self._status == "running":
            return self.get_status()

        self._status = "running"
        db.update_simulator_state(
            status="running",
            speed_seconds=self._speed_seconds,
            current_index=self._current_index,
        )

        # Cancel any previous task if lingering
        if self._task and not self._task.done():
            self._task.cancel()

        try:
            loop = asyncio.get_running_loop()
            self._task = loop.create_task(self._run_loop())
        except RuntimeError:
            logger.debug("No active event loop to create background task immediately.")

        logger.info(f"Simulator started (speed={self._speed_seconds}s)")
        return self.get_status()

    def pause(self) -> Dict[str, Any]:
        """Pause playback at current index."""
        if self._status != "running":
            return self.get_status()

        self._status = "paused"
        if self._task and not self._task.done():
            self._task.cancel()
            self._task = None

        db.update_simulator_state(status="paused")
        logger.info(f"Simulator paused at index {self._current_index}")
        return self.get_status()

    def resume(self) -> Dict[str, Any]:
        """Resume playback from paused index."""
        if self._status == "running":
            return self.get_status()
        return self.start()

    def stop(self) -> Dict[str, Any]:
        """Stop playback."""
        self._status = "stopped"
        if self._task and not self._task.done():
            self._task.cancel()
            self._task = None

        db.update_simulator_state(status="stopped")
        logger.info("Simulator stopped.")
        return self.get_status()

    def reset(self) -> Dict[str, Any]:
        """Stop playback and reset pointer to beginning (index 0)."""
        self.stop()
        self._current_index = 0
        self._simulated_count = 0
        db.update_simulator_state(current_index=0, simulated_count=0)
        logger.info("Simulator reset to index 0.")
        return self.get_status()


# Global singleton simulator
simulator = SensorSimulator()
