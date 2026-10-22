"""Simulator control endpoints for MachinePulse AI."""

from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from backend.app.services.simulator import simulator

router = APIRouter(prefix="/api/simulator", tags=["Simulator"])


class SimulatorStartRequest(BaseModel):
    speed_seconds: Optional[float] = Field(
        default=1.5,
        ge=0.1,
        le=60.0,
        description="Interval in seconds between telemetry readings.",
    )
    start_index: Optional[int] = Field(
        default=None,
        ge=0,
        description="Optional starting row index in the AI4I dataset.",
    )


@router.get("/status", summary="Get simulator status")
async def get_simulator_status() -> Dict[str, Any]:
    """Retrieve the current playback status and progress of the AI4I simulator."""
    return simulator.get_status()


@router.post("/start", summary="Start or resume simulator")
async def start_simulator(payload: SimulatorStartRequest = SimulatorStartRequest()) -> Dict[str, Any]:
    """Start replaying AI4I dataset sensor readings through model inference."""
    try:
        return simulator.start(
            speed_seconds=payload.speed_seconds,
            start_index=payload.start_index,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to start simulator: {exc}",
        ) from exc


@router.post("/pause", summary="Pause simulator")
async def pause_simulator() -> Dict[str, Any]:
    """Pause simulator at current row index."""
    return simulator.pause()


@router.post("/resume", summary="Resume simulator")
async def resume_simulator() -> Dict[str, Any]:
    """Resume paused simulator."""
    return simulator.resume()


@router.post("/stop", summary="Stop simulator")
async def stop_simulator() -> Dict[str, Any]:
    """Stop simulator playback."""
    return simulator.stop()


@router.post("/reset", summary="Reset simulator")
async def reset_simulator() -> Dict[str, Any]:
    """Stop simulator and reset pointer to row 0."""
    return simulator.reset()


@router.post("/step", summary="Advance single step")
async def step_simulator() -> Dict[str, Any]:
    """Advance exactly one row, score it, persist, and return the result."""
    result = await simulator.step_once()
    if not result:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to advance simulator step.",
        )
    return {
        "status": simulator.get_status(),
        "prediction": result,
    }
