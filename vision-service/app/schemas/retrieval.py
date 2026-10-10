"""Internal retrieval evidence only; not an HTTP or ProductIdentification contract."""

from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


@dataclass(frozen=True)
class RetrievalImage:
    image_id: str
    data: bytes
    source_url: str | None = None


@dataclass(frozen=True)
class CandidateImage:
    candidate_id: str
    image: RetrievalImage


class RetrievalRecord(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid", allow_inf_nan=False)


class ModelProvenance(RetrievalRecord):
    model_family: str = Field(min_length=1)
    checkpoint: str = Field(min_length=1)
    revision: str = Field(min_length=1)
    embedding_dimension: int = Field(gt=0)
    preprocessing: str = Field(min_length=1)


class ImageEmbedding(RetrievalRecord):
    image_id: str = Field(min_length=1)
    source_url: str | None = None
    model: ModelProvenance
    vector: tuple[float, ...] = Field(min_length=1)


@dataclass(frozen=True)
class CandidateEmbedding:
    candidate_id: str
    embedding: ImageEmbedding


class QueryImageReference(RetrievalRecord):
    source_image_index: int = Field(ge=1)
    image_id: str
    source_url: str | None


class QuerySimilarity(RetrievalRecord):
    source_image_index: int = Field(ge=1)
    similarity: float = Field(ge=-1, le=1)


class RankedVisualCandidate(RetrievalRecord):
    candidate_id: str
    image_id: str
    source_url: str | None
    rank: int = Field(ge=1)
    similarity: float = Field(ge=-1, le=1)
    query_similarities: tuple[QuerySimilarity, ...]
    model: ModelProvenance


class RetrievalEvidence(RetrievalRecord):
    schema_version: Literal["retrieval.v1"] = "retrieval.v1"
    source: Literal["visual_retrieval"] = "visual_retrieval"
    metric: Literal["cosine"] = "cosine"
    aggregation: Literal["mean_query_cosine"] = "mean_query_cosine"
    tie_break: Literal["candidate_id_ascending"] = "candidate_id_ascending"
    model: ModelProvenance
    query_images: tuple[QueryImageReference, ...]
    candidates: tuple[RankedVisualCandidate, ...]
