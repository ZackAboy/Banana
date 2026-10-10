# Independent visual retrieval

This milestone compares supplied image bytes entirely inside `vision-service`.
It emits visual similarity evidence, with no product identification, candidate
discovery, Gemini, OCR, Lens, search, shopping, reviews or UI integration. The
shared FastAPI app remains health-only. No HTTP inference endpoint, Next.js
client, shared/public contract, default dependency or OCR file changed.

## Model investigation and selection

Selected **SigLIP**, `google/siglip-base-patch16-224`, pinned to Hugging Face
revision `7fd15f0689c79d79e38b1c2e2e2370a7bf2761ed`. The image embedding has
**768 dimensions**. Only `SiglipVisionModel` and `SiglipImageProcessor` run;
there is no tokenizer, text inference, prompt or label list.

| Option evaluated     | Checkpoint download                                    | Dimensions | Decision                                                                                                         |
| -------------------- | ------------------------------------------------------ | ---------- | ---------------------------------------------------------------------------------------------------------------- |
| SigLIP base/16, 224  | 812,672,320 bytes (~813 MB / 775 MiB), safetensors     | 768        | Selected: manageable local baseline, 16-pixel patches, explicit Apache 2.0 license                               |
| SigLIP2 base/16, 224 | 1,500,800,904 bytes (~1.5 GB), safetensors             | 768        | Same image resolution; larger bundled text vocabulary/artifact, without demonstrated benefit on our products yet |
| OpenAI CLIP ViT-B/32 | 605,247,071 bytes (~605 MB), upstream PyTorch artifact | 512        | Smaller and fewer image tokens; coarser 32-pixel patches. A useful future speed/quality comparison               |

The finer patches are a practical reason to try SigLIP for product appearance,
not evidence that it outperforms CLIP on this application's products. No comparative
product benchmark or SigLIP2 inference was run. DINOv2 and other image-only models
were not added: there is no measured advantage here that justifies another stack.

Primary sources: [SigLIP model/license](https://huggingface.co/google/siglip-base-patch16-224),
[SigLIP artifact](https://huggingface.co/google/siglip-base-patch16-224/blob/7fd15f0689c79d79e38b1c2e2e2370a7bf2761ed/model.safetensors),
[SigLIP2 model/config](https://huggingface.co/google/siglip2-base-patch16-224),
[SigLIP2 artifact](https://huggingface.co/google/siglip2-base-patch16-224/blob/main/model.safetensors),
[CLIP model/config](https://huggingface.co/openai/clip-vit-base-patch32),
[CLIP MIT license](https://github.com/openai/CLIP/blob/main/LICENSE),
[pinned SigLIP implementation](https://github.com/huggingface/transformers/blob/v4.57.6/src/transformers/models/siglip/modeling_siglip.py).

The chosen checkpoint is Apache 2.0 licensed; retain applicable license/notices
when distributing it. It is a general pretrained model, not a validated exact-SKU
matcher. Local inference has no API charge or key requirement. CPU and Apple MPS
both ran successfully; CPU is the explicit default, with no automatic device
selection or fallback. Other accelerators/platforms are not validated here.

## Optional installation, cache and deployment

Keep retrieval in its own environment. From `vision-service/`:

```sh
python3.11 -m venv "$HOME/.venvs/banana-retrieval"
source "$HOME/.venvs/banana-retrieval/bin/activate"
python -m pip install -e '.[dev]' -r requirements-retrieval.txt
python -m pip check
```

The shared `pyproject.toml`, Python 3.10+ baseline and OCR requirements are untouched.
Real inference was validated on CPython 3.11.15 / macOS arm64. The unchanged
Python 3.14 health/default environment also passes its deterministic tests; this
does not validate ML installation on Python 3.14.

Packages added only to `requirements-retrieval.txt`:

- `torch==2.10.0`: local FP32 tensor inference on CPU/MPS.
- `transformers==4.57.6`: checkpoint loading and official SigLIP image preprocessing.
- `numpy>=1.26,<3`: image processor arrays.
- `Pillow>=11,<13`: image decode, EXIF orientation and RGB conversion.

Transformers brings Hugging Face Hub, safetensors and tokenizers transitively,
although no tokenizer is instantiated. No torchvision, OpenCLIP, timm, sentencepiece,
accelerate, vector database or hosted inference package is added. This is not a
full transitive lock. The observed NumPy/Pillow versions were 2.4.6 / 12.3.0.

Imports and construction do not import these ML packages or load weights. First
embedding loads the processor and model at the pinned revision. The upstream
safetensors file contains both towers, so downloading it still requires ~813 MB;
only the vision tower is instantiated. Missing/mismatched vision weights fail
initialization instead of leaving random parameters. One encoder retains one
model, with a lock serializing loading and inference. Reuse a service across calls.
There is no global model singleton and no persistent image/embedding cache.

Hugging Face uses its normal user cache, ordinarily `~/.cache/huggingface/hub`,
outside this repository. Standard `HF_HOME` can relocate it outside git. Provision
the pinned snapshot once, then use CLI `--local-files-only` (or the encoder's
`local_files_only=True`) for offline operation. This fails explicitly if missing.
No image is uploaded. Images and vectors remain in memory unless the local caller
explicitly saves CLI output. No gitignore change was necessary.

Observed disk use: ~789 MiB for the optional environment plus ~775 MiB for the
checkpoint cache. Allow roughly 2–3 GB including installation/cache overhead.
Download bandwidth, interpreter and platform can change these requirements.
On Linux, PyPI torch may install CUDA dependencies; use an appropriate official
CPU wheel for a CPU deployment rather than assuming macOS installation size.

This is an optional local Python primitive, outside the Next.js/Vercel deployment.
Future hosting needs a persistent model cache, adequate RAM and a reused worker.
Every worker/encoder instance can duplicate model memory. HTTP transport, worker
timeouts, authentication, readiness and concurrency policy need coordination
before deployment; none is introduced here.

## Architecture and internal interface

```text
Supplied ordered query views + supplied candidate images
  -> validate IDs, counts, bytes and every image before inference
  -> EXIF transpose -> RGB -> official bicubic 224x224 SigLIP preprocessing
  -> one lazy image-only encoder in eval / inference mode, FP32, eager attention
  -> pooled image vector -> finite, stable L2 normalization
  -> cosine for each query view against each candidate
  -> arithmetic mean across query views
  -> descending score; exact ties by ascending candidate ID
  -> versioned internal retrieval evidence, with per-view scores and provenance
```

Modules:

- `app/models/retrieval.py`: `ImageEncoder` protocol, checkpoint definition, lazy
  `SiglipImageEncoder`, safe internal `RetrievalError`.
- `app/schemas/retrieval.py`: immutable local image/embedding/evidence records.
- `app/services/retrieval.py`: validation, normalization, cosine and ranking.
- `app/services/retrieval_cli.py`: local file reads and JSON output only.

The service interface is:

```python
VisualRetrievalService(encoder: ImageEncoder | None = None)
service.embed_image(image: RetrievalImage) -> ImageEmbedding
service.rank(
    queries: Sequence[RetrievalImage],
    candidates: Sequence[CandidateImage],
) -> RetrievalEvidence
```

`RetrievalImage(image_id, data: bytes, source_url=None)` preserves caller identity
and an optional supplied HTTP(S) image URL. `CandidateImage(candidate_id, image)`
associates that image with an opaque candidate ID. URLs are provenance only, never
fetched. The CLI generates ordered `query-1`, `candidate-1`, etc. image IDs and
emits null URLs; a Python caller can supply URLs. No local absolute path is emitted.

`embed_image` returns `{ image_id, source_url, model, vector }`, where `vector` is a
finite normalized tuple of exactly `model.embedding_dimension` floats. It does
not persist it. `CandidateEmbedding(candidate_id, embedding)` and
`rank_embeddings(queries, candidates)` also allow deterministic ranking of vectors
already produced through the same encoder. Model/revision/preprocessing mismatches
are rejected even when dimensions happen to match.

The exact JSON ranking shape is below. Every listed field is emitted. Arrays
are tuples internally; `source_url` is nullable. Embeddings are omitted from this
ranking output.

```text
ModelProvenance {
  model_family: "siglip",
  checkpoint: "google/siglip-base-patch16-224",
  revision: "7fd15f0689c79d79e38b1c2e2e2370a7bf2761ed",
  embedding_dimension: 768,
  preprocessing: "exif_transpose_rgb;siglip_bicubic_resize_224;mean_std_0.5"
}
RetrievalEvidence {
  schema_version: "retrieval.v1",
  source: "visual_retrieval",
  metric: "cosine",
  aggregation: "mean_query_cosine",
  tie_break: "candidate_id_ascending",
  model: ModelProvenance,
  query_images: [{ source_image_index: integer >= 1, image_id: string, source_url: string? }],
  candidates: [{
    candidate_id: string,
    image_id: string,
    source_url: string?,
    rank: integer >= 1,
    similarity: number in [-1, 1],
    query_similarities: [{ source_image_index: integer >= 1, similarity: number in [-1, 1] }],
    model: ModelProvenance
  }]
}
```

## Ranking, determinism and validation

For candidate `c` and `n` query views, `score(c) = sum(cosine(q_i, c)) / n`.
Every view has equal weight. Individual scores and 1-based query indexes remain
available. This is the mean of separate cosine scores, not cosine against a
renormalized mean embedding. No softmax, sigmoid, threshold, product confidence
or confirmed/likely/uncertain decision is applied.

Ranking is descending full-precision score. Exact ties use case-sensitive Python
string order of candidate IDs (for example `A`, `a`, `b`); ranks are consecutive
1-based positions. Near ties are not rounded into ties. Duplicate candidate IDs
are rejected, including when their images differ. Different IDs may intentionally
have identical images. Query image IDs must also be unique within the invocation.

Normalization scales by the largest absolute component before computing the L2
norm to avoid overflow/underflow. Cosine normalizes inputs, uses `math.fsum`, and
clamps floating point roundoff to [-1, 1]. Pure math/ranking are deterministic.
The model uses fixed preprocessing, FP32, eval/inference mode and eager attention,
with no random augmentation. Repeated CPU and MPS embeddings were bit-identical
within each tested runtime/device. Bit equality across hardware/library versions
is not promised; MPS and CPU results can differ slightly. Do not mix checkpoints.

Internal limits: 1–4 query views, 1–64 candidates, one image per candidate, at most
3 MiB/image, 64 MiB total and 16 megapixels/image. Only static JPEG/PNG/WebP decode.
These are local retrieval limits, not a new upload/HTTP contract. All images are
validated before expensive inference; they are decoded again one at a time to
avoid retaining all full-resolution pixel arrays.

Clear error codes:

- `RETRIEVAL_INVALID_INPUT`: empty/oversized bytes, invalid IDs/counts/URLs,
  duplicate query IDs or invalid device.
- `RETRIEVAL_INVALID_IMAGE`: corrupt/truncated, animated, unsupported or oversized pixels.
- `RETRIEVAL_INVALID_VECTOR`: empty, zero, nonnumeric or non-finite vectors.
- `RETRIEVAL_DIMENSION_MISMATCH`: incompatible vectors or encoder dimension.
- `RETRIEVAL_MODEL_MISMATCH`: incompatible model provenance.
- `RETRIEVAL_DUPLICATE_CANDIDATE`: repeated candidate ID.
- `RETRIEVAL_IMAGE_READ_FAILED`: unreadable local file (CLI).
- `RETRIEVAL_UNAVAILABLE`: initialization, dependencies, cache or device unavailable.
- `RETRIEVAL_INFERENCE_FAILED`: encoder inference failure.

Failures do not yield mocks or partial rankings. Successful CLI stdout is only
JSON; errors exit 1 with `{ "error": { "code", "message" } }` on stderr. Upstream
diagnostics may precede error JSON on stderr. Argparse usage errors exit 2.

## Manual CLI and opt-in real-image acceptance

With the optional environment active, from `vision-service/`:

```sh
python -m app.services.retrieval_cli \
  --query /path/to/controller-front.jpg \
  --candidate A /path/to/white-dualsense.jpg \
  --candidate B /path/to/dualsense-edge.jpg \
  --candidate C /path/to/unrelated-product.jpg
```

Add another query view and use an already provisioned cache:

```sh
python -m app.services.retrieval_cli \
  --query /path/to/controller-front.jpg \
  --query /path/to/controller-rear.jpg \
  --candidate A /path/to/white-dualsense.jpg \
  --candidate B /path/to/dualsense-edge.jpg \
  --candidate C /path/to/unrelated-product.jpg \
  --local-files-only
```

Add `--device mps` to explicitly select Apple GPU inference. No product names
are passed to the encoder. IDs A/B/C do not influence scores.

Default tests never load or download the real model:

```sh
python -m pytest
python -m pytest tests/test_retrieval_vectors.py tests/test_retrieval_encoder.py tests/test_retrieval_service.py tests/test_retrieval_cli.py -q
python -m ruff check .
python -m ruff format --check .
python -m pip check
```

Math/ranking/lifecycle tests run with the shared dev install alone. Decode/service/CLI
tests use Pillow and skip if absent. Two opt-in integration tests share one encoder:

```sh
BANANA_RUN_RETRIEVAL_INTEGRATION=1 python -m pytest tests/test_retrieval_integration.py -q
```

That runs a generated-pixel smoke test for finite normalized embeddings, exact
repeatability and identical-image ranking. Product acceptance additionally needs
a local manifest, which is not committed:

```json
{
  "queries": ["/path/to/controller-front.jpg", "/path/to/controller-rear.jpg"],
  "candidates": {
    "A": "/path/to/white-dualsense.jpg",
    "B": "/path/to/dualsense-edge.jpg",
    "C": "/path/to/unrelated-product.jpg"
  },
  "matching_candidate_id": "A",
  "unrelated_candidate_id": "C"
}
```

```sh
BANANA_RUN_RETRIEVAL_INTEGRATION=1 BANANA_RETRIEVAL_ACCEPTANCE_MANIFEST=/path/to/manifest.json python -m pytest tests/test_retrieval_integration.py -q
```

The acceptance test asserts the matching candidate beats the unrelated candidate
for the first query view and all supplied views. It makes no claim that the model
reliably distinguishes every related variant. The manifest can test any product;
no DualSense knowledge or expected-score constants appear in the implementation.

## Recorded local validation and limitations

Validated 2026-10-10 on Apple M4 Pro (14 CPU cores, 24 GiB RAM), CPython 3.11.15,
torch 2.10.0 and Transformers 4.57.6. Actual query photos were the available
`IMG_0216.jpg` front view (with thumbstick covers) and `IMG_0217.jpg` rear view of
the same physical white controller. Candidate files were saved locally from
official PlayStation images for validation only:

- A: [white DualSense front image](https://gmedia.playstation.com/is/image/SIEPDC/dualsense-controller-image-block-01-ps5-26jun20?wid=1000&fmt=jpeg&bgc=ffffff), 1000x667 JPEG.
- B: [DualSense Edge angled image](https://gmedia.playstation.com/is/image/SIEPDC/DualSense-Edge-image-block-02-en-24aug22?wid=1000&fmt=jpeg&bgc=ffffff), 1000x563 JPEG.
- C: [PULSE Elite headset image](https://gmedia.playstation.com/is/image/SIEPDC/Pulse-Elite-headset-features-image-block-02-en-14sep23?wid=1000&fmt=jpeg&bgc=ffffff), 1000x563 JPEG.

These are official product renders, not additional user photographs. They were
visually checked and never supplied as text labels to the model. Downloads were
test preparation outside the repository; no fetching/search code was added.
Neither photos, renders, manifest, generated embeddings nor output artifacts are
committed. Candidate SHA256 hashes, respectively:

```text
A 432a6fc07fea0955140c8ed7ebb69d44539802c64225e97dcecae61dc4c0da6a
B c4df47be397507769e04b60a3acb6a50f0ed0154130b407ed1dcbd1d599e7eb7
C 2a7bf0782cb6994a0247791bc4ac814fd7be70a00beed67e6e43d813a82a6774
```

CPU CLI results (rounded here only; output retains full precision):

| Query views              | Ranking and cosine scores          |
| ------------------------ | ---------------------------------- |
| Front                    | A 0.845616, B 0.828830, C 0.560949 |
| Front + rear, equal mean | B 0.801348, A 0.799034, C 0.566394 |

The same-product candidate beats the clearly unrelated candidate in both runs.
**The extra rear view changes the order of the two related controllers.** This is
an observed limitation, not corrected with weights or product-specific logic.
One case is not an accuracy benchmark. Background, view, lighting, accessories,
224-pixel resizing and near-identical variants can alter rankings. The encoder
does not establish exact SKU, condition or identity, even with high cosine.

Observed inference including decode/preprocessing of the actual front photo:
cached CPU initialization + first embedding ~1.01 s, warm calls ~0.112–0.116 s;
CPU peak RSS ~907 MB. A first-ever synthetic-image run including download/import/
loading took ~17.2 s and peaked ~1.01 GB RSS. Warm 224-pixel synthetic CPU inference
was ~50 ms. Actual-photo MPS warm calls were ~80–83 ms, with ~372 MB tensor
allocation and ~424 MB Metal driver allocation. RSS alone does not capture all
MPS memory; reserve memory beyond these observations for decode and workers.
These are local observations, not throughput guarantees.

Validation results:

- Retrieval deterministic tests: **57 passed**, real tests disabled/skipped.
- Full Python suite in retrieval environment: **137 passed, 4 skipped** (OCR and
  retrieval integration opt-ins). Existing TestClient deprecation warning only.
- Unmodified Python 3.14 default environment: **105 passed, 7 skipped**; optional
  image-decode suites/dependencies absent. Dependency consistency passed there too.
- Opt-in real retrieval tests with acceptance manifest: **2 passed**; one shared
  real model, covering synthetic smoke and single/multiple real query views.
- CPU and MPS real inference both passed; exact repeatability observed per device.
- Ruff lint and format: passed for the entire Python service.
- `pip check`: passed in default and retrieval environments.
- JS/TS: **66 tests passed**; `npm run typecheck`, `npm run lint` and production
  `npm run build` passed using Node 24.21.0 and explicit mock build mode.
- Existing Chromium browser tests: **6 passed** against the fresh production build.
- Repository `npm run format:check` and `git diff --check`: passed. New untracked
  files were also checked explicitly for diff whitespace errors.
- Python static type checking: not configured; not run.

## Handoff and coordination

Exact added files (no existing tracked file was modified):

```text
vision-service/RETRIEVAL.md
vision-service/requirements-retrieval.txt
vision-service/app/models/retrieval.py
vision-service/app/schemas/retrieval.py
vision-service/app/services/retrieval.py
vision-service/app/services/retrieval_cli.py
vision-service/tests/test_retrieval_vectors.py
vision-service/tests/test_retrieval_encoder.py
vision-service/tests/test_retrieval_service.py
vision-service/tests/test_retrieval_cli.py
vision-service/tests/test_retrieval_integration.py
```

Shared/public contracts changed: **None**. No push or deployment is included.

- Assumption about Product Search: it will eventually supply candidate IDs and
  image bytes/URLs through an agreed boundary; this service does not discover them.
  `TODO(ProductSearch)`: agree on candidate-image acquisition/transport and map
  opaque IDs back to existing `ProductCandidate` records when integration is assigned.
- `TODO(Fusion)` in `app/services/retrieval.py`: agree on a versioned fixture,
  Python/TypeScript validation and transport before consuming native scores.
  Fusion owns interpretation and all identity/status/variant/conflict decisions.
- OCR: no dependency or implementation assumption. Before combining environments,
  coordinate native ML versions, memory, reproducible dependencies and concurrency.
- Main/maintainers: review this isolated primitive first. Shared transport,
  orchestration/provider changes and deployment policy require a separate agreed
  integration. No other branch must merge first to run this CLI.
