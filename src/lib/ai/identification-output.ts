import "server-only";
import { z } from "zod";
import {
  productCandidateSchema,
  productIdentificationSchema,
} from "@/schemas/domain";
import { AppError } from "@/lib/errors";
import { semanticVisionEvidenceSchema } from "@/schemas/evidence";
import { fuseEvidence } from "@/lib/identification/fusion";

// Private model output; evidence never changes the shared API/provider contract.
const geminiIdentificationSchema = z.object({
  identification: productIdentificationSchema.safeExtend({
    candidates: z.array(productCandidateSchema).max(0),
  }),
  evidence: semanticVisionEvidenceSchema,
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

export function parseGeminiIdentification(text: string, imageCount: number) {
  return fuseEvidence(parseGeminiSignal(text, imageCount));
}

export function parseGeminiSignal(text: string, imageCount: number) {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return invalidGeminiResponse();
  }
  const parsed = geminiIdentificationSchema.safeParse(value);
  if (!parsed.success) return invalidGeminiResponse();
  const { identification, evidence } = parsed.data;
  // Resolution metadata belongs to deterministic Fusion, never model output.
  delete identification.identityResolution;
  if (evidence.exactMatch.some((clue) => clue.imageIndex > imageCount))
    return invalidGeminiResponse();

  return { source: "gemini" as const, identification, evidence };
}
