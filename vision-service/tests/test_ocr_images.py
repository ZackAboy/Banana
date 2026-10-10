"""Image decoding checks need lightweight OCR extras, never model weights."""

from io import BytesIO

import pytest

pytest.importorskip("numpy")
Image = pytest.importorskip("PIL.Image")

from app.models.ocr import OcrError  # noqa: E402
from app.services.ocr import _decode  # noqa: E402


def encoded(image, format="PNG", **kwargs):
    stream = BytesIO()
    image.save(stream, format=format, **kwargs)
    return stream.getvalue()


@pytest.mark.parametrize("format", ["JPEG", "PNG", "WEBP"])
def test_decode_formats_and_bgr(format):
    pixels = _decode(encoded(Image.new("RGB", (20, 10), (255, 0, 0)), format))
    assert pixels.shape == (10, 20, 3)
    assert pixels[0, 0, 2] >= 250
    assert pixels[0, 0, 0] <= 5


def test_exif_orientation_matches_documented_coordinates():
    image = Image.new("RGB", (20, 10))
    exif = Image.Exif()
    exif[274] = 6
    assert _decode(encoded(image, "JPEG", exif=exif)).shape == (20, 10, 3)


@pytest.mark.parametrize("data", [b"not an image", b"\x89PNG\r\n\x1a\n"])
def test_malformed_image(data):
    with pytest.raises(OcrError) as caught:
        _decode(data)
    assert caught.value.code == "OCR_INVALID_IMAGE"


def test_unsupported_and_animated_images():
    image = Image.new("RGB", (20, 10))
    for data in [
        encoded(image, "BMP"),
        encoded(
            image,
            "PNG",
            save_all=True,
            append_images=[Image.new("RGB", (20, 10), "red")],
        ),
    ]:
        with pytest.raises(OcrError):
            _decode(data)


def test_pixel_limit(monkeypatch):
    monkeypatch.setattr("app.services.ocr.MAX_PIXELS", 10)
    with pytest.raises(OcrError):
        _decode(encoded(Image.new("RGB", (20, 10))))
