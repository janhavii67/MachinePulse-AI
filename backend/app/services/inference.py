"""Inference service for MachinePulse AI failure prediction model.

Manages pipeline loading, metadata parsing, threshold resolution, and prediction
execution using the serialized scikit-learn pipeline.
"""

from __future__ import annotations

import datetime
import json
import logging
from pathlib import Path
from typing import Any, Dict, Optional

import joblib
import numpy as np
import pandas as pd
from sklearn.pipeline import Pipeline

from backend.app.config import settings
from backend.app.schemas import MachineFeatures, ModelInfoResponse, PredictionResponse

logger = logging.getLogger("machinepulse.inference")


class ModelNotLoadedError(RuntimeError):
    """Raised when inference is requested before the model pipeline is loaded."""


class InferenceService:
    """Singleton service for loading model artifacts and executing failure predictions."""

    def __init__(
        self,
        pipeline_path: Path | None = None,
        metadata_path: Path | None = None,
    ):
        self.pipeline_path: Path = pipeline_path or settings.MODEL_PIPELINE_PATH
        self.metadata_path: Path = metadata_path or settings.MODEL_METADATA_PATH

        self.pipeline: Optional[Pipeline] = None
        self.metadata: Dict[str, Any] = {}
        self.decision_threshold: float = 0.50
        self.model_name: str = "UnknownModel"
        self.model_version: str = "0.0.0"
        self.dataset_source: str = "AI4I 2020 Predictive Maintenance Dataset"
        self._is_ready: bool = False

    @property
    def is_ready(self) -> bool:
        """Return True if both the pipeline and metadata are successfully loaded."""
        return self._is_ready and self.pipeline is not None

    def load_model(self) -> None:
        """Load the model pipeline and read metadata dynamically at application startup.

        Raises:
            FileNotFoundError: If pipeline or metadata files do not exist.
        """
        logger.info("Initializing MachinePulse AI Inference Service...")
        logger.info(f"Target pipeline path: {self.pipeline_path}")
        logger.info(f"Target metadata path: {self.metadata_path}")

        # 1. Verify and read metadata first
        if not self.metadata_path.exists():
            self._is_ready = False
            msg = f"Model metadata not found at: {self.metadata_path}"
            logger.error(msg)
            raise FileNotFoundError(msg)

        try:
            with open(self.metadata_path, "r", encoding="utf-8") as f:
                self.metadata = json.load(f)
        except Exception as e:
            self._is_ready = False
            logger.error(f"Failed to parse metadata JSON from {self.metadata_path}: {e}")
            raise

        # Dynamically read threshold and parameters from metadata
        self.decision_threshold = float(
            self.metadata.get("selected_classification_threshold", 0.66)
        )
        self.model_name = str(self.metadata.get("model_name", "HistGradientBoosting"))
        self.model_version = str(self.metadata.get("model_version", "1.0.0"))
        self.dataset_source = str(
            self.metadata.get("dataset_source", "AI4I 2020 Predictive Maintenance Dataset")
        )

        logger.info(
            f"Parsed metadata successfully: model={self.model_name} (v{self.model_version}), "
            f"dynamic threshold={self.decision_threshold:.4f}"
        )

        # 2. Verify and load pipeline artifact
        if not self.pipeline_path.exists():
            self._is_ready = False
            msg = f"Fitted model pipeline artifact not found at: {self.pipeline_path}"
            logger.error(msg)
            raise FileNotFoundError(msg)

        try:
            self.pipeline = joblib.load(self.pipeline_path)
            self._is_ready = True
            logger.info(f"Fitted pipeline loaded successfully from {self.pipeline_path}")
        except Exception as e:
            self._is_ready = False
            logger.error(f"Failed to unpickle pipeline artifact: {e}")
            raise

        # Warm up pipeline with dummy inference check
        self._warmup_check()

    def _warmup_check(self) -> None:
        """Perform a single dummy prediction to verify pipeline execution."""
        if not self.pipeline:
            return

        dummy_record = {
            "Type": "M",
            "Air temperature [K]": 300.0,
            "Process temperature [K]": 310.0,
            "Rotational speed [rpm]": 1500,
            "Torque [Nm]": 40.0,
            "Tool wear [min]": 100,
        }
        try:
            df = pd.DataFrame([dummy_record])
            prob = self.pipeline.predict_proba(df)[0, 1]
            logger.info(f"Pipeline warm-up check passed (test failure prob: {prob:.4f})")
        except Exception as exc:
            logger.warning(f"Pipeline warm-up check produced warning: {exc}")

    def get_model_info(self) -> ModelInfoResponse:
        """Return full audit metadata as a structured Pydantic response."""
        if not self.is_ready:
            raise ModelNotLoadedError("Model is not loaded. Cannot fetch model info.")

        return ModelInfoResponse(
            model_name=self.model_name,
            model_type=str(self.metadata.get("model_type", "HistGradientBoostingClassifier")),
            model_version=self.model_version,
            created_at=str(self.metadata.get("created_at", "N/A")),
            dataset_source=self.dataset_source,
            target_column=str(self.metadata.get("target_column", "Machine failure")),
            input_features=self.metadata.get("input_features", settings.EXPECTED_FEATURES),
            excluded_features=self.metadata.get("excluded_features", settings.FORBIDDEN_COLUMNS),
            selected_classification_threshold=self.decision_threshold,
            selection_criterion=str(self.metadata.get("selection_criterion", "PR-AUC / F1-score")),
            evaluation_metrics=self.metadata.get("evaluation_metrics", {}),
            known_limitations=self.metadata.get("known_limitations", []),
        )

    def _determine_risk_and_recommendation(
        self,
        probability: float,
        features: MachineFeatures,
    ) -> tuple[str, str]:
        """Classify operational risk category and generate tailored maintenance advice."""
        thresh = self.decision_threshold

        if probability >= 0.85:
            risk = "CRITICAL"
            advice = (
                "IMMINENT BREAKDOWN RISK: Halting spindle rotation recommended immediately. "
                f"Predicted failure probability is {probability:.1%}. "
            )
        elif probability >= thresh:
            risk = "HIGH"
            advice = (
                f"MAINTENANCE REQUIRED: Probability ({probability:.1%}) exceeds threshold ({thresh:.1%}). "
                "Schedule priority tool inspection before commencing the next manufacturing batch. "
            )
        elif probability >= 0.20:
            risk = "MEDIUM"
            advice = (
                f"ELEVATED OPERATIONAL STRESS: Failure probability is {probability:.1%}. "
                "Equipment is operating within safe limits but exhibiting higher-than-average wear or torque. "
            )
        else:
            risk = "LOW"
            advice = (
                f"NORMAL OPERATING CONDITION: Machine tool healthy ({probability:.1%} failure probability). "
                "No immediate maintenance action required."
            )

        # Contextual insights based on sensor readings
        specific_factors = []
        if features.tool_wear >= 200:
            specific_factors.append(f"Tool wear is elevated at {features.tool_wear:.0f} min (near standard end-of-life).")
        if features.torque >= 65:
            specific_factors.append(f"Cutting torque is unusually high ({features.torque:.1f} Nm).")
        if features.process_temperature - features.air_temperature >= 11.5:
            specific_factors.append("Thermal dissipation difference is abnormally high (> 11.5 K).")
        if features.rotational_speed <= 1300:
            specific_factors.append(f"Low rotational speed ({features.rotational_speed:.0f} rpm) combined with torque load.")

        if specific_factors and risk in ("HIGH", "CRITICAL"):
            advice += " Primary contributing stressors: " + " ".join(specific_factors)

        return risk, advice

    def predict(self, features: MachineFeatures) -> PredictionResponse:
        """Execute model inference for a single machine reading.

        Args:
            features: Validated MachineFeatures instance.

        Returns:
            Structured PredictionResponse with probability, threshold, and recommendation.
        """
        if not self.is_ready or self.pipeline is None:
            raise ModelNotLoadedError(
                "Prediction pipeline is not loaded. Please ensure failure_pipeline.joblib exists."
            )

        # 1. Map validated fields to original AI4I dataset column names
        raw_feature_dict = features.to_original_pipeline_dict()
        input_df = pd.DataFrame([raw_feature_dict])

        # 2. Compute probability from scikit-learn pipeline
        probabilities = self.pipeline.predict_proba(input_df)[0]
        failure_prob = float(probabilities[1])

        # 3. Classify using the dynamically loaded threshold from metadata
        is_failure = bool(failure_prob >= self.decision_threshold)
        predicted_class = 1 if is_failure else 0

        # 4. Generate risk level and maintenance advice
        risk_level, recommendation = self._determine_risk_and_recommendation(
            failure_prob, features
        )

        # 5. Timestamp
        now_utc = datetime.datetime.now(datetime.timezone.utc).isoformat()

        return PredictionResponse(
            failure_probability=round(failure_prob, 4),
            failure_predicted=is_failure,
            predicted_class=predicted_class,
            decision_threshold=self.decision_threshold,
            risk_level=risk_level,  # type: ignore[arg-type]
            recommendation=recommendation,
            model_name=self.model_name,
            model_version=self.model_version,
            timestamp=now_utc,
            data_source=self.dataset_source,
            features_used=raw_feature_dict,
        )


# Global singleton instance used across the FastAPI application
inference_service = InferenceService()
