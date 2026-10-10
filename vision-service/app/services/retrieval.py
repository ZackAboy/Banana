"""Independent image embeddings, deterministic cosine and supplied-candidate ranking."""

import math
import warnings
from collections.abc import Sequence
from io import BytesIO

from app.models.retrieval import ImageEncoder, RetrievalError, SiglipImageEncoder
from app.schemas.retrieval import (
    CandidateEmbedding,
    CandidateImage,
    ImageEmbedding,
    QueryImageReference,
    QuerySimilarity,
    RankedVisualCandidate,
    RetrievalEvidence,
    RetrievalImage,
)

MAX_QUERY_IMAGES = 4
MAX_CANDIDATES = 64
MAX_IMAGE_BYTES = 3 * 1024 * 1024
MAX_TOTAL_BYTES = 64 * 1024 * 1024
MAX_PIXELS = 16_000_000


def normalize_vector(vector: Sequence[float]) -> tuple[float, ...]:
    """Stable L2 normalization, including very large/small finite components."""
    try:
        values = tuple(float(value) for value in vector)
    except (TypeError, ValueError, OverflowError) as exc:
        raise RetrievalError(
            "RETRIEVAL_INVALID_VECTOR", "Expected a one-dimensional numeric vector."
        ) from exc
    if not values or not all(math.isfinite(value) for value in values):
        raise RetrievalError(
            "RETRIEVAL_INVALID_VECTOR", "Vectors must be nonempty and finite."
        )
    scale = max(map(abs, values))
    if scale == 0:
        raise RetrievalError("RETRIEVAL_INVALID_VECTOR", "Zero vectors are invalid.")
    scaled = tuple(value / scale for value in values)
    norm = math.sqrt(math.fsum(value * value for value in scaled))
    return tuple(value / norm for value in scaled)


def cosine_similarity(left: Sequence[float], right: Sequence[float]) -> float:
    if len(left) != len(right):
        raise RetrievalError(
            "RETRIEVAL_DIMENSION_MISMATCH", "Vector dimensions must match."
        )
    a, b = normalize_vector(left), normalize_vector(right)
    # Clamp floating point roundoff only. No sigmoid/softmax or confidence mapping.
    return max(-1.0, min(1.0, math.fsum(x * y for x, y in zip(a, b))))


def _validate_id(value: str, description: str) -> None:
    if not isinstance(value, str) or not value.strip() or len(value) > 200:
        raise RetrievalError(
            "RETRIEVAL_INVALID_INPUT", f"{description} must have 1–200 characters."
        )


def _validate_candidates(candidate_ids: Sequence[str]) -> None:
    if not 1 <= len(candidate_ids) <= MAX_CANDIDATES:
        raise RetrievalError("RETRIEVAL_INVALID_INPUT", "Supply 1–64 candidate images.")
    for candidate_id in candidate_ids:
        _validate_id(candidate_id, "Candidate ID")
    if len(set(candidate_ids)) != len(candidate_ids):
        raise RetrievalError(
            "RETRIEVAL_DUPLICATE_CANDIDATE", "Candidate IDs must be unique."
        )


def rank_embeddings(
    queries: Sequence[ImageEmbedding], candidates: Sequence[CandidateEmbedding]
) -> RetrievalEvidence:
    """Mean per-view cosine; exact ties use ascending case-sensitive candidate ID."""
    _validate_candidates([candidate.candidate_id for candidate in candidates])
    if not 1 <= len(queries) <= MAX_QUERY_IMAGES:
        raise RetrievalError("RETRIEVAL_INVALID_INPUT", "Supply 1–4 query images.")
    if len({query.image_id for query in queries}) != len(queries):
        raise RetrievalError(
            "RETRIEVAL_INVALID_INPUT", "Query image IDs must be unique."
        )
    model = queries[0].model
    all_embeddings = [*queries, *(candidate.embedding for candidate in candidates)]
    for embedding in all_embeddings:
        _validate_id(embedding.image_id, "Image ID")
        if embedding.model != model:
            raise RetrievalError(
                "RETRIEVAL_MODEL_MISMATCH", "Use the same encoder for every image."
            )
        if len(embedding.vector) != model.embedding_dimension:
            raise RetrievalError(
                "RETRIEVAL_DIMENSION_MISMATCH", "Vector does not match model dimension."
            )
        normalize_vector(embedding.vector)
    scored = []
    for candidate in candidates:
        scores = tuple(
            QuerySimilarity(
                source_image_index=index,
                similarity=cosine_similarity(query.vector, candidate.embedding.vector),
            )
            for index, query in enumerate(queries, start=1)
        )
        scored.append(
            (math.fsum(s.similarity for s in scores) / len(scores), candidate, scores)
        )
    scored.sort(key=lambda item: (-item[0], item[1].candidate_id))
    # TODO(Fusion): coordinate versioned cross-language fixtures/transport before
    # consumption. Similarity is retrieval evidence; Fusion owns identity/status.
    return RetrievalEvidence(
        model=model,
        query_images=tuple(
            QueryImageReference(
                source_image_index=index,
                image_id=query.image_id,
                source_url=query.source_url,
            )
            for index, query in enumerate(queries, start=1)
        ),
        candidates=tuple(
            RankedVisualCandidate(
                candidate_id=candidate.candidate_id,
                image_id=candidate.embedding.image_id,
                source_url=candidate.embedding.source_url,
                rank=rank,
                similarity=score,
                query_similarities=scores,
                model=model,
            )
            for rank, (score, candidate, scores) in enumerate(scored, start=1)
        ),
    )


def _validate_image(image: RetrievalImage) -> None:
    _validate_id(image.image_id, "Image ID")
    if not isinstance(image.data, bytes) or not 1 <= len(image.data) <= MAX_IMAGE_BYTES:
        raise RetrievalError(
            "RETRIEVAL_INVALID_INPUT",
            "Supply nonempty image bytes, at most 3 MiB each.",
        )
    if image.source_url is not None and (
        not isinstance(image.source_url, str)
        or not image.source_url.startswith(("https://", "http://"))
    ):
        raise RetrievalError("RETRIEVAL_INVALID_INPUT", "Source URL must use HTTP(S).")


def decode_image(data: bytes):
    """Validate static JPEG/PNG/WebP; return EXIF-oriented RGB pixels in memory."""
    if not isinstance(data, bytes) or not 1 <= len(data) <= MAX_IMAGE_BYTES:
        raise RetrievalError("RETRIEVAL_INVALID_INPUT", "Invalid image byte length.")
    try:
        from PIL import Image, ImageOps
    except ImportError as exc:
        raise RetrievalError(
            "RETRIEVAL_UNAVAILABLE", "Install the optional retrieval dependencies."
        ) from exc
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as image:
                if image.format not in {"JPEG", "PNG", "WEBP"}:
                    raise ValueError("Unsupported format")
                if image.width * image.height > MAX_PIXELS:
                    raise ValueError("Too many pixels")
                if getattr(image, "n_frames", 1) != 1:
                    raise ValueError("Animated image")
                image.load()
                return ImageOps.exif_transpose(image).convert("RGB")
    except Exception as exc:
        raise RetrievalError(
            "RETRIEVAL_INVALID_IMAGE",
            "Use a decodable, static JPEG/PNG/WebP of at most 16 megapixels.",
        ) from exc


class VisualRetrievalService:
    def __init__(self, encoder: ImageEncoder | None = None):
        self._encoder = encoder if encoder is not None else SiglipImageEncoder()

    def embed_image(self, image: RetrievalImage) -> ImageEmbedding:
        _validate_image(image)
        with decode_image(image.data) as pixels:
            vector = normalize_vector(self._encoder.encode(pixels))
        if len(vector) != self._encoder.metadata.embedding_dimension:
            raise RetrievalError(
                "RETRIEVAL_DIMENSION_MISMATCH",
                "Encoder returned an unexpected dimension.",
            )
        return ImageEmbedding(
            image_id=image.image_id,
            source_url=image.source_url,
            model=self._encoder.metadata,
            vector=vector,
        )

    def rank(
        self, queries: Sequence[RetrievalImage], candidates: Sequence[CandidateImage]
    ) -> RetrievalEvidence:
        # TODO(ProductSearch): at integration, supply existing ProductCandidate
        # IDs and acquired image bytes/URLs through an agreed caller interface.
        _validate_candidates([candidate.candidate_id for candidate in candidates])
        if not 1 <= len(queries) <= MAX_QUERY_IMAGES:
            raise RetrievalError("RETRIEVAL_INVALID_INPUT", "Supply 1–4 query images.")
        if len({query.image_id for query in queries}) != len(queries):
            raise RetrievalError(
                "RETRIEVAL_INVALID_INPUT", "Query image IDs must be unique."
            )
        images = [*queries, *(candidate.image for candidate in candidates)]
        for image in images:
            _validate_image(image)
        if sum(len(image.data) for image in images) > MAX_TOTAL_BYTES:
            raise RetrievalError("RETRIEVAL_INVALID_INPUT", "Use at most 64 MiB total.")
        # Validate all images before any model load/inference. Decode again one at
        # a time during embedding to keep full-resolution pixel memory bounded.
        for image in images:
            with decode_image(image.data):
                pass
        query_embeddings = [self.embed_image(query) for query in queries]
        candidate_embeddings = [
            CandidateEmbedding(
                candidate.candidate_id, self.embed_image(candidate.image)
            )
            for candidate in candidates
        ]
        return rank_embeddings(query_embeddings, candidate_embeddings)
