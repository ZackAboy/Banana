import "server-only";
import { z } from "zod";
import {
  productCandidateSchema,
  productIdentificationSchema,
} from "@/schemas/domain";
import { AppError } from "@/lib/errors";
import { MAX_IMAGES } from "@/lib/upload";

// Private model output; evidence never changes the shared API/provider contract.
const geminiIdentificationSchema = z.object({
  identification: productIdentificationSchema.safeExtend({
    candidates: z.array(productCandidateSchema).max(0),
  }),
  evidence: z.object({
    familySupported: z.boolean(),
    conflictingImages: z.boolean(),
    exactMatch: z.array(
      z.object({
        imageIndex: z.number().int().min(1).max(MAX_IMAGES),
        kind: z.enum([
          "model_number",
          "sku",
          "unique_label",
          "packaging",
          "visual_feature",
        ]),
        observation: z.string().trim().min(1),
        interpretation: z.string().trim().min(1),
      }),
    ),
  }),
});

export const identificationJsonSchema = z.toJSONSchema(
  geminiIdentificationSchema,
  { target: "draft-7" },
);

export function invalidGeminiResponse(): never {
  throw new AppError(
    "GEMINI_INVALID_RESPONSE",
    "Gemini did not return a valid product identification. Please try again with clear product photos.",
    502,
  );
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

export function parseGeminiIdentification(text: string, imageCount: number) {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return invalidGeminiResponse();
  }
  const parsed = geminiIdentificationSchema.safeParse(value);
  if (!parsed.success) return invalidGeminiResponse();
  const { identification, evidence } = parsed.data;
  if (evidence.exactMatch.some((clue) => clue.imageIndex > imageCount))
    return invalidGeminiResponse();

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
  // Never upgrade the model's cautious status based on a numeric score or OCR.
  if (identification.identificationStatus !== originalStatus)
    identification.reasoning += evidence.conflictingImages
      ? " Conflicting image evidence prevents confirmation; the proposed identity is tentative."
      : " Exact identity is not established by the supplied evidence; model and variant details remain tentative.";
  if (identification.identificationStatus !== "confirmed")
    identification.suggestedNextImage ??=
      "Take a clear photo of the model/SKU label on the back or bottom of the product.";

  // Revalidate after applying the evidence policy before exposing the result.
  const result = productIdentificationSchema.safeParse(identification);
  if (!result.success) return invalidGeminiResponse();
  return result.data;
}
