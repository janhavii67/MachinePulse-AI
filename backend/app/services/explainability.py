"""Explainability service for MachinePulse AI failure prediction model.

Provides:
1. Local feature attribution via occlusion / healthy baseline substitution:
   Computes signed probability delta for each feature when substituted with
   the healthy non-failure baseline median/mode.
2. Global feature importance retrieval (permutation importance on held-out split).
3. Boundary checks against observed AI4I training distributions.

Reuses the existing fitted scikit-learn pipeline from inference_service.
Does NOT duplicate feature transformations or model evaluation.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

import pandas as pd

from backend.app.config import settings
from backend.app.schemas import MachineFeatures
from backend.app.services.inference import ModelNotLoadedError, inference_service

logger = logging.getLogger("machinepulse.explainability")

DEFAULT_BASELINE_PATH = settings.ARTIFACTS_DIR / "explain_baseline.json"
DEFAULT_GLOBAL_PATH = settings.ARTIFACTS_DIR / "global_importance.json"

FEATURE_COLUMNS = [
    "Type",
    "Air temperature [K]",
    "Process temperature [K]",
    "Rotational speed [rpm]",
    "Torque [Nm]",
    "Tool wear [min]",
]


class ArtifactsMissingError(FileNotFoundError):
    """Raised when required explainability JSON artifacts are missing from disk."""


class ExplainabilityService:
    """Service providing local occlusion explanations and global permutation importance."""

    def __init__(
        self,
        baseline_path: Optional[Path] = None,
        global_path: Optional[Path] = None,
    ) -> None:
        self.baseline_path: Path = baseline_path or DEFAULT_BASELINE_PATH
        self.global_path: Path = global_path or DEFAULT_GLOBAL_PATH
        self._baseline_data: Optional[Dict[str, Any]] = None
        self._global_data: Optional[Dict[str, Any]] = None

    def _ensure_artifacts_loaded(self) -> None:
        """Load baseline and importance artifacts lazily if not already cached in memory."""
        if self._baseline_data is None:
            if not self.baseline_path.exists():
                raise ArtifactsMissingError(
                    f"Explainability baseline artifact not found at {self.baseline_path}. "
                    "Run 'python backend/scripts/build_explain_artifacts.py' to generate."
                )
            try:
                with open(self.baseline_path, "r", encoding="utf-8") as f:
                    self._baseline_data = json.load(f)
            except Exception as exc:
                raise RuntimeError(f"Failed to read baseline JSON from {self.baseline_path}: {exc}") from exc

        if self._global_data is None:
            if not self.global_path.exists():
                raise ArtifactsMissingError(
                    f"Global importance artifact not found at {self.global_path}. "
                    "Run 'python backend/scripts/build_explain_artifacts.py' to generate."
                )
            try:
                with open(self.global_path, "r", encoding="utf-8") as f:
                    self._global_data = json.load(f)
            except Exception as exc:
                raise RuntimeError(f"Failed to read global importance JSON from {self.global_path}: {exc}") from exc

    def get_global_importance(self) -> Dict[str, Any]:
        """Return the precomputed global permutation importance report."""
        self._ensure_artifacts_loaded()
        assert self._global_data is not None
        return self._global_data

    def get_baseline_info(self) -> Dict[str, Any]:
        """Return healthy baselines and observed feature training ranges."""
        self._ensure_artifacts_loaded()
        assert self._baseline_data is not None
        return self._baseline_data

    def _check_training_ranges(self, raw_features: Dict[str, Any]) -> List[str]:
        """Inspect input values against observed training boundaries and flag deviations."""
        self._ensure_artifacts_loaded()
        assert self._baseline_data is not None

        ranges = self._baseline_data.get("training_ranges", {})
        warnings: List[str] = []

        for col, col_range in ranges.items():
            if col == "Type":
                allowed = col_range.get("allowed_values", ["L", "M", "H"])
                val = raw_features.get("Type")
                if val and val not in allowed:
                    warnings.append(f"Product Type '{val}' is outside expected categories {allowed}.")
                continue

            val_num = raw_features.get(col)
            if val_num is None:
                continue

            try:
                numeric_val = float(val_num)
                min_v = float(col_range["min"])
                max_v = float(col_range["max"])
                if numeric_val < min_v:
                    warnings.append(
                        f"{col} ({numeric_val:.1f}) is below minimum observed training value ({min_v:.1f})."
                    )
                elif numeric_val > max_v:
                    warnings.append(
                        f"{col} ({numeric_val:.1f}) is above maximum observed training value ({max_v:.1f})."
                    )
            except (ValueError, TypeError, KeyError):
                pass

        return warnings

    def explain_features(
        self,
        features: Union[MachineFeatures, Dict[str, Any]],
    ) -> Dict[str, Any]:
        """Compute local feature attribution via occlusion against healthy non-failure baselines.

        Methodology:
        1. Base prediction: compute failure probability P_current for the candidate machine reading.
        2. Univariate occlusion: for each feature Fi, replace its value with the healthy baseline Bi
           (derived from non-failure training rows) while leaving all other sensors unchanged.
        3. Re-evaluate pipeline: compute P_occluded(Fi -> Bi).
        4. Signed attribution: Delta = P_current - P_occluded.
           - Delta > 0: Current value pushes the model TOWARDS failure (risk-increasing driver).
           - Delta < 0: Current value pulls the model AWAY from failure (stabilizing/protective).
           - Delta ~= 0: Sensor has negligible influence relative to healthy norm.

        Note on limitations:
        This is a first-order occlusion approximation. Non-linear cross-sensor interactions
        (e.g., combined high torque + low speed power spikes) are not independently separated.

        Args:
            features: MachineFeatures instance or dict of sensor values.

        Returns:
            Dictionary matching LocalExplanationResponse schema with sorted contributions.
        """
        # Ensure model is ready
        if not inference_service.is_ready or inference_service.pipeline is None:
            try:
                inference_service.load_model()
            except Exception as exc:
                raise ModelNotLoadedError(f"Inference model pipeline could not be loaded: {exc}") from exc

        # Ensure baseline artifact is loaded
        self._ensure_artifacts_loaded()
        assert self._baseline_data is not None

        baseline_values: Dict[str, Any] = self._baseline_data["baseline_values"]

        # Standardize features to canonical pipeline dictionary
        if isinstance(features, MachineFeatures):
            raw_dict = features.to_original_pipeline_dict()
            validated_features = features
        elif isinstance(features, dict):
            validated_features = MachineFeatures(**features)
            raw_dict = validated_features.to_original_pipeline_dict()
        else:
            raise ValueError(f"Expected MachineFeatures or dict, received {type(features)}")

        # 1. Base probability using the real fitted pipeline
        base_df = pd.DataFrame([raw_dict])
        base_probs = inference_service.pipeline.predict_proba(base_df)[0]
        prob_current = float(base_probs[1])

        thresh = inference_service.decision_threshold
        is_failure = bool(prob_current >= thresh)

        # 2. Risk tier and recommendation from inference service
        risk_level, recommendation = inference_service._determine_risk_and_recommendation(
            prob_current, validated_features
        )

        # 3. Univariate occlusion against healthy baselines
        contributions: List[Dict[str, Any]] = []

        for feature_name in FEATURE_COLUMNS:
            orig_val = raw_dict[feature_name]
            base_val = baseline_values[feature_name]

            # Construct occluded input row
            occluded_dict = dict(raw_dict)
            occluded_dict[feature_name] = base_val

            # Score occluded row through pipeline
            occluded_df = pd.DataFrame([occluded_dict])
            occluded_prob = float(inference_service.pipeline.predict_proba(occluded_df)[0, 1])

            # Signed probability contribution
            delta = prob_current - occluded_prob

            if delta > 0.0005:
                direction = "increases_risk"
            elif delta < -0.0005:
                direction = "decreases_risk"
            else:
                direction = "neutral"

            contributions.append(
                {
                    "feature": feature_name,
                    "original_value": orig_val,
                    "baseline_value": base_val,
                    "contribution": round(delta, 4),
                    "absolute_contribution": round(abs(delta), 4),
                    "direction": direction,
                }
            )

        # Sort contributions by absolute impact descending
        contributions.sort(key=lambda x: x["absolute_contribution"], reverse=True)

        # 4. Range boundary check
        range_warnings = self._check_training_ranges(raw_dict)

        return {
            "method": "occlusion_vs_healthy_baseline",
            "method_description": (
                "Feature contribution computed via occlusion against healthy non-failure baseline medians. "
                "Positive values indicate features increasing failure risk above healthy baseline; "
                "negative values indicate features lowering risk. "
                "Interactions between correlated features are not separated."
            ),
            "failure_probability": round(prob_current, 4),
            "decision_threshold": thresh,
            "failure_predicted": is_failure,
            "predicted_label": "Failure" if is_failure else "Healthy",
            "risk_level": risk_level,
            "recommendation": recommendation,
            "contributions": contributions,
            "outside_range_warnings": range_warnings,
            "baseline_used": baseline_values,
            "features_analyzed": raw_dict,
            "disclaimer": (
                "Explanations describe feature contributions to this specific trained model's decision function. "
                "They do not establish causal physical root causes or guarantee true Remaining Useful Life."
            ),
        }


# Global singleton instance
explainability_service = ExplainabilityService()
