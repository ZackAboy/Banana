import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.models.ocr import OcrError
from app.schemas.ocr import OcrEvidence, OcrRegion
from app.services import ocr


def test_ordered_views_and_empty_text_are_explicit(monkeypatch):
    monkeypatch.setattr(ocr, "_decode", lambda _: SimpleNamespace(shape=(100, 200)))
    observations = iter(
        [
            [
                OcrRegion(
                    region_index=1,
                    raw_text="SONY",
                    normalized_text="SONY",
                    polygon=None,
                ),
                OcrRegion(
                    region_index=2,
                    raw_text="MODEL CFI-ZCT2W",
                    normalized_text="MODEL CFI-ZCT2W",
                    polygon=None,
                ),
            ],
            [],
        ]
    )
    engine = SimpleNamespace(
        engine_version="test",
        detection_model="test-det",
        recognition_model="test-rec",
        recognize=lambda _: next(observations),
    )
    result = ocr.OcrService(engine).analyze([b"label", b"front"])
    assert [i.source_image_index for i in result.images] == [1, 2]
    assert [i.outcome for i in result.images] == ["text_detected", "no_text_detected"]
    assert result.images[0].identifiers[0].value == "CFI-ZCT2W"
    assert result.images[0].brand_clues[0].value == "SONY"
    assert result.images[1].identifiers == []
    assert result.images[0].label_role == "unknown"
    assert result.images[0].label_role_basis == "not_assessed"
    assert result == OcrEvidence.model_validate_json(result.model_dump_json())
    assert "identificationStatus" not in result.model_dump_json()


@pytest.mark.parametrize(
    "images",
    [
        [],
        [b""],
        [b"x"] * 5,
        [b"x" * (ocr.MAX_IMAGE_BYTES + 1)],
        [b"x" * ocr.MAX_IMAGE_BYTES, b"y" * ocr.MAX_IMAGE_BYTES],
    ],
)
def test_input_bounds_before_decode_or_model_load(images):
    with pytest.raises(OcrError) as caught:
        ocr.OcrService().analyze(images)
    assert caught.value.code == "OCR_INVALID_INPUT"


def test_invalid_later_image_prevents_any_inference(monkeypatch):
    calls = []

    def decode(data):
        if data == b"bad":
            raise OcrError("OCR_INVALID_IMAGE", "Invalid image")

    monkeypatch.setattr(ocr, "_decode", decode)
    engine = SimpleNamespace(recognize=lambda _: calls.append("inference"))
    with pytest.raises(OcrError):
        ocr.OcrService(engine).analyze([b"good", b"bad"])
    assert calls == []


def test_provider_failure_does_not_return_partial_success(monkeypatch):
    monkeypatch.setattr(ocr, "_decode", lambda _: SimpleNamespace(shape=(10, 10)))

    def fail(_):
        raise OcrError("OCR_INFERENCE_FAILED", "Inference failed")

    with pytest.raises(OcrError):
        ocr.OcrService(SimpleNamespace(recognize=fail)).analyze([b"valid"])


def test_recorded_typeset_fixture_retains_resolvable_provenance():
    path = Path(__file__).parent / "fixtures" / "ocr_typeset_dualsense.json"
    evidence = OcrEvidence.model_validate_json(path.read_text())
    [image] = evidence.images
    assert image.label_role == "unknown"
    assert image.identifiers[0].kind == "model_number"
    assert image.identifiers[0].value == "CFI-ZCT2W"
    regions = {r.region_index: r for r in image.regions}
    for clue in image.identifiers + image.brand_clues:
        assert clue.source_image_index == image.source_image_index
        span = clue.value_span
        region = regions[span.region_index]
        assert region.normalized_text[span.start : span.end] == clue.value
    assert regions[3].raw_text == "MODEL CFI-ZCT2W"
    assert image.brand_clues[0].value == "SONY"


def test_importing_ocr_service_does_not_import_ml_or_image_packages():
    completed = subprocess.run(
        [
            sys.executable,
            "-c",
            "import sys; import app.services.ocr; "
            "assert not {'paddle', 'paddleocr', 'numpy', 'PIL'} & sys.modules.keys()",
        ],
        cwd=Path(__file__).resolve().parents[1],
        capture_output=True,
        text=True,
        check=False,
    )
    assert completed.returncode == 0, completed.stderr
