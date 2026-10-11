import "server-only";
import type { ProductSearchResult } from "@/lib/search/product-search";

/** Source groups remain source groups. Preserve every observation, never vote
 * by repeated URLs or transformations. Identity normalization lives in Fusion. */
export function combineCandidateEvidence(
  a: ProductSearchResult | undefined,
  b: ProductSearchResult,
): ProductSearchResult {
  if (!a) return b;
  const candidates = new Map(
    a.candidates.map((c) => [c.canonicalUrl, structuredClone(c)]),
  );
  for (const candidate of b.candidates) {
    const existing = candidates.get(candidate.canonicalUrl);
    if (!existing)
      candidates.set(candidate.canonicalUrl, structuredClone(candidate));
    else {
      existing.observations.push(...candidate.observations);
      existing.foundBy.push(...candidate.foundBy);
      existing.evidence.push(...candidate.evidence);
      existing.identifierObservations.push(...candidate.identifierObservations);
      existing.imageUrls = [
        ...new Set([...existing.imageUrls, ...candidate.imageUrls]),
      ];
      existing.urls = [...new Set([...existing.urls, ...candidate.urls])];
    }
  }
  return {
    ...a,
    query: a.queries.length ? a.query : b.query,
    queries: [
      ...new Map(
        [...a.queries, ...b.queries].map((q) => [JSON.stringify(q), q]),
      ).values(),
    ],
    candidates: [...candidates.values()],
    providerRuns: [...a.providerRuns, ...b.providerRuns],
    finishedAt: b.finishedAt,
  };
}
