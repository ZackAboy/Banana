"""python -m app.services.ocr_cli label.jpg [front.jpg ...]"""

import argparse
import json
import sys
from contextlib import redirect_stdout
from pathlib import Path

from app.models.ocr import OcrError
from app.services.ocr import MAX_IMAGE_BYTES, MAX_IMAGES, OcrService


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Local PaddleOCR evidence as JSON")
    parser.add_argument("images", nargs="+", type=Path, help="JPEG, PNG, or WebP files")
    args = parser.parse_args(argv)
    try:
        if len(args.images) > MAX_IMAGES:
            raise OcrError("OCR_INVALID_INPUT", "Use at most four images.")
        images = []
        for path in args.images:
            with path.open("rb") as stream:
                images.append(stream.read(MAX_IMAGE_BYTES + 1))
        # Keep Paddle's progress/model messages off the JSON stdout channel.
        with redirect_stdout(sys.stderr):
            result = OcrService().analyze(images)
        print(result.model_dump_json(indent=2))
        return 0
    except OcrError as exc:
        error = {"code": exc.code, "message": str(exc)}
    except OSError:
        error = {
            "code": "OCR_IMAGE_READ_FAILED",
            "message": "Cannot read an input image.",
        }
    print(json.dumps({"error": error}), file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
