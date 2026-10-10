"""Lazy CPU PaddleOCR adapter. Importing the service never loads ML packages."""

from collections.abc import Callable
from importlib.metadata import version
from threading import Lock
from typing import Any, Protocol

from app.schemas.ocr import OcrRegion
from app.services.ocr_identifiers import normalize_text

DETECTION_MODEL = "PP-OCRv5_mobile_det"
RECOGNITION_MODEL = "en_PP-OCRv5_mobile_rec"


class OcrError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class OcrEngine(Protocol):
    engine_version: str
    detection_model: str
    recognition_model: str

    def recognize(self, image: Any) -> list[OcrRegion]: ...


def _load_paddle() -> Any:
    from paddleocr import PaddleOCR

    return PaddleOCR(
        text_detection_model_name=DETECTION_MODEL,
        text_recognition_model_name=RECOGNITION_MODEL,
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
        device="cpu",
        enable_mkldnn=False,
        cpu_threads=4,
        text_rec_score_thresh=0.0,
    )


class PaddleOcrEngine:
    detection_model = DETECTION_MODEL
    recognition_model = RECOGNITION_MODEL

    def __init__(self, loader: Callable[[], Any] = _load_paddle):
        self._loader = loader
        self._pipeline = None
        self._lock = Lock()

    @property
    def engine_version(self) -> str:
        return version("paddleocr")

    def recognize(self, image: Any) -> list[OcrRegion]:
        # Paddle predictor reuse is serialized; one lazy model per engine instance.
        with self._lock:
            if self._pipeline is None:
                try:
                    self._pipeline = self._loader()
                except Exception as exc:
                    raise OcrError(
                        "OCR_UNAVAILABLE",
                        "OCR initialization failed; check install and model cache.",
                    ) from exc
            try:
                results = list(self._pipeline.predict(image))
                if len(results) != 1:
                    raise ValueError("Expected one OCR result per image")
                result = results[0]
                texts = result["rec_texts"]
                scores = result.get("rec_scores")
                polygons = result.get("rec_polys")
                if scores is not None and len(scores) != len(texts):
                    raise ValueError("Unaligned OCR scores")
                if polygons is not None and len(polygons) != len(texts):
                    raise ValueError("Unaligned OCR polygons")
                regions = []
                for index, raw in enumerate(texts):
                    if not isinstance(raw, str):
                        raise ValueError("Invalid OCR transcription")
                    polygon = None
                    if polygons is not None:
                        polygon = [
                            tuple(map(float, point)) for point in polygons[index]
                        ]
                        if len(polygon) < 4:
                            raise ValueError("Invalid OCR polygon")
                    regions.append(
                        OcrRegion(
                            region_index=index + 1,
                            raw_text=raw,
                            normalized_text=normalize_text(raw),
                            polygon=polygon,
                            recognition_confidence=(
                                float(scores[index]) if scores is not None else None
                            ),
                        )
                    )
                return regions
            except Exception as exc:
                raise OcrError(
                    "OCR_INFERENCE_FAILED", "OCR inference returned no usable result."
                ) from exc
