// Trims real SerpApi responses down to the fields the adapters read, so
// recorded fixtures stay small and carry no account metadata. search_metadata
// (request IDs, endpoints) is dropped; search_parameters keeps only what the
// replay router needs to match a request.

type Json = Record<string, unknown>;

const pick = (item: unknown, keys: string[]) =>
  Object.fromEntries(
    keys
      .filter((k) => item && typeof item === "object" && k in (item as Json))
      .map((k) => [k, (item as Json)[k]]),
  );

const LISTS: Record<string, string[]> = {
  organic_results: ["position", "title", "link", "snippet", "date"],
  shopping_results: [
    "position",
    "title",
    "source",
    "link",
    "product_link",
    "price",
    "old_price",
    "delivery",
    "second_hand_condition",
    "condition",
    "stock_information",
    "tag",
  ],
  exact_matches: [
    "position",
    "title",
    "link",
    "source",
    "price",
    "condition",
    "in_stock",
    "stock_information",
  ],
  visual_matches: [
    "position",
    "title",
    "link",
    "source",
    "price",
    "condition",
    "in_stock",
    "stock_information",
  ],
};

export function trimSerpApiResponse(body: unknown): Json {
  const source = (body ?? {}) as Json;
  const out: Json = {
    search_parameters: pick(source.search_parameters, [
      "engine",
      "q",
      "url",
      "gl",
      "country",
      "hl",
    ]),
  };
  if (source.search_metadata)
    out.search_metadata = pick(source.search_metadata, ["status"]);
  for (const [field, keys] of Object.entries(LISTS))
    if (Array.isArray(source[field]))
      out[field] = (source[field] as unknown[]).map((item) =>
        pick(item, [
          ...keys,
          "image",
          "thumbnail",
          "thumbnails",
          "serpapi_thumbnails",
          "product_id",
          "brand",
          "variant",
        ]),
      );
  return out;
}

/** File name for a recorded request, stable across runs. */
export function fixtureName(trimmed: Json, queryId: string) {
  const engine = String(
    (trimmed.search_parameters as Json).engine ?? "unknown",
  );
  return `${engine}.${queryId}.json`;
}
