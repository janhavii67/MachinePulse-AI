"""WebSocket connection manager for real-time telemetry streaming."""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, List

from fastapi import WebSocket

logger = logging.getLogger("machinepulse.websocket")


class WebSocketManager:
    """Manages active WebSocket connections and broadcasts telemetry updates."""

    def __init__(self) -> None:
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket) -> None:
        """Accept and register a new client connection."""
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info(f"WebSocket client connected. Active connections: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket) -> None:
        """Remove a disconnected client."""
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            logger.info(f"WebSocket client disconnected. Active connections: {len(self.active_connections)}")

    async def broadcast(self, message: Dict[str, Any]) -> None:
        """Broadcast a JSON message to all connected clients."""
        if not self.active_connections:
            return

        payload = json.dumps(message)
        disconnected: List[WebSocket] = []

        for connection in self.active_connections:
            try:
                await connection.send_text(payload)
            except Exception as exc:
                logger.warning(f"Failed to send to client: {exc}. Marking for removal.")
                disconnected.append(connection)

        for dead in disconnected:
            self.disconnect(dead)


ws_manager = WebSocketManager()
