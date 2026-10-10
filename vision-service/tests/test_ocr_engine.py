from types import SimpleNamespace

import pytest

from app.models.ocr import OcrError, PaddleOcrEngine


def test_lazy_loading_reuses_predictor_and_preserves_output():
    calls = []

    def loader():
        calls.append("load")
        return SimpleNamespace(
            predict=lambda image: [
                {
                    "rec_texts": ["  MODEL  CFI-ZCT2W ", "SONY"],
                    "rec_scores": [0.93, 0.98],
                    "rec_polys": [
                        [[1, 2], [100, 2], [100, 20], [1, 20]],
                        [[1, 22], [50, 22], [50, 40], [1, 40]],
                    ],
                }
            ]
        )

    engine = PaddleOcrEngine(loader)
    assert calls == []
    regions = engine.recognize(object())
    engine.recognize(object())
    assert calls == ["load"]
    assert regions[0].raw_text == "  MODEL  CFI-ZCT2W "
    assert regions[0].normalized_text == "MODEL CFI-ZCT2W"
    assert regions[0].recognition_confidence == 0.93
    assert regions[0].polygon[0] == (1.0, 2.0)


def test_optional_engine_metadata_is_null_not_fabricated():
    engine = PaddleOcrEngine(
        lambda: SimpleNamespace(predict=lambda _: [{"rec_texts": ["MODEL CFI-ZCT2W"]}])
    )
    [region] = engine.recognize(None)
    assert region.polygon is None
    assert region.recognition_confidence is None


@pytest.mark.parametrize(
    "result",
    [
        [],
        [{}],
        [{"rec_texts": ["SONY"], "rec_scores": []}],
        [{"rec_texts": ["SONY"], "rec_polys": []}],
        [{"rec_texts": [123]}],
        [{"rec_texts": ["SONY"], "rec_scores": [float("nan")]}],
        [{"rec_texts": ["SONY"], "rec_scores": [1.1]}],
        [{"rec_texts": ["SONY"], "rec_polys": [[[1, 2]]]}],
    ],
)
def test_malformed_engine_output_is_explicit_failure(result):
    engine = PaddleOcrEngine(lambda: SimpleNamespace(predict=lambda _: result))
    with pytest.raises(OcrError, match="no usable result") as caught:
        engine.recognize(None)
    assert caught.value.code == "OCR_INFERENCE_FAILED"


def test_load_failure_does_not_fall_back_to_fake_evidence():
    def fail():
        raise ImportError("private upstream details")

    with pytest.raises(OcrError) as caught:
        PaddleOcrEngine(fail).recognize(None)
    assert caught.value.code == "OCR_UNAVAILABLE"
    assert "private upstream details" not in str(caught.value)
