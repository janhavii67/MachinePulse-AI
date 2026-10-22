"""Training-run endpoints for MachinePulse AI.

Provides:
- POST /api/training-runs  — kick off a new training run in a background thread
- GET  /api/training-runs/{run_id} — poll run status and retrieve results
- GET  /api/training-runs — list recent runs

Training runs are stored in memory for the lifetime of the server process.
The underlying pipeline is the same run_training_pipeline() used during
initial model creation (backend/ml/train_failure.py).
"""

from __future__ import annotations

import io
import logging
import threading
import traceback
import uuid
from contextlib import redirect_stdout
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

logger = logging.getLogger("machinepulse.training")

router = APIRouter(prefix="/api", tags=["Training Runs"])

# ---------------------------------------------------------------------------
# In-memory run store (sufficient for single-server dev/lab usage)
# ---------------------------------------------------------------------------
_runs: Dict[str, Dict[str, Any]] = {}
_runs_lock = threading.Lock()


# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------

class TrainingConfig(BaseModel):
    target_column: Optional[str] = None
    test_size: Optional[float] = None
    random_state: Optional[int] = None
    model_type: Optional[str] = None


class StartTrainingRequest(BaseModel):
    dataset_id: str
    config: Optional[TrainingConfig] = None


class TrainingRunResponse(BaseModel):
    id: str
    dataset_id: str
    status: str          # pending | running | done | failed
    config: Optional[Dict[str, Any]]
    log: Optional[str]
    model_version_id: Optional[str]
    started_at: Optional[str]
    finished_at: Optional[str]
    created_at: str


# ---------------------------------------------------------------------------
# Background training worker
# ---------------------------------------------------------------------------

def _training_worker(run_id: str, dataset_id: str) -> None:
    """Execute the training pipeline in a dedicated background thread."""
    from backend.app.config import settings
    from backend.ml.train_failure import run_training_pipeline
    from backend.app.services.inference import inference_service

    log_buffer = io.StringIO()
    now = lambda: datetime.now(timezone.utc).isoformat()

    with _runs_lock:
        _runs[run_id]["status"] = "running"
        _runs[run_id]["started_at"] = now()

    try:
        data_path = settings.PROJECT_ROOT / "data" / "ai4i2020.csv"
        logger.info(f"[run:{run_id}] Starting training pipeline on {data_path}")

        # Capture print() output from the training script as the run log
        with redirect_stdout(log_buffer):
            run_training_pipeline(data_path=data_path)

        # Reload the updated model into the inference service
        inference_service.load_model()
        meta = inference_service.metadata
        mv_id = (
            f"mv_{meta.get('model_name', 'HistGradientBoosting')}"
            f"_v{meta.get('model_version', '1.0.0')}"
        )

        log_text = log_buffer.getvalue()
        logger.info(f"[run:{run_id}] Training completed. Model version: {mv_id}")

        with _runs_lock:
            _runs[run_id]["status"] = "done"
            _runs[run_id]["finished_at"] = now()
            _runs[run_id]["log"] = log_text
            _runs[run_id]["model_version_id"] = mv_id

    except Exception as exc:
        error_log = log_buffer.getvalue() + "\n\n" + traceback.format_exc()
        logger.error(f"[run:{run_id}] Training failed: {exc}", exc_info=True)

        with _runs_lock:
            _runs[run_id]["status"] = "failed"
            _runs[run_id]["finished_at"] = now()
            _runs[run_id]["log"] = error_log


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post(
    "/training-runs",
    response_model=TrainingRunResponse,
    summary="Start a new training run",
    status_code=201,
)
def start_training_run(body: StartTrainingRequest) -> TrainingRunResponse:
    """Launch the ML training pipeline in the background and return a run record.

    Supported dataset_id: ``ai4i2020``
    Supported target_column: ``Machine failure`` (supervised GBM classification).
    """
    from backend.app.config import settings

    # Validate dataset exists
    dataset_file = settings.PROJECT_ROOT / "data" / "ai4i2020.csv"
    if body.dataset_id != "ai4i2020" or not dataset_file.exists():
        raise HTTPException(
            status_code=404,
            detail=(
                f"Dataset '{body.dataset_id}' not found. "
                "Only the built-in 'ai4i2020' dataset is supported."
            ),
        )

    # Reject if another run is already in progress
    with _runs_lock:
        in_progress = [
            r for r in _runs.values() if r["status"] in ("pending", "running")
        ]
        if in_progress:
            raise HTTPException(
                status_code=409,
                detail="A training run is already in progress. Wait for it to complete before starting another.",
            )

    run_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    config_dict = body.config.model_dump() if body.config else {}

    run_record: Dict[str, Any] = {
        "id": run_id,
        "dataset_id": body.dataset_id,
        "status": "pending",
        "config": config_dict,
        "log": None,
        "model_version_id": None,
        "started_at": None,
        "finished_at": None,
        "created_at": now,
    }

    with _runs_lock:
        _runs[run_id] = run_record

    # Kick off training in a daemon thread so it doesn't block the HTTP response
    t = threading.Thread(
        target=_training_worker,
        args=(run_id, body.dataset_id),
        daemon=True,
        name=f"training-{run_id[:8]}",
    )
    t.start()

    logger.info(f"Training run {run_id} created and started in background thread.")
    return TrainingRunResponse(**run_record)


@router.get(
    "/training-runs/{run_id}",
    response_model=TrainingRunResponse,
    summary="Get training run status",
)
def get_training_run(run_id: str) -> TrainingRunResponse:
    """Poll the status and log of an existing training run."""
    with _runs_lock:
        run = _runs.get(run_id)

    if run is None:
        raise HTTPException(
            status_code=404,
            detail=f"Training run '{run_id}' not found.",
        )

    return TrainingRunResponse(**run)


@router.get(
    "/training-runs",
    response_model=List[TrainingRunResponse],
    summary="List recent training runs",
)
def list_training_runs(
    limit: int = Query(default=20, ge=1, le=100),
) -> List[TrainingRunResponse]:
    """Return recent training runs (most recent first)."""
    with _runs_lock:
        runs = sorted(_runs.values(), key=lambda r: r["created_at"], reverse=True)

    return [TrainingRunResponse(**r) for r in runs[:limit]]
