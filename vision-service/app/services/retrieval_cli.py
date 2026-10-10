"""Local bytes-only CLI: no image fetching, search or product-specific knowledge."""

import argparse
import contextlib
import json
import sys
from collections.abc import Sequence
from pathlib import Path

from app.models.retrieval import RetrievalError, SiglipImageEncoder
from app.schemas.retrieval import CandidateImage, RetrievalImage
from app.services.retrieval import MAX_IMAGE_BYTES, VisualRetrievalService


def _read_image(path: str, image_id: str) -> RetrievalImage:
    try:
        with Path(path).open("rb") as stream:
            data = stream.read(MAX_IMAGE_BYTES + 1)
    except OSError as exc:
        raise RetrievalError(
            "RETRIEVAL_IMAGE_READ_FAILED", "Unable to read a supplied image file."
        ) from exc
    return RetrievalImage(image_id=image_id, data=data)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--query", action="append", required=True, metavar="PATH")
    parser.add_argument(
        "--candidate", action="append", required=True, nargs=2, metavar=("ID", "PATH")
    )
    parser.add_argument("--device", choices=("cpu", "mps"), default="cpu")
    parser.add_argument("--local-files-only", action="store_true")
    args = parser.parse_args(argv)
    try:
        queries = [
            _read_image(path, f"query-{index}")
            for index, path in enumerate(args.query, start=1)
        ]
        candidates = [
            CandidateImage(candidate_id, _read_image(path, f"candidate-{index}"))
            for index, (candidate_id, path) in enumerate(args.candidate, start=1)
        ]
        with contextlib.redirect_stdout(sys.stderr):
            service = VisualRetrievalService(
                SiglipImageEncoder(
                    device=args.device, local_files_only=args.local_files_only
                )
            )
            evidence = service.rank(queries, candidates)
        print(evidence.model_dump_json(indent=2))
        return 0
    except RetrievalError as exc:
        print(
            json.dumps({"error": {"code": exc.code, "message": str(exc)}}),
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
