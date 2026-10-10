import { z } from "zod";
import type {
  ProductSearchResult,
  SearchIdentifier,
} from "@/lib/search/product-search";
import type { IdentificationStatus } from "@/types";
import type { SemanticVisionSignal } from "./fusion";

// Local readers for Python's versioned JSON, not new HTTP/API contracts. Keep
// unknown provenance fields; validate the fields used in adjudication.
const span = z.object({
  region_index: z.number().int().positive(),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
});
const imageIndex = z.number().int().positive();
const text = z.string().trim().min(1);
export const ocrEvidenceSchema = z
  .object({
    schema_version: z.literal("ocr.v1"),
    source: z.literal("paddleocr"),
    images: z.array(
      z.looseObject({
        source_image_index: imageIndex,
        regions: z.array(
          z.looseObject({
            region_index: z.number().int().positive(),
            raw_text: z.string(),
            normalized_text: z.string(),
          }),
        ),
        identifiers: z.array(
          z.looseObject({
            source_image_index: imageIndex,
            kind: z.enum([
              "model_number",
              "sku",
              "part_number",
              "serial_number",
            ]),
            value: text,
            extraction: z.enum(["explicit_label", "spatial_label"]),
            label: text,
            label_span: span,
            value_span: span,
          }),
        ),
        brand_clues: z.array(
          z.looseObject({
            source_image_index: imageIndex,
            value: text,
            kind: z.enum(["brand", "manufacturer"]),
            extraction: z.enum([
              "explicit_label",
              "standalone_allowlist",
              "corporate_name",
            ]),
            value_span: span,
          }),
        ),
      }),
    ),
  })
  .passthrough();

const model = z.looseObject({
  model_family: text,
  checkpoint: text,
  revision: text,
  embedding_dimension: z.number().int().positive(),
  preprocessing: text,
});
export const retrievalEvidenceSchema = z.looseObject({
  schema_version: z.literal("retrieval.v1"),
  source: z.literal("visual_retrieval"),
  metric: z.literal("cosine"),
  aggregation: z.literal("mean_query_cosine"),
  tie_break: z.literal("candidate_id_ascending"),
  model,
  query_images: z.array(
    z.object({
      source_image_index: imageIndex,
      image_id: text,
      source_url: z.string().nullable(),
    }),
  ),
  candidates: z.array(
    z.looseObject({
      candidate_id: text,
      image_id: text,
      source_url: z.string().nullable(),
      rank: z.number().int().positive(),
      similarity: z.number().min(-1).max(1),
      query_similarities: z.array(
        z.object({
          source_image_index: imageIndex,
          similarity: z.number().min(-1).max(1),
        }),
      ),
      model,
    }),
  ),
});

/** A source-linked interpretation of ONE observation, never a search score.
 * The caller must establish that the identifier names the subject product,
 * rather than an accessory target or another product mentioned on the page.
 * Merely filling this in from a literal match is invalid integration behavior.
 */
export interface ExternalAssociation {
  candidateId: string;
  observationIndex: number; // zero-based in Search candidate.observations
  relation: "product_identity" | "compatible_with" | "unresolved";
  identity: {
    brand: string | null;
    productName: string;
    variant: string | null;
  };
  identifiers: SearchIdentifier[];
  basis: string;
  // Optional common upstream source for syndicated/copied observations.
  originGroup?: string;
}

// deriveSearchAssociations supplies conservative direct-title findings. Other
// patterns require reviewed subject-product association; occurrence is not proof.

/** Optional inspection finding. Raw cosine scores cannot manufacture this. */
export interface VisualAssessment {
  candidateId: string;
  imageId: string;
  finding: "compatible" | "concern" | "contradiction";
  basis: string;
}

// TODO(VisualRetrieval): agree an inspection/validated mismatch policy before
// generating VisualAssessment from retrieval. Never threshold scores as identity.

export interface FusionInput {
  imageCount: number;
  ocr?: unknown;
  search?: ProductSearchResult;
  associations?: ExternalAssociation[]; // Omitted: derive from Search; []: opt out.
  retrieval?: unknown;
  visualAssessments?: VisualAssessment[];
  semantic?: SemanticVisionSignal;
}

export interface FusionIdentity {
  brand: string | null;
  productName: string | null;
  modelNumber: string | null;
  sku: string | null;
  partNumber: string | null;
  variant: string | null;
}

export interface EvidenceReference {
  id: string;
  source: "paddleocr" | "product_search" | "visual_retrieval" | "gemini";
  // Different processors of the same image share this underlying observation.
  observationGroup: string;
  imageIndexes: number[];
  candidateId?: string;
  sourceUrl?: string;
  observation: unknown;
}

export type MissingEvidenceType =
  | "physical_identifier"
  | "external_association"
  | "distinguishing_view"
  | "conflict_resolution";

export interface FusionResult {
  status: IdentificationStatus;
  identity: FusionIdentity | null;
  supportingEvidence: string[];
  conflictingEvidence: {
    code: string;
    evidenceRefs: string[];
    material: boolean;
  }[];
  reasonCodes: string[];
  needsMoreEvidence: boolean;
  missingEvidenceType: MissingEvidenceType | null;
  followUpReason: string | null;
  followUpOwner: "user" | "product_search" | "fusion" | null;
  provenance: EvidenceReference[];
}
