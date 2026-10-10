"""Local OCR evidence only; not the public ProductIdentification contract."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class OcrRecord(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)


class OcrRegion(OcrRecord):
    region_index: int = Field(ge=1)
    raw_text: str
    normalized_text: str
    polygon: list[tuple[float, float]] | None
    recognition_confidence: float | None = Field(default=None, ge=0, le=1)


class OcrSpan(OcrRecord):
    """Half-open Python character offsets in a region's normalized_text."""

    region_index: int = Field(ge=1)
    start: int = Field(ge=0)
    end: int = Field(ge=0)


class OcrIdentifier(OcrRecord):
    source_image_index: int = Field(ge=1)
    kind: Literal["model_number", "sku", "part_number", "serial_number"]
    value: str
    extraction: Literal["explicit_label", "spatial_label"]
    label: str
    label_span: OcrSpan
    value_span: OcrSpan


class OcrBrandClue(OcrRecord):
    source_image_index: int = Field(ge=1)
    value: str
    kind: Literal["brand", "manufacturer"]
    extraction: Literal["explicit_label", "standalone_allowlist", "corporate_name"]
    value_span: OcrSpan


class OcrImageEvidence(OcrRecord):
    source_image_index: int = Field(ge=1)
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    coordinate_space: Literal["exif_transposed_pixels"] = "exif_transposed_pixels"
    outcome: Literal["text_detected", "no_text_detected"]
    # A transcription alone cannot establish manufacturer/product/packaging role.
    label_role: Literal["unknown"] = "unknown"
    label_role_basis: Literal["not_assessed"] = "not_assessed"
    regions: list[OcrRegion]
    identifiers: list[OcrIdentifier]
    brand_clues: list[OcrBrandClue]


class OcrEvidence(OcrRecord):
    schema_version: Literal["ocr.v1"] = "ocr.v1"
    source: Literal["paddleocr"] = "paddleocr"
    engine_version: str
    detection_model: str
    recognition_model: str
    images: list[OcrImageEvidence]
