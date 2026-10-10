"""Local CLI tests inject an encoder; no weights or network required."""

import json
from io import BytesIO

import pytest

from app.schemas.retrieval import ModelProvenance
from app.services import retrieval_cli

Image = pytest.importorskip("PIL.Image")


@pytest.fixture
def image_path(tmp_path):
    stream = BytesIO()
    Image.new("RGB", (8, 8), "white").save(stream, format="PNG")
    path = tmp_path / "local.png"
    path.write_bytes(stream.getvalue())
    return str(path)


class Encoder:
    metadata = ModelProvenance(
        model_family="test",
        checkpoint="test",
        revision="test",
        embedding_dimension=2,
        preprocessing="test",
    )

    def encode(self, image):
        # Upstream diagnostics must never contaminate JSON stdout.
        print("test diagnostic")
        return [1, 0]


def test_cli_json_multiple_queries_ties_and_options(monkeypatch, image_path, capsys):
    options = []

    def encoder(**kwargs):
        options.append(kwargs)
        return Encoder()

    monkeypatch.setattr(retrieval_cli, "SiglipImageEncoder", encoder)
    assert (
        retrieval_cli.main(
            [
                "--query",
                image_path,
                "--query",
                image_path,
                "--candidate",
                "B",
                image_path,
                "--candidate",
                "A",
                image_path,
                "--device",
                "mps",
                "--local-files-only",
            ]
        )
        == 0
    )
    captured = capsys.readouterr()
    result = json.loads(captured.out)
    assert [c["candidate_id"] for c in result["candidates"]] == ["A", "B"]
    assert len(result["query_images"]) == 2
    assert "test diagnostic" in captured.err
    assert options == [{"device": "mps", "local_files_only": True}]


def test_cli_missing_file_returns_safe_error_without_paths(
    tmp_path, image_path, capsys
):
    assert (
        retrieval_cli.main(
            ["--query", str(tmp_path / "private.jpg"), "--candidate", "A", image_path]
        )
        == 1
    )
    captured = capsys.readouterr()
    assert captured.out == ""
    assert json.loads(captured.err)["error"]["code"] == "RETRIEVAL_IMAGE_READ_FAILED"
    assert "private.jpg" not in captured.err


def test_cli_duplicate_ids_fail_before_model_load(image_path, capsys):
    assert (
        retrieval_cli.main(
            [
                "--query",
                image_path,
                "--candidate",
                "A",
                image_path,
                "--candidate",
                "A",
                image_path,
            ]
        )
        == 1
    )
    captured = capsys.readouterr()
    assert captured.out == ""
    assert json.loads(captured.err)["error"]["code"] == "RETRIEVAL_DUPLICATE_CANDIDATE"


def test_cli_corrupt_image_returns_no_partial_result(tmp_path, image_path, capsys):
    corrupt = tmp_path / "bad.png"
    corrupt.write_bytes(b"not an image")
    assert (
        retrieval_cli.main(["--query", image_path, "--candidate", "A", str(corrupt)])
        == 1
    )
    captured = capsys.readouterr()
    assert captured.out == ""
    assert json.loads(captured.err)["error"]["code"] == "RETRIEVAL_INVALID_IMAGE"
