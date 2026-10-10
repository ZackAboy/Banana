import "server-only";
import {
  identifierObservations,
  productSearchResultSchema,
  type ExternalProductCandidate,
  type ProductSearchResult,
  type SourceObservation,
  type SearchIdentifier,
} from "@/lib/search/product-search";
import type { ExternalAssociation } from "./evidence-contracts";
import { brandRelationship } from "./brand-relationships";

const comparable = (value: string) =>
  value.trim().toLowerCase().replace(/\s+/g, " ");
// Intentionally small and conservative. These words make subject attribution
// ambiguous; rejecting them is not an attempt to classify all accessories/NLP.
const ambiguousSubject =
  /\b(for|with|compatible|compatibility|fits?|replacement|not|incompatible|except|case|cover|dock|review|versus|vs|support|manual|guide|article)\b/i;
const identifierLabel =
  /\b(model(?:\s+number)?|sku|mpn|part\s+number|p\/n)\s*[:#]?\s*$/i;

/** Guard relationships to THIS identifier, not commerce prose elsewhere in a
 * snippet. Uses Search's literal matcher; never creates identifier evidence. */
export function identifierIsRelationshipTarget(
  text: string,
  identifier: SearchIdentifier,
) {
  return identifierObservations(identifier, text, "source").some((match) => {
    if (match.match !== "literal") return false;
    let position = text.indexOf(match.observedValue);
    while (position >= 0) {
      if (
        /\b(compatible\s+with|works?\s+with|designed\s+for|fits?|replacement\b[^.;:\n]*\bfor|(?:case|cover|dock)\b[^.;:\n]*\bfor|not|incompatible|except|versus|vs)\b[^.;:\n]*$/i.test(
          text.slice(0, position),
        ) ||
        /^\s+(?:vs\.?|versus)\b/i.test(
          text.slice(position + match.observedValue.length),
        )
      )
        return true;
      position = text.indexOf(
        match.observedValue,
        position + match.observedValue.length,
      );
    }
    return false;
  });
}

// Only clearly delimited fields, never an arbitrary prose occurrence. MPN is a
// part number, NOT a model number just because the search query used that kind.
function specificationFields(snippet: string) {
  return [
    ...snippet
      .replace(/^\s*Specifications\s*:\s*/i, "")
      .matchAll(
        /(?:^|[;\n])\s*(brand|manufacturer|product(?:\s+name)?|model(?:\s+number)?|sku|mpn|part\s+number|p\/n)\s*[:,]\s*([^;\n]+)/gi,
      ),
  ].map((match) => ({ label: comparable(match[1]), value: match[2].trim() }));
}

function sourceBrand(
  observation: SourceObservation,
  queryBrand?: string | null,
) {
  const labeled = specificationFields(observation.snippet ?? "")
    .filter((field) => field.label === "brand")
    .map((field) => field.value);
  const explicit = [observation.brandClue, ...labeled].filter(
    (value): value is string => Boolean(value?.trim()),
  );
  if (new Set(explicit.map(comparable)).size > 1) return null;
  if (explicit.length)
    return {
      value: explicit[0].trim(),
      basis: "source brand metadata/labeled Brand field",
    };
  if (!queryBrand) return null;
  // The query supplies a spelling hint only. The brand must actually occur as
  // whole leading words in the source title, independently of the query.
  const words = observation.title.trim().split(/\s+/);
  for (let length = words.length - 1; length > 0; length--) {
    const prefix = words.slice(0, length).join(" ");
    if (brandRelationship(queryBrand, prefix, "manufacturer"))
      return {
        value: prefix,
        basis:
          "literal source-title brand prefix grounded by the query clue (bounded corporate-name comparison)",
      };
  }
  return null;
}

/** Source IDs are groups: never select the representative title over another
 * observation. Different wording remains unresolved; no alias inference. */
export function searchGroupHasConflict(candidate: ExternalProductCandidate) {
  // Do not accept the nicest title while a second observation negates it or
  // describes a compatibility target. Different prose is left unresolved too.
  if (
    candidate.observations.length > 1 &&
    candidate.observations.some(
      (o) =>
        ambiguousSubject.test(o.title) ||
        o.identifiers.some((id) =>
          identifierIsRelationshipTarget(o.snippet ?? "", {
            kind: id.kind,
            value: id.queryValue,
            caseSensitive: id.caseSensitive,
          }),
        ),
    )
  )
    return true;
  for (const field of [
    "title",
    "snippet",
    "brandClue",
    "variantClue",
  ] as const) {
    const values = candidate.observations
      .map((o) => o[field])
      .filter((v) => v?.trim());
    if (new Set(values.map((v) => comparable(v!))).size > 1) return true;
  }
  const identifiers = candidate.observations.flatMap((o) => o.identifiers);
  return identifiers.some((a, index) =>
    identifiers.slice(index + 1).some((b) => {
      if (a.kind !== b.kind) return false;
      return !identifierObservations(
        {
          kind: a.kind,
          value: a.observedValue,
          caseSensitive: a.caseSensitive || b.caseSensitive,
        },
        b.observedValue,
        "group",
      ).some(
        (m) => m.match === "literal" && m.observedValue === b.observedValue,
      );
    }),
  );
}

function subjectAssociation(
  observation: SourceObservation,
  queryBrand?: string | null,
  reject: (reason: string) => void = () => {},
) {
  const title = observation.title.trim();
  const grounding = sourceBrand(observation, queryBrand);
  const brand = grounding?.value;
  const failures = [
    !brand && "source_brand_clue_missing",
    brand &&
      !comparable(title).startsWith(`${comparable(brand)} `) &&
      "source_brand_not_title_prefix",
    ambiguousSubject.test(title) && "ambiguous_subject_title",
    observation.identifiers.some((id) =>
      identifierIsRelationshipTarget(observation.snippet ?? "", {
        kind: id.kind,
        value: id.queryValue,
        caseSensitive: id.caseSensitive,
      }),
    ) && "ambiguous_subject_snippet",
    /[;?!]|\s[|/]\s/.test(title) && "ambiguous_title_punctuation",
  ].filter((reason): reason is string => Boolean(reason));
  if (!brand || failures.length) {
    failures.forEach(reject);
    return [];
  }
  if (!observation.identifiers.length) reject("identifier_observation_missing");

  return observation.identifiers.flatMap((claim) => {
    // Query identifiers are clues, not observed facts. Require the Search
    // observation AND a fresh literal check against the exact title field.
    if (claim.match !== "literal") {
      reject("literal_title_identifier_missing");
      return [];
    }
    const inTitle = claim.field === `${observation.field}.title`;
    const fields = specificationFields(observation.snippet ?? "");
    const role = (label: string) =>
      label === "sku"
        ? "sku"
        : /^(mpn|part|p\/n)/.test(label)
          ? "part_number"
          : "model_number";
    const specification =
      !inTitle &&
      claim.field === `${observation.field}.snippet` &&
      fields.some(
        (field) =>
          field.label === "brand" &&
          comparable(field.value) === comparable(brand),
      ) &&
      !fields.some((field) =>
        fields.some(
          (other) =>
            other.label === field.label &&
            comparable(other.value) !== comparable(field.value),
        ),
      ) &&
      fields.some(
        (field) =>
          [
            "model",
            "model number",
            "sku",
            "mpn",
            "part number",
            "p/n",
          ].includes(field.label) &&
          role(field.label) === claim.kind &&
          field.value === claim.observedValue,
      ) &&
      fields.some(
        (field) =>
          ["product", "product name", "model"].includes(field.label) &&
          comparable(`${brand} ${field.value}`) === comparable(title),
      );
    if (!inTitle && !specification) {
      reject("literal_title_identifier_missing");
      return [];
    }
    const matches = identifierObservations(
      {
        kind: claim.kind,
        value: claim.queryValue,
        caseSensitive: claim.caseSensitive,
      },
      inTitle ? title : (observation.snippet ?? ""),
      claim.field,
    );
    if (
      !matches.some(
        (m) => m.match === "literal" && m.observedValue === claim.observedValue,
      )
    ) {
      reject("literal_title_identifier_not_grounded");
      return [];
    }
    const ending = title.replace(/\s*[)\]]\s*$/, "").trimEnd();
    if (inTitle && !ending.endsWith(claim.observedValue)) {
      reject("identifier_not_title_suffix");
      return [];
    }
    let name = inTitle
      ? ending.slice(0, -claim.observedValue.length).trimEnd()
      : title;
    const label = name.match(identifierLabel);
    const expectedKind =
      label?.[1].toLowerCase() === "sku"
        ? "sku"
        : label && /^(part|p\/n|mpn)/i.test(label[1])
          ? "part_number"
          : "model_number";
    // A bare listing suffix can be a model. SKU/part roles need an explicit
    // label so a query's typed clue cannot relabel an unlabeled product model.
    if (
      inTitle &&
      ((label && expectedKind !== claim.kind) ||
        (!label && claim.kind !== "model_number"))
    ) {
      reject("identifier_role_not_established");
      return [];
    }
    if (label) name = name.slice(0, label.index).trimEnd();
    name = name.replace(/\s*[(\[]\s*$/, "").trim();
    const description = comparable(name).slice(comparable(brand).length).trim();
    if (!description || !/\p{L}/u.test(description)) {
      reject("descriptive_product_name_missing");
      return [];
    }
    // A repeated identifier in the name is ambiguous, rather than another vote.
    if (
      identifierObservations(
        {
          kind: claim.kind,
          value: claim.queryValue,
          caseSensitive: claim.caseSensitive,
        },
        name,
        "name",
      ).length
    ) {
      reject("identifier_repeated_in_product_name");
      return [];
    }
    const variant = observation.variantClue?.trim() || null;
    if (
      variant &&
      !` ${comparable(`${title} ${observation.snippet ?? ""}`)} `.includes(
        ` ${comparable(variant)} `,
      )
    ) {
      reject("variant_not_grounded");
      return [];
    }
    return [
      {
        identity: { brand, productName: name, variant },
        identifier: {
          kind: claim.kind,
          value: claim.observedValue,
          caseSensitive: claim.caseSensitive,
        },
        basis: inTitle
          ? `${grounding!.basis}; ${claim.kind} ${JSON.stringify(claim.observedValue)} is a literal ${claim.field} suffix${claim.kind === "model_number" ? "" : " with an explicit typed label"}; a descriptive product name precedes it`
          : `${grounding!.basis}; labeled specification product name agrees with the subject title; literal ${claim.field} has an explicit ${claim.kind} field`,
      },
    ];
  });
}

/** Offline positive subject association only. No query/rank/score-based identity
 * inference. Candidate + observation index dereference the full Search provenance. */
export function deriveSearchAssociations(
  search: ProductSearchResult,
): ExternalAssociation[] {
  return deriveAssociations(search);
}

/** Development inspection of the same rules, never a second association policy. */
export function inspectSearchAssociations(search: ProductSearchResult) {
  const rejections: {
    candidateId: string;
    observationIndex: number;
    reason: string;
  }[] = [];
  const associations = deriveAssociations(search, (rejection) =>
    rejections.push(rejection),
  );
  return {
    associations,
    rejections: rejections.filter(
      (rejection) =>
        !associations.some(
          (association) =>
            association.candidateId === rejection.candidateId &&
            association.observationIndex === rejection.observationIndex,
        ),
    ),
  };
}

function deriveAssociations(
  search: ProductSearchResult,
  reject?: (rejection: {
    candidateId: string;
    observationIndex: number;
    reason: string;
  }) => void,
): ExternalAssociation[] {
  const result = productSearchResultSchema.parse(search);
  return result.candidates.flatMap((candidate) => {
    if (searchGroupHasConflict(candidate)) {
      candidate.observations.forEach((_, observationIndex) =>
        reject?.({
          candidateId: candidate.id,
          observationIndex,
          reason: "source_group_conflict",
        }),
      );
      return [];
    }
    return candidate.observations.flatMap((observation, observationIndex) =>
      subjectAssociation(observation, result.query.brand, (reason) =>
        reject?.({ candidateId: candidate.id, observationIndex, reason }),
      ).map(({ identity, identifier, basis }) => ({
        candidateId: candidate.id,
        observationIndex,
        relation: "product_identity" as const,
        identity,
        identifiers: [identifier],
        basis: `Direct subject association: ${basis}; no guarded accessory, compatibility or negation relationship, and no source-group disagreement.`,
      })),
    );
  });
}
