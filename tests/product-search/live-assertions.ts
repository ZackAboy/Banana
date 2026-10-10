import { productSearchResultSchema } from "@/lib/search/product-search";

/** A run record alone proves nothing: require evidence from an actual success. */
export function assertUsefulLiveEvidence(value: unknown) {
  const result = productSearchResultSchema.parse(value);
  const observations = [
    ...result.candidates.flatMap((c) => c.observations),
    ...result.offers.flatMap((o) => o.observations),
  ];
  const useful = result.providerRuns.some((run) =>
    run.requests.some(
      (request) =>
        request.executed &&
        request.status === "ok" &&
        observations.some(
          (observation) =>
            observation.provider === run.provider &&
            observation.requestId === request.id &&
            (observation.identifiers.length > 0 ||
              observation.brandClue !== null ||
              observation.imageUrls.length > 0),
        ),
    ),
  );
  if (!useful)
    throw new Error(
      "No configured provider returned schema-valid useful evidence from a successful executed request.",
    );
  return result;
}
