"""Application configuration and environment settings for MachinePulse AI."""

from __future__ import annotations

import os
from pathlib import Path
from typing import List


def get_project_root() -> Path:
    """Resolve project root directory reliably regardless of execution working directory."""
    # backend/app/config.py -> parent is app, parent.parent is backend, parent.parent.parent is project root
    return Path(__file__).resolve().parent.parent.parent


class Settings:
    """Application settings and configuration parameters."""

    PROJECT_ROOT: Path = get_project_root()
    ARTIFACTS_DIR: Path = PROJECT_ROOT / "backend" / "artifacts"
    MODEL_PIPELINE_PATH: Path = Path(
        os.getenv("MODEL_PIPELINE_PATH", str(ARTIFACTS_DIR / "failure_pipeline.joblib"))
    )
    MODEL_METADATA_PATH: Path = Path(
        os.getenv("MODEL_METADATA_PATH", str(ARTIFACTS_DIR / "model_metadata.json"))
    )

    # API metadata
    APP_TITLE: str = "MachinePulse AI — Predictive Maintenance API"
    APP_DESCRIPTION: str = (
        "Production REST API for real-time industrial machine failure probability "
        "and classification using AI4I 2020 trained ML pipelines."
    )
    APP_VERSION: str = "1.0.0"

    # Server configuration
    HOST: str = os.getenv("HOST", "0.0.0.0")
    PORT: int = int(os.getenv("PORT", "8001"))
    DEBUG: bool = os.getenv("DEBUG", "false").lower() in ("true", "1", "yes")

    # CORS configuration: Allow React frontend dev server
    CORS_ORIGINS: List[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
    ]

    # Model input feature specification (AI4I 2020 exact column names)
    EXPECTED_FEATURES: List[str] = [
        "Type",
        "Air temperature [K]",
        "Process temperature [K]",
        "Rotational speed [rpm]",
        "Torque [Nm]",
        "Tool wear [min]",
    ]

    # Explicitly forbidden leakage columns
    FORBIDDEN_COLUMNS: List[str] = [
        "Machine failure",
        "TWF",
        "HDF",
        "PWF",
        "OSF",
        "RNF",
        "UDI",
        "Product ID",
    ]


settings = Settings()
