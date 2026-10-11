import "server-only";
import type { LensProvider } from "@/lib/providers/interfaces";
import type { ImageInput } from "@/lib/providers/interfaces";
import { AppError } from "@/lib/errors";
import {
  liveProductSearchProviders,
  productSearchConfig,
  runProductSearch,
} from "./product-search";

/** Uses direct, short-lived provider uploads; the app never hosts user photos. */
export function discoverLensCandidates(images: ImageInput[]) {
  return runProductSearch(
    {},
    liveProductSearchProviders().filter((p) => p.kind === "visual"),
    {
      images,
      timeoutMs: productSearchConfig().timeoutMs,
      includeReviews: false,
    },
  );
}

export const liveLens: LensProvider = {
  async search(images) {
    const result = await discoverLensCandidates(images);
    if (result.providerRuns.every((run) => run.status === "error"))
      throw new AppError(
        "LENS_UNAVAILABLE",
        "Visual candidate discovery is unavailable.",
        503,
      );
    return result.candidates.map((candidate) => ({
      id: candidate.id,
      brand: candidate.brand,
      productName: candidate.title,
      modelNumber: null,
      variant: candidate.variant,
      source: "Google Lens",
      sourceUrl: candidate.canonicalUrl,
      evidence: candidate.observations.map((o) => o.title),
      matchReason:
        "Visual candidate only; product identity requires evidence adjudication.",
    }));
  },
};
