// A bounded lexical relationship, not a brand ontology or ownership lookup.
// Only manufacturer clues may shed corporate descriptors; explicit brands
// still require equality. Keep the original strings in evidence/provenance.
const normalized = (value: string) =>
  value.trim().toLowerCase().replace(/\s+/g, " ");
const legalSuffix =
  /(?:[,.]?\s+)(?:inc\.?|incorporated|ltd\.?|limited|llc|corp\.?|corporation|co\.?|company|plc)$/i;
const descriptors = new Set([
  "electronics",
  "interactive",
  "entertainment",
  "technology",
  "technologies",
  "products",
  "systems",
]);

export function brandRelationship(
  physical: string,
  external: string,
  kind: "brand" | "manufacturer",
): "exact" | "corporate_name" | null {
  if (normalized(physical) === normalized(external)) return "exact";
  if (kind !== "manufacturer" || !legalSuffix.test(physical.trim()))
    return null;
  const core = normalized(
    physical.trim().replace(legalSuffix, "").replace(/,$/, ""),
  );
  const brand = normalized(external);
  if (core === brand) return "corporate_name";
  // Require the complete leading brand, at least four letters, followed ONLY
  // by one or two generic corporate descriptors. Middle/shared tokens, short
  // initials, arbitrary company tails and suffix-free aliases do not qualify.
  if (
    !/^[\p{L}][\p{L}\p{N} ]*$/u.test(brand) ||
    (brand.match(/\p{L}/gu)?.length ?? 0) < 4 ||
    descriptors.has(brand) ||
    !core.startsWith(`${brand} `)
  )
    return null;
  const tail = core.slice(brand.length + 1).split(" ");
  return tail.length <= 2 && tail.every((token) => descriptors.has(token))
    ? "corporate_name"
    : null;
}
