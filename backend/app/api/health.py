"""Health check and model metadata endpoints for MachinePulse AI."""

from __future__ import annotations

import datetime
from fastapi import APIRouter, HTTPException, status

from backend.app.schemas import HealthResponse, ModelInfoResponse
from backend.app.services.inference import ModelNotLoadedError, inference_service

router = APIRouter(prefix="/api", tags=["Health & Info"])


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="Health check",
    description="Check API service availability, uptime, and model loading status.",
)
def get_health() -> HealthResponse:
    """Return health check and model loading status."""
    now_utc = datetime.datetime.now(datetime.timezone.utc).isoformat()

    if inference_service.is_ready:
        return HealthResponse(
            status="healthy",
            timestamp=now_utc,
            model_loaded=True,
            model_name=inference_service.model_name,
            model_version=inference_service.model_version,
            selected_threshold=inference_service.decision_threshold,
            detail="MachinePulse AI inference service is fully operational.",
        )
    else:
        return HealthResponse(
            status="degraded",
            timestamp=now_utc,
            model_loaded=False,
            model_name=None,
            model_version=None,
            selected_threshold=None,
            detail="Inference model is not currently loaded.",
        )


@router.get(
    "/model/info",
    response_model=ModelInfoResponse,
    summary="Model metadata and audit info",
    description="Retrieve trained model architecture, dynamic decision threshold, feature schema, and evaluation metrics.",
)
def get_model_info() -> ModelInfoResponse:
    """Retrieve full audit metadata for the trained model."""
    try:
        return inference_service.get_model_info()
    except ModelNotLoadedError as err:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(err),
        ) from err
