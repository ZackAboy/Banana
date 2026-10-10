# Vision service baseline

This optional service isolates future Python/native vision dependencies and model
lifecycles from Next.js. OCR (PaddleOCR) and visual retrieval (SigLIP/CLIP) will be
independent evidence sources; Gemini remains in the Next.js backend. Next.js does
not call this service yet, and it is not deployed with the Vercel application.

Only `GET /health` exists and returns `{"status":"ok"}`. This means the process
is serving requests, not that any model or inference capability is ready. No ML
packages, weights, image processing, credentials, storage or inference are included.

## Run independently

Use Python 3.10+ for the scaffold; future ML extras may narrow compatibility.
From this directory:

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e '.[dev]'
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Then `curl --fail http://127.0.0.1:8000/health`. FastAPI's API description is at
`/docs`. For runtime-only installation use `python -m pip install -e .`.
The setup follows FastAPI's [isolated environment guidance](https://fastapi.tiangolo.com/virtual-environments/)
and [TestClient testing guidance](https://fastapi.tiangolo.com/tutorial/testing/).
Dependency ranges are intentionally bounded for this health-only scaffold; a
reproducible ML lock and supported interpreter matrix need coordination before
inference integration. Do not install models into the common baseline.

## Validate

```sh
python -m pytest
python -m ruff check .
python -m ruff format --check .
```

Static type checking is not configured. Tests exercise the HTTP health contract
and ensure OpenAPI advertises no inference routes. No external service is called.

## Ownership and future interfaces

- `feature/vision-ocr`: separate OCR service/schema/model-loading modules and tests;
  text detection, recognition, normalization and model/SKU/part extraction.
- `feature/visual-retrieval`: separate retrieval modules and tests; embeddings,
  native similarity scores and ranking using supplied candidate images.
- `app/main.py`, `pyproject.toml`, common transport/configuration and future shared
  schemas are coordinated files. Add optional dependency groups rather than
  independently changing the default install. Do not add Gemini/search or UI work.

Potential future `POST /ocr` and `POST /retrieve` endpoints are design proposals,
not implemented contracts. Agree on multipart bytes, upload bounds/signature and
decode validation, 1-based source image indexes, provenance, timeouts, error
envelopes and cross-language fixtures before implementing them. Preserve raw OCR
observations alongside normalization; inferred identifiers are distinct from
label extractions. Retrieval scores must include metric/provider/index provenance.
See `../ARCHITECTURE.md` for reuse of existing domain contracts and fusion policy.
Deployment/authentication and model readiness are future integration decisions.
YOLO/object detection is explicitly deferred.
