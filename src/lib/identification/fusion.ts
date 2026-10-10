import "server-only";
import { productIdentificationSchema } from "@/schemas/domain";
import type { ProductIdentification, SemanticVisionEvidence } from "@/types";

export interface SemanticVisionSignal {
  source: "gemini";
  identification: ProductIdentification;
  evidence: SemanticVisionEvidence;
}

const normalize = (value: string) =>
  value.trim().toLowerCase().replace(/\s+/g, " ");
// Match complete identifiers, not e.g. MX3 inside MX3S.
function containsIdentifier(observation: string, identifier: string | null) {
  if (!identifier) return false;
  const escaped = normalize(identifier).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9_-])${escaped}($|[^a-z0-9_-])`).test(
    normalize(observation),
  );
}

// Initial fusion boundary: preserve the existing semantic-only policy.
// TODO(Fusion): accept independent OCR/retrieval/verification signals once their
// contracts include provenance and conflict handling. Do not invent score weights.
export function fuseEvidence(
  signal: SemanticVisionSignal,
): ProductIdentification {
  const identification = structuredClone(signal.identification);
  const { evidence } = signal;
  const observedText = identification.visibleText.map(normalize);
  const features = identification.distinguishingFeatures.map(normalize);
  const hasExactLabel = evidence.exactMatch.some((clue) => {
    if (!observedText.includes(normalize(clue.observation))) return false;
    if (clue.kind === "model_number")
      return containsIdentifier(clue.observation, identification.modelNumber);
    if (clue.kind === "sku")
      return containsIdentifier(clue.observation, identification.sku);
    if (clue.kind === "unique_label" || clue.kind === "packaging")
      return [
        identification.productName,
        identification.modelNumber,
        identification.sku,
      ].some((identifier) => containsIdentifier(clue.observation, identifier));
    return false;
  });
  const independentFeatures = new Set(
    evidence.exactMatch
      .filter(
        (clue) =>
          clue.kind === "visual_feature" &&
          features.includes(normalize(clue.observation)),
      )
      .map((clue) => normalize(clue.observation)),
  );
  const familySupported =
    evidence.familySupported &&
    Boolean(identification.brand || identification.productName);
  const strongEvidence = hasExactLabel || independentFeatures.size >= 2;
  const originalStatus = identification.identificationStatus;
  if (evidence.conflictingImages) {
    identification.identificationStatus = "uncertain";
  } else if (originalStatus === "confirmed" && !strongEvidence) {
    identification.identificationStatus = familySupported
      ? "likely"
      : "uncertain";
  } else if (originalStatus === "likely" && !familySupported) {
    identification.identificationStatus = "uncertain";
  }
  // Preserve cautious statuses until independent extraction provenance is available.
  if (identification.identificationStatus !== originalStatus)
    identification.reasoning += evidence.conflictingImages
      ? " Conflicting image evidence prevents confirmation; the proposed identity is tentative."
      : " Exact identity is not established by the supplied evidence; model and variant details remain tentative.";
  if (identification.identificationStatus !== "confirmed")
    identification.suggestedNextImage ??=
      "Take a clear photo of the model/SKU label on the back or bottom of the product.";

  return productIdentificationSchema.parse(identification);
}
