import pytest

from app.schemas.ocr import OcrRegion
from app.services.ocr_identifiers import (
    extract_brand_clues,
    extract_identifiers,
    normalize_text,
)


def region(text, index=1, box=None, confidence=None):
    return OcrRegion(
        region_index=index,
        raw_text=text,
        normalized_text=normalize_text(text),
        polygon=box,
        recognition_confidence=confidence,
    )


@pytest.mark.parametrize(
    "label",
    [
        "MODEL CFI-ZCT2W",
        "Model: CFI-ZCT2W",
        "MODEL NO. CFI-ZCT2W",
        "MODEL NUMBER: CFI-ZCT2W",
        "model no CFI-ZCT2W",
        "MODEL：CFI-ZCT2W",
    ],
)
def test_dualsense_label_and_spans(label):
    observed = region(label, confidence=0.01)
    [identifier] = extract_identifiers([observed], 2)
    assert identifier.kind == "model_number"
    assert identifier.value == "CFI-ZCT2W"
    assert identifier.source_image_index == 2
    assert identifier.extraction == "explicit_label"
    assert identifier.label_span.region_index == 1
    span = identifier.value_span
    assert observed.normalized_text[span.start : span.end] == identifier.value
    assert observed.raw_text == label
    # A very low recognition score is retained metadata, never a status decision.
    assert observed.recognition_confidence == 0.01
    assert "confidence" not in identifier.model_dump()


@pytest.mark.parametrize(
    ("text", "kind", "value"),
    [
        ("SKU: 0012-AB/34", "sku", "0012-AB/34"),
        ("SKU NO. ab_CD.12+X", "sku", "ab_CD.12+X"),
        ("PART 5-123-456", "part_number", "5-123-456"),
        ("PART NO. A12/BC-9", "part_number", "A12/BC-9"),
        ("PART NUMBER: 001234", "part_number", "001234"),
        ("P/N: 123-ABC", "part_number", "123-ABC"),
        ("P / N 123-ABC", "part_number", "123-ABC"),
        ("MODEL 001234", "model_number", "001234"),
        ("S/N: 987654321", "serial_number", "987654321"),
        ("SERIAL NO. CFI-ZCT2W", "serial_number", "CFI-ZCT2W"),
    ],
)
def test_explicit_identifier_kinds(text, kind, value):
    [identifier] = extract_identifiers([region(text)], 1)
    assert (identifier.kind, identifier.value) == (kind, value)


@pytest.mark.parametrize(
    "text",
    [
        "5V 1500mA",
        "FCC ID: AK8CFIZCT1",
        "IC: 409B-CFIZCT1",
        "CE 2025",
        "123456789",
        "CFI-ZCT2W",
        "Made in China",
        "MODELING ABC-123",
        "XMODEL ABC-123",
        "MODEL",
        "MODEL NO.",
        "MODEL CFI-ZCT2W™",
        "MODEL AB–123",
    ],
)
def test_unlabeled_regulatory_or_partial_text_is_not_a_model(text):
    assert extract_identifiers([region(text)], 1) == []


def test_serial_is_never_promoted_by_identifier_appearance():
    identifiers = extract_identifiers(
        [
            region("SERIAL NUMBER: CFI-ZCT2W"),
            region("S/N 123-AB", 2),
        ],
        1,
    )
    assert [item.kind for item in identifiers] == ["serial_number", "serial_number"]


@pytest.mark.parametrize("text", ["MODEL SERIAL 123456", "MODEL SKU 123456"])
def test_label_names_are_not_model_values(text):
    identifiers = extract_identifiers([region(text)], 1)
    assert identifiers
    assert all(i.kind != "model_number" for i in identifiers)


def test_multiple_labels_remain_distinct():
    ids = extract_identifiers([region("MODEL CFI-ZCT2W SKU: 001-AB S/N: 123456")], 1)
    assert [(i.kind, i.value) for i in ids] == [
        ("model_number", "CFI-ZCT2W"),
        ("sku", "001-AB"),
        ("serial_number", "123456"),
    ]


def test_normalization_preserves_identifier_characters_and_original():
    raw = "  Model:\t cfi-ZCT2W/01_A.2+X\n"
    observed = region(raw)
    assert observed.raw_text == raw
    assert observed.normalized_text == "Model: cfi-ZCT2W/01_A.2+X"
    assert extract_identifiers([observed], 1)[0].value == "cfi-ZCT2W/01_A.2+X"
    assert normalize_text("MODEL CFI‐ZCT2W") == "MODEL CFI‐ZCT2W"
    assert normalize_text("MODEL O0I1") == "MODEL O0I1"


def test_multiple_images_preserve_conflicting_observations():
    first = extract_identifiers([region("MODEL CFI-ZCT2W", 2)], 1)
    second = extract_identifiers([region("MODEL CFI-ZCT1W", 3)], 2)
    assert [
        (i.source_image_index, i.value_span.region_index, i.value)
        for i in first + second
    ] == [(1, 2, "CFI-ZCT2W"), (2, 3, "CFI-ZCT1W")]


def test_separate_regions_require_geometry_and_single_neighbor():
    label = region("MODEL", box=[(0, 0), (80, 0), (80, 20), (0, 20)])
    value = region("CFI-ZCT2W", 2, [(90, 0), (210, 0), (210, 20), (90, 20)])
    [identifier] = extract_identifiers([label, value], 1)
    assert identifier.extraction == "spatial_label"
    assert identifier.label_span.region_index == 1
    assert identifier.value_span.region_index == 2
    assert extract_identifiers([region("MODEL"), region("CFI-ZCT2W", 2)], 1) == []
    ambiguous = region("CFI-ZCT1W", 3, [(0, 25), (120, 25), (120, 45), (0, 45)])
    assert extract_identifiers([label, value, ambiguous], 1) == []


def test_separate_regions_do_not_cross_images_or_attach_regulatory_line():
    label = region("MODEL", box=[(0, 0), (80, 0), (80, 20), (0, 20)])
    regulatory = region("FCC ID 12345", 2, [(0, 22), (100, 22), (100, 42), (0, 42)])
    assert extract_identifiers([label, regulatory], 1) == []
    assert extract_identifiers([label], 1) == []
    assert extract_identifiers([region("CFI-ZCT2W")], 2) == []


def test_spatial_value_with_competing_model_and_serial_labels_is_ambiguous():
    regions = [
        region("MODEL", box=[(0, 0), (80, 0), (80, 20), (0, 20)]),
        region("SERIAL", 2, [(0, 22), (80, 22), (80, 42), (0, 42)]),
        region("123-ABC", 3, [(0, 44), (100, 44), (100, 64), (0, 64)]),
    ]
    assert extract_identifiers(regions, 1) == []


def test_brand_clues_are_literal_not_product_inference():
    regions = [
        region("SONY"),
        region("WIRELESS CONTROLLER", 2),
        region("MANUFACTURER: Example Electronics Inc.", 3),
        region("BRAND: Example", 4),
    ]
    clues = extract_brand_clues(regions, 2)
    assert [c.value for c in clues] == ["SONY", "Example Electronics Inc.", "Example"]
    assert [c.kind for c in clues] == ["brand", "manufacturer", "brand"]
    assert clues[0].extraction == "standalone_allowlist"
    assert all(c.source_image_index == 2 for c in clues)
    assert extract_brand_clues([region("Some Random Capitalized Text")], 1) == []


@pytest.mark.parametrize(
    "company",
    [
        "Sony Interactive Entertainment Inc.",
        "Example Electronics Ltd.",
        "Example Hardware LLC",
        "Example Corporation",
        "Example GmbH",
    ],
)
def test_literal_corporate_name_clue_excludes_following_address(company):
    observed = region(company + " 123 Example Road Japan SERIAL 123456")
    [clue] = extract_brand_clues([observed], 2)
    assert clue.value == company
    assert clue.kind == "manufacturer"
    assert clue.extraction == "corporate_name"
    assert clue.source_image_index == 2
    span = clue.value_span
    assert observed.normalized_text[span.start : span.end] == company


def test_misread_brand_logo_is_not_silently_repaired():
    assert extract_brand_clues([region("SONYR")], 1) == []
