"""Operational alert management endpoints for MachinePulse AI."""

from __future__ import annotations

from typing import Any, Dict, Literal, Optional

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel

from backend.app.core.database import db

router = APIRouter(prefix="/api/alerts", tags=["Alerts"])


class AlertStatusPatchRequest(BaseModel):
    status: Literal["acknowledged", "resolved", "open"]


@router.get("", summary="List alerts")
def list_alerts(
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    status: Optional[str] = Query(default=None, description="Filter by status (open, acknowledged, resolved)"),
) -> Dict[str, Any]:
    """Retrieve paginated operational alerts ordered by last seen descending."""
    items, total = db.list_alerts(limit=limit, offset=offset, status_filter=status)
    return {
        "items": items,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.patch("/{alert_id}", summary="Acknowledge or resolve an alert")
def update_alert_status(alert_id: str, payload: AlertStatusPatchRequest) -> Dict[str, Any]:
    """Update alert status to 'acknowledged' or 'resolved'."""
    updated = db.patch_alert(alert_id, payload.status)
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Alert '{alert_id}' not found.",
        )
    return updated
