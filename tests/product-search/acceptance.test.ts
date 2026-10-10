import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  productSearchResultSchema,
  runProductSearch,
  type ProductSearchResult,
  type SearchProvider,
} from "@/lib/search/product-search";
import {
  DUALSENSE,
  FIXED_NOW,
  IMAGE_URL,
  blockNetwork,
  fixtureProviders,
  recordedRoute,
} from "./helpers";

// Every provider response here is a real SerpApi response recorded on
// 2026-10-10 (tests/product-search/fixtures/recorded). Failures are injected
// around that data; nothing is invented.

let restoreNetwork: () => void;
beforeAll(() => {
  restoreNetwork = blockNetwork();
});
afterAll(() => restoreNetwork());

const NO_MODEL = { brand: "Sony", product: "DualSense Wireless Controller" };
const run = (
  providers: SearchProvider[],
  imageUrl: string | null = IMAGE_URL,
  query: typeof DUALSENSE | typeof NO_MODEL = DUALSENSE,
) =>
  runProductSearch(query, providers, {
    imageUrl,
    now: FIXED_NOW,
    includeReviews: true,
  });

describe("DualSense replay acceptance (supplied historical fixtures, no network)", () => {
  it("produces a schema-valid result with every provider succeeding", async () => {
    const result = await run(fixtureProviders().providers);
    expect(() => productSearchResultSchema.parse(result)).not.toThrow();
    expect(result.providerRuns.map((r) => [r.provider, r.status])).toEqual([
      ["serpapi:google", "ok"],
      ["serpapi:google_shopping", "ok"],
      ["serpapi:google_lens", "ok"],
      ["serpapi:google_reviews", "ok"],
    ]);
  });

  it("finds a candidate with exact CFI-ZCT2W evidence and a source URL", async () => {
    const result = await run(fixtureProviders().providers);
    const ebay = result.candidates.find(
      (c) => c.canonicalUrl === "https://www.ebay.com/itm/318473414276",
    )!;
    expect(ebay.matchSignals).toMatchObject({
      exactModelNumber: true,
      brandMatch: true,
    });
    const exact = ebay.evidence.find((e) => /CFI-ZCT2W/i.test(e.snippet))!;
    expect(ebay.identifierObservations).toContainEqual(
      expect.objectContaining({
        kind: "model_number",
        match: "literal",
        observedValue: "CFI-ZCT2W",
      }),
    );
    expect(exact).toMatchObject({
      sourceUrl: "https://www.ebay.com/itm/318473414276",
      provider: "serpapi:google",
      queryId: "exact-model",
      retrievedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
    expect(exact.snippet).toMatch(/CFI-ZCT2W/i);
  });

  it("returns normalised offers from more than one merchant", async () => {
    const { offers } = await run(fixtureProviders().providers);
    expect(new Set(offers.map((o) => o.merchant)).size).toBeGreaterThan(5);
    expect(
      offers.find((o) => o.title === "Sony Ps5 Cfi-zct2w White"),
    ).toMatchObject({
      merchant: "eBay",
      priceMinor: 4999,
      currency: "USD",
      originalPrice: "$49.99",
      condition: "used",
      matchSignals: { exactModelNumber: true },
    });
    // Thousands separator, from a real (unrelated) listing Shopping returned.
    expect(offers.find((o) => o.merchant === "Schiller's")).toMatchObject({
      priceMinor: 289900,
      originalPrice: "$2,899.00",
      matchSignals: { exactModelNumber: false },
    });
    // Lens prices carry a trailing asterisk.
    expect(offers.find((o) => o.merchant === "Apple")).toMatchObject({
      priceMinor: 7500,
      currency: "USD",
      originalPrice: "$75*",
    });
    for (const offer of offers) {
      expect(offer.url).toMatch(/^https:\/\//);
      expect(offer.foundBy.length).toBeGreaterThan(0);
    }
  });

  it("groups source candidates while preserving distinct Shopping/Lens offers", async () => {
    // Without a model number, web search and Lens both return the Apple listing,
    // and Shopping and Lens both return PlayStation's DualSense Edge offer.
    const result = await run(fixtureProviders().providers, IMAGE_URL, NO_MODEL);
    const apple = result.candidates.filter((c) =>
      c.canonicalUrl.startsWith("https://www.apple.com/shop/product/hsg32zm"),
    );
    expect(apple).toHaveLength(1);
    expect(apple[0].urls).toHaveLength(2); // "™" and "%E2%84%A2" spellings
    expect(new Set(apple[0].foundBy.map((r) => r.provider))).toEqual(
      new Set(["serpapi:google", "serpapi:google_lens"]),
    );

    const edge = result.offers.filter(
      (o) => o.merchant === "PlayStation" && o.priceMinor === 19900,
    );
    expect(edge).toHaveLength(2);
    expect(
      new Set(edge.flatMap((o) => o.foundBy.map((r) => r.provider))),
    ).toEqual(new Set(["serpapi:google_shopping", "serpapi:google_lens"]));

    expect(new Set(result.candidates.map((c) => c.id)).size).toBe(
      result.candidates.length,
    );
  });

  it("keeps Lens's DualSense Edge matches beside the CFI-ZCT2W results", async () => {
    const result = await run(fixtureProviders().providers);
    const edge = result.candidates.find((c) =>
      c.canonicalUrl.includes("/dp/B0BSYFB99D"),
    )!;
    expect(edge.title).toContain("DualSense Edge");
    expect(new Set(edge.foundBy.map((r) => r.provider))).toEqual(
      new Set(["serpapi:google_lens"]),
    );
    expect(edge.matchSignals.exactModelNumber).toBe(false);

    const modelMatches = result.candidates.filter(
      (c) =>
        c.matchSignals.exactModelNumber &&
        c.foundBy.some((r) => r.queryId === "exact-model"),
    );
    expect(modelMatches.length).toBeGreaterThan(5);

    // A Lens match naming a different model is kept, with that as evidence.
    const ps5Console = result.candidates.find((c) =>
      c.modelNumbersSeen.includes("CFI-1215A"),
    )!;
    expect(ps5Console.foundBy[0].provider).toBe("serpapi:google_lens");
    expect(
      ps5Console.evidence.some((e) => e.snippet.includes("CFI-1215A")),
    ).toBe(true);
  });

  it("returns the other providers' results when one provider errors", async () => {
    const { providers } = fixtureProviders((p) =>
      p.get("engine") === "google_shopping"
        ? new Response(JSON.stringify({ error: "Internal error" }), {
            status: 500,
          })
        : recordedRoute(p),
    );
    const result = await run(providers);
    const shopping = result.providerRuns.find((r) => r.kind === "shopping")!;
    expect(shopping).toMatchObject({
      status: "error",
      error: { code: "HTTP_ERROR" },
    });
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.reviewSources.length).toBeGreaterThan(0);
    // Only Lens offers remain.
    expect(result.offers.length).toBeGreaterThan(0);
    expect(
      result.offers.every((o) =>
        o.foundBy.every((r) => r.provider === "serpapi:google_lens"),
      ),
    ).toBe(true);
  });

  it("records a timeout without waiting for a hung provider", async () => {
    const hung: SearchProvider = {
      id: "test:hung",
      kind: "web",
      search: ({ signal }) =>
        new Promise((_, reject) =>
          signal.addEventListener("abort", () => reject(new Error("aborted"))),
        ),
    };
    const result = await runProductSearch(
      DUALSENSE,
      [hung, ...fixtureProviders().providers],
      { imageUrl: IMAGE_URL, timeoutMs: 50, now: FIXED_NOW },
    );
    expect(result.providerRuns[0]).toMatchObject({
      status: "error",
      error: { code: "TIMEOUT" },
    });
    expect(result.offers.length).toBeGreaterThan(0);
  });

  it("classifies the recorded review sources", async () => {
    const { reviewSources } = await run(fixtureProviders().providers);
    const domains = (type: string) =>
      reviewSources.filter((r) => r.sourceType === type).map((r) => r.domain);
    expect(domains("reddit").length).toBeGreaterThan(5);
    expect(domains("review_site")).toEqual(
      expect.arrayContaining([
        "pk.ign.com",
        "digitalfoundry.net",
        "tomsguide.com",
      ]),
    );
    expect(domains("other")).toEqual(
      expect.arrayContaining(["youtube.com", "godisageek.com"]),
    );
    // This recording has no manufacturer page among review results; the
    // classifier is covered against real PlayStation/Sony URLs in units.test.ts.
    expect(domains("manufacturer_spec")).toEqual([]);
  });

  it("contains no verdict or confidence labels in its own fields", async () => {
    const result = await run(fixtureProviders().providers);
    // Strip text copied from sources; titles may legitimately say "likely".
    const own = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(own)
        : value && typeof value === "object"
          ? Object.fromEntries(
              Object.entries(value)
                .filter(([k]) => !SOURCE_TEXT.has(k))
                .map(([k, v]) => [k, own(v)]),
            )
          : value;
    const json = JSON.stringify(
      own(result as ProductSearchResult),
    ).toLowerCase();
    for (const word of [
      "confirmed",
      "likely",
      "uncertain",
      "confidence",
      "verdict",
    ])
      expect(json).not.toContain(word);
  });

  it("skips Lens without an image URL and says so", async () => {
    const result = await run(fixtureProviders().providers, null);
    expect(result.providerRuns.find((r) => r.kind === "visual")).toMatchObject({
      status: "skipped",
      error: { code: "SKIPPED" },
    });
    expect(
      result.candidates.some((c) =>
        c.foundBy.some((r) => r.provider === "serpapi:google_lens"),
      ),
    ).toBe(false);
  });

  it("includes raw provider payloads only on request", async () => {
    const plain = await run(fixtureProviders().providers);
    expect(plain.raw).toBeUndefined();
    const debug = await runProductSearch(
      DUALSENSE,
      fixtureProviders().providers,
      {
        imageUrl: IMAGE_URL,
        includeRaw: true,
        now: FIXED_NOW,
      },
    );
    expect(debug.raw?.["serpapi:google_shopping"]).toHaveLength(1);
  });
});

/** Fields holding text copied from sources rather than produced by this module. */
const SOURCE_TEXT = new Set([
  "title",
  "snippet",
  "url",
  "urls",
  "canonicalUrl",
  "sourceUrl",
  "merchant",
  "originalPrice",
  "availability",
  "shipping",
  "publishedAt",
  "domain",
  "text",
]);
