"""Explicitly opt-in real inference; one lazily loaded model for this module."""

import json
import math
import os
from io import BytesIO
from pathlib import Path

import pytest

from app.models.retrieval import SIGLIP_MODEL, SiglipImageEncoder
from app.schemas.retrieval import CandidateImage, RetrievalImage
from app.services.retrieval import VisualRetrievalService

pytestmark = pytest.mark.skipif(
    os.getenv("BANANA_RUN_RETRIEVAL_INTEGRATION") != "1",
    reason="Set BANANA_RUN_RETRIEVAL_INTEGRATION=1; install retrieval dependencies",
)


@pytest.fixture(scope="module")
def service():
    return VisualRetrievalService(SiglipImageEncoder())


def test_real_embedding_repeatability_and_identical_image_ranking(service):
    # Generated pixels are a smoke test, not real product acceptance.
    from PIL import Image, ImageDraw

    image = Image.new("RGB", (320, 240), "white")
    ImageDraw.Draw(image).ellipse((30, 50, 290, 190), fill="red")
    stream = BytesIO()
    image.save(stream, format="PNG")
    query = RetrievalImage("generated-query", stream.getvalue())
    other = BytesIO()
    Image.new("RGB", (320, 240), "blue").save(other, format="PNG")
    embedding = service.embed_image(query)
    assert embedding.model == SIGLIP_MODEL
    assert len(embedding.vector) == 768
    assert all(math.isfinite(value) for value in embedding.vector)
    assert math.fsum(value * value for value in embedding.vector) == pytest.approx(1)
    assert embedding == service.embed_image(query)
    result = service.rank(
        [query],
        [
            CandidateImage("different", RetrievalImage("other", other.getvalue())),
            CandidateImage("identical", RetrievalImage("same", query.data)),
        ],
    )
    assert result.candidates[0].candidate_id == "identical"
    assert result.candidates[0].similarity == pytest.approx(1)
    assert result.candidates[0].similarity > result.candidates[1].similarity


@pytest.mark.skipif(
    not os.getenv("BANANA_RETRIEVAL_ACCEPTANCE_MANIFEST"),
    reason="Supply a local real-photo acceptance manifest; see RETRIEVAL.md",
)
def test_real_product_acceptance_single_and_multiple_views(service):
    manifest = json.loads(
        Path(os.environ["BANANA_RETRIEVAL_ACCEPTANCE_MANIFEST"]).read_text()
    )
    queries = [
        RetrievalImage(f"query-{i}", Path(path).read_bytes())
        for i, path in enumerate(manifest["queries"], start=1)
    ]
    candidates = [
        CandidateImage(key, RetrievalImage(key, Path(path).read_bytes()))
        for key, path in manifest["candidates"].items()
    ]
    assert len(queries) >= 1
    assert manifest["matching_candidate_id"] != manifest["unrelated_candidate_id"]
    for views in ([queries[0]], queries):
        result = service.rank(views, candidates)
        scores = {
            candidate.candidate_id: candidate.similarity
            for candidate in result.candidates
        }
        assert (
            scores[manifest["matching_candidate_id"]]
            > scores[manifest["unrelated_candidate_id"]]
        )
