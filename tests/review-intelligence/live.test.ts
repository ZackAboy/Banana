import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoverReviewSources } from "@/lib/review-intelligence";
import { liveReviewProvider } from "@/lib/review-intelligence/config";
import { trimSerpApiResponse } from "../product-search/record";
import { DUALSENSE } from "../product-search/helpers";

// OPT-IN LIVE CHECK. Skipped unless REVIEW_INTELLIGENCE_LIVE=1. Makes up to six
// real SerpApi requests (one per planned query). Run only with maintainer
// approval. REVIEW_INTELLIGENCE_RECORD_DIR saves trimmed responses so the
// replayed tests can cover queries that are not recorded yet.
// REVIEW_INTELLIGENCE_QUERY='{"brand":"…","product":"…","modelNumber":"…"}'
// replaces the default DualSense identity.
const live = process.env.REVIEW_INTELLIGENCE_LIVE === "1";

describe.skipIf(!live)("review discovery against SerpApi", () => {
  it("discovers sources for the supplied product", async () => {
    const recordDir = process.env.REVIEW_INTELLIGENCE_RECORD_DIR;
    const query = process.env.REVIEW_INTELLIGENCE_QUERY
      ? JSON.parse(process.env.REVIEW_INTELLIGENCE_QUERY)
      : DUALSENSE;
    const result = await discoverReviewSources(query, liveReviewProvider(), {
      includeRaw: Boolean(recordDir),
    });
    if (recordDir) {
      mkdirSync(recordDir, { recursive: true });
      for (const body of result.raw ?? []) {
        const trimmed = trimSerpApiResponse(body);
        const q = (trimmed.search_parameters as { q?: string }).q;
        const id = result.queries.find((p) => p.text === q)?.id ?? "unknown";
        writeFileSync(
          join(recordDir, `google.${id}.json`),
          `${JSON.stringify(trimmed, null, 2)}\n`,
        );
      }
      writeFileSync(
        join(recordDir, "recording.json"),
        `${JSON.stringify({ recordedAt: result.finishedAt, provider: "SerpApi", query: result.query }, null, 2)}\n`,
      );
    }
    // A run where every request failed is a failure, not an empty success.
    expect(result.providerRun.requests.some((r) => r.status === "ok")).toBe(
      true,
    );
    expect(result.sources.length).toBeGreaterThan(0);
  }, 90_000);
});
