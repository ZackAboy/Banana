"""Deterministic label extraction. No model, network, or semantic inference."""

import re
import unicodedata

from app.schemas.ocr import OcrBrandClue, OcrIdentifier, OcrRegion, OcrSpan


def normalize_text(text: str) -> str:
    # NFC + whitespace only: preserve case, hyphens, slashes, and OCR mistakes.
    return " ".join(unicodedata.normalize("NFC", text).split())


_LABEL = re.compile(
    r"(?<![\w/-])(?P<label>"
    r"MODEL(?:\s+(?:NUMBER|NO\.?))?"
    r"|SKU(?:\s+(?:NUMBER|NO\.?))?"
    r"|PART(?:\s+(?:NUMBER|NO\.?))?"
    r"|P\s*/\s*N"
    r"|SERIAL(?:\s+(?:NUMBER|NO\.?))?"
    r"|S\s*/\s*N)(?![\w/-])",
    re.IGNORECASE,
)
# One complete identifier token. Never guess missing characters or join fragments.
_VALUE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._/+\-]*[A-Za-z0-9]")
_RESERVED = {
    "MODEL",
    "NO",
    "NUMBER",
    "SKU",
    "PART",
    "P/N",
    "SERIAL",
    "S/N",
    "FCC",
    "IC",
    "ID",
    "CE",
    "INPUT",
    "OUTPUT",
    "MADE",
    "UNKNOWN",
    "NONE",
}
_STANDALONE_BRANDS = {
    "SONY",
    "NINTENDO",
    "MICROSOFT",
    "LOGITECH",
    "SAMSUNG",
    "LG",
    "APPLE",
}
_BRAND_LABEL = re.compile(
    r"^(?P<label>BRAND|MANUFACTURER|MFR)\s*[:：#]?\s+(?P<value>.+)$",
    re.IGNORECASE,
)
_CORPORATE_NAME = re.compile(
    r"^(?P<value>[A-Za-z][A-Za-z0-9&'., -]{1,100}?\b"
    r"(?:Inc\.?|Ltd\.?|LLC|Corp\.?|Corporation|GmbH|Limited))(?=\s|$)",
    re.IGNORECASE,
)


def _kind(label: str) -> str:
    compact = re.sub(r"\s", "", label).upper()
    if compact.startswith("MODEL"):
        return "model_number"
    if compact.startswith("SKU"):
        return "sku"
    if compact.startswith("SERIAL") or compact == "S/N":
        return "serial_number"
    return "part_number"


def _span(region: OcrRegion, start: int, end: int) -> OcrSpan:
    return OcrSpan(region_index=region.region_index, start=start, end=end)


def _value(text: str, offset: int = 0) -> re.Match | None:
    # Consume only separators between label and value; never skip arbitrary words.
    start = offset + len(text[offset:]) - len(text[offset:].lstrip(" :：#=\t"))
    match = _VALUE.match(text, start)
    if match is None or match.group().upper().rstrip(".") in _RESERVED:
        return None
    # Reject partial tokens (including non-ASCII identifier characters).
    if match.end() < len(text) and not (
        text[match.end()].isspace() or text[match.end()] in ",;:)"
    ):
        return None
    return match


def _nearby(label: OcrRegion, candidate: OcrRegion) -> bool:
    """Restrict split labels to the same row on the right or immediately below."""
    if not label.polygon or not candidate.polygon:
        return False
    lx = [p[0] for p in label.polygon]
    ly = [p[1] for p in label.polygon]
    cx = [p[0] for p in candidate.polygon]
    cy = [p[1] for p in candidate.polygon]
    height = max(max(ly) - min(ly), max(cy) - min(cy), 1)
    same_row = abs((min(ly) + max(ly)) / 2 - (min(cy) + max(cy)) / 2)
    right = same_row <= height * 0.5 and 0 <= min(cx) - max(lx) <= height * 4
    below = 0 <= min(cy) - max(ly) <= height * 1.5 and abs(min(cx) - min(lx)) <= height
    return right or below


def extract_identifiers(
    regions: list[OcrRegion], image_index: int
) -> list[OcrIdentifier]:
    identifiers = []
    for region in regions:
        text = region.normalized_text
        for label in _LABEL.finditer(text):
            value_region = region
            value = _value(text, label.end())
            extraction = "explicit_label"
            if value is None and not text[label.end() :].strip(" :：#=\t"):
                # Geometry is mandatory. Never combine across images or ambiguous
                # neighbors, or attach a trailing label to an earlier same-line value.
                if text[: label.start()].strip():
                    continue
                neighbors = []
                for candidate in regions:
                    candidate_value = _value(candidate.normalized_text)
                    if (
                        candidate is not region
                        and candidate_value is not None
                        and candidate_value.end() == len(candidate.normalized_text)
                        and _nearby(region, candidate)
                    ):
                        neighbors.append((candidate, candidate_value))
                if len(neighbors) == 1:
                    value_region, value = neighbors[0]
                    # Do not attach one token to both MODEL and SERIAL (or any
                    # competing spatial labels). Leave ambiguous evidence raw.
                    competing_labels = [
                        other
                        for other in regions
                        if other is not region
                        and _LABEL.fullmatch(other.normalized_text.strip(" :：#=\t"))
                        and _nearby(other, value_region)
                    ]
                    if competing_labels:
                        continue
                    extraction = "spatial_label"
            if value is None:
                continue
            identifiers.append(
                OcrIdentifier(
                    source_image_index=image_index,
                    kind=_kind(label.group()),
                    value=value.group(),
                    extraction=extraction,
                    label=label.group(),
                    label_span=_span(region, label.start(), label.end()),
                    value_span=_span(value_region, value.start(), value.end()),
                )
            )
    return identifiers


def extract_brand_clues(
    regions: list[OcrRegion], image_index: int
) -> list[OcrBrandClue]:
    clues = []
    for region in regions:
        text = region.normalized_text
        labeled = _BRAND_LABEL.fullmatch(text)
        if labeled and not _LABEL.search(labeled.group("value")):
            start, end = labeled.span("value")
            kind = (
                "brand" if labeled.group("label").upper() == "BRAND" else "manufacturer"
            )
            extraction = "explicit_label"
        elif text.upper() in _STANDALONE_BRANDS:
            start, end = 0, len(text)
            kind = "brand"
            extraction = "standalone_allowlist"
        elif (corporate := _CORPORATE_NAME.match(text)) and not _LABEL.search(
            corporate.group("value")
        ):
            # Preserve a literal corporate name, without mapping it to a brand
            # or claiming that this image is a manufacturer label. Ignore the
            # following address/serial text rather than making it part of the name.
            start, end = corporate.span("value")
            kind = "manufacturer"
            extraction = "corporate_name"
        else:
            continue
        clues.append(
            OcrBrandClue(
                source_image_index=image_index,
                value=text[start:end],
                kind=kind,
                extraction=extraction,
                value_span=_span(region, start, end),
            )
        )
    return clues
