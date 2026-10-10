// Public surface of the external product search module. Fusion and other
// workstreams should import from here only.
export { runProductSearch, type ProductSearchOptions } from "./search";
export { buildQueries } from "./query";
export {
  ProviderError,
  type SearchProvider,
  type ProviderInput,
  type ProviderOutput,
  type PageHit,
  type OfferHit,
  type ReviewHit,
} from "./provider";
export * from "./types";
