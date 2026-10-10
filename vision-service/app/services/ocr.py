"""In-memory image boundary, independent of Gemini and final identity policy."""

import warnings
from collections.abc import Sequence
from io import BytesIO

from app.models.ocr import OcrEngine, OcrError, PaddleOcrEngine
from app.schemas.ocr import OcrEvidence, OcrImageEvidence
from app.services.ocr_identifiers import extract_brand_clues, extract_identifiers

MAX_IMAGES = 4
MAX_IMAGE_BYTES = 3 * 1024 * 1024
MAX_TOTAL_BYTES = 4 * 1024 * 1024
MAX_PIXELS = 16_000_000


def _decode(data: bytes):
    try:
        import numpy as np
        from PIL import Image, ImageOps
    except ImportError as exc:
        raise OcrError(
            "OCR_UNAVAILABLE", "Install the optional OCR dependencies first."
        ) from exc
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as image:
                if image.format not in {"JPEG", "PNG", "WEBP"}:
                    raise ValueError("Unsupported format")
                if image.width * image.height > MAX_PIXELS:
                    raise ValueError("Too many pixels")
                if getattr(image, "n_frames", 1) != 1:
                    raise ValueError("Animated image")
                image.load()
                image = ImageOps.exif_transpose(image).convert("RGB")
                # Paddle's numpy input convention is BGR. Coordinates refer to
                # these EXIF-oriented pixels, without resizing or unwarping.
                return np.asarray(image)[:, :, ::-1].copy()
    except Exception as exc:
        raise OcrError(
            "OCR_INVALID_IMAGE",
            "Use a decodable, static JPEG/PNG/WebP image of at most 16 megapixels.",
        ) from exc


class OcrService:
    def __init__(self, engine: OcrEngine | None = None):
        self._engine = engine if engine is not None else PaddleOcrEngine()

    def analyze(self, images: Sequence[bytes]) -> OcrEvidence:
        """Ordered views become 1-based evidence; failures never return mock text."""
        if (
            not 1 <= len(images) <= MAX_IMAGES
            or any(not image or len(image) > MAX_IMAGE_BYTES for image in images)
            or sum(map(len, images)) > MAX_TOTAL_BYTES
        ):
            raise OcrError(
                "OCR_INVALID_INPUT",
                "Use 1–4 images, at most 3 MiB each and 4 MiB total.",
            )
        # Validate every view before starting expensive inference. Decode once
        # again per inference to avoid retaining four full pixel arrays in memory.
        for image in images:
            _decode(image)
        evidence = []
        for image_index, data in enumerate(images, start=1):
            pixels = _decode(data)
            regions = self._engine.recognize(pixels)
            evidence.append(
                OcrImageEvidence(
                    source_image_index=image_index,
                    width=pixels.shape[1],
                    height=pixels.shape[0],
                    outcome=(
                        "text_detected"
                        if any(region.normalized_text for region in regions)
                        else "no_text_detected"
                    ),
                    regions=regions,
                    identifiers=extract_identifiers(regions, image_index),
                    brand_clues=extract_brand_clues(regions, image_index),
                )
            )
        # TODO(Fusion): agree on a versioned cross-language fixture and transport
        # before consuming this evidence; establish label role and resolve conflicts
        # upstream. Recognition confidence must never decide identification status.
        return OcrEvidence(
            engine_version=self._engine.engine_version,
            detection_model=self._engine.detection_model,
            recognition_model=self._engine.recognition_model,
            images=evidence,
        )
