import "server-only";
import {
  identifierObservations,
  productSearchResultSchema,
  type ExternalProductCandidate,
  type ProductSearchResult,
  type SourceObservation,
} from "@/lib/search/product-search";
import type { ExternalAssociation } from "./evidence-contracts";

const comparable = (value: string) =>
  value.trim().toLowerCase().replace(/\s+/g, " ");
// Intentionally small and conservative. These words make subject attribution
// ambiguous; rejecting them is not an attempt to classify all accessories/NLP.
const ambiguousSubject =
  /\b(for|compatible|compatibility|fits?|replacement|not|incompatible|except|case|cover|dock|review|versus|vs)\b/i;
const identifierLabel =
  /\b(model(?:\s+number)?|sku|part\s+number|p\/n)\s*[:#]?\s*$/i;

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
        ambiguousSubject.test(o.snippet ?? ""),
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

function subjectAssociation(observation: SourceObservation) {
  const title = observation.title.trim();
  const brand = observation.brandClue?.trim();
  if (
    !brand ||
    !comparable(title).startsWith(`${comparable(brand)} `) ||
    ambiguousSubject.test(title) ||
    ambiguousSubject.test(observation.snippet ?? "") ||
    /[;?!]|\s[|/]\s/.test(title)
  )
    return [];

  return observation.identifiers.flatMap((claim) => {
    // Query identifiers are clues, not observed facts. Require the Search
    // observation AND a fresh literal check against the exact title field.
    if (
      claim.match !== "literal" ||
      claim.field !== `${observation.field}.title`
    )
      return [];
    const matches = identifierObservations(
      {
        kind: claim.kind,
        value: claim.queryValue,
        caseSensitive: claim.caseSensitive,
      },
      title,
      claim.field,
    );
    if (
      !matches.some(
        (m) => m.match === "literal" && m.observedValue === claim.observedValue,
      )
    )
      return [];
    const ending = title.replace(/\s*[)\]]\s*$/, "").trimEnd();
    if (!ending.endsWith(claim.observedValue)) return [];
    let name = ending.slice(0, -claim.observedValue.length).trimEnd();
    const label = name.match(identifierLabel);
    const expectedKind =
      label?.[1].toLowerCase() === "sku"
        ? "sku"
        : label && /^(part|p\/n)/i.test(label[1])
          ? "part_number"
          : "model_number";
    // A bare listing suffix can be a model. SKU/part roles need an explicit
    // label so a query's typed clue cannot relabel an unlabeled product model.
    if (
      (label && expectedKind !== claim.kind) ||
      (!label && claim.kind !== "model_number")
    )
      return [];
    if (label) name = name.slice(0, label.index).trimEnd();
    name = name.replace(/\s*[(\[]\s*$/, "").trim();
    const description = comparable(name).slice(comparable(brand).length).trim();
    if (!description || !/\p{L}/u.test(description)) return [];
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
    )
      return [];
    const variant = observation.variantClue?.trim() || null;
    if (
      variant &&
      !` ${comparable(`${title} ${observation.snippet ?? ""}`)} `.includes(
        ` ${comparable(variant)} `,
      )
    )
      return [];
    return [
      {
        identity: { brand, productName: name, variant },
        identifier: {
          kind: claim.kind,
          value: claim.observedValue,
          caseSensitive: claim.caseSensitive,
        },
        field: claim.field,
      },
    ];
  });
}

/** Offline positive subject association only. No query/rank/score-based identity
 * inference. Candidate + observation index dereference the full Search provenance. */
export function deriveSearchAssociations(
  search: ProductSearchResult,
): ExternalAssociation[] {
  const result = productSearchResultSchema.parse(search);
  return result.candidates.flatMap((candidate) => {
    if (searchGroupHasConflict(candidate)) return [];
    return candidate.observations.flatMap((observation, observationIndex) =>
      subjectAssociation(observation).map(
        ({ identity, identifier, field }) => ({
          candidateId: candidate.id,
          observationIndex,
          relation: "product_identity" as const,
          identity,
          identifiers: [identifier],
          basis: `Direct subject title: source brand is the title prefix; ${identifier.kind} ${JSON.stringify(identifier.value)} is a literal ${field} suffix${identifier.kind === "model_number" ? "" : " with an explicit typed label"}; a descriptive product name precedes it; no guarded accessory, compatibility or negation wording, and no source-group disagreement.`,
        }),
      ),
    );
  });
}
