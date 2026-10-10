import json
from types import SimpleNamespace

from app.models.ocr import OcrError
from app.services import ocr_cli


def test_cli_json_stdout_and_ordered_files(tmp_path, monkeypatch, capsys):
    first, second = tmp_path / "label.png", tmp_path / "front.jpg"
    first.write_bytes(b"label")
    second.write_bytes(b"front")
    seen = []

    def analyze(images):
        seen.extend(images)
        print("model diagnostic")
        return SimpleNamespace(
            model_dump_json=lambda **_: '{"schema_version":"ocr.v1"}'
        )

    monkeypatch.setattr(ocr_cli, "OcrService", lambda: SimpleNamespace(analyze=analyze))
    assert ocr_cli.main([str(first), str(second)]) == 0
    output = capsys.readouterr()
    assert json.loads(output.out) == {"schema_version": "ocr.v1"}
    assert "model diagnostic" in output.err
    assert seen == [b"label", b"front"]


def test_cli_failure_is_nonzero_and_no_success_json(tmp_path, monkeypatch, capsys):
    image = tmp_path / "label.png"
    image.write_bytes(b"bad")

    def fail(_):
        raise OcrError("OCR_INVALID_IMAGE", "Invalid image")

    monkeypatch.setattr(ocr_cli, "OcrService", lambda: SimpleNamespace(analyze=fail))
    assert ocr_cli.main([str(image)]) == 1
    output = capsys.readouterr()
    assert output.out == ""
    assert json.loads(output.err)["error"]["code"] == "OCR_INVALID_IMAGE"


def test_cli_missing_file(tmp_path, capsys):
    assert ocr_cli.main([str(tmp_path / "missing.png")]) == 1
    assert (
        json.loads(capsys.readouterr().err)["error"]["code"] == "OCR_IMAGE_READ_FAILED"
    )


def test_cli_rejects_too_many_files_before_reading(capsys):
    assert ocr_cli.main(["missing.png"] * 5) == 1
    assert json.loads(capsys.readouterr().err)["error"]["code"] == "OCR_INVALID_INPUT"
