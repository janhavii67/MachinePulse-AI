"""Transparent, rule-based maintenance recommendation engine for MachinePulse AI.

Provides independent, deterministic physical indicators derived from the official
AI4I 2020 Predictive Maintenance failure-mode definitions:
1. Heat Dissipation Failure (HDF) - VERIFIED against dataset ground truth.
2. Power Failure (PWF) - VERIFIED against dataset ground truth.
3. Overstrain Failure (OSF) - VERIFIED against dataset ground truth.
4. Tool Wear Failure (TWF) Proximity - HEURISTIC warning band (stochastic in AI4I).

IMPORTANT TRANSPARENCY PRINCIPLES:
- Rules are independent heuristic / physical indicators, NOT causes learned by the ML model.
- Tool wear is evaluated as a "wear-budget proxy - not RUL". AI4I has no RUL labels.
- Risk tier is an application-level operational policy that combines model probability
  with rule states for triaging; it never alters the underlying ML model probability.
- Pure deterministic module: zero DB access, zero model loading, zero network/disk I/O.
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field

# ==============================================================================
# RULE THRESHOLDS & EVIDENCE STATUS
# ==============================================================================

# 1. Heat Dissipation (HDF)
# Source: AI4I 2020 dataset documentation (Matzka, 2020); verified via backend/scripts/verify_rules.py
# Verification: 115/115 exact match with ground-truth HDF column (100% precision & recall).
HDF_TEMP_DIFF_THRESHOLD_K: float = 8.6  # [VERIFIED] Difference (T_proc - T_air) < 8.6 K triggers HDF
HDF_ROTATIONAL_SPEED_THRESHOLD_RPM: float = 1380.0  # [VERIFIED] Rotational speed < 1380 rpm triggers HDF
# Approach margins: Application heuristic warning buffer
HDF_TEMP_DIFF_APPROACH_K: float = 10.0  # [HEURISTIC] Warning margin when temp diff is between 8.6 K and 10.0 K
HDF_SPEED_APPROACH_RPM: float = 1450.0  # [HEURISTIC] Warning margin when rotational speed is between 1380 and 1450 rpm

# 2. Power Failure (PWF)
# Source: AI4I 2020 dataset documentation (Matzka, 2020); verified via backend/scripts/verify_rules.py
# Verification: 95/95 exact match with ground-truth PWF column (100% precision & recall).
# Power formula: P (W) = Torque (Nm) * Rotational_Speed (rad/s) where rad/s = rpm * 2 * pi / 60
PWF_MIN_POWER_WATTS: float = 3500.0  # [VERIFIED] Power < 3500 W causes stall failure
PWF_MAX_POWER_WATTS: float = 9000.0  # [VERIFIED] Power > 9000 W causes overload failure
# Approach margins: Application heuristic warning buffer
PWF_MIN_APPROACH_WATTS: float = 3800.0  # [HEURISTIC] Warning buffer within 3500 W - 3800 W
PWF_MAX_APPROACH_WATTS: float = 8500.0  # [HEURISTIC] Warning buffer within 8500 W - 9000 W

# 3. Overstrain Failure (OSF)
# Source: AI4I 2020 dataset documentation (Matzka, 2020); verified via backend/scripts/verify_rules.py
# Verification: 98/98 exact match with ground-truth OSF column (100% precision & recall).
# Overstrain product = Tool wear (min) * Torque (Nm)
OSF_THRESHOLDS_MIN_NM: Dict[str, float] = {
    "L": 11000.0,  # [VERIFIED] Low quality variant threshold: 11,000 min*Nm
    "M": 12000.0,  # [VERIFIED] Medium quality variant threshold: 12,000 min*Nm
    "H": 13000.0,  # [VERIFIED] High quality variant threshold: 13,000 min*Nm
}
OSF_APPROACH_RATIO: float = 0.85  # [HEURISTIC] Approaching overstrain when product is between 85% and 100% of threshold

# 4. Tool Wear Failure (TWF) Proximity
# Source: AI4I 2020 dataset documentation (Matzka, 2020); verified via backend/scripts/verify_rules.py
# Verification: [HEURISTIC] TWF is stochastic in AI4I; failures occur randomly between 200 and 240 minutes.
TWF_CRITICAL_WINDOW_MIN: float = 200.0  # [HEURISTIC] Start of critical wear breakdown window
TWF_DOCUMENTED_LIMIT_MIN: float = 240.0  # [HEURISTIC] Upper replacement limit of documented window
TWF_APPROACHING_MIN: float = 170.0  # [HEURISTIC] Approaching warning threshold (~85% of 200 min)

# 5. Risk Tier Cut-Off Multiplier
WATCH_PROBABILITY_MULTIPLIER: float = 0.50  # [HEURISTIC] Probability >= 50% of decision threshold qualifies for WATCH


# ==============================================================================
# PYDANTIC SCHEMAS
# ==============================================================================

class RuleIndicator(BaseModel):
    """Evaluation result for an independent physical or heuristic sensor rule."""

    rule_id: Literal["HDF", "PWF", "OSF", "TWF_PROXIMITY"]
    name: str
    status: Literal["normal", "approaching", "triggered"]
    measured_values: Dict[str, Any]
    actual_value: float
    threshold: Any
    unit: str
    comparison: str
    recommendation: Optional[str] = None
    source_text: str
    threshold_status: Literal["VERIFIED", "HEURISTIC"]


class WearBudgetProxy(BaseModel):
    """Wear-budget proxy indicator. NOT Remaining Useful Life (RUL)."""

    tool_wear_min: float
    assumed_limit_min: float
    percentage_consumed: float
    is_over_limit: bool
    label: Literal["wear-budget proxy - not RUL"] = "wear-budget proxy - not RUL"
    limit_source: str
    interpretation: str


class AgreementResult(BaseModel):
    """Alignment comparison between ML model classification and deterministic rules."""

    status: Literal["agree_failure", "agree_normal", "model_only", "rules_only"]
    explanation: str


class RecommendationResult(BaseModel):
    """Comprehensive recommendation engine response."""

    product_type: str
    readings_used: Dict[str, Any]
    indicators: List[RuleIndicator]
    wear_budget_proxy: WearBudgetProxy
    model_probability: float
    model_threshold: float
    model_predicted_class: int
    risk_tier: Literal["NORMAL", "WATCH", "HIGH", "CRITICAL"]
    tier_definitions: Dict[str, str]
    agreement: AgreementResult
    recommended_actions: List[str]
    notes: List[str]


# ==============================================================================
# RULE EVALUATORS
# ==============================================================================

def evaluate_hdf_rule(
    air_temp_k: float,
    process_temp_k: float,
    speed_rpm: float,
) -> RuleIndicator:
    """Evaluate Heat Dissipation Failure (HDF) rule."""
    temp_diff = round(process_temp_k - air_temp_k, 2)
    is_triggered = (temp_diff < HDF_TEMP_DIFF_THRESHOLD_K) and (speed_rpm < HDF_ROTATIONAL_SPEED_THRESHOLD_RPM)

    if is_triggered:
        status: Literal["normal", "approaching", "triggered"] = "triggered"
        rec = "CRITICAL COOLING FAILURE: Dissipation delta is below 8.6 K and spindle speed is under 1380 rpm. Inspect coolant delivery, heat exchangers, and spindle ventilation immediately."
    elif (temp_diff < HDF_TEMP_DIFF_APPROACH_K) and (speed_rpm < HDF_SPEED_APPROACH_RPM):
        status = "approaching"
        rec = "COOLING WARNING: Thermal dissipation is nearing critical limits. Check for coolant degradation or air flow obstruction."
    else:
        status = "normal"
        rec = None

    return RuleIndicator(
        rule_id="HDF",
        name="Heat Dissipation Indicator",
        status=status,
        measured_values={
            "air_temperature_k": air_temp_k,
            "process_temperature_k": process_temp_k,
            "temperature_difference_k": temp_diff,
            "rotational_speed_rpm": speed_rpm,
        },
        actual_value=temp_diff,
        threshold=f"diff < {HDF_TEMP_DIFF_THRESHOLD_K} K AND speed < {HDF_ROTATIONAL_SPEED_THRESHOLD_RPM} rpm",
        unit="K",
        comparison="<",
        recommendation=rec,
        source_text="AI4I 2020 ground truth rule: (Process temp - Air temp < 8.6 K) AND (speed < 1380 rpm).",
        threshold_status="VERIFIED",
    )


def evaluate_pwf_rule(
    torque_nm: float,
    speed_rpm: float,
) -> RuleIndicator:
    """Evaluate Power Failure (PWF) rule."""
    # omega = rpm * 2 * pi / 60
    omega = speed_rpm * (math.pi / 30.0)
    power_watts = round(torque_nm * omega, 2)

    is_low_triggered = power_watts < PWF_MIN_POWER_WATTS
    is_high_triggered = power_watts > PWF_MAX_POWER_WATTS
    is_triggered = is_low_triggered or is_high_triggered

    if is_triggered:
        status: Literal["normal", "approaching", "triggered"] = "triggered"
        if is_high_triggered:
            rec = f"POWER OVERLOAD ({power_watts:.0f} W > 9000 W): Motor electrical load exceeds safe power threshold. Reduce torque load and verify spindle drive rating."
        else:
            rec = f"POWER STALL ({power_watts:.0f} W < 3500 W): Motor power is below operating minimum. Inspect for spindle stalling or sudden motor resistance."
    elif (power_watts < PWF_MIN_APPROACH_WATTS) or (power_watts > PWF_MAX_APPROACH_WATTS):
        status = "approaching"
        rec = f"POWER MARGIN WARNING ({power_watts:.0f} W): Operating near power envelope boundaries (3500 - 9000 W). Monitor motor current and load variations."
    else:
        status = "normal"
        rec = None

    return RuleIndicator(
        rule_id="PWF",
        name="Power Indicator",
        status=status,
        measured_values={
            "torque_nm": torque_nm,
            "rotational_speed_rpm": speed_rpm,
            "angular_velocity_rad_s": round(omega, 3),
            "power_watts": power_watts,
        },
        actual_value=power_watts,
        threshold="3500 - 9000",
        unit="W",
        comparison="outside_range",
        recommendation=rec,
        source_text="AI4I 2020 ground truth rule: Power = Torque * omega outside [3500 W, 9000 W].",
        threshold_status="VERIFIED",
    )


def evaluate_osf_rule(
    tool_wear_min: float,
    torque_nm: float,
    product_type: str,
) -> RuleIndicator:
    """Evaluate Overstrain Failure (OSF) rule."""
    norm_type = product_type.upper().strip()
    if norm_type not in OSF_THRESHOLDS_MIN_NM:
        raise ValueError(f"Invalid product type '{product_type}'. Must be 'L', 'M', or 'H'.")

    limit_val = OSF_THRESHOLDS_MIN_NM[norm_type]
    actual_product = round(tool_wear_min * torque_nm, 2)
    approach_val = round(limit_val * OSF_APPROACH_RATIO, 2)

    is_triggered = actual_product > limit_val
    is_approaching = (actual_product >= approach_val) and not is_triggered

    if is_triggered:
        status: Literal["normal", "approaching", "triggered"] = "triggered"
        rec = f"OVERSTRAIN CRITICAL: Tool wear * torque ({actual_product:.0f} min*Nm) exceeds Type-{norm_type} threshold ({limit_val:.0f} min*Nm). Immediate tool change and cutting torque reduction required."
    elif is_approaching:
        status = "approaching"
        rec = f"OVERSTRAIN WARNING: Stress product ({actual_product:.0f} min*Nm) is at {actual_product / limit_val:.0%} of limit ({limit_val:.0f} min*Nm). Schedule tool inspection before next heavy cycle."
    else:
        status = "normal"
        rec = None

    return RuleIndicator(
        rule_id="OSF",
        name="Overstrain Indicator",
        status=status,
        measured_values={
            "tool_wear_min": tool_wear_min,
            "torque_nm": torque_nm,
            "overstrain_product_min_nm": actual_product,
            "product_type": norm_type,
        },
        actual_value=actual_product,
        threshold=limit_val,
        unit="min*Nm",
        comparison=">",
        recommendation=rec,
        source_text=f"AI4I 2020 ground truth rule: Tool wear * Torque > {limit_val:.0f} min*Nm for Type {norm_type}.",
        threshold_status="VERIFIED",
    )


def evaluate_twf_rule(
    tool_wear_min: float,
) -> RuleIndicator:
    """Evaluate Tool Wear Failure (TWF) Proximity indicator."""
    is_critical_window = tool_wear_min >= TWF_CRITICAL_WINDOW_MIN
    is_approaching = (tool_wear_min >= TWF_APPROACHING_MIN) and not is_critical_window

    if is_critical_window:
        status: Literal["normal", "approaching", "triggered"] = "triggered"
        rec = f"TOOL WEAR WARNING: Tool wear is {tool_wear_min:.0f} min, inside documented stochastic failure band (200 - 240 min). Replace cutting tool to prevent unexpected tool breakage."
    elif is_approaching:
        status = "approaching"
        rec = f"TOOL WEAR ADVISORY: Tool wear ({tool_wear_min:.0f} min) is nearing the 200 min replacement window. Prepare replacement tool."
    else:
        status = "normal"
        rec = None

    return RuleIndicator(
        rule_id="TWF_PROXIMITY",
        name="Tool Wear Proximity Indicator",
        status=status,
        measured_values={
            "tool_wear_min": tool_wear_min,
            "critical_window_start_min": TWF_CRITICAL_WINDOW_MIN,
            "documented_limit_min": TWF_DOCUMENTED_LIMIT_MIN,
        },
        actual_value=round(tool_wear_min, 1),
        threshold=TWF_CRITICAL_WINDOW_MIN,
        unit="min",
        comparison=">=",
        recommendation=rec,
        source_text="AI4I 2020 documentation (Matzka, 2020): tool fails randomly between 200 and 240 minutes. Heuristic warning only.",
        threshold_status="HEURISTIC",
    )


def compute_wear_budget_proxy(
    tool_wear_min: float,
) -> WearBudgetProxy:
    """Calculate wear-budget percentage against the documented 240 min limit.
    
    Explicitly labeled as 'wear-budget proxy - not RUL' because AI4I has no RUL labels.
    """
    limit = TWF_DOCUMENTED_LIMIT_MIN
    raw_pct = (tool_wear_min / limit) * 100.0
    percentage_consumed = round(max(0.0, raw_pct), 1)
    is_over = tool_wear_min > limit

    if is_over:
        interpretation = f"Tool wear ({tool_wear_min:.0f} min) exceeds the documented 240 min replacement window by {tool_wear_min - limit:.0f} min."
    elif tool_wear_min >= TWF_CRITICAL_WINDOW_MIN:
        interpretation = f"Tool wear ({tool_wear_min:.0f} min) has consumed {percentage_consumed:.1f}% of assumed wear budget and is in the critical replacement band."
    else:
        interpretation = f"Tool wear ({tool_wear_min:.0f} min) is at {percentage_consumed:.1f}% of assumed 240 min wear budget."

    return WearBudgetProxy(
        tool_wear_min=round(tool_wear_min, 1),
        assumed_limit_min=limit,
        percentage_consumed=percentage_consumed,
        is_over_limit=is_over,
        limit_source="AI4I 2020 dataset documentation (Matzka, 2020: 200-240 min replacement window)",
        interpretation=interpretation,
    )


# ==============================================================================
# RISK TIER & AGREEMENT LOGIC
# ==============================================================================

TIER_DEFINITIONS: Dict[str, str] = {
    "CRITICAL": "Probability >= Threshold AND at least one physical rule is triggered. Immediate shutdown/intervention required.",
    "HIGH": "Probability >= Threshold without a rule triggered, OR a physical rule is triggered with Probability < Threshold. Urgent inspection required.",
    "WATCH": "Probability >= 50% of Threshold, OR any physical rule is approaching boundary. Increased monitoring advised.",
    "NORMAL": "Probability < 50% of Threshold and all physical rules are within safe operating envelope.",
}


def determine_risk_tier(
    probability: float,
    threshold: float,
    has_triggered: bool,
    has_approaching: bool,
) -> Literal["NORMAL", "WATCH", "HIGH", "CRITICAL"]:
    """Assign an application-level operational risk tier.
    
    Guarantees every input maps to exactly one mutually exclusive tier.
    """
    watch_cutoff = threshold * WATCH_PROBABILITY_MULTIPLIER

    if probability >= threshold:
        if has_triggered:
            return "CRITICAL"
        return "HIGH"
    else:
        if has_triggered:
            return "HIGH"
        if (probability >= watch_cutoff) or has_approaching:
            return "WATCH"
        return "NORMAL"


def evaluate_agreement(
    probability: float,
    threshold: float,
    has_triggered: bool,
    has_approaching: bool,
) -> AgreementResult:
    """Compare model failure prediction against deterministic rule triggers."""
    model_failure = probability >= threshold

    if model_failure and has_triggered:
        return AgreementResult(
            status="agree_failure",
            explanation="Model failure prediction aligns with one or more triggered physical failure-mode rules.",
        )
    if (not model_failure) and (not has_triggered) and (not has_approaching):
        return AgreementResult(
            status="agree_normal",
            explanation="Both the machine learning model and physical sensor rules indicate healthy operation.",
        )
    if model_failure and (not has_triggered):
        return AgreementResult(
            status="model_only",
            explanation="Model predicted elevated failure risk based on multivariate patterns, although no single deterministic physical threshold was breached.",
        )
    # Remaining case: not model_failure and (has_triggered or has_approaching)
    return AgreementResult(
        status="rules_only",
        explanation="A physical operating limit was breached even though the model probability remains below the classification threshold.",
    )


# ==============================================================================
# MAIN ENGINE ENTRYPOINT
# ==============================================================================

def evaluate_recommendations(
    readings: Dict[str, Any],
    model_probability: float,
    model_predicted_class: int,
    model_threshold: float,
) -> RecommendationResult:
    """Execute complete deterministic recommendation evaluation for a machine observation.
    
    Args:
        readings: Dictionary of sensor readings (keys: type, air_temperature,
                  process_temperature, rotational_speed, torque, tool_wear).
        model_probability: Float failure probability from ML pipeline.
        model_predicted_class: 0 or 1 from ML pipeline.
        model_threshold: Decision threshold (e.g. 0.66) from model metadata.
        
    Returns:
        Structured RecommendationResult instance.
    """
    # Extract & standardize input fields
    p_type = str(readings.get("type", readings.get("Type", "L"))).upper().strip()
    air_temp = float(readings.get("air_temperature", readings.get("Air temperature [K]", 300.0)))
    proc_temp = float(readings.get("process_temperature", readings.get("Process temperature [K]", 310.0)))
    speed = float(readings.get("rotational_speed", readings.get("Rotational speed [rpm]", 1500.0)))
    torque = float(readings.get("torque", readings.get("Torque [Nm]", 40.0)))
    wear = float(readings.get("tool_wear", readings.get("Tool wear [min]", 0.0)))

    # Evaluate 4 rules
    hdf_ind = evaluate_hdf_rule(air_temp_k=air_temp, process_temp_k=proc_temp, speed_rpm=speed)
    pwf_ind = evaluate_pwf_rule(torque_nm=torque, speed_rpm=speed)
    osf_ind = evaluate_osf_rule(tool_wear_min=wear, torque_nm=torque, product_type=p_type)
    twf_ind = evaluate_twf_rule(tool_wear_min=wear)

    indicators = [hdf_ind, pwf_ind, osf_ind, twf_ind]

    has_triggered = any(ind.status == "triggered" for ind in indicators)
    has_approaching = any(ind.status == "approaching" for ind in indicators)

    # Compute wear budget proxy
    wear_budget = compute_wear_budget_proxy(tool_wear_min=wear)

    # Determine risk tier
    risk_tier = determine_risk_tier(
        probability=model_probability,
        threshold=model_threshold,
        has_triggered=has_triggered,
        has_approaching=has_approaching,
    )

    # Determine agreement
    agreement = evaluate_agreement(
        probability=model_probability,
        threshold=model_threshold,
        has_triggered=has_triggered,
        has_approaching=has_approaching,
    )

    # Collect and deduplicate recommended actions in order of severity
    actions: List[str] = []
    # Triggered recommendations first
    for ind in indicators:
        if ind.status == "triggered" and ind.recommendation and ind.recommendation not in actions:
            actions.append(ind.recommendation)
    # Approaching recommendations second
    for ind in indicators:
        if ind.status == "approaching" and ind.recommendation and ind.recommendation not in actions:
            actions.append(ind.recommendation)

    if not actions:
        if model_probability >= model_threshold:
            actions.append(
                f"Model predicts elevated failure probability ({model_probability:.1%}). "
                "Conduct manual machine inspection and check for multi-sensor stress anomalies."
            )
        elif risk_tier == "WATCH":
            actions.append("Operating within permissible tolerances but approaching warning limits. Maintain heightened operational monitoring.")
        else:
            actions.append("Normal operating condition. No corrective maintenance action required.")

    disclaimers = [
        "Rule indicators are deterministic physical and heuristic checks, not causal factors learned by the machine learning model.",
        "The AI4I 2020 dataset is synthetically generated; failure modes represent modeled physical constraints.",
        "Tool wear is expressed as a wear-budget proxy against the documented 240 min limit, not true Remaining Useful Life (RUL).",
        "Risk tier is an application operational policy for maintenance prioritization; it does not alter model predictions.",
    ]

    canonical_readings = {
        "type": p_type,
        "air_temperature_k": air_temp,
        "process_temperature_k": proc_temp,
        "rotational_speed_rpm": speed,
        "torque_nm": torque,
        "tool_wear_min": wear,
    }

    return RecommendationResult(
        product_type=p_type,
        readings_used=canonical_readings,
        indicators=indicators,
        wear_budget_proxy=wear_budget,
        model_probability=round(model_probability, 4),
        model_threshold=round(model_threshold, 4),
        model_predicted_class=int(model_predicted_class),
        risk_tier=risk_tier,
        tier_definitions=TIER_DEFINITIONS,
        agreement=agreement,
        recommended_actions=actions,
        notes=disclaimers,
    )
