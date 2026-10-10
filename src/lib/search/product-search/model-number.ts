import type { IdentifierObservation, SearchIdentifier } from "./types";

/** Lossy comparison only. Never use this as literal identifier evidence. */
export function normalizeModelNumber(value: string): string {
  return value
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[\s\p{Pd}_./]+/gu, "");
}

// Identifier continuation characters are excluded on BOTH sides. Unicode words,
// combining marks and punctuation used within identifiers cannot be boundaries.
const CONTINUATION = "\\p{L}\\p{N}\\p{M}\\p{Pd}_./+";
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Single contiguous tokens only. No joining neighboring words or source fields. */
export function extractModelNumbers(text: string): string[] {
  const words = text.match(/[\p{L}\p{N}]+(?:[-_./+][\p{L}\p{N}]+)*/gu) ?? [];
  return [
    ...new Set(
      words.filter(
        (word) =>
          word.length >= 5 &&
          /[a-z]/i.test(word) &&
          /\d/.test(word) &&
          !/^(?:\d+(?:GB|TB|MB|HZ|MM|CM|W|MAH|K|P|X|G)|USB\d.*|PS\d(?:TM)?|COVID19|\d{1,2}(?:AM|PM)(?:-\d{1,2}(?:AM|PM))?)$/i.test(
            word,
          ) &&
          !/[a-z]{6}/i.test(word),
      ),
    ),
  ];
}

export function identifierObservations(
  identifier: SearchIdentifier,
  text: string,
  field: string,
): IdentifierObservation[] {
  const value = identifier.value.trim();
  const caseSensitive =
    identifier.caseSensitive ?? identifier.kind !== "model_number";
  const literal = new RegExp(
    `(?<![${CONTINUATION}])${escape(value)}(?![${CONTINUATION}])`,
    caseSensitive ? "gu" : "giu",
  );
  const normalized = normalizeModelNumber(value);
  const out: IdentifierObservation[] = [];
  const add = (
    observedValue: string,
    match: IdentifierObservation["match"],
  ) => {
    if (
      !out.some((o) => o.observedValue === observedValue && o.match === match)
    )
      out.push({
        kind: identifier.kind,
        queryValue: identifier.value,
        normalizedQueryValue: normalized,
        caseSensitive,
        observedValue,
        normalizedObservedValue: normalizeModelNumber(observedValue),
        match,
        field,
      });
  };
  for (const match of text.matchAll(literal)) add(match[0], "literal");
  // Compare contiguous observed tokens only. Case/separator folding is WEAKER
  // evidence, including when SKU/part matching defaults to case-sensitive.
  for (const token of text.match(/[\p{L}\p{N}]+(?:[-_./+][\p{L}\p{N}]+)*/gu) ??
    []) {
    const n = normalizeModelNumber(token);
    if (
      n === normalized &&
      !out.some((o) => o.observedValue === token && o.match === "literal")
    )
      add(token, "normalized");
    else if (n !== normalized && n.startsWith(normalized))
      add(token, "extension");
  }
  return out;
}

export interface ModelNumberMatch {
  exact: boolean;
  normalized: boolean;
  suffixVariants: string[];
  seen: string[];
}
export function matchModelNumber(
  queryModel: string,
  text: string,
): ModelNumberMatch {
  const observations = identifierObservations(
    { kind: "model_number", value: queryModel },
    text,
    "text",
  );
  return {
    exact: observations.some((o) => o.match === "literal"),
    normalized: observations.some(
      (o) => o.match === "literal" || o.match === "normalized",
    ),
    suffixVariants: observations
      .filter((o) => o.match === "extension")
      .map((o) => o.observedValue),
    seen: [
      ...new Set([
        ...extractModelNumbers(text),
        ...observations.map((o) => o.observedValue),
      ]),
    ],
  };
}
