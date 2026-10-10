"""Lazy image-only SigLIP adapter. No ML imports or downloads at module import."""

from collections.abc import Callable, Sequence
from threading import Lock
from typing import Any, Literal, Protocol

from app.schemas.retrieval import ModelProvenance

SIGLIP_MODEL = ModelProvenance(
    model_family="siglip",
    checkpoint="google/siglip-base-patch16-224",
    revision="7fd15f0689c79d79e38b1c2e2e2370a7bf2761ed",
    embedding_dimension=768,
    preprocessing="exif_transpose_rgb;siglip_bicubic_resize_224;mean_std_0.5",
)


class RetrievalError(RuntimeError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class ImageEncoder(Protocol):
    @property
    def metadata(self) -> ModelProvenance: ...

    def encode(self, image: Any) -> Sequence[float]: ...


def _load_siglip(device: str, local_files_only: bool) -> Callable[[Any], list[float]]:
    import torch
    from transformers import SiglipImageProcessor, SiglipVisionModel

    if device == "mps" and not torch.backends.mps.is_available():
        raise RuntimeError("MPS was requested but is unavailable")
    options = {
        "revision": SIGLIP_MODEL.revision,
        "local_files_only": local_files_only,
    }
    processor = SiglipImageProcessor.from_pretrained(SIGLIP_MODEL.checkpoint, **options)
    # Load only the vision tower. The upstream safetensors artifact also contains
    # text weights, but no text encoder/tokenizer is instantiated or invoked.
    model, loading_info = SiglipVisionModel.from_pretrained(
        SIGLIP_MODEL.checkpoint,
        **options,
        use_safetensors=True,
        attn_implementation="eager",
        dtype=torch.float32,
        output_loading_info=True,
    )
    if any(
        loading_info.get(key)
        for key in ("missing_keys", "mismatched_keys", "error_msgs")
    ):
        raise RuntimeError("Checkpoint did not fully initialize the image encoder")
    model = model.to(device)
    model.eval()

    def predict(image: Any) -> list[float]:
        inputs = processor(images=image, return_tensors="pt")
        with torch.inference_mode():
            pooled = model(pixel_values=inputs["pixel_values"].to(device)).pooler_output
        if tuple(pooled.shape) != (1, SIGLIP_MODEL.embedding_dimension):
            raise ValueError("Unexpected embedding shape")
        return pooled[0].detach().to(device="cpu", dtype=torch.float32).tolist()

    return predict


class SiglipImageEncoder:
    metadata = SIGLIP_MODEL

    def __init__(
        self,
        device: Literal["cpu", "mps"] = "cpu",
        local_files_only: bool = False,
        loader: Callable[[str, bool], Callable[[Any], Sequence[float]]] = _load_siglip,
    ):
        if device not in {"cpu", "mps"}:
            raise RetrievalError("RETRIEVAL_INVALID_INPUT", "Use cpu or mps.")
        self._device = device
        self._local_files_only = local_files_only
        self._loader = loader
        self._predict = None
        self._lock = Lock()

    def encode(self, image: Any) -> Sequence[float]:
        # One lazy model per encoder; serialize loading and predictor reuse.
        # Keep the service/encoder alive across calls rather than constructing
        # it for each request. A CLI invocation shares it across all images.
        with self._lock:
            if self._predict is None:
                try:
                    self._predict = self._loader(self._device, self._local_files_only)
                except Exception as exc:
                    raise RetrievalError(
                        "RETRIEVAL_UNAVAILABLE",
                        "Check retrieval dependencies, device and model cache.",
                    ) from exc
            try:
                return self._predict(image)
            except Exception as exc:
                raise RetrievalError(
                    "RETRIEVAL_INFERENCE_FAILED", "Image embedding inference failed."
                ) from exc
