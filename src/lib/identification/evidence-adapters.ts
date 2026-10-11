import "server-only";
import {
  identifierObservations,
  productSearchResultSchema,
  searchIdentifierSchema,
  type SearchIdentifier,
} from "@/lib/search/product-search";
import { semanticVisionEvidenceSchema } from "@/schemas/evidence";
import { productIdentificationSchema } from "@/schemas/domain";
import {
  deriveSearchAssociations,
  searchGroupHasConflict,
  identifierIsRelationshipTarget,
} from "./search-associations";
import {
  ocrEvidenceSchema,
  retrievalEvidenceSchema,
  type EvidenceReference,
  type ExternalAssociation,
  type FusionInput,
  type FusionResult,
} from "./evidence-contracts";

export const comparableText = (value: string) =>
  value.trim().toLowerCase().replace(/\s+/g, " ");

// Delegate typed/case/separator semantics to Search's public comparator.
export function compareIdentifier(a: SearchIdentifier, b: SearchIdentifier) {
  if (a.kind !== b.kind) return "unrelated";
  const defaultSensitive = a.kind !== "model_number";
  const caseSensitive =
    (a.caseSensitive ?? defaultSensitive) ||
    (b.caseSensitive ?? defaultSensitive);
  const matches = identifierObservations(
    { ...a, caseSensitive },
    b.value,
    "value",
  ).filter((match) => match.observedValue === b.value.trim());
  if (matches.some((match) => match.match === "literal")) return "exact";
  if (matches.some((match) => match.match === "normalized"))
    return "normalized";
  return "different";
}

interface IdentifierClaim {
  identifier: SearchIdentifier;
  ref: string;
}
export interface AdaptedEvidence {
  physical: IdentifierClaim[];
  brands: { value: string; kind: "brand" | "manufacturer"; ref: string }[];
  associations: {
    association: ExternalAssociation;
    identifiers: IdentifierClaim[];
    ref: string;
  }[];
  visual: { candidateId: string; finding: string; ref: string }[];
  provenance: EvidenceReference[];
  conflicts: FusionResult["conflictingEvidence"];
  reasons: Set<string>;
  search: FusionInput["search"];
  visibleText: string[];
}

export function adaptEvidence(input: FusionInput): AdaptedEvidence {
  if (!Number.isInteger(input.imageCount) || input.imageCount < 1)
    throw new Error("Fusion requires a positive imageCount.");
  const checkImage = (index: number) => {
    if (!Number.isInteger(index) || index < 1 || index > input.imageCount)
      throw new Error("Fusion evidence references an unavailable image.");
  };
  const result: AdaptedEvidence = {
    physical: [],
    brands: [],
    associations: [],
    visual: [],
    provenance: [],
    conflicts: [],
    reasons: new Set(),
    search: input.search
      ? productSearchResultSchema.parse(input.search)
      : undefined,
    visibleText: [],
  };
  const add = (ref: EvidenceReference) => {
    result.provenance.push(ref);
    return ref.id;
  };
  if (input.ocr) {
    const ocr = ocrEvidenceSchema.parse(input.ocr);
    const seenImages = new Set<number>();
    for (const image of ocr.images) {
      const index = image.source_image_index;
      checkImage(index);
      if (seenImages.has(index)) throw new Error("Duplicate OCR image index.");
      seenImages.add(index);
      const regions = new Map(
        image.regions.map((region) => [region.region_index, region]),
      );
      if (regions.size !== image.regions.length)
        throw new Error("Duplicate OCR region index.");
      // Python offsets count Unicode code points, not JavaScript UTF-16 units.
      const checkSpan = (
        span: { region_index: number; start: number; end: number },
        value: string,
      ) => {
        const region = regions.get(span.region_index);
        const characters = Array.from(region?.normalized_text ?? "");
        if (
          !region ||
          span.end <= span.start ||
          span.end > characters.length ||
          characters.slice(span.start, span.end).join("") !== value
        )
          throw new Error("OCR span does not support its literal observation.");
      };
      result.visibleText.push(...image.regions.map((r) => r.raw_text));
      add({
        id: `ocr:${index}`,
        source: "paddleocr",
        observationGroup: `physical:${index}`,
        imageIndexes: [index],
        observation: { ...ocr, images: [image] },
      });
      image.identifiers.forEach((identifier, offset) => {
        if (identifier.source_image_index !== index)
          throw new Error("OCR identifier image provenance disagrees.");
        checkSpan(identifier.value_span, identifier.value);
        checkSpan(identifier.label_span, identifier.label);
        const ref = add({
          id: `ocr:${index}:identifier:${offset}`,
          source: "paddleocr",
          observationGroup: `physical:${index}`,
          imageIndexes: [index],
          observation: identifier,
        });
        if (identifier.kind === "serial_number") {
          result.reasons.add("serial_number_excluded");
        } else if (identifier.extraction === "explicit_label") {
          result.physical.push({
            identifier: { kind: identifier.kind, value: identifier.value },
            ref,
          });
        } else result.reasons.add("spatial_label_requires_verification");
      });
      image.brand_clues.forEach((brand, offset) => {
        if (brand.source_image_index !== index)
          throw new Error("OCR brand image provenance disagrees.");
        checkSpan(brand.value_span, brand.value);
        const ref = add({
          id: `ocr:${index}:brand:${offset}`,
          source: "paddleocr",
          observationGroup: `physical:${index}`,
          imageIndexes: [index],
          observation: brand,
        });
        result.brands.push({ value: brand.value, kind: brand.kind, ref });
      });
    }
  }
  for (const candidate of result.search?.candidates ?? []) {
    candidate.observations.forEach((observation, index) =>
      add({
        id: `search:${candidate.id}:${index}`,
        source:
          observation.kind === "visual" ? "google_lens" : "product_search",
        // Same-domain repeats never increase evidence strength. There is no vote
        // count; originGroup below can additionally link syndicated observations.
        observationGroup: `external:${new URL(observation.url).hostname}`,
        imageIndexes: observation.sourceImageIndex
          ? [observation.sourceImageIndex]
          : [],
        candidateId: candidate.id,
        sourceUrl: observation.url,
        observation,
      }),
    );
    candidate.observations.forEach((o) => {
      if (o.sourceImageIndex) checkImage(o.sourceImageIndex);
    });
    candidate.observations.forEach((observation, index) => {
      for (const mention of observation.identifiers) {
        for (const physical of result.physical) {
          if (
            compareIdentifier(physical.identifier, {
              kind: mention.kind,
              value: mention.observedValue,
              caseSensitive: mention.caseSensitive,
            }) === "different"
          )
            result.conflicts.push({
              code: "unresolved_external_identifier_disagreement",
              evidenceRefs: [physical.ref, `search:${candidate.id}:${index}`],
              material: false,
            });
        }
      }
    });
    if (searchGroupHasConflict(candidate))
      result.conflicts.push({
        code: "source_group_identity_conflict",
        material: true,
        evidenceRefs: candidate.observations.map(
          (_, index) => `search:${candidate.id}:${index}`,
        ),
      });
  }
  result.search?.providerRuns.forEach((run, index) => {
    add({
      id: `search:run:${index}`,
      source: "product_search",
      observationGroup: `provider:${run.provider}`,
      imageIndexes: [],
      observation: run,
    });
    if (run.status === "error" || run.status === "partial")
      result.reasons.add("search_incomplete_or_unavailable");
  });
  const ids = (result.search?.candidates ?? []).map((c) => c.id);
  if (new Set(ids).size !== ids.length)
    throw new Error("Duplicate Search candidate ID.");
  // An explicit array (including []) retains caller control. Omitted findings
  // derive only the narrow direct-subject cases supported by returned Search.
  const associations =
    input.associations ??
    (result.search ? deriveSearchAssociations(result.search) : []);
  for (const [index, association] of associations.entries()) {
    const candidate = result.search?.candidates.find(
      (c) => c.id === association.candidateId,
    );
    const observation = candidate?.observations[association.observationIndex];
    if (
      !observation ||
      !Number.isInteger(association.observationIndex) ||
      !association.basis.trim() ||
      !association.identity.productName.trim()
    )
      throw new Error(
        "Association requires a source observation, identity and basis.",
      );
    const ref = add({
      id: `association:${index}`,
      source: "product_search",
      observationGroup: association.originGroup
        ? `external:${association.originGroup}`
        : `external:${new URL(observation.url).hostname}`,
      imageIndexes: [],
      candidateId: association.candidateId,
      sourceUrl: observation.url,
      observation: {
        ...association,
        sourceRef: `search:${candidate!.id}:${association.observationIndex}`,
      },
    });
    // Defensive veto, not an accessory classifier: a reviewed association still
    // must distinguish the page's subject from compatibility targets. An
    // unrelated statement AFTER the identifier (e.g. console compatibility)
    // must not turn a genuine product model into an accessory target.
    const declaredIdentifiers = association.identifiers.map((id) =>
      searchIdentifierSchema.parse(id),
    );
    const fields = [observation.title, observation.snippet ?? ""];
    const compatibilityText = fields.some((field) =>
      declaredIdentifiers.some((identifier) =>
        identifierIsRelationshipTarget(field, identifier),
      ),
    );
    if (association.relation !== "product_identity" || compatibilityText) {
      result.reasons.add("external_association_unresolved");
      continue;
    }
    const identifiers = declaredIdentifiers.map((identifier) => {
      // Do not join fields to manufacture a complete identifier occurrence.
      const literal = fields.some((field) =>
        identifierObservations(identifier, field, "source").some(
          (m) => m.match === "literal",
        ),
      );
      if (!literal)
        throw new Error(
          "Association identifier lacks literal source evidence.",
        );
      return { identifier, ref };
    });
    result.associations.push({ association, identifiers, ref });
    // Source groups are not canonical products. Preserve disagreements even
    // when the caller selected only one observation as product association.
    for (const [offset, other] of candidate!.observations.entries()) {
      const otherRef = `search:${candidate!.id}:${offset}`;
      for (const claim of other.identifiers) {
        if (
          identifiers.some(
            ({ identifier }) =>
              compareIdentifier(identifier, {
                kind: claim.kind,
                value: claim.observedValue,
                caseSensitive: claim.caseSensitive,
              }) === "different",
          )
        )
          result.conflicts.push({
            code: "source_group_identifier_conflict",
            evidenceRefs: [ref, otherRef],
            material: true,
          });
      }
      for (const [field, clue] of [
        ["brand", other.brandClue],
        ["variant", other.variantClue],
      ] as const) {
        const expected = association.identity[field];
        if (
          expected &&
          clue &&
          comparableText(expected) !== comparableText(clue)
        )
          result.conflicts.push({
            code: `${field}_conflict`,
            evidenceRefs: [ref, otherRef],
            material: true,
          });
      }
    }
  }
  if (input.retrieval) {
    const retrieval = retrievalEvidenceSchema.parse(input.retrieval);
    retrieval.query_images.forEach((image) =>
      checkImage(image.source_image_index),
    );
    const queryIndexes = new Set(
      retrieval.query_images.map((q) => q.source_image_index),
    );
    const visualKeys = new Set<string>();
    for (const [index, candidate] of retrieval.candidates.entries()) {
      if (!ids.includes(candidate.candidate_id))
        throw new Error("Retrieval candidate is unknown to Search.");
      const searchCandidate = result.search!.candidates.find(
        (c) => c.id === candidate.candidate_id,
      )!;
      if (
        candidate.source_url &&
        !searchCandidate.imageUrls.includes(candidate.source_url)
      )
        throw new Error(
          "Retrieval image URL is not linked to its Search candidate.",
        );
      const key = JSON.stringify([candidate.candidate_id, candidate.image_id]);
      if (visualKeys.has(key))
        throw new Error("Duplicate retrieval candidate image.");
      visualKeys.add(key);
      candidate.query_similarities.forEach((q) => {
        checkImage(q.source_image_index);
        if (!queryIndexes.has(q.source_image_index))
          throw new Error("Retrieval query provenance is missing.");
      });
      const ref = add({
        id: `retrieval:${index}`,
        source: "visual_retrieval",
        observationGroup: `comparison:${key}`,
        candidateId: candidate.candidate_id,
        imageIndexes: candidate.query_similarities.map(
          (q) => q.source_image_index,
        ),
        sourceUrl: candidate.source_url ?? undefined,
        observation: { ...retrieval, candidates: [candidate] },
      });
      for (const [offset, assessment] of (
        input.visualAssessments ?? []
      ).entries()) {
        if (
          assessment.candidateId !== candidate.candidate_id ||
          assessment.imageId !== candidate.image_id
        )
          continue;
        if (!assessment.basis.trim())
          throw new Error("Visual assessment needs a basis.");
        const assessmentRef = add({
          id: `visual:${offset}`,
          source: "visual_retrieval",
          observationGroup: `comparison:${key}`,
          candidateId: candidate.candidate_id,
          imageIndexes: candidate.query_similarities.map(
            (q) => q.source_image_index,
          ),
          observation: { ...assessment, retrievalRef: ref },
        });
        result.visual.push({
          candidateId: candidate.candidate_id,
          finding: assessment.finding,
          ref: assessmentRef,
        });
      }
    }
    result.reasons.add("raw_similarity_is_not_identity");
  }
  if ((input.visualAssessments?.length ?? 0) !== result.visual.length)
    throw new Error("Visual assessment references an unavailable comparison.");
  if (input.semantic) {
    const evidence = semanticVisionEvidenceSchema.parse(
      input.semantic.evidence,
    );
    productIdentificationSchema.parse(input.semantic.identification);
    evidence.exactMatch.forEach((clue, index) => {
      checkImage(clue.imageIndex);
      add({
        id: `gemini:${index}`,
        source: "gemini",
        observationGroup: `physical:${clue.imageIndex}`,
        imageIndexes: [clue.imageIndex],
        observation: clue,
      });
      // A conflicting transcription is a concern about the images, not an
      // independent vote. Pure Gemini model guesses do not veto exact evidence.
      const kind = clue.kind;
      const value =
        kind === "model_number"
          ? input.semantic!.identification.modelNumber
          : kind === "sku"
            ? input.semantic!.identification.sku
            : null;
      if (
        value &&
        (kind === "model_number" || kind === "sku") &&
        input.semantic!.identification.visibleText.some(
          (t) => comparableText(t) === comparableText(clue.observation),
        ) &&
        identifierObservations(
          { kind, value },
          clue.observation,
          "semantic",
        ).some((m) => m.match === "literal")
      ) {
        for (const physical of result.physical) {
          if (
            compareIdentifier(physical.identifier, { kind, value }) ===
            "different"
          )
            result.conflicts.push({
              code: "semantic_label_conflict",
              evidenceRefs: [physical.ref, `gemini:${index}`],
              material: true,
            });
        }
      }
    });
    const ref = add({
      id: "gemini:proposal",
      source: "gemini",
      observationGroup: "semantic:all_views",
      imageIndexes: Array.from({ length: input.imageCount }, (_, i) => i + 1),
      observation: input.semantic,
    });
    if (evidence.conflictingImages)
      result.conflicts.push({
        code: "conflicting_images",
        evidenceRefs: [ref],
        material: true,
      });
    result.reasons.add("semantic_evidence_not_independent_label_confirmation");
  }
  return result;
}
