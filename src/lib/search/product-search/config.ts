import "server-only";
import { createSerpApiProviders } from "./serpapi";
import type { SearchProvider } from "./provider";

// Module-local configuration. SERPAPI_API_KEY is already declared in
// .env.example; the PRODUCT_SEARCH_* variables are new and documented in the
// README here. TODO(ProductSearch): fold into src/lib/config/env.ts once agreed.

const positiveInt = (value: string | undefined, fallback: number) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

export function productSearchConfig(
  env: Record<string, string | undefined> = process.env,
) {
  return {
    serpApiKey: env.SERPAPI_API_KEY?.trim() || undefined,
    country: env.PRODUCT_SEARCH_COUNTRY?.trim() || "us",
    language: env.PRODUCT_SEARCH_LANGUAGE?.trim() || "en",
    timeoutMs: positiveInt(env.PRODUCT_SEARCH_TIMEOUT_MS, 10_000),
    maxRequestsPerHour: positiveInt(env.SERPAPI_MAX_REQUESTS_PER_HOUR, 50),
  };
}

export function liveProductSearchProviders(
  env: Record<string, string | undefined> = process.env,
): SearchProvider[] {
  const config = productSearchConfig(env);
  return createSerpApiProviders({
    apiKey: config.serpApiKey,
    timeoutMs: config.timeoutMs,
    country: config.country,
    language: config.language,
    maxRequestsPerHour: config.maxRequestsPerHour,
  });
}
