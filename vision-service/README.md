# Local vision service and independent OCR

OCR runs entirely in Python: local pretrained PaddleOCR detects and recognizes
text, then deterministic application logic extracts identifiers. Gemini, Next.js,
retrieval, search, fusion policy and public `ProductIdentification` are unchanged.
No credentials are required.

The shared FastAPI app still exposes only `GET /health` and `/docs`. Health means
process health, not model readiness. **No HTTP inference endpoint or Next.js client
is added.** The inference boundary is
`OcrService.analyze(images: Sequence[bytes]) -> OcrEvidence`, with a local JSON CLI.
This avoids changing the shared entrypoint, default dependencies or unagreed HTTP
transport; those require coordination first.

## Install and run

For health and deterministic tests, the original Python 3.10+ setup remains:

```sh
cd vision-service
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e '.[dev]'
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Then `curl --fail http://127.0.0.1:8000/health` returns `{"status":"ok"}`.
The default installation never imports Paddle or downloads models.

For actual OCR use a **separate CPython 3.11 environment**. Validated locally on
macOS arm64; the default Python 3.14 health environment is not the OCR environment.
Do not overwrite an existing virtualenv with another interpreter. From
`vision-service/` (this environment lives outside the repository):

```sh
python3.11 -m venv "$HOME/.venvs/banana-ocr"
source "$HOME/.venvs/banana-ocr/bin/activate"
python -m pip install -e '.[dev]' -r requirements-ocr.txt
python -m pip check
```

The OCR-only file pins PaddleOCR 3.3.2, PaddleX 3.3.13 (`ocr-core` extra), CPU
PaddlePaddle 3.2.2, and bounded NumPy/Pillow. Transitive dependencies include native
OpenCV, PaddleX image utilities and model-download libraries. The broader PaddleX
`ocr` extra is unnecessary. No torch, GPU runtime, Gemini SDK or LLM is required.
This is not a complete transitive lock; other platforms/interpreters need testing.
Shared `pyproject.toml` and its Python requirement are unchanged.

Models: `PP-OCRv5_mobile_det` and `en_PP-OCRv5_mobile_rec`, small CPU models for
local English labels. They are ordinary detection/recognition models, not
PaddleOCR-VL. See the pinned upstream
[OCR API](https://github.com/PaddlePaddle/PaddleOCR/blob/v3.3.2/docs/version3.x/pipeline_usage/OCR.en.md)
and [recognition models](https://github.com/PaddlePaddle/PaddleOCR/blob/v3.3.2/docs/version3.x/module_usage/text_recognition.en.md).

Imports/loading are lazy. First inference downloads official weights to PaddleX's
user cache (normally `~/.paddlex/official_models/`), **outside git**. Keep the cache
outside the repository; never commit weights. Inference uses local pixels without
uploading images. PaddleX may check host connectivity at initialization; after
provisioning the cache, `DISABLE_MODEL_SOURCE_CHECK=True` skips that check in the
pinned runtime. Each service retains one engine; predictor use is serialized.
A CLI process loads the cached models once for all its images.

## Test a real DualSense rear-label image

Use an upright, focused photo with readable printed text. From `vision-service/`
with the OCR environment active:

```sh
python -m app.services.ocr_cli /absolute/path/dualsense-rear-label.jpg > /tmp/ocr.json
python -m json.tool /tmp/ocr.json
```

Multiple views retain argument order:

```sh
python -m app.services.ocr_cli /absolute/path/front.jpg /absolute/path/rear-label.jpg
```

Indexes are 1-based per invocation; the second file has `source_image_index: 2`.
Conflicts remain independent observations. For `MODEL CFI-ZCT2W`, look for:

```json
{
  "source_image_index": 1,
  "kind": "model_number",
  "value": "CFI-ZCT2W",
  "extraction": "explicit_label",
  "label": "MODEL",
  "label_span": { "region_index": 3, "start": 0, "end": 5 },
  "value_span": { "region_index": 3, "start": 6, "end": 15 }
}
```

The region number depends on OCR output. Its region contains original and
normalized text, polygon and score. This does not establish product identity.

Successful stdout contains only JSON. Diagnostics go to stderr. Errors exit 1
with safe `{ "error": { "code", "message" } }` JSON on stderr, possibly preceded
by upstream diagnostics. Codes: `OCR_INVALID_INPUT`, `OCR_INVALID_IMAGE`,
`OCR_IMAGE_READ_FAILED`, `OCR_UNAVAILABLE`, `OCR_INFERENCE_FAILED`. No mock fallback
or partial success. Empty OCR is explicitly `no_text_detected`.

## Architecture and exact evidence shape

```text
Ordered image bytes -> bounds/decode/EXIF orientation/RGB-to-BGR
  -> lazy CPU PaddleOCR -> raw regions/polygons/engine scores
  -> deterministic labeled identifiers and brand clues -> OcrEvidence JSON
```

Authoritative schema: [app/schemas/ocr.py](app/schemas/ocr.py). A full recorded
**synthetic typeset** example from real inference is
[ocr_typeset_dualsense.json](tests/fixtures/ocr_typeset_dualsense.json). It is a local
fixture, not a coordinated HTTP/TypeScript contract or proof of photo accuracy.
Every field below is emitted; `?` means nullable:

```text
OcrEvidence {
  schema_version: "ocr.v1", source: "paddleocr", engine_version: string,
  detection_model: string, recognition_model: string,
  images: [{
    source_image_index: integer >= 1, width: integer > 0, height: integer > 0,
    coordinate_space: "exif_transposed_pixels",
    outcome: "text_detected" | "no_text_detected",
    label_role: "unknown", label_role_basis: "not_assessed",
    regions: [{
      region_index: integer >= 1, raw_text: string, normalized_text: string,
      polygon: [[x: number, y: number], ...]?,
      recognition_confidence: number in [0, 1]?
    }],
    identifiers: [{
      source_image_index: integer >= 1,
      kind: "model_number" | "sku" | "part_number" | "serial_number",
      value: string, extraction: "explicit_label" | "spatial_label", label: string,
      label_span: { region_index: integer, start: integer, end: integer },
      value_span: { region_index: integer, start: integer, end: integer }
    }],
    brand_clues: [{
      source_image_index: integer >= 1, value: string,
      kind: "brand" | "manufacturer",
      extraction: "explicit_label" | "standalone_allowlist" | "corporate_name",
      value_span: { region_index: integer, start: integer, end: integer }
    }]
  }]
}
```

Region indexes are per image. Spans are half-open Python character offsets in
`normalized_text`, not byte offsets in `raw_text`. Original transcription is
untouched. Polygons use full EXIF-oriented pixels, origin at top left; document
unwarping/orientation models are disabled. Missing engine polygons/scores are null.
Recognition confidence is uncalibrated engine metadata, never product confidence
or a status decision. Label role remains explicitly unknown/not assessed. No final
status, product identity or AI interpretation is emitted.

Inputs: 1–4 static JPEG/PNG/WebP images, at most 3 MiB each, 4 MiB total and
16 megapixels each. Every image is decoded/validated before inference. Images
remain in memory; the CLI does not persist them. Redirected evidence files are
controlled by the local caller.

## Deterministic extraction rules

- Normalize Unicode to NFC and collapse whitespace. Preserve case, leading zeros,
  hyphens, slashes, underscores, periods, plus signs and transcription errors.
  Never repair `O/0`, `I/1` or missing punctuation using product knowledge.
- Require explicit case-insensitive `MODEL`, `MODEL NO[.]`, `MODEL NUMBER`, `SKU`,
  `PART`, `PART NO[.]`, `PART NUMBER`, or `P/N`. SKU number/no labels also work.
  Separators: whitespace, colon/full-width colon, `#`, `=`.
- Values are complete tokens of at least two ASCII letters/digits with internal
  `.`, `_`, `/`, `+`, `-`. Explicit numeric values retain leading zeros. Unlabeled
  model-shaped, numeric and regulatory text remain raw observations. Reserved
  field names cannot become values.
- `SERIAL`, `SERIAL NO[.]`, `SERIAL NUMBER`, `S/N` yield only `serial_number`.
  A serial-shaped value never becomes a model because of its appearance.
- A label-only region may pair with one complete-token region to its right on the
  same row or immediately below, within bounded geometry. Reject ambiguous
  neighbors/competing labels. No cross-image pairing, guessed reading order or
  pairing without boxes. Record separate label/value region spans.
- Brand/manufacturer clues use explicit `BRAND`, `MANUFACTURER`, `MFR` lines or
  exact standalone allowlist matches: Sony, Nintendo, Microsoft, Logitech,
  Samsung, LG, Apple. A leading corporate name ending in `Inc[.]`, `Ltd[.]`, `LLC`,
  `Corp[.]`, `Corporation`, `GmbH` or `Limited` is also a literal manufacturer clue;
  following addresses/serial text are excluded. Preserve literal text. Do not map
  company names to brands, repair misread logos, infer brand from family or
  establish manufacturer-label role from a clue alone.

## Validate

```sh
python -m pytest
python -m ruff check .
python -m ruff format --check .
python -m pip check
```

Default tests never load Paddle or download weights. Extraction, adapter, service
and CLI tests inject observations. Decode tests run with NumPy/Pillow, otherwise
skip. Python static type checking is not configured.

Opt into real inference on a generated typeset label (one model load per session):

```sh
BANANA_RUN_OCR_INTEGRATION=1 python -m pytest tests/test_ocr_integration.py -q
```

For actual Sony photo acceptance, also supply the real rear-label photo:

```sh
BANANA_RUN_OCR_INTEGRATION=1 BANANA_DUALSENSE_IMAGE=/absolute/path/label.jpg python -m pytest tests/test_ocr_integration.py -q
```

The photo test requires visible `SONY`, `WIRELESS CONTROLLER`, and extracted
`model_number: CFI-ZCT2W`, plus a Sony brand/manufacturer clue. Both tests share
one model. No real photo is included; a skipped photo test is not acceptance.

Manual validation on 2026-10-10 used the supplied `IMG_0216.jpg` front view and
`IMG_0217.jpg` rear label. The real-photo acceptance test passed. Ordered two-view
CLI output extracted `CFI-ZCT2W` from image 2, region 21, with label/value spans;
the front view produced no model candidates. The engine read the manufacturer
line but transcribed the logo as `SONYR`; that raw error is preserved, not repaired.
The manufacturer clue uses the literal `Sony Interactive Entertainment Inc.` text.
The source photos and full OCR output are not committed as fixtures.

## Limits and coordination

Small, blurred, curved, rotated or reflective text can be missed/mistranscribed.
English models and ASCII identifier syntax are initial scope. Arbitrary rotations,
multiline/space-containing identifiers, unknown unlabeled brands and complex split
layouts are not repaired or inferred. Runtime inference has no hard deadline;
there is no OCR HTTP worker, deployment/authentication or readiness policy yet.

- `TODO(Fusion)` in the service: agree on versioned cross-language fixtures,
  transport/error validation before consumption. Maintainers establish label role,
  reconcile brands/models/variants/conflicts and own status decisions. The
  CFI-ZCT2W likely/confirmed limitation remains deliberately unchanged.
- Maintainers and Visual Retrieval: coordinate optional dependencies, supported
  interpreters, reproducible locks, readiness/timeouts and shared HTTP transport
  before changing `app/main.py` or `pyproject.toml`. Those files and existing health
  tests are untouched here.
- No assumptions about retrieval implementation or candidate discovery. Next.js
  still runs independently and retains its explicit live/mock behavior.
