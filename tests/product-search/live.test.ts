import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import { runProductSearch } from "@/lib/search/product-search";
import {
  liveProductSearchProviders,
  productSearchConfig,
} from "@/lib/search/product-search/config";
import { assertUsefulLiveEvidence } from "./live-assertions";
import { imageReferenceUrl } from "@/lib/search/product-search/url";
import { DUALSENSE } from "./helpers";
import { fixtureName, trimSerpApiResponse } from "./record";

// OPT-IN LIVE CHECK. Skipped unless PRODUCT_SEARCH_LIVE=1. Uses real SerpApi
// requests: at most 4 for default clues, or 5 with a supplied public image URL.
// PRODUCT_SEARCH_RECORD_DIR saves trimmed responses as replayable fixtures.
// See src/lib/search/product-search/README.md for the command.
const live = process.env.PRODUCT_SEARCH_LIVE === "1";

describe.skipIf(!live)("product search against live providers", () => {
  it("returns a valid result for the development query", async () => {
    const config = productSearchConfig();
    const recordDir = process.env.PRODUCT_SEARCH_RECORD_DIR;
    const query = process.env.PRODUCT_SEARCH_QUERY
      ? JSON.parse(process.env.PRODUCT_SEARCH_QUERY)
      : DUALSENSE;
    const imageUrl = process.env.PRODUCT_SEARCH_IMAGE_URL || null;
    const result = await runProductSearch(query, liveProductSearchProviders(), {
      imageUrl,
      timeoutMs: config.timeoutMs,
      includeRaw: Boolean(process.env.PRODUCT_SEARCH_LIVE_OUT || recordDir),
    });
    if (process.env.PRODUCT_SEARCH_LIVE_OUT)
      writeFileSync(
        process.env.PRODUCT_SEARCH_LIVE_OUT,
        JSON.stringify(result, null, 2),
      );
    if (recordDir) {
      mkdirSync(recordDir, { recursive: true });
      for (const bodies of Object.values(result.raw ?? {}))
        for (const body of bodies) {
          const trimmed = trimSerpApiResponse(body);
          const params = trimmed.search_parameters as Record<string, unknown>;
          const queryId =
            result.queries.find((q) => q.text === params.q)?.id ??
            (params.engine === "google_lens" ? "lens-image" : "unknown");
          writeFileSync(
            join(recordDir, fixtureName(trimmed, queryId)),
            `${JSON.stringify(trimmed, null, 2)}\n`,
          );
        }
      writeFileSync(
        join(recordDir, "recording.json"),
        `${JSON.stringify(
          {
            recordedAt: result.finishedAt,
            provider: "SerpApi",
            query,
            imageUrl: imageUrl ? imageReferenceUrl(imageUrl) : null,
            note: "Real responses trimmed to the fields the adapters read.",
          },
          null,
          2,
        )}\n`,
      );
    }
    console.table(
      result.providerRuns.map((r) => ({
        provider: r.provider,
        status: r.status,
        items: r.itemCount,
        ms: r.durationMs,
        error: r.error?.code ?? "",
      })),
    );
    console.log(
      `${result.candidates.length} candidates, ${result.offers.length} offers, ${result.reviewSources.length} review sources`,
    );
    assertUsefulLiveEvidence(result);
  }, 60_000);
});
