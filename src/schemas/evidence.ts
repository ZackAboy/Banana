import { z } from "zod";
import { MAX_IMAGES } from "@/lib/upload";

// Image-indexed semantic observations; Gemini is the current source.
// These are model observations, not independent OCR or external verification.
export const semanticVisionEvidenceSchema = z.object({
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
});
