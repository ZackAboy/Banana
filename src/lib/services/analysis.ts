import "server-only";
import { getProviders } from "@/lib/providers";
import { getConfig } from "@/lib/config/env";
import { identifyWithEvidence } from "@/lib/identification/runtime";
import type { ImageInput } from "@/lib/providers/interfaces";
import type { DemoScenario, ProductQuery, VerifyRequest } from "@/types";
import {
  identifyResponseSchema,
  pricesResponseSchema,
  reviewsResponseSchema,
} from "@/schemas/api";
import { sortOffers } from "@/lib/products/offers";
import { productKey } from "@/lib/products/normalization";
import { MemoryCache } from "@/lib/cache/memory";
const cache = new MemoryCache();
export async function identify(images: ImageInput[], scenario: DemoScenario) {
  const { providers, meta } = getProviders();
  const config = getConfig();
  if (!config.mock && config.identificationMode === "evidence") {
    const result = await identifyWithEvidence(images);
    return identifyResponseSchema.parse({
      identification: result.identification,
      meta: { ...meta, notice: result.notice },
    });
  }
  return identifyResponseSchema.parse({
    identification: await providers.identification.identify(images, scenario),
    meta,
  });
}
export async function verify(input: VerifyRequest) {
  const { providers, meta } = getProviders();
  return identifyResponseSchema.parse({
    identification: await providers.verification.verify(input),
    meta,
  });
}
export async function prices(product: ProductQuery) {
  const { providers, meta } = getProviders();
  return cache.getOrLoad(
    `prices:${meta.mode}:${productKey(product)}`,
    async () =>
      pricesResponseSchema.parse({
        offers: sortOffers(await providers.shopping.search(product)),
        meta,
      }),
  );
}
export async function reviews(product: ProductQuery) {
  const { providers, meta } = getProviders();
  return cache.getOrLoad(
    `reviews:${meta.mode}:${productKey(product)}`,
    async () => {
      const sources = await providers.reviewSearch.search(product);
      return reviewsResponseSchema.parse({
        insights: await providers.reviewAnalysis.summarize(product, sources),
        meta,
      });
    },
  );
}
