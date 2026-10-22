# MachinePulse AI — AI-Based Predictive Maintenance

> **Industrial Equipment Failure Prediction and Remaining Useful Life Estimation**  
> *Modules 1 & 2 Complete: Dataset Preparation, ML Training, FastAPI Prediction Backend*

---

## 1. Project Overview & System Architecture

MachinePulse AI is an industrial predictive maintenance system designed to detect machine tool failures before catastrophic breakdowns occur on factory floors.

The project is structured into clear engineering modules:
- **Module 1**: Dataset exploration, leak-free preprocessing, candidate model benchmarking, validation threshold optimization, and artifact serialization.
- **Module 2**: High-performance FastAPI REST API, dynamic metadata reading, Pydantic validation, strict anti-leakage guards, CORS configuration, and comprehensive automated test suite.

```text
MachinePulseAI/
├── .gitignore                      # Git ignore patterns for venv, caches, logs
├── README.md                       # Comprehensive guide and beginner documentation
├── data/
│   └── ai4i2020.csv                # Official dataset (10,000 rows x 14 columns)
├── backend/
│   ├── requirements.txt            # Python dependencies (ML + FastAPI)
│   ├── __init__.py
│   ├── artifacts/                  # Serialized models and production artifacts
│   │   ├── failure_pipeline.joblib # Full fitted preprocessor + classifier pipeline
│   │   └── model_metadata.json     # Audit trail, schema, threshold, and metrics
│   ├── reports/                    # Diagnostic plots and metric summaries
│   │   ├── eda_target_distribution.png
│   │   ├── eda_failure_modes.png
│   │   ├── eda_feature_distributions.png
│   │   ├── eda_feature_correlations.png
│   │   ├── model_comparison.csv
│   │   ├── model_comparison.json
│   │   ├── test_metrics.csv
│   │   ├── test_metrics.json
│   │   ├── confusion_matrix.png
│   │   └── precision_recall_curve.png
│   ├── ml/                         # Module 1: ML Pipeline
│   │   ├── __init__.py
│   │   ├── download_dataset.py     # Automated dataset downloader from UCI
│   │   ├── eda.py                  # Exploratory Data Analysis & visualizer
│   │   ├── preprocess.py           # Leak-free ColumnTransformer & data splitters
│   │   ├── train_failure.py        # Model training, validation tuning, & export
│   │   └── evaluate.py             # Held-out test evaluation & reporting
│   └── app/                        # Module 2: FastAPI Backend
│       ├── __init__.py
│       ├── main.py                 # FastAPI application, lifespan hooks, CORS & errors
│       ├── config.py               # Path resolution, environment settings & CORS origins
│       ├── schemas.py              # Pydantic models, friendly aliases & anti-leakage
│       ├── api/
│       │   ├── __init__.py
│       │   ├── health.py           # GET /api/health and GET /api/model/info
│       │   └── predictions.py      # POST /api/predict
│       └── services/
│           ├── __init__.py
│           └── inference.py        # Model loader, dynamic threshold & predictor
└── tests/
    ├── __init__.py
    ├── test_pipeline.py            # Module 1 unit & pipeline tests (9 tests)
    └── test_api.py                 # Module 2 FastAPI integration tests (25 tests)
```

---

## 2. Module 2: FastAPI Backend & Prediction API

### 2.1 API Endpoints Summary

| Method | Endpoint | Description | Sample Status |
| :--- | :--- | :--- | :---: |
| `GET` | `/` | Service root and navigation discovery links | `200 OK` |
| `GET` | `/api/health` | Health check, uptime, model status, and threshold | `200 OK` |
| `GET` | `/api/model/info` | Dynamic audit metadata, performance metrics, limits | `200 OK` |
| `POST` | `/api/predict` | Real-time machine failure prediction from sensor input | `200 OK` |
| `GET` | `/docs` | Interactive Swagger UI documentation | `200 OK` |
| `GET` | `/redoc` | ReDoc alternative documentation | `200 OK` |

### 2.2 Dynamic Metadata Loading
The application never hardcodes model parameters or decision boundaries:
- At startup, `InferenceService` dynamically parses `backend/artifacts/model_metadata.json`.
- The classification threshold is loaded directly from `selected_classification_threshold` (currently **`0.66`**).
- The pipeline artifact `backend/artifacts/failure_pipeline.joblib` is loaded once and cached in memory for sub-millisecond scoring.

### 2.3 Input Features & Flexible Schema Mapping
The API accepts either friendly snake_case keys or the exact AI4I 2020 dataset column names:

| User-Friendly Key | Canonical AI4I Column Name | Type | Valid Range | Physical Meaning |
| :--- | :--- | :---: | :---: | :--- |
| `type` / `Type` | `Type` | string | `L`, `M`, `H` | Machine quality variant |
| `air_temperature` | `Air temperature [K]` | float | 200 - 400 K | Ambient room temperature |
| `process_temperature` | `Process temperature [K]` | float | 200 - 450 K | Cutting zone temperature |
| `rotational_speed` | `Rotational speed [rpm]` | float | 0 - 5000 rpm | Spindle rotational rate |
| `torque` | `Torque [Nm]` | float | 0 - 200 Nm | Cutting torque load |
| `tool_wear` | `Tool wear [min]` | float | 0 - 500 min | Tool wear minutes |

### 2.4 Strict Anti-Leakage Guard
To prevent accidental data leakage:
- If a client payload includes `Machine failure`, `TWF`, `HDF`, `PWF`, `OSF`, `RNF`, `UDI`, or `Product ID`, the API immediately rejects the request with **HTTP 422 Unprocessable Entity**.
- Additional unknown fields are rejected via Pydantic `extra = "forbid"`.
- Physical temperature checks enforce that `process_temperature >= air_temperature`.

### 2.5 CORS Configuration
CORS middleware is pre-configured for modern frontend tooling:
- Allowed origins: `http://localhost:5173` (Vite / React default), `http://127.0.0.1:5173`, `http://localhost:3000`.

---

## 3. How to Run the Application

### 3.1 Start the FastAPI Development Server

From the project root (`e:\AIML CIE`):

```bash
uvicorn backend.app.main:app --reload --host 0.0.0.0 --port 8000
```

The server will start at `http://localhost:8000`.
- Interactive API Docs (Swagger UI): **`http://localhost:8000/docs`**
- ReDoc Docs: **`http://localhost:8000/redoc`**

### 3.2 Sample API Requests

#### A. Health Check (`GET /api/health`)
```bash
curl -X GET http://localhost:8000/api/health
```
**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2026-10-21T13:08:45.123456+00:00",
  "model_loaded": true,
  "model_name": "HistGradientBoosting",
  "model_version": "1.0.0",
  "selected_threshold": 0.66,
  "detail": "MachinePulse AI inference service is fully operational."
}
```

#### B. Failure Prediction (`POST /api/predict`)

**Healthy Machine Example:**
```bash
curl -X POST http://localhost:8000/api/predict \
  -H "Content-Type: application/json" \
  -d '{
    "type": "M",
    "air_temperature": 298.5,
    "process_temperature": 308.7,
    "rotational_speed": 1400.0,
    "torque": 45.0,
    "tool_wear": 50.0
  }'
```
**Response:**
```json
{
  "failure_probability": 0.0124,
  "failure_predicted": false,
  "predicted_class": 0,
  "decision_threshold": 0.66,
  "risk_level": "LOW",
  "recommendation": "NORMAL OPERATING CONDITION: Machine tool healthy (1.2% failure probability). No immediate maintenance action required.",
  "model_name": "HistGradientBoosting",
  "model_version": "1.0.0",
  "timestamp": "2026-10-21T13:08:45.123456+00:00",
  "data_source": "AI4I 2020 Predictive Maintenance Dataset (UCI Machine Learning Repository #601)",
  "features_used": {
    "Type": "M",
    "Air temperature [K]": 298.5,
    "Process temperature [K]": 308.7,
    "Rotational speed [rpm]": 1400.0,
    "Torque [Nm]": 45.0,
    "Tool wear [min]": 50.0
  }
}
```

**High-Stress Failing Machine Example:**
```bash
curl -X POST http://localhost:8000/api/predict \
  -H "Content-Type: application/json" \
  -d '{
    "type": "H",
    "air_temperature": 302.5,
    "process_temperature": 311.5,
    "rotational_speed": 1280.0,
    "torque": 72.0,
    "tool_wear": 235.0
  }'
```
**Response:**
```json
{
  "failure_probability": 0.9412,
  "failure_predicted": true,
  "predicted_class": 1,
  "decision_threshold": 0.66,
  "risk_level": "CRITICAL",
  "recommendation": "IMMINENT BREAKDOWN RISK: Halting spindle rotation recommended immediately. Predicted failure probability is 94.1%. Primary contributing stressors: Tool wear is elevated at 235 min (near standard end-of-life). Cutting torque is unusually high (72.0 Nm). Low rotational speed (1280 rpm) combined with torque load.",
  "model_name": "HistGradientBoosting",
  "model_version": "1.0.0",
  "timestamp": "2026-10-21T13:08:45.123456+00:00",
  "data_source": "AI4I 2020 Predictive Maintenance Dataset (UCI Machine Learning Repository #601)",
  "features_used": {
    "Type": "H",
    "Air temperature [K]": 302.5,
    "Process temperature [K]": 311.5,
    "Rotational speed [rpm]": 1280.0,
    "Torque [Nm]": 72.0,
    "Tool wear [min]": 235.0
  }
}
```

---

## 4. Automated Testing Suite

We provide a comprehensive automated test suite with **34 total passing tests**:
- **9 tests** in `tests/test_pipeline.py`: Feature schema, target validity, anti-leakage, probability shapes, finite bounds, unknown category handling, and joblib loading.
- **25 tests** in `tests/test_api.py`: FastAPI endpoints, health check, dynamic threshold inspection, friendly aliases, original column names, anti-leakage rejection, Pydantic range checks, temperature inversion checks, and missing artifact error handling.

To run the full suite:

```bash
pytest tests/ -v
```

Output:
```text
============================= test session starts =============================
platform win32 -- Python 3.14.2, pytest-9.1.1, pluggy-1.7.0
rootdir: E:\AIML CIE
collected 34 items

tests/test_api.py::test_root_endpoint PASSED                             [  2%]
tests/test_api.py::test_health_endpoint_healthy PASSED                   [  5%]
tests/test_api.py::test_model_info_endpoint PASSED                       [  8%]
tests/test_api.py::test_predict_friendly_field_names PASSED              [ 11%]
tests/test_api.py::test_predict_original_ai4i_column_names PASSED        [ 14%]
tests/test_api.py::test_predict_high_stress_machine PASSED               [ 17%]
tests/test_api.py::test_predict_rejects_leakage_fields[Machine failure] PASSED [ 20%]
...
tests/test_pipeline.py::test_saved_pipeline_can_be_loaded PASSED         [ 85%]
tests/test_pipeline.py::test_prediction_and_probability_shapes PASSED    [ 88%]
tests/test_pipeline.py::test_probability_values_finite_and_bounded PASSED [ 91%]
tests/test_pipeline.py::test_unseen_product_type_handling PASSED         [ 94%]
tests/test_pipeline.py::test_inference_schema_validation PASSED          [ 97%]
tests/test_pipeline.py::test_model_metadata_integrity PASSED             [100%]

============================= 34 passed in 3.88s ==============================
```

---

## 5. Summary of Module 1 ML Performance

For full audit records, the champion model trained in Module 1 is:
- **Architecture**: `HistGradientBoostingClassifier` inside a scikit-learn `Pipeline` (with `OneHotEncoder` and `StandardScaler`).
- **Tuned Threshold**: `0.66` (tuned on validation partition to maximize F1-score).
- **Test Performance (held-out 1,500 test samples)**:
  - **Recall**: `90.20%` (46 of 51 real breakdowns detected)
  - **Precision**: `82.14%` (only 10 false alarms)
  - **F1-Score**: `0.8598`
  - **PR-AUC**: `0.9127`
  - **ROC-AUC**: `0.9838`

---

## 6. Important Note on Remaining Useful Life (RUL)

> [!NOTE]
> AI4I 2020 consists of independent machine observations, not continuous run-to-failure degradation trajectories.  
> Following sound ML engineering principles, **no invented RUL regression labels are trained**. Module 1 and Module 2 focus on high-fidelity failure classification. A wear-budget proxy and genuine run-to-failure RUL model will be handled separately in future modules.
"# MachinePulse-AI" 
