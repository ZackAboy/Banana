import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  runProductSearch,
  productSearchResultSchema,
} from "@/lib/search/product-search";
import {
  identifierObservations,
  matchModelNumber,
} from "@/lib/search/product-search/model-number";
import {
  cleanQuery,
  queryIdentifiers,
} from "@/lib/search/product-search/query";
import { parsePrice } from "@/lib/search/product-search/price";
import {
  emptyOutput,
  type OfferHit,
  type PageHit,
  type SearchProvider,
} from "@/lib/search/product-search/provider";
import { createSerpApiProviders } from "@/lib/search/product-search/serpapi";
import { assertUsefulLiveEvidence } from "./live-assertions";
import { DUALSENSE, IMAGE_URL, blockNetwork } from "./helpers";

let restore: () => void;
beforeAll(() => {
  restore = blockNetwork();
});
afterAll(() => restore());
const model = { kind: "model_number" as const, value: "CFI-ZCT2W" };
const page = (changes: Partial<PageHit> = {}): PageHit => ({
  queryId: "exact-model",
  field: "items",
  title: "Sony CFI-ZCT2W White",
  url: "https://shop.example/item",
  ...changes,
});
const offer = (changes: Partial<OfferHit> = {}): OfferHit => ({
  ...page(),
  merchant: "Shop",
  price: "$59.99",
  currencyHint: "USD",
  condition: "new",
  ...changes,
});
const custom = (
  pages: PageHit[] = [],
  offers: OfferHit[] = [],
): SearchProvider => ({
  id: "test",
  kind: "web",
  async search() {
    return { ...emptyOutput(), pages, offers };
  },
});
const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
/** Handcrafted documented engine shapes, not historical/live recordings. */
function adapter(
  kind: "web" | "visual" | "reviews",
  route: (
    params: URLSearchParams,
    call: number,
    signal: AbortSignal | null | undefined,
  ) => Response | Promise<Response>,
  timeoutMs = 10_000,
) {
  const calls: URLSearchParams[] = [];
  const providers = createSerpApiProviders({
    apiKey: "regression-not-a-key",
    acquire: () => {},
    timeoutMs,
    fetch: (async (url, init) => {
      const params = new URL(String(url)).searchParams;
      calls.push(params);
      return route(params, calls.length, init?.signal);
    }) as typeof fetch,
  });
  return { providers: providers.filter((p) => p.kind === kind), calls };
}
async function webBody(body: unknown) {
  const { providers } = adapter("web", () => json(body));
  return runProductSearch({ modelNumber: model.value }, providers);
}

describe("unit: critical identifier and price semantics", () => {
  it("observes literal CFI-ZCT2W without asserting positive product association", async () => {
    expect(matchModelNumber(model.value, "cfi-zct2w").exact).toBe(true);
    const result = await runProductSearch(DUALSENSE, [
      custom([page({ title: "Not compatible with CFI-ZCT2W" })]),
    ]);
    expect(result.candidates[0].identifierObservations[0].match).toBe(
      "literal",
    );
    expect(result.candidates[0].evidence[0].claim).toContain(
      "do not establish product association",
    );
  });
  it("rejects suffixed/different identifiers and keeps separator folding weaker", () => {
    for (const text of [
      "CFI-ZCT2W-01",
      "CFI-ZCT2W/01",
      "CFI-ZCT2W_REV2",
      "CFI-ZCT2WA",
      "XCFI-ZCT2W",
      "CFI-ZCT2WPRO",
      "CFI-ZCT1W",
      "CFI_ZCT2W",
    ])
      expect(matchModelNumber(model.value, text).exact, text).toBe(false);
    expect(identifierObservations(model, "CFI_ZCT2W", "title")[0].match).toBe(
      "normalized",
    );
    expect(matchModelNumber(model.value, "CFI ZCT2W").normalized).toBe(false);
  });
  it("preserves SKU/part-number kinds, literal values, leading zeros and case policy", () => {
    const query = cleanQuery({
      sku: "Ab-001",
      partNumber: " Ab-001 ",
      variant: "White",
    });
    expect(queryIdentifiers(query)).toEqual([
      { kind: "sku", value: "Ab-001" },
      { kind: "part_number", value: " Ab-001 " },
    ]);
    expect(query.variant).toBe("White");
    for (const kind of ["sku", "part_number"] as const) {
      const observations = identifierObservations(
        { kind, value: "Ab-001" },
        "ab-001 Ab-001 Ab-1",
        "title",
      );
      expect(observations).toContainEqual(
        expect.objectContaining({
          kind,
          queryValue: "Ab-001",
          match: "literal",
          observedValue: "Ab-001",
          caseSensitive: true,
        }),
      );
      expect(observations).toContainEqual(
        expect.objectContaining({
          match: "normalized",
          observedValue: "ab-001",
        }),
      );
      expect(observations.some((o) => o.observedValue === "Ab-1")).toBe(false);
    }
  });
  it("keeps ambiguous displayed prices unknown", () => {
    for (const text of [
      "-$59.99",
      "4 payments of $15",
      "2 for $50",
      "Was $99 now $59",
      "$59.99 - $74.99",
      "¥59.99",
      "59.990 KWD",
    ])
      expect(parsePrice(text, "USD"), text).toMatchObject({
        amountMinor: null,
        original: text,
      });
  });
});

describe("mocked orchestration: critical evidence preservation", () => {
  it("preserves candidate images with deterministic order-independent IDs", async () => {
    const rows = [
      page({
        imageUrls: ["https://images.example/one.jpg"],
        brand: "Sony",
        variant: "White",
        position: 4,
      }),
      page({ url: "https://shop.example/other", title: "CFI-ZCT1W" }),
    ];
    const a = await runProductSearch(DUALSENSE, [custom(rows)]);
    const b = await runProductSearch(DUALSENSE, [custom([...rows].reverse())]);
    expect(a.candidates.map((c) => c.id).sort()).toEqual(
      b.candidates.map((c) => c.id).sort(),
    );
    expect(a.candidates[0]).toMatchObject({
      id: expect.stringMatching(/^candidate_[a-f0-9]{64}$/),
      imageUrls: ["https://images.example/one.jpg"],
      brand: "Sony",
      variant: "White",
      domain: "shop.example",
    });
    expect(a.candidates[0].observations[0]).toMatchObject({
      position: 4,
      provider: "test",
      queryId: "exact-model",
    });
    expect(productSearchResultSchema.safeParse(a).success).toBe(true);
  });
  it("retains conflicting model/variant/condition/merchant/price and URL offer observations", async () => {
    const changes: Partial<OfferHit>[] = [
      { title: "Sony CFI-ZCT1W White" },
      { variant: "Black" },
      { condition: "used" },
      { merchant: "Other Shop" },
      { price: "$74.99" },
      { url: "https://shop.example/different" },
    ];
    const result = await runProductSearch(DUALSENSE, [
      custom([], [offer(), ...changes.map(offer)]),
    ]);
    expect(result.offers).toHaveLength(7);
    expect(result.offers.flatMap((o) => o.observations)).toHaveLength(7);
  });
  it("merges genuine/tracking-only duplicates while retaining all original provenance", async () => {
    const result = await runProductSearch(DUALSENSE, [
      custom(
        [],
        [
          offer(),
          offer({ queryId: "brand-product", position: 2 }),
          offer({
            queryId: "brand-product",
            url: "https://shop.example/item?utm_source=test",
          }),
        ],
      ),
    ]);
    expect(result.offers).toHaveLength(1);
    expect(result.offers[0].observations).toHaveLength(3);
    expect(result.offers[0].foundBy.map((p) => p.queryId)).toEqual([
      "exact-model",
      "brand-product",
    ]);
    expect(result.offers[0].observations[2].url).toContain("utm_source");
  });
  it("contains malformed normalized rows and envelopes", async () => {
    const good = await runProductSearch(DUALSENSE, [
      custom([page(), page({ title: "" }), page({ url: "javascript:bad" })]),
    ]);
    expect(good.candidates).toHaveLength(1);
    expect(good.providerRuns[0].discardedRows).toBe(2);
    const bad = await runProductSearch(DUALSENSE, [
      { id: "bad", kind: "web", search: async () => null as never },
    ]);
    expect(bad.providerRuns[0].error?.code).toBe("INVALID_RESPONSE");
  });
});

describe("mocked HTTP: critical provider behavior", () => {
  it("preserves successful evidence when a later query fails", async () => {
    const { providers, calls } = adapter("web", (_p, n) =>
      n === 1
        ? json({
            organic_results: [
              { title: "CFI-ZCT2W", link: "https://shop.example/item" },
            ],
          })
        : new Response("bad", { status: 500 }),
    );
    const result = await runProductSearch(DUALSENSE, providers);
    expect(calls).toHaveLength(2);
    expect(result.candidates).toHaveLength(1);
    expect(result.providerRuns[0]).toMatchObject({
      status: "partial",
      queryIds: ["exact-model", "brand-product"],
      error: { code: "HTTP_ERROR" },
    });
    expect(result.providerRuns[0].requests.map((r) => r.status)).toEqual([
      "ok",
      "error",
    ]);
    expect(result.candidates[0].foundBy[0].requestId).toBe(
      result.providerRuns[0].requests[0].id,
    );
  });
  it("contains malformed raw data without confusing provider failure with empty results", async () => {
    expect((await webBody({})).providerRuns[0].error?.code).toBe(
      "INVALID_RESPONSE",
    );
    expect(
      (await webBody({ organic_results: [] })).providerRuns[0],
    ).toMatchObject({ status: "ok", error: null, itemCount: 0 });
    const mixed = await webBody({
      organic_results: [
        { title: "CFI-ZCT2W", link: "https://shop.example/item" },
        { link: "https://shop.example/bad" },
        null,
      ],
    });
    expect(mixed.candidates).toHaveLength(1);
    expect(mixed.providerRuns[0]).toMatchObject({
      status: "ok",
      discardedRows: 2,
    });
  });
  it("sanitizes provider errors and classifies HTML 429 without parsing JSON", async () => {
    const jsonError = await webBody({
      error: "https://serpapi.com/?api_key=SECRET token=OTHER",
    });
    const { providers } = adapter(
      "web",
      () => new Response("<h1>api_key=SECRET</h1>", { status: 429 }),
    );
    const htmlError = await runProductSearch(DUALSENSE, providers);
    const thrown = await runProductSearch(DUALSENSE, [
      {
        id: "bad",
        kind: "web",
        search: async () => {
          throw new Error(
            "api_key=SECRET https://user:password@example.com/?token=OTHER",
          );
        },
      },
    ]);
    expect(jsonError.providerRuns[0].error?.code).toBe("PROVIDER_ERROR");
    expect(htmlError.providerRuns[0].error?.code).toBe("RATE_LIMITED");
    for (const result of [jsonError, htmlError, thrown])
      expect(JSON.stringify(result)).not.toMatch(
        /SECRET|OTHER|password|api_key/,
      );
  });
  it("Lens preserves images/section, parses boolean stock and sanitizes image request provenance", async () => {
    const { providers, calls } = adapter("visual", () =>
      json({
        exact_matches: [
          {
            title: "DualSense",
            link: "https://shop.example/item",
            image: "https://images.example/full.jpg",
            thumbnail: "https://images.example/thumb.jpg",
            source: "Shop",
            price: { value: "$59.99", currency: "$" },
            in_stock: false,
          },
        ],
        visual_matches: [
          {
            title: "CFI-ZCT1W",
            link: "https://shop.example/old",
            in_stock: true,
            source: "Other",
            price: { value: "$49.99" },
          },
        ],
      }),
    );
    const result = await runProductSearch(DUALSENSE, providers, {
      imageUrl: `${IMAGE_URL}?signature=SECRET`,
      includeRaw: true,
    });
    expect(calls[0].get("country")).toBe("us");
    expect(calls[0].has("gl")).toBe(false);
    expect(result.candidates[0].observations[0]).toMatchObject({
      field: "exact_matches",
      engine: "google_lens",
      identifiers: [],
    });
    expect(result.candidates[0].imageUrls).toHaveLength(2);
    expect(result.candidates[0].matchSignals.exactModelNumber).toBe(false);
    expect(result.offers.map((o) => o.availability)).toEqual([
      "out_of_stock",
      "in_stock",
    ]);
    expect(result.providerRuns[0].requests[0]).toMatchObject({
      inputImageUrl: IMAGE_URL,
      inputImageId: expect.stringMatching(/^image_[a-f0-9]{64}$/),
    });
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });
  it("review discovery requires explicit opt-in", async () => {
    const { providers, calls } = adapter("reviews", () =>
      json({ organic_results: [] }),
    );
    expect(
      (await runProductSearch(DUALSENSE, providers)).providerRuns[0].status,
    ).toBe("skipped");
    expect(calls).toHaveLength(0);
    expect(
      (await runProductSearch(DUALSENSE, providers, { includeReviews: true }))
        .providerRuns[0].queryIds,
    ).toEqual(["reviews", "reviews-reddit"]);
    expect(calls).toHaveLength(2);
  });
  it("live acceptance rejects total failure/empty evidence and requires a successful executed request", async () => {
    for (const result of [
      await webBody({ error: "failure" }),
      await webBody({ organic_results: [] }),
      await runProductSearch(DUALSENSE, [custom([page()])]),
    ])
      expect(() => assertUsefulLiveEvidence(result)).toThrow();
    const good = await webBody({
      organic_results: [
        {
          title: "CFI-ZCT2W",
          link: "https://shop.example/item",
          thumbnail: "https://images.example/a.jpg",
        },
      ],
    });
    expect(() => assertUsefulLiveEvidence(good)).not.toThrow();
  });
});
