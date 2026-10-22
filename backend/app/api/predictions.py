"""Prediction endpoints for MachinePulse AI.

Provides real-time single-reading inference (POST /api/predict) and dataset
batch scoring (POST /api/predictions). Both paths execute actual model inference
using the saved pipeline and dynamic threshold.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import pandas as pd
from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from backend.app.config import settings
from backend.app.core.database import db
from backend.app.schemas import MachineFeatures, PredictionResponse
from backend.app.services.alert_service import alert_service
from backend.app.services.inference import ModelNotLoadedError, inference_service
from backend.app.services.websocket_manager import ws_manager

logger = logging.getLogger("machinepulse.predictions")

router = APIRouter(prefix="/api", tags=["Predictions"])


class DatasetPredictionRequest(BaseModel):
    dataset_id: str = Field(default="ai4i2020")
    machine_id: Optional[str] = None
    row_index: Optional[int] = None


@router.post(
    "/predict",
    response_model=PredictionResponse,
    status_code=status.HTTP_200_OK,
    summary="Predict machine failure probability",
    description=(
        "Estimate the probability of machine failure from sensor telemetry and "
        "determine whether maintenance is required using the champion model."
    ),
)
async def predict_machine_failure(payload: MachineFeatures) -> PredictionResponse:
    """Score incoming machine sensor telemetry.

    Accepts product type, temperatures, rotational speed, torque, and tool wear.
    Returns the failure probability, binary prediction using the metadata threshold,
    risk category, and maintenance recommendation.
    Also persists the prediction and evaluates alerts for real-time dashboard tracking.
    """
    try:
        response = inference_service.predict(payload)
        logger.info(
            f"Prediction scored: prob={response.failure_probability:.4f}, "
            f"predicted_class={response.predicted_class}, risk={response.risk_level}"
        )

        if response.risk_level == "CRITICAL":
            status_val = "critical"
        elif response.risk_level in ("HIGH", "MEDIUM"):
            status_val = "warning"
        else:
            status_val = "normal"

        pred_record = {
            "machine_id": f"LIVE_{payload.type}",
            "observed_at": response.timestamp,
            "predicted_at": response.timestamp,
            "status": status_val,
            "task_type": "failure_classification",
            "predicted_label": "Failure" if response.failure_predicted else "Healthy",
            "failure_probability": response.failure_probability,
            "decision_threshold": response.decision_threshold,
            "risk_score": response.failure_probability,
            "anomaly_score": None,
            "rul_estimate": f"Tool wear: {payload.tool_wear:.0f} min (Manual Live Input)",
            "recommendation": response.recommendation,
            "model_version": f"{response.model_name} v{response.model_version}",
            "input_snapshot": response.features_used,
            "is_simulated": False,
        }
        saved_pred = db.save_prediction(pred_record)

        new_alerts = alert_service.evaluate_prediction(
            prediction=saved_pred,
            features=response.features_used,
            machine_id=f"LIVE_{payload.type}",
        )

        asyncio.create_task(
            ws_manager.broadcast({
                "type": "telemetry",
                "data": {
                    "reading_index": 0,
                    "machine_id": f"LIVE_{payload.type}",
                    "raw_features": payload.model_dump(),
                    "prediction": saved_pred,
                    "stats": db.get_dashboard_stats(),
                    "is_simulated": False,
                    "label": "Live Manual Inference",
                },
            })
        )
        for alert in new_alerts:
            asyncio.create_task(
                ws_manager.broadcast({"type": "alert", "data": alert})
            )

        return response
    except ModelNotLoadedError as err:
        logger.error(f"Inference rejected: {err}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Model is not ready for inference. Ensure failure_pipeline.joblib is loaded.",
        ) from err
    except ValueError as val_err:
        logger.warning(f"Inference validation error: {val_err}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(val_err),
        ) from val_err
    except Exception as exc:
        logger.exception(f"Unexpected inference error: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Internal inference failure: {exc}",
        ) from exc


@router.post(
    "/predictions",
    status_code=status.HTTP_201_CREATED,
    summary="Batch predict dataset rows",
    description="Run model inference on AI4I dataset rows, persist results, and generate alerts.",
)
async def score_dataset_batch(body: DatasetPredictionRequest) -> List[Dict[str, Any]]:
    """Score rows from the authentic AI4I dataset through the fitted ML model."""
    dataset_file = settings.PROJECT_ROOT / "data" / "ai4i2020.csv"
    if not dataset_file.exists():
        raise HTTPException(status_code=404, detail="Dataset file not found.")

    df = pd.read_csv(dataset_file)
    if body.row_index is not None:
        if body.row_index >= len(df):
            raise HTTPException(status_code=422, detail=f"Row index {body.row_index} out of bounds.")
        rows_to_score = df.iloc[[body.row_index]]
    else:
        # Default batch: score up to first 50 rows
        rows_to_score = df.head(50)

    results: List[Dict[str, Any]] = []

    for _, row in rows_to_score.iterrows():
        machine_id = body.machine_id or str(row.get("Product ID", "M001"))
        features = MachineFeatures(
            type=str(row["Type"]),
            air_temperature=float(row["Air temperature [K]"]),
            process_temperature=float(row["Process temperature [K]"]),
            rotational_speed=float(row["Rotational speed [rpm]"]),
            torque=float(row["Torque [Nm]"]),
            tool_wear=float(row["Tool wear [min]"]),
        )

        res = inference_service.predict(features)
        now_utc = datetime.now(timezone.utc).isoformat()

        if res.risk_level == "CRITICAL":
            status_val = "critical"
        elif res.risk_level in ("HIGH", "MEDIUM"):
            status_val = "warning"
        else:
            status_val = "normal"

        pred_record = {
            "machine_id": machine_id,
            "observed_at": now_utc,
            "predicted_at": now_utc,
            "status": status_val,
            "task_type": "failure_classification",
            "predicted_label": "Failure" if res.failure_predicted else "Healthy",
            "failure_probability": res.failure_probability,
            "decision_threshold": res.decision_threshold,
            "risk_score": res.failure_probability,
            "anomaly_score": None,
            "rul_estimate": f"Tool wear: {features.tool_wear:.0f} min (AI4I Batch)",
            "recommendation": res.recommendation,
            "model_version": f"{res.model_name} v{res.model_version}",
            "input_snapshot": res.features_used,
            "is_simulated": True,
        }
        saved = db.save_prediction(pred_record)

        # Trigger alerts
        alert_service.evaluate_prediction(
            prediction=saved,
            features=res.features_used,
            machine_id=machine_id,
        )

        results.append(saved)

    return results
