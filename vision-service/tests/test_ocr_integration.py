"""Opt-in real Paddle inference, loaded once. Default tests never download models."""

import os
from io import BytesIO
from pathlib import Path

import pytest

pytestmark = pytest.mark.skipif(
    os.getenv("BANANA_RUN_OCR_INTEGRATION") != "1",
    reason="Set BANANA_RUN_OCR_INTEGRATION=1 with OCR dependencies installed",
)


@pytest.fixture(scope="module")
def service():
    from app.services.ocr import OcrService

    return OcrService()


def test_real_engine_on_typeset_dualsense_label(service):
    # Synthetic typography smoke test; not evidence of real-photo accuracy.
    from PIL import Image, ImageDraw, ImageFont

    image = Image.new("RGB", (1000, 320), "white")
    ImageDraw.Draw(image).multiline_text(
        (40, 30),
        "SONY\nWIRELESS CONTROLLER\nMODEL CFI-ZCT2W",
        font=ImageFont.load_default(size=44),
        fill="black",
        spacing=25,
    )
    stream = BytesIO()
    image.save(stream, format="PNG")
    result = service.analyze([stream.getvalue()])
    identifiers = result.images[0].identifiers
    assert any(i.kind == "model_number" and i.value == "CFI-ZCT2W" for i in identifiers)
    assert any(c.value.upper() == "SONY" for c in result.images[0].brand_clues)
    assert all(r.polygon for r in result.images[0].regions)
    assert all(r.recognition_confidence is not None for r in result.images[0].regions)


@pytest.mark.skipif(
    not os.getenv("BANANA_DUALSENSE_IMAGE"),
    reason="Provide BANANA_DUALSENSE_IMAGE for the real rear-label acceptance test",
)
def test_real_dualsense_rear_label(service):
    result = service.analyze([Path(os.environ["BANANA_DUALSENSE_IMAGE"]).read_bytes()])
    observed = result.images[0]
    assert any(
        i.kind == "model_number" and i.value == "CFI-ZCT2W"
        for i in observed.identifiers
    )
    assert any("SONY" in r.normalized_text.upper() for r in observed.regions)
    assert "WIRELESS CONTROLLER" in " ".join(
        r.normalized_text.upper() for r in observed.regions
    )
    assert any("SONY" in clue.value.upper() for clue in observed.brand_clues)
