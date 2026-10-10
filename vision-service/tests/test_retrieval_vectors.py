"""Pure math/ranking tests: standard library and internal schemas only."""

import math

import pytest

from app.models.retrieval import RetrievalError
from app.schemas.retrieval import CandidateEmbedding, ImageEmbedding, ModelProvenance
from app.services.retrieval import (
    cosine_similarity,
    normalize_vector,
    rank_embeddings,
)

MODEL = ModelProvenance(
    model_family="test",
    checkpoint="test/checkpoint",
    revision="fixed",
    embedding_dimension=2,
    preprocessing="test",
)


def embedding(vector, image_id="query", model=MODEL):
    return ImageEmbedding(
        image_id=image_id,
        source_url=f"https://example.com/{image_id}.jpg",
        model=model,
        vector=tuple(vector),
    )


def candidate(candidate_id, vector, model=MODEL):
    return CandidateEmbedding(candidate_id, embedding(vector, candidate_id, model))


@pytest.mark.parametrize("scale", [1, 1e308, 1e-308])
def test_normalization_is_finite_unit_length_and_does_not_mutate(scale):
    values = [0.3 * scale, 0.4 * scale]
    original = values.copy()
    result = normalize_vector(values)
    assert result == pytest.approx((0.6, 0.8))
    assert math.fsum(value * value for value in result) == pytest.approx(1)
    assert values == original
    assert result == normalize_vector(values)


@pytest.mark.parametrize(
    ("left", "right", "expected"),
    [
        ([3, 4], [3, 4], 1),
        ([1, 0], [0, 1], 0),
        ([3, 4], [-3, -4], -1),
        ([1, 0], [1, 1], 1 / math.sqrt(2)),
        ([3, 4], [6, 8], 1),
    ],
)
def test_cosine_is_scale_invariant_and_not_confidence(left, right, expected):
    assert cosine_similarity(left, right) == pytest.approx(expected)
    assert cosine_similarity(left, right) == cosine_similarity(right, left)


@pytest.mark.parametrize(
    "vector",
    [
        [],
        [0, 0],
        [float("nan"), 1],
        [float("inf"), 1],
        [-float("inf"), 0],
        [[1, 2]],
        ["bad", 1],
    ],
)
def test_invalid_vectors(vector):
    with pytest.raises(RetrievalError) as error:
        normalize_vector(vector)
    assert error.value.code == "RETRIEVAL_INVALID_VECTOR"


def test_invalid_dimensions():
    with pytest.raises(RetrievalError, match="dimensions must match"):
        cosine_similarity([1, 0], [1])
    with pytest.raises(RetrievalError, match="model dimension"):
        rank_embeddings([embedding([1])], [candidate("A", [1, 0])])


def test_cosine_rejects_zero_and_nonfinite_vectors():
    for invalid in ([0, 0], [float("nan"), 1], [float("inf"), 1]):
        with pytest.raises(RetrievalError):
            cosine_similarity([1, 0], invalid)


def test_ranking_preserves_identity_provenance_and_native_scores():
    queries = [embedding([1, 0])]
    candidates = [
        candidate("opposite", [-1, 0]),
        candidate("same", [2, 0]),
        candidate("orthogonal", [0, 1]),
    ]
    result = rank_embeddings(queries, candidates)
    assert [item.candidate_id for item in result.candidates] == [
        "same",
        "orthogonal",
        "opposite",
    ]
    assert [item.rank for item in result.candidates] == [1, 2, 3]
    assert [item.similarity for item in result.candidates] == [1, 0, -1]
    assert all(item.model == MODEL for item in result.candidates)
    assert result.candidates[0].source_url == "https://example.com/same.jpg"
    assert result.query_images[0].source_image_index == 1
    assert result.query_images[0].image_id == "query"
    assert result == rank_embeddings(queries, candidates)
    assert "confidence" not in result.model_dump_json()
    assert "identificationStatus" not in result.model_dump_json()
    assert "vector" not in result.model_dump_json()


def test_ties_use_candidate_id_independently_of_input_order():
    candidates = [
        candidate("b", [1, 0]),
        candidate("a", [1, 0]),
        candidate("A", [1, 0]),
    ]
    result = rank_embeddings([embedding([1, 0])], candidates)
    assert [item.candidate_id for item in result.candidates] == ["A", "a", "b"]
    assert result == rank_embeddings([embedding([1, 0])], list(reversed(candidates)))


def test_multiple_queries_use_arithmetic_mean_of_per_view_cosines():
    queries = [embedding([1, 0], "front"), embedding([0, 1], "rear")]
    result = rank_embeddings(queries, [candidate("A", [1, 0]), candidate("B", [1, 1])])
    assert [item.candidate_id for item in result.candidates] == ["B", "A"]
    assert result.candidates[0].similarity == pytest.approx(1 / math.sqrt(2))
    assert result.candidates[1].similarity == 0.5
    assert [s.similarity for s in result.candidates[1].query_similarities] == [1, 0]
    assert [s.source_image_index for s in result.candidates[1].query_similarities] == [
        1,
        2,
    ]
    assert [q.image_id for q in result.query_images] == ["front", "rear"]


@pytest.mark.parametrize("queries", [[], [embedding([1, 0])] * 5])
def test_query_collection_bounds(queries):
    with pytest.raises(RetrievalError, match="1–4 query"):
        rank_embeddings(queries, [candidate("A", [1, 0])])


@pytest.mark.parametrize(
    "candidates", [[], [candidate(str(i), [1, 0]) for i in range(65)]]
)
def test_candidate_collection_bounds(candidates):
    with pytest.raises(RetrievalError, match="1–64 candidate"):
        rank_embeddings([embedding([1, 0])], candidates)


def test_duplicate_candidate_ids_are_rejected_even_with_different_vectors():
    with pytest.raises(RetrievalError) as error:
        rank_embeddings(
            [embedding([1, 0])], [candidate("A", [1, 0]), candidate("A", [0, 1])]
        )
    assert error.value.code == "RETRIEVAL_DUPLICATE_CANDIDATE"


def test_duplicate_query_image_ids_are_rejected():
    with pytest.raises(RetrievalError, match="Query image IDs must be unique"):
        rank_embeddings(
            [embedding([1, 0]), embedding([0, 1])], [candidate("A", [1, 0])]
        )


def test_zero_embedding_is_rejected_at_ranking_boundary():
    with pytest.raises(RetrievalError, match="Zero vectors"):
        rank_embeddings([embedding([1, 0])], [candidate("A", [0, 0])])


def test_incompatible_models_with_same_dimensions_are_rejected():
    other = MODEL.model_copy(update={"revision": "different"})
    with pytest.raises(RetrievalError) as error:
        rank_embeddings([embedding([1, 0])], [candidate("A", [1, 0], other)])
    assert error.value.code == "RETRIEVAL_MODEL_MISMATCH"
