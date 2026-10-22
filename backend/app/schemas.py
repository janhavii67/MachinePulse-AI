"""Pydantic schemas and data validation models for MachinePulse AI."""

from __future__ import annotations

import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

# Explicitly forbidden leakage columns
FORBIDDEN_COLUMNS = {
    "machine failure",
    "machine_failure",
    "twf",
    "hdf",
    "pwf",
    "osf",
    "rnf",
    "udi",
    "product id",
    "product_id",
}

# Mapping table from various user-friendly keys to canonical internal fields
FIELD_ALIASES = {
    # Type
    "type": "type",
    "product_type": "type",
    "Type": "type",
    # Air temperature
    "air_temperature": "air_temperature",
    "air_temperature_k": "air_temperature",
    "air_temp": "air_temperature",
    "Air temperature [K]": "air_temperature",
    # Process temperature
    "process_temperature": "process_temperature",
    "process_temperature_k": "process_temperature",
    "process_temp": "process_temperature",
    "Process temperature [K]": "process_temperature",
    # Rotational speed
    "rotational_speed": "rotational_speed",
    "rotational_speed_rpm": "rotational_speed",
    "speed": "rotational_speed",
    "Rotational speed [rpm]": "rotational_speed",
    # Torque
    "torque": "torque",
    "torque_nm": "torque",
    "Torque [Nm]": "torque",
    # Tool wear
    "tool_wear": "tool_wear",
    "tool_wear_min": "tool_wear",
    "wear": "tool_wear",
    "Tool wear [min]": "tool_wear",
}


class MachineFeatures(BaseModel):
    """Input sensor features for machine failure probability prediction.

    Supports both friendly snake_case field names (e.g., `air_temperature`)
    and the exact AI4I 2020 dataset column names (e.g., `Air temperature [K]`).
    Strictly forbids data leakage fields such as `Machine failure` or `TWF`.
    """

    model_config = ConfigDict(
        extra="forbid",
        json_schema_extra={
            "example": {
                "type": "M",
                "air_temperature": 298.5,
                "process_temperature": 308.7,
                "rotational_speed": 1400.0,
                "torque": 45.0,
                "tool_wear": 120.0,
            }
        },
    )

    type: Literal["L", "M", "H"] = Field(
        ...,
        description="Product quality variant: 'L' (Low 50%), 'M' (Medium 30%), or 'H' (High 20%).",
    )
    air_temperature: float = Field(
        ...,
        ge=200.0,
        le=400.0,
        description="Ambient air temperature in Kelvin (valid range: 200 - 400 K; typical: 295 - 305 K).",
    )
    process_temperature: float = Field(
        ...,
        ge=200.0,
        le=450.0,
        description="Process cutting temperature in Kelvin (valid range: 200 - 450 K; typical: 305 - 315 K).",
    )
    rotational_speed: float = Field(
        ...,
        ge=0.0,
        le=5000.0,
        description="Spindle rotational speed in RPM (valid range: 0 - 5000 rpm; typical: 1100 - 2900 rpm).",
    )
    torque: float = Field(
        ...,
        ge=0.0,
        le=200.0,
        description="Cutting torque load in Nm (valid range: 0 - 200 Nm; typical: 3 - 80 Nm).",
    )
    tool_wear: float = Field(
        ...,
        ge=0.0,
        le=500.0,
        description="Cumulative cutting tool usage in minutes (valid range: 0 - 500 min; typical: 0 - 260 min).",
    )

    @model_validator(mode="before")
    @classmethod
    def preprocess_and_validate_fields(cls, data: Any) -> Any:
        """Inspect and standardize incoming dictionary keys.

        - Rejects any leakage columns (target label, failure modes, IDs).
        - Maps alternate friendly or raw column names into canonical field names.
        """
        if not isinstance(data, dict):
            return data

        normalized: Dict[str, Any] = {}
        for key, value in data.items():
            clean_key = str(key).strip()
            lower_key = clean_key.lower()

            # Anti-leakage guard
            if lower_key in FORBIDDEN_COLUMNS:
                raise ValueError(
                    f"Forbidden input field '{clean_key}'. Target labels ('Machine failure') "
                    f"and diagnostic failure modes ('TWF', 'HDF', 'PWF', 'OSF', 'RNF', 'UDI', 'Product ID') "
                    f"are strictly disallowed as model input features to prevent data leakage."
                )

            # Map alias if recognized
            canonical = FIELD_ALIASES.get(clean_key) or FIELD_ALIASES.get(lower_key)
            if canonical:
                normalized[canonical] = value
            else:
                # Keep original key so extra='forbid' can properly flag unexpected fields
                normalized[clean_key] = value

        # Physics check: Process temperature should exceed or equal Air temperature
        air_t = normalized.get("air_temperature")
        proc_t = normalized.get("process_temperature")
        if air_t is not None and proc_t is not None:
            try:
                if float(proc_t) < float(air_t):
                    raise ValueError(
                        f"Physical consistency violation: Process temperature ({proc_t} K) "
                        f"cannot be lower than Air temperature ({air_t} K)."
                    )
            except (ValueError, TypeError) as e:
                if "Physical consistency violation" in str(e):
                    raise e

        return normalized

    def to_original_pipeline_dict(self) -> Dict[str, Any]:
        """Convert validated fields into exact AI4I 2020 DataFrame column names."""
        return {
            "Type": str(self.type),
            "Air temperature [K]": float(self.air_temperature),
            "Process temperature [K]": float(self.process_temperature),
            "Rotational speed [rpm]": float(self.rotational_speed),
            "Torque [Nm]": float(self.torque),
            "Tool wear [min]": float(self.tool_wear),
        }


class PredictionResponse(BaseModel):
    """Structured response for machine failure prediction."""

    failure_probability: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description="Model-estimated probability of machine failure (0.0 to 1.0).",
    )
    failure_predicted: bool = Field(
        ...,
        description="Whether failure is predicted based on the selected decision threshold.",
    )
    predicted_class: int = Field(
        ...,
        description="Binary failure class: 0 for Healthy, 1 for Failure.",
    )
    decision_threshold: float = Field(
        ...,
        description="Decision threshold loaded dynamically from model metadata.",
    )
    risk_level: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"] = Field(
        ...,
        description="Categorized operational risk level for maintenance planning.",
    )
    recommendation: str = Field(
        ...,
        description="Actionable operational recommendation for technicians.",
    )
    model_name: str = Field(
        ...,
        description="Name of the champion ML model.",
    )
    model_version: str = Field(
        ...,
        description="Semantic version of the model artifact.",
    )
    timestamp: str = Field(
        ...,
        description="UTC ISO 8601 timestamp of inference.",
    )
    data_source: str = Field(
        ...,
        description="Originating dataset source documentation.",
    )
    features_used: Dict[str, Any] = Field(
        ...,
        description="The exact feature inputs passed to the ML pipeline.",
    )


class ModelInfoResponse(BaseModel):
    """Model metadata, training parameters, and performance audit response."""

    model_name: str
    model_type: str
    model_version: str
    created_at: str
    dataset_source: str
    target_column: str
    input_features: List[str]
    excluded_features: List[str]
    selected_classification_threshold: float
    selection_criterion: str
    evaluation_metrics: Dict[str, Any]
    known_limitations: List[str]


class HealthResponse(BaseModel):
    """API health and operational readiness status."""

    status: Literal["healthy", "degraded", "unhealthy"]
    timestamp: str
    model_loaded: bool
    model_name: Optional[str] = None
    model_version: Optional[str] = None
    selected_threshold: Optional[float] = None
    detail: Optional[str] = None


class FeatureContributionItem(BaseModel):
    """Single feature attribution derived from occlusion vs healthy baseline."""

    feature: str = Field(..., description="Sensor feature name.")
    original_value: Any = Field(..., description="Observed sensor value.")
    baseline_value: Any = Field(..., description="Healthy non-failure baseline reference value.")
    contribution: float = Field(..., description="Signed probability change (positive increases risk, negative decreases risk).")
    absolute_contribution: float = Field(..., description="Magnitude of the feature's influence on the prediction.")
    direction: Literal["increases_risk", "decreases_risk", "neutral"] = Field(
        ..., description="Whether this feature pushes the model towards failure or maintains healthy status."
    )


class LocalExplanationResponse(BaseModel):
    """Local occlusion explanation for a machine reading."""

    method: Literal["occlusion_vs_healthy_baseline"] = "occlusion_vs_healthy_baseline"
    method_description: str
    prediction_id: Optional[str] = None
    failure_probability: float
    decision_threshold: float
    failure_predicted: bool
    predicted_label: Literal["Healthy", "Failure"]
    risk_level: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
    recommendation: Optional[str] = None
    contributions: List[FeatureContributionItem]
    outside_range_warnings: List[str]
    baseline_used: Dict[str, Any]
    features_analyzed: Dict[str, Any]
    recommendations: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Rule-based maintenance recommendations, physical indicators, and wear budget.",
    )
    disclaimer: str


class GlobalImportanceItem(BaseModel):
    """Global feature permutation importance metric."""

    feature: str
    importance_mean: float
    importance_std: float
    rank: int


class GlobalImportanceResponse(BaseModel):
    """Precomputed permutation importance across held-out test data."""

    method: Literal["permutation_importance"] = "permutation_importance"
    description: str
    metric: str
    n_repeats: int
    random_state: int
    evaluation_split: str
    test_sample_size: int
    pipeline_artifact: str
    generated_at: str
    importances: List[GlobalImportanceItem]
    interpretation: str

