import "server-only";
import { productIdentificationSchema } from "@/schemas/domain";
import type { ProductIdentification } from "@/types";
import { brandRelationship } from "./brand-relationships";
import {
  adaptEvidence,
  comparableText,
  compareIdentifier,
} from "./evidence-adapters";
import type {
  FusionIdentity,
  FusionInput,
  FusionResult,
  MissingEvidenceType,
} from "./evidence-contracts";

/** No scores, source counts or Gemini status participate in confirmation. */
export function fuseProductEvidence(input: FusionInput): FusionResult {
  const evidence = adaptEvidence(input);
  const { physical, associations, brands, conflicts, reasons } = evidence;
  const supporting = new Set<string>();
  const conflict = (code: string, refs: string[], material = true) =>
    conflicts.push({ code, evidenceRefs: [...new Set(refs)], material });
  for (const [index, a] of physical.entries()) {
    for (const b of physical.slice(index + 1)) {
      const comparison = compareIdentifier(a.identifier, b.identifier);
      if (comparison !== "unrelated" && comparison !== "exact")
        conflict("physical_identifier_conflict", [a.ref, b.ref]);
    }
  }
  // Every explicit physical claim is checked, including claims on other views.
  const supported = associations.filter(({ association, identifiers, ref }) => {
    let exact = false;
    for (const external of identifiers) {
      for (const label of physical) {
        const comparison = compareIdentifier(
          label.identifier,
          external.identifier,
        );
        if (comparison === "exact") {
          exact = true;
          supporting.add(label.ref);
          supporting.add(ref);
          supporting.add(
            `search:${association.candidateId}:${association.observationIndex}`,
          );
        } else if (comparison === "different") {
          conflict("physical_external_identifier_conflict", [label.ref, ref]);
        } else if (comparison === "normalized") {
          reasons.add("normalized_identifier_agreement_is_insufficient");
        }
      }
    }
    for (const brand of brands) {
      if (
        association.identity.brand &&
        !brandRelationship(brand.value, association.identity.brand, brand.kind)
      )
        conflict("brand_conflict", [brand.ref, ref]);
      else if (association.identity.brand) {
        supporting.add(brand.ref);
        if (
          comparableText(brand.value) !==
          comparableText(association.identity.brand)
        )
          reasons.add("manufacturer_brand_name_relationship");
      }
    }
    for (const [index, a] of identifiers.entries()) {
      for (const b of identifiers.slice(index + 1)) {
        if (compareIdentifier(a.identifier, b.identifier) === "different")
          conflict("external_identifier_conflict", [a.ref, b.ref]);
      }
    }
    return exact;
  });
  // Equal display identities + typed claims can be grouped, never source IDs or
  // rank. Differently named identities remain ambiguous (no alias ontology).
  const identityKey = (item: (typeof associations)[number]) =>
    JSON.stringify([
      comparableText(item.association.identity.brand ?? ""),
      comparableText(item.association.identity.productName),
      comparableText(item.association.identity.variant ?? ""),
      [
        ...new Set(
          item.identifiers.map(({ identifier }) =>
            JSON.stringify([
              identifier.kind,
              identifier.kind === "model_number" &&
              identifier.caseSensitive !== true
                ? identifier.value.trim().toLowerCase()
                : identifier.value.trim(),
            ]),
          ),
        ),
      ].sort(),
    ]);
  const identities = new Set(supported.map(identityKey));
  if (identities.size > 1)
    conflict(
      "multiple_supported_identities",
      supported.map((s) => s.ref),
    );
  const relevantIds = new Set(
    associations.length
      ? (supported.length ? supported : associations).map(
          (a) => a.association.candidateId,
        )
      : (evidence.search?.candidates.map((c) => c.id) ?? []),
  );
  for (const visual of evidence.visual) {
    if (!relevantIds.has(visual.candidateId)) continue;
    if (visual.finding === "compatible") supporting.add(visual.ref);
    else
      conflict(
        visual.finding === "contradiction"
          ? "visual_contradiction"
          : "visual_concern",
        [visual.ref],
        visual.finding === "contradiction",
      );
  }
  const materialConflict = conflicts.some((c) => c.material);
  const visualConcern = conflicts.some((c) => c.code === "visual_concern");
  const confirmed =
    identities.size === 1 && !materialConflict && !visualConcern;

  // Pick a provisional identity only when there is a single possibility. Search
  // titles and Gemini may support a family, but cannot supply confirmation.
  const uniqueAssociations = new Map(
    associations.map((a) => [identityKey(a), a]),
  );
  const selected =
    identities.size === 1
      ? supported[0]
      : uniqueAssociations.size === 1
        ? [...uniqueAssociations.values()][0]
        : undefined;
  const singleCandidate =
    evidence.search?.candidates.length === 1
      ? evidence.search.candidates[0]
      : undefined;
  const semanticFamily = input.semantic?.evidence.familySupported
    ? input.semantic.identification
    : undefined;
  const provisional =
    selected?.association.identity ??
    (singleCandidate
      ? {
          brand: singleCandidate.brand,
          productName: singleCandidate.title,
          variant: singleCandidate.variant,
        }
      : semanticFamily);
  if (provisional === semanticFamily && semanticFamily)
    supporting.add("gemini:proposal");
  // Only corroborated identifiers or unique physical observations are projected;
  // tentative Gemini model guesses are not upgraded into resolved fields.
  const identifierValue = (kind: "model_number" | "sku" | "part_number") => {
    const values = physical.filter((p) => p.identifier.kind === kind);
    if (
      !values.length ||
      values.some(
        (v) =>
          compareIdentifier(values[0].identifier, v.identifier) !== "exact",
      )
    )
      return null;
    return values[0].identifier.value;
  };
  const identity: FusionIdentity = {
    brand:
      provisional?.brand ??
      (new Set(brands.map((b) => comparableText(b.value))).size === 1
        ? brands[0].value
        : null),
    productName: provisional?.productName ?? null,
    modelNumber: identifierValue("model_number"),
    sku: identifierValue("sku"),
    partNumber: identifierValue("part_number"),
    variant: provisional?.variant ?? null,
  };
  const ambiguous =
    identities.size > 1 ||
    (!selected && (evidence.search?.candidates.length ?? 0) > 1);
  const status = confirmed
    ? "confirmed"
    : materialConflict || ambiguous
      ? "uncertain"
      : identity.productName
        ? "likely"
        : "uncertain";
  let missing: MissingEvidenceType | null = null;
  let owner: FusionResult["followUpOwner"] = null;
  if (!confirmed) {
    if (materialConflict) {
      missing = "conflict_resolution";
      owner = "fusion";
    } else if (visualConcern || (ambiguous && !physical.length)) {
      missing = "distinguishing_view";
      owner = "user";
    } else if (physical.length) {
      missing = "external_association";
      owner = "product_search";
    } else {
      missing = "physical_identifier";
      owner = "user";
    }
  }
  reasons.add(
    confirmed
      ? "exact_physical_external_agreement"
      : "exact_identity_not_established",
  );
  if (!physical.length) reasons.add("strong_physical_identifier_missing");
  if (!supported.length) reasons.add("independent_external_agreement_missing");
  if (ambiguous) reasons.add("ambiguous_candidates");
  conflicts.forEach((c) => reasons.add(c.code));
  return {
    status,
    identity: Object.values(identity).some(Boolean) ? identity : null,
    supportingEvidence: [...supporting].sort(),
    conflictingEvidence: conflicts,
    reasonCodes: [...reasons].sort(),
    needsMoreEvidence: !confirmed,
    missingEvidenceType: missing,
    followUpReason: missing ? FOLLOW_UP_REASONS[missing] : null,
    followUpOwner: owner,
    provenance: evidence.provenance,
  };
}

const FOLLOW_UP_REASONS: Record<MissingEvidenceType, string> = {
  physical_identifier:
    "An explicit physical model/SKU/part-number observation is missing.",
  external_association:
    "The physical identifier is available; independent product association is missing or ambiguous.",
  distinguishing_view:
    "A distinguishing physical feature is needed to resolve visual or candidate ambiguity.",
  conflict_resolution:
    "Conflicting observations require reconciliation before exact identity can be established.",
};

/** Presentation mapping stays separate from decision rules. Search-side work
 * must never turn into a repeated request for a physical label. */
export function suggestedFusionImage(result: FusionResult): string | null {
  if (result.missingEvidenceType === "physical_identifier")
    return "Take a clear photo of the model/SKU/part-number label on the product.";
  if (result.missingEvidenceType === "distinguishing_view")
    return "Take another angle showing the physical features that distinguish the possible variants.";
  return null;
}

/** Backwards-compatible projection; detailed part-number/provenance findings
 * remain in FusionResult because ProductIdentification has no such fields. */
export function toProductIdentification(
  result: FusionResult,
  input: FusionInput,
): ProductIdentification {
  return productIdentificationSchema.parse({
    brand: result.identity?.brand ?? null,
    productName: result.identity?.productName ?? null,
    modelNumber: result.identity?.modelNumber ?? null,
    sku: result.identity?.sku ?? null,
    variant: result.identity?.variant ?? null,
    category: input.semantic?.identification.category ?? null,
    visibleText: input.ocr
      ? ocrText(input)
      : (input.semantic?.identification.visibleText ?? []),
    distinguishingFeatures:
      input.semantic?.identification.distinguishingFeatures ?? [],
    identificationStatus: result.status,
    reasoning:
      result.status === "confirmed"
        ? "An explicit physical identifier agrees exactly with independent external product association, with no unresolved contradiction."
        : (result.followUpReason ??
          "Exact identity is not established by the available evidence."),
    suggestedNextImage: suggestedFusionImage(result),
    candidates: [],
  });
}

function ocrText(input: FusionInput) {
  return adaptEvidence(input).visibleText;
}
