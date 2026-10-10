"""Decode and service tests require only Pillow, never the pretrained model."""

from io import BytesIO

import pytest

from app.models.retrieval import RetrievalError
from app.schemas.retrieval import CandidateImage, ModelProvenance, RetrievalImage
from app.services.retrieval import VisualRetrievalService, decode_image

Image = pytest.importorskip("PIL.Image")


def image_bytes(color="red", format="PNG", mode="RGB"):
    stream = BytesIO()
    Image.new(mode, (16, 12), color).save(stream, format=format)
    return stream.getvalue()


class FakeEncoder:
    metadata = ModelProvenance(
        model_family="test",
        checkpoint="test",
        revision="test",
        embedding_dimension=2,
        preprocessing="test",
    )

    def __init__(self, vector=None):
        self.calls = []
        self.vector = vector

    def encode(self, image):
        self.calls.append(image.getpixel((0, 0)))
        if self.vector is not None:
            return self.vector
        red, green, blue = self.calls[-1]
        return [red, blue]


def test_service_embeds_normalized_pixels_and_preserves_reference():
    encoder = FakeEncoder([3, 4])
    service = VisualRetrievalService(encoder)
    result = service.embed_image(
        RetrievalImage("front", image_bytes(), "https://example.com/front")
    )
    assert result.vector == (0.6, 0.8)
    assert result.image_id == "front"
    assert result.source_url == "https://example.com/front"
    assert result.model == encoder.metadata


def test_service_ranks_supplied_images_using_one_encoder_across_calls():
    encoder = FakeEncoder()
    service = VisualRetrievalService(encoder)
    query = RetrievalImage("front", image_bytes())
    candidates = [
        CandidateImage("B", RetrievalImage("blue", image_bytes("blue"))),
        CandidateImage("A", RetrievalImage("red", image_bytes())),
    ]
    first = service.rank([query], candidates)
    assert [item.candidate_id for item in first.candidates] == ["A", "B"]
    assert first == service.rank([query], candidates)
    assert len(encoder.calls) == 6


def test_all_images_are_validated_before_any_inference():
    encoder = FakeEncoder()
    service = VisualRetrievalService(encoder)
    with pytest.raises(RetrievalError) as error:
        service.rank(
            [RetrievalImage("query", image_bytes())],
            [
                CandidateImage("A", RetrievalImage("valid", image_bytes())),
                CandidateImage("B", RetrievalImage("corrupt", b"not an image")),
            ],
        )
    assert error.value.code == "RETRIEVAL_INVALID_IMAGE"
    assert encoder.calls == []


@pytest.mark.parametrize("data", [b"", b"x" * (3 * 1024 * 1024 + 1), "bad"])
def test_empty_oversized_or_nonbytes_images_are_rejected(data):
    with pytest.raises(RetrievalError) as error:
        VisualRetrievalService(FakeEncoder()).embed_image(RetrievalImage("query", data))
    assert error.value.code == "RETRIEVAL_INVALID_INPUT"


@pytest.mark.parametrize(
    "data", [b"corrupt", image_bytes()[:30], image_bytes(format="GIF")]
)
def test_corrupt_truncated_and_unsupported_images(data):
    with pytest.raises(RetrievalError) as error:
        decode_image(data)
    assert error.value.code == "RETRIEVAL_INVALID_IMAGE"


def test_pixel_limit_is_checked_before_full_decode(monkeypatch):
    monkeypatch.setattr("app.services.retrieval.MAX_PIXELS", 16 * 12 - 1)
    with pytest.raises(RetrievalError, match="16 megapixels"):
        decode_image(image_bytes())


def test_animated_images_are_rejected():
    stream = BytesIO()
    Image.new("RGB", (8, 8), "red").save(
        stream,
        format="PNG",
        save_all=True,
        append_images=[Image.new("RGB", (8, 8), "blue")],
    )
    with pytest.raises(RetrievalError):
        decode_image(stream.getvalue())


def test_decode_applies_exif_orientation_and_rgb_conversion():
    image = Image.new("L", (16, 12), 100)
    exif = image.getexif()
    exif[274] = 6
    stream = BytesIO()
    image.save(stream, format="JPEG", exif=exif)
    with decode_image(stream.getvalue()) as pixels:
        assert pixels.size == (12, 16)
        assert pixels.mode == "RGB"
        assert pixels.getpixel((0, 0)) == (100, 100, 100)


@pytest.mark.parametrize("vector", [[0, 0], [float("nan"), 1], [float("inf"), 1], [1]])
def test_invalid_encoder_vectors_fail_explicitly(vector):
    with pytest.raises(RetrievalError):
        VisualRetrievalService(FakeEncoder(vector)).embed_image(
            RetrievalImage("query", image_bytes())
        )


def test_total_byte_limit(monkeypatch):
    data = image_bytes()
    monkeypatch.setattr("app.services.retrieval.MAX_TOTAL_BYTES", len(data))
    encoder = FakeEncoder()
    with pytest.raises(RetrievalError, match="64 MiB"):
        VisualRetrievalService(encoder).rank(
            [RetrievalImage("query", data)],
            [CandidateImage("A", RetrievalImage("candidate", data))],
        )
    assert encoder.calls == []


@pytest.mark.parametrize("candidate_id", ["", " ", "a" * 201])
def test_invalid_candidate_identifiers(candidate_id):
    with pytest.raises(RetrievalError, match="Candidate ID"):
        VisualRetrievalService(FakeEncoder()).rank(
            [RetrievalImage("q", image_bytes())],
            [CandidateImage(candidate_id, RetrievalImage("c", image_bytes()))],
        )
