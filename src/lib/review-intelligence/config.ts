import "server-only";
import { liveProductSearchProviders } from "@/lib/search/product-search/config";
import type { SearchProvider } from "@/lib/search/product-search";

/**
 * The live review provider is Product Search's SerpApi review adapter, reused
 * as-is: same SERPAPI_API_KEY, country/language/timeout settings and the same
 * process-wide request allowance. Review Intelligence supplies its own queries.
 */
export function liveReviewProvider(
  env: Record<string, string | undefined> = process.env,
): SearchProvider {
  const provider = liveProductSearchProviders(env).find(
    (p) => p.kind === "reviews",
  );
  // Product Search always constructs one; fail loudly if that ever changes.
  if (!provider)
    throw new Error("No review-capable search provider is available.");
  return provider;
}
