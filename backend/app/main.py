"""FastAPI application entrypoint for MachinePulse AI.

Configures lifespan startup hooks, CORS middleware for React frontend,
REST API routers, error handlers, and application telemetry.
"""

from __future__ import annotations

import logging
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncGenerator

# Ensure project root is in sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

import uvicorn
from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.app.api.alerts import router as alerts_router
from backend.app.api.datasets_models import router as datasets_models_router
from backend.app.api.explain import router as explain_router
from backend.app.api.health import router as health_router
from backend.app.api.history import router as history_router
from backend.app.api.predictions import router as predictions_router
from backend.app.api.simulator import router as simulator_router
from backend.app.api.training import router as training_router
from backend.app.api.websocket_endpoint import router as ws_router
from backend.app.config import settings
from backend.app.services.inference import inference_service
from backend.app.services.simulator import simulator

# Configure standard application logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("machinepulse.app")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan manager: loads ML pipeline once at server startup."""
    logger.info("=" * 70)
    logger.info(" Starting MachinePulse AI API Server...")
    logger.info(f" Project root: {settings.PROJECT_ROOT}")
    logger.info(f" Pipeline path: {settings.MODEL_PIPELINE_PATH}")
    logger.info(f" Metadata path: {settings.MODEL_METADATA_PATH}")
    logger.info("=" * 70)

    try:
        inference_service.load_model()
        logger.info(
            f"Model loaded successfully! Champion: {inference_service.model_name} "
            f"(threshold: {inference_service.decision_threshold:.4f})"
        )
    except FileNotFoundError as fnf_err:
        logger.warning(
            f"[DEGRADED MODE] Model artifact not found: {fnf_err}. "
            "Server will start, but predictions will return 503 until model is trained."
        )
    except Exception as exc:
        logger.error(f"Error loading model during startup: {exc}", exc_info=True)

    yield

    logger.info("Shutting down MachinePulse AI API Server...")
    simulator.stop()


def create_application() -> FastAPI:
    """Build and configure the FastAPI application instance."""
    app = FastAPI(
        title=settings.APP_TITLE,
        description=settings.APP_DESCRIPTION,
        version=settings.APP_VERSION,
        lifespan=lifespan,
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
    )

    # Configure CORS for React frontend (Vite defaults to http://localhost:5173)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Register API routers
    app.include_router(health_router)
    app.include_router(predictions_router)
    app.include_router(explain_router)
    app.include_router(simulator_router)
    app.include_router(history_router)
    app.include_router(alerts_router)
    app.include_router(datasets_models_router)
    app.include_router(training_router)
    app.include_router(ws_router)

    # Custom validation error handler for friendly, readable messages
    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        errors = []
        for error in exc.errors():
            loc = " -> ".join(str(l) for l in error.get("loc", []))
            msg = error.get("msg", "Validation error")
            errors.append({"field": loc, "message": msg, "type": error.get("type")})

        logger.warning(f"Validation failure on {request.method} {request.url.path}: {errors}")
        return JSONResponse(
            status_code=422,
            content={
                "error": "Unprocessable Entity",
                "message": "Input validation failed. Please check sensor parameter types and ranges.",
                "details": errors,
            },
        )

    # Root welcome and service discovery endpoint
    @app.get(
        "/",
        tags=["Root"],
        summary="API Root",
        description="Service discovery and navigation links.",
    )
    def root() -> dict[str, str]:
        return {
            "service": settings.APP_TITLE,
            "version": settings.APP_VERSION,
            "status": "online",
            "docs_url": "/docs",
            "health_url": "/api/health",
            "model_info_url": "/api/model/info",
            "predict_url": "/api/predict",
        }

    return app


app = create_application()

if __name__ == "__main__":
    uvicorn.run(
        "backend.app.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEBUG,
    )
