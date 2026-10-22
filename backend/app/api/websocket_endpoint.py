"""WebSocket streaming endpoint for live telemetry."""

from __future__ import annotations

import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from backend.app.core.database import db
from backend.app.services.simulator import simulator
from backend.app.services.websocket_manager import ws_manager

logger = logging.getLogger("machinepulse.ws_endpoint")

router = APIRouter(tags=["WebSocket"])


@router.websocket("/api/ws/live")
async def websocket_live_telemetry(websocket: WebSocket) -> None:
    """Stream real-time sensor telemetry, model inferences, and alerts."""
    await ws_manager.connect(websocket)

    # Send initial state snapshot upon connection
    initial_payload = {
        "type": "init",
        "data": {
            "simulator": simulator.get_status(),
            "stats": db.get_dashboard_stats(),
        },
    }
    try:
        await websocket.send_json(initial_payload)
    except Exception as err:
        logger.warning(f"Error sending initial state to client: {err}")
        ws_manager.disconnect(websocket)
        return

    try:
        while True:
            # Keep connection open and receive optional client messages
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        logger.info("Client disconnected from /api/ws/live")
        ws_manager.disconnect(websocket)
    except Exception as exc:
        logger.warning(f"WebSocket error: {exc}")
        ws_manager.disconnect(websocket)
