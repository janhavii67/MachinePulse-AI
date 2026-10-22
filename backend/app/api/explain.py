"""Explainability API router for MachinePulse AI.

Exposes:
- GET /api/predictions/{id}/explain: Local occlusion attribution for a stored prediction record.
- GET /api/explain/global: Global permutation feature importance calculated on held-out test data.
- GET /api/explain/baseline: Healthy baseline reference values and training distributions.
- POST /api/explain: Local occlusion attribution for arbitrary inputs (used by What-if simulation).
  Strictly performs ZERO database writes.
"""

from __future__ import annotations

import logging
from typing import Any, Dict

from fastapi import APIRouter, HTTPException, status

from backend.app.core.database import db
from backend.app.schemas import (
    FIELD_ALIASES,
    GlobalImportanceResponse,
    LocalExplanationResponse,
    MachineFeatures,
)
from backend.app.services.explainability import (
    ArtifactsMissingError,
    explainability_service,
)
from backend.app.services.inference import ModelNotLoadedError, inference_service
from backend.app.services.recommendations import (
    RecommendationResult,
    evaluate_recommendations,
)

logger = logging.getLogger("machinepulse.api.explain")

router = APIRouter(tags=["Explainability"])


@router.get(
    "/api/explain/global",
    response_model=GlobalImportanceResponse,
    summary="Get global permutation feature importance",
    description=(
        "Returns permutation feature importance computed on held-out test data (ROC-AUC drop). "
        "Provides an audit trail of which sensor signals the fitted model relies upon globally."
    ),
)
async def get_global_importance() -> Dict[str, Any]:
    """Retrieve precomputed global feature importance from disk artifacts."""
    try:
        return explainability_service.get_global_importance()
    except ArtifactsMissingError as err:
        logger.error(f"Global importance artifact missing: {err}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Global importance artifact is missing. "
                "Please run 'python backend/scripts/build_explain_artifacts.py' to generate artifacts."
            ),
        ) from err
    except Exception as exc:
        logger.error(f"Failed to load global importance: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error reading global importance: {exc}",
        ) from exc


@router.get(
    "/api/explain/baseline",
    summary="Get healthy reference baselines and training ranges",
    description="Returns non-failure baseline medians and observed training ranges for input validation and UI sliders.",
)
async def get_baseline_info() -> Dict[str, Any]:
    """Retrieve healthy reference baseline medians and min/max training boundaries."""
    try:
        return explainability_service.get_baseline_info()
    except ArtifactsMissingError as err:
        logger.error(f"Baseline artifact missing: {err}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Explainability baseline artifact is missing. "
                "Please run 'python backend/scripts/build_explain_artifacts.py' to generate artifacts."
            ),
        ) from err
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error reading baseline info: {exc}",
        ) from exc


@router.post(
    "/api/explain",
    response_model=LocalExplanationResponse,
    summary="Explain arbitrary sensor readings (What-if)",
    description=(
        "Executes model inference and univariate occlusion analysis for arbitrary valid sensor inputs. "
        "Intended for interactive What-if experimentation. Strictly performs ZERO database writes "
        "and creates no alerts."
    ),
)
async def explain_arbitrary_input(payload: MachineFeatures) -> Dict[str, Any]:
    """Generate local occlusion explanation for given input without persisting to database."""
    try:
        explanation = explainability_service.explain_features(payload)
        # Compute transparent rule-based recommendations for What-if without DB writes
        recs = evaluate_recommendations(
            readings=explanation["features_analyzed"],
            model_probability=explanation["failure_probability"],
            model_predicted_class=1 if explanation["failure_predicted"] else 0,
            model_threshold=explanation["decision_threshold"],
        )
        explanation["recommendations"] = recs.model_dump()
        return explanation
    except ModelNotLoadedError as err:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(err),
        ) from err
    except ArtifactsMissingError as err:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Explainability baseline artifact is missing. "
                "Please run 'python backend/scripts/build_explain_artifacts.py' to generate."
            ),
        ) from err
    except Exception as exc:
        logger.error(f"Error computing local explanation: {exc}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to compute explanation: {exc}",
        ) from exc


@router.get(
    "/api/predictions/{prediction_id}/explain",
    response_model=LocalExplanationResponse,
    summary="Explain a stored prediction",
    description=(
        "Retrieves a historical prediction by ID and reconstructs feature attributions "
        "via occlusion against the healthy non-failure baseline."
    ),
)
async def explain_stored_prediction(prediction_id: str) -> Dict[str, Any]:
    """Explain a stored prediction using its recorded sensor input snapshot."""
    record = db.get_prediction(prediction_id)
    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Prediction record with ID '{prediction_id}' not found.",
        )

    raw_features = record.get("input_snapshot")
    if not raw_features or not isinstance(raw_features, dict):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Prediction record '{prediction_id}' does not contain a valid input sensor snapshot.",
        )

    # Re-validate inputs through MachineFeatures to ensure canonical normalization
    try:
        validated = MachineFeatures(**raw_features)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Stored input features in prediction '{prediction_id}' failed validation: {exc}",
        ) from exc

    try:
        explanation = explainability_service.explain_features(validated)
        explanation["prediction_id"] = prediction_id

        # Attach rule-based recommendations using stored prediction parameters
        recs = evaluate_recommendations(
            readings=explanation["features_analyzed"],
            model_probability=explanation["failure_probability"],
            model_predicted_class=1 if explanation["failure_predicted"] else 0,
            model_threshold=explanation["decision_threshold"],
        )
        explanation["recommendations"] = recs.model_dump()
        return explanation
    except ModelNotLoadedError as err:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(err),
        ) from err
    except ArtifactsMissingError as err:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Explainability baseline artifact is missing. Run build script.",
        ) from err
    except Exception as exc:
        logger.error(f"Error explaining stored prediction {prediction_id}: {exc}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to explain prediction: {exc}",
        ) from exc


@router.get(
    "/api/predictions/{prediction_id}/recommendations",
    response_model=RecommendationResult,
    summary="Get rule-based maintenance recommendations for a stored prediction",
    description=(
        "Retrieves a historical prediction by ID and evaluates independent physical failure-mode rules "
        "(HDF, PWF, OSF, TWF proximity) and wear-budget proxy. Uses the stored prediction probability "
        "and threshold without executing a fresh inference. Read-only: zero DB writes, zero alerts created."
    ),
)
async def get_stored_prediction_recommendations(prediction_id: str) -> Dict[str, Any]:
    """Evaluate deterministic maintenance rules on stored prediction record."""
    record = db.get_prediction(prediction_id)
    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Prediction record with ID '{prediction_id}' not found.",
        )

    raw_features = record.get("input_snapshot")
    if not raw_features or not isinstance(raw_features, dict):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Prediction record '{prediction_id}' lacks a valid input sensor snapshot.",
        )

    # Normalize aliases to ensure all 6 required fields are present
    mapped: Dict[str, Any] = {}
    for k, v in raw_features.items():
        canonical = FIELD_ALIASES.get(k) or FIELD_ALIASES.get(str(k).lower())
        if canonical:
            mapped[canonical] = v
        else:
            mapped[k] = v

    required_fields = ["type", "air_temperature", "process_temperature", "rotational_speed", "torque", "tool_wear"]
    missing = [f for f in required_fields if f not in mapped or mapped[f] is None]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Stored input snapshot for prediction '{prediction_id}' is missing required sensor fields: {missing}.",
        )

    # Use the STORED probability and threshold, NOT a fresh inference
    stored_prob = float(record.get("failure_probability", 0.0))
    stored_thresh = float(record.get("decision_threshold", inference_service.decision_threshold))
    stored_label = str(record.get("predicted_label", "Healthy"))
    stored_class = 1 if stored_label == "Failure" or stored_prob >= stored_thresh else 0

    recs = evaluate_recommendations(
        readings=mapped,
        model_probability=stored_prob,
        model_predicted_class=stored_class,
        model_threshold=stored_thresh,
    )

    return recs.model_dump()

