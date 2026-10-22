"""Prediction history, metrics, and aggregated telemetry endpoints."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query, status

from backend.app.core.database import db

router = APIRouter(prefix="/api", tags=["History & Analytics"])


@router.get("/predictions", summary="List prediction history")
def list_predictions(
    limit: int = Query(default=50, ge=1, le=200, description="Max records to return"),
    offset: int = Query(default=0, ge=0, description="Records to skip"),
) -> Dict[str, Any]:
    """Retrieve persisted prediction history ordered from newest to oldest."""
    items, total = db.list_predictions(limit=limit, offset=offset)
    return {
        "items": items,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/predictions/{prediction_id}", summary="Get prediction detail")
def get_prediction_detail(prediction_id: str) -> Dict[str, Any]:
    """Retrieve full details of a specific prediction including sensor features."""
    record = db.get_prediction(prediction_id)
    if not record:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Prediction record '{prediction_id}' not found.",
        )
    return record


@router.get("/stats", summary="Get real-time dashboard KPIs")
def get_dashboard_stats() -> Dict[str, Any]:
    """Calculate and return real-time KPIs and trend lines from actual database records."""
    return db.get_dashboard_stats()


@router.get("/history/trend", summary="Get failure probability trend points")
def get_probability_trend(
    limit: int = Query(default=30, ge=5, le=100)
) -> List[Dict[str, Any]]:
    """Return recent probability points for time-series charts."""
    stats = db.get_dashboard_stats()
    return stats.get("trend", [])
