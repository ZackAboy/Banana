"""Model lifecycle/error tests inject predictors and never import real torch."""

import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

import pytest

from app.models.retrieval import RetrievalError, SiglipImageEncoder


def test_import_and_construction_do_not_import_ml_packages():
    script = """
import sys
from app.services.retrieval import VisualRetrievalService
VisualRetrievalService()
assert not {'torch', 'transformers', 'PIL', 'numpy'} & sys.modules.keys()
"""
    subprocess.run([sys.executable, "-c", script], check=True)


def test_model_is_lazy_and_reused_even_on_concurrent_calls():
    loads, images = [], []

    def loader(device, local_files_only):
        loads.append((device, local_files_only))

        def predict(image):
            images.append(image)
            return [3, 4]

        return predict

    encoder = SiglipImageEncoder(loader=loader, local_files_only=True)
    assert loads == []
    with ThreadPoolExecutor(max_workers=4) as pool:
        assert list(pool.map(encoder.encode, range(8))) == [[3, 4]] * 8
    assert loads == [("cpu", True)]
    assert sorted(images) == list(range(8))
    assert encoder.metadata.embedding_dimension == 768


def test_initialization_failure_is_explicit_without_mock_fallback():
    def fail(device, local_files_only):
        raise RuntimeError("private initialization details")

    encoder = SiglipImageEncoder(loader=fail)
    with pytest.raises(RetrievalError) as error:
        encoder.encode(object())
    assert error.value.code == "RETRIEVAL_UNAVAILABLE"
    assert "private" not in str(error.value)


def test_inference_failure_is_explicit_without_mock_fallback():
    def fail(image):
        raise RuntimeError("private image details")

    encoder = SiglipImageEncoder(loader=lambda device, offline: fail)
    with pytest.raises(RetrievalError) as error:
        encoder.encode(object())
    assert error.value.code == "RETRIEVAL_INFERENCE_FAILED"
    assert "private" not in str(error.value)


def test_invalid_device_is_rejected():
    with pytest.raises(RetrievalError, match="cpu or mps"):
        SiglipImageEncoder(device="invalid")
