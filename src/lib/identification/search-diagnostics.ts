import "server-only";
import {
  buildQueries,
  type ProductSearchQuery,
  type ProductSearchResult,
} from "@/lib/search/product-search";
import type { FusionResult } from "./evidence-contracts";
import { inspectSearchAssociations } from "./search-associations";

/** Bounded, allowlisted development summary. No raw payload/error or source URL.
 * Keep configured secrets out even if a provider echoes them in source text. */
export function summarizeSearchDiagnostics(
  query: ProductSearchQuery,
  search?: ProductSearchResult,
  secrets: string[] = [],
) {
  const inspection = search ? inspectSearchAssociations(search) : null;
  const summary = {
    query,
    plannedQueries: buildQueries(query),
    outcome: search
      ? "search_result_returned"
      : "search_unavailable_or_invalid",
    startedAt: search?.startedAt ?? null,
    finishedAt: search?.finishedAt ?? null,
    providerCount: search?.providerRuns.length ?? null,
    providers:
      search?.providerRuns.slice(0, 8).map((run) => ({
        provider: run.provider,
        kind: run.kind,
        status: run.status,
        errorCode: run.error?.code ?? null,
        durationMs: run.durationMs,
        itemCount: run.itemCount,
        discardedRows: run.discardedRows,
        requestCount: run.requests.length,
        requests: run.requests.slice(0, 12).map((request) => ({
          id: request.id,
          queryId: request.queryId,
          engine: request.engine,
          executed: request.executed,
          status: request.status,
          errorCode: request.error?.code ?? null,
          discardedRows: request.discardedRows,
        })),
      })) ?? [],
    candidateCount: search?.candidates.length ?? null,
    associationCount: inspection?.associations.length ?? null,
    // Counts retain the full result; arrays intentionally show only a sample.
    candidates:
      search?.candidates.slice(0, 8).map((candidate) => ({
        id: candidate.id,
        title: candidate.title,
        domain: candidate.domain,
        observationCount: candidate.observations.length,
        observations: candidate.observations
          .slice(0, 3)
          .map((observation, observationIndex) => ({
            observationIndex,
            provider: observation.provider,
            engine: observation.engine,
            queryId: observation.queryId,
            requestId: observation.requestId,
            domain: observation.domain,
            title: observation.title,
            snippet: observation.snippet,
            brandClue: observation.brandClue,
            identifiers: observation.identifiers.slice(0, 8).map((claim) => ({
              kind: claim.kind,
              queryValue: claim.queryValue,
              observedValue: claim.observedValue,
              match: claim.match,
              field: claim.field,
              caseSensitive: claim.caseSensitive,
            })),
            accepted: inspection!.associations.some(
              (association) =>
                association.candidateId === candidate.id &&
                association.observationIndex === observationIndex,
            ),
            rejectionReasons: [
              ...new Set(
                inspection!.rejections
                  .filter(
                    (rejection) =>
                      rejection.candidateId === candidate.id &&
                      rejection.observationIndex === observationIndex,
                  )
                  .map((rejection) => rejection.reason),
              ),
            ],
          })),
      })) ?? [],
  };
  // Existing Search error taxonomy is used; arbitrary error messages and URLs
  // are never selected. Redact strings before truncating so partial secrets
  // cannot leak at the length boundary. URLs embedded in prose are omitted too.
  const redact = (value: unknown): unknown => {
    if (typeof value === "string") {
      for (const secret of secrets.filter(Boolean))
        value = (value as string).split(secret).join("[REDACTED]");
      return (value as string)
        .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[URL]")
        .slice(0, 400);
    }
    if (Array.isArray(value)) return value.map(redact);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, redact(entry)]),
      );
    return value;
  };
  return redact(summary) as typeof summary;
}

export function logSearchDiagnostics(
  query: ProductSearchQuery,
  search: ProductSearchResult | undefined,
  fusion: FusionResult,
) {
  if (process.env.NODE_ENV !== "development") return;
  try {
    const summary = summarizeSearchDiagnostics(query, search, [
      process.env.SERPAPI_API_KEY ?? "",
      process.env.GEMINI_API_KEY ?? "",
    ]);
    console.info(
      "[identification:search]",
      JSON.stringify({
        search: summary,
        fusion: { status: fusion.status, reasonCodes: fusion.reasonCodes },
      }),
    );
  } catch {
    // Diagnostics must never change identification behavior or expose errors.
    console.info("[identification:search] Diagnostic summary unavailable.");
  }
}
