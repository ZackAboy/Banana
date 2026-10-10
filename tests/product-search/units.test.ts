import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildQueries } from "@/lib/search/product-search/query";
import {
  extractModelNumbers,
  matchModelNumber,
  normalizeModelNumber,
} from "@/lib/search/product-search/model-number";
import { parsePrice } from "@/lib/search/product-search/price";
import { canonicalizeUrl } from "@/lib/search/product-search/url";
import { classifySource } from "@/lib/search/product-search/sources";
import { computeMatchSignals } from "@/lib/search/product-search/signals";
import {
  createRateLimiter,
  emptyOutput,
  type SearchProvider,
} from "@/lib/search/product-search/provider";
import { runProductSearch } from "@/lib/search/product-search";
import {
  DUALSENSE,
  FIXED_NOW,
  IMAGE_URL,
  blockNetwork,
  fixtureProviders,
  recorded,
} from "./helpers";

let restoreNetwork: () => void;
beforeAll(() => {
  restoreNetwork = blockNetwork();
});
afterAll(() => restoreNetwork());

describe("query building", () => {
  it("puts the quoted model number with brand first, then brand + product", () => {
    const queries = buildQueries(DUALSENSE, true);
    expect(queries.map((q) => [q.id, q.text])).toEqual([
      ["exact-model", '"CFI-ZCT2W" Sony'],
      ["brand-product", "Sony DualSense Wireless Controller"],
      ["reviews", "Sony DualSense Wireless Controller review"],
      ["reviews-reddit", "Sony DualSense Wireless Controller reddit"],
    ]);
  });

  it("handles a missing model number, brand or product", () => {
    expect(
      buildQueries({ brand: "Sony", product: "DualSense" }, true).map(
        (q) => q.id,
      ),
    ).toEqual(["brand-product", "reviews", "reviews-reddit"]);
    const modelOnly = buildQueries({ modelNumber: "CFI-ZCT2W" }, true);
    expect(modelOnly[0]).toMatchObject({
      text: '"CFI-ZCT2W"',
      fields: ["identifiers"],
    });
    // Unquoted, Google read "CFI-ZCT2W" as "CFI" in a live run.
    expect(modelOnly.map((q) => q.text)).toEqual([
      '"CFI-ZCT2W"',
      '"CFI-ZCT2W" review',
      '"CFI-ZCT2W" reddit',
    ]);
    expect(buildQueries({ brand: "  Sony " })).toEqual([]);
    expect(buildQueries({})).toEqual([]);
  });
});

describe("model numbers", () => {
  it("normalises case, spaces and separators", () => {
    for (const variant of [
      "cfi-zct2w",
      "cfi zct2w",
      "CFIZCT2W",
      "CFI_ZCT2W",
      " CFI-ZCT2W ",
    ])
      expect(normalizeModelNumber(variant)).toBe("CFIZCT2W");
  });

  it("keeps the original spelling when matching variants", () => {
    const spaced = matchModelNumber(
      "CFI-ZCT2W",
      "Sony DualSense CFI ZCT2W white",
    );
    expect(spaced).toMatchObject({
      exact: false,
      normalized: false,
      seen: ["ZCT2W"],
    });
    const lower = matchModelNumber("CFI-ZCT2W", "model cfi-zct2w");
    expect(lower).toMatchObject({
      exact: true,
      normalized: true,
      seen: ["cfi-zct2w"],
    });
  });

  it("reports regional suffixes separately instead of merging them", () => {
    const m = matchModelNumber("CFI-ZCT2W", "Sold as CFI-ZCT2W01 in Japan");
    expect(m.exact).toBe(false);
    expect(m.normalized).toBe(false);
    expect(m.suffixVariants).toEqual(["CFI-ZCT2W01"]);
  });

  it("does not treat a different revision as a match", () => {
    const m = matchModelNumber("CFI-ZCT2W", "Original CFI-ZCT1W controller");
    expect(m).toMatchObject({
      exact: false,
      normalized: false,
      suffixVariants: [],
    });
    expect(m.seen).toEqual(["CFI-ZCT1W"]);
  });

  it("extracts whole tokens without splitting them across words", () => {
    expect(
      extractModelNumbers("Sony DualSense Controller cfi-zct2w White - eBay"),
    ).toEqual(["cfi-zct2w"]);
    expect(
      extractModelNumbers(
        "The CFI-ZCT2W revision replaces the original CFI-ZCT1W, lighter.",
      ),
    ).toEqual(["CFI-ZCT2W", "CFI-ZCT1W"]);
    expect(extractModelNumbers("SONY CFI ZCT2W (white)")).toEqual(["ZCT2W"]);
    // From a live snippet: an em dash separates clauses, not model pieces.
    expect(
      extractModelNumbers(
        "advertised weight of 280 g" +
          String.fromCharCode(0x2014) +
          "CFI-ZCT1W AKA V1",
      ),
    ).toEqual(["CFI-ZCT1W"]);
    expect(extractModelNumbers("Model: CFI-ZCT2W/CFI-ZCT1W.")).toEqual([
      "CFI-ZCT2W/CFI-ZCT1W",
    ]);
  });

  it("ignores handles, words and times seen in real results", () => {
    for (const title of [
      "What to buy for this controller : r/PS5HelpSupport",
      "PS5's DualSense Edge controller is now available at Amazon",
      "Open 7am-11pm",
      "for an immersive gaming experience1",
    ])
      expect(extractModelNumbers(title)).toEqual([]);
    // A real model number in a real Lens title is still found.
    expect(
      extractModelNumbers(
        "Sony CFI-1215A PlayStation 5 825GB Home Gaming Console",
      ),
    ).toEqual(["CFI-1215A"]);
  });

  it("ignores ordinary words, years and capacities", () => {
    expect(
      extractModelNumbers("Sony 2026 edition 64GB PS5 controller"),
    ).toEqual([]);
  });
});

describe("price parsing", () => {
  it.each([
    ["$59.99", "USD", 5999, "USD"],
    ["59,99 €", null, 5999, "EUR"],
    ["€59,99", null, 5999, "EUR"],
    ["1.234,56 €", null, 123456, "EUR"],
    ["$1,234.56", "USD", 123456, "USD"],
    ["£49", null, 4900, "GBP"],
    ["¥7,980", null, 7980, "JPY"],
    ["CA$89.99", "USD", 8999, "CAD"],
    ["EUR 59.99", null, 5999, "EUR"],
    ["129,00 kr", "SEK", 12900, "SEK"],
    ["1 299,00 zł", null, 129900, "PLN"],
    ["$69.99 - $74.99", "USD", null, "USD"],
  ])("parses %s", (text, hint, minor, currency) => {
    expect(parsePrice(text, hint)).toEqual({
      amountMinor: minor,
      currency,
      original: text,
    });
  });

  it("never guesses an ambiguous currency", () => {
    expect(parsePrice("$59.99")).toEqual({
      amountMinor: null,
      currency: null,
      original: "$59.99",
    });
    // A euro hint does not turn "$" into euros.
    expect(parsePrice("$59.99", "EUR").currency).toBeNull();
  });

  it("returns null amounts for text without a price", () => {
    expect(parsePrice("See price in cart", "USD")).toMatchObject({
      amountMinor: null,
      currency: "USD",
    });
  });
});

describe("URL canonicalisation", () => {
  // Inputs are real URLs returned by SerpApi in the recordings.
  it.each([
    [
      "https://www.pawnamerica.com/product/sony-dualsense-cfi-zct2w-playstation-5-wireless-controller-white?srsltid=AU7gw4WGYu5t9VE7dizyIQMTle2nStgfR_lAQ7tprVAd_ClsWrB",
      "https://www.pawnamerica.com/product/sony-dualsense-cfi-zct2w-playstation-5-wireless-controller-white",
    ],
    [
      "https://www.reddit.com/r/PS5/comments/1j507tf/first_look_at_the_dualsense_wireless_controller/",
      "https://www.reddit.com/r/PS5/comments/1j507tf/first_look_at_the_dualsense_wireless_controller/",
    ],
    [
      "https://www.target.com/p/dualsense-wireless-controller-for-playstation-5/-/A-81114477?showOnlyQuestions=true",
      "https://www.target.com/p/dualsense-wireless-controller-for-playstation-5/-/A-81114477?showOnlyQuestions=true",
    ],
    [
      "https://www.apple.com/shop/product/hsg32zm/a/dualsense™-wireless-controller",
      "https://www.apple.com/shop/product/hsg32zm/a/dualsense%E2%84%A2-wireless-controller",
    ],
  ])("canonicalises %s", (input, expected) => {
    expect(canonicalizeUrl(input)).toBe(expected);
  });

  it("preserves Amazon seller/variant/path distinctions", () => {
    // Real Amazon ASIN from the Lens recording, with Amazon's usual slug/ref/tag noise.
    expect(
      canonicalizeUrl(
        "https://www.amazon.com/PlayStation-DualSense-Wireless-Controller/dp/B0BSYFB99D/ref=sr_1_1?tag=x-20&th=1",
      ),
    ).toBe(
      "https://www.amazon.com/PlayStation-DualSense-Wireless-Controller/dp/B0BSYFB99D/ref=sr_1_1?tag=x-20&th=1",
    );
  });

  it("drops common tracking parameters and sorts the rest", () => {
    expect(
      canonicalizeUrl(
        "http://WWW.BestBuy.com:80/site/searchpage.jsp?st=dualsense&utm_source=x&gclid=1&fbclid=2&cp=2#reviews",
      ),
    ).toBe(
      "http://www.bestbuy.com/site/searchpage.jsp?cp=2&st=dualsense#reviews",
    );
  });
});

describe("source classification", () => {
  // Real URLs from the recordings and the brand's own sites.
  it.each([
    [
      "https://www.reddit.com/r/PS5/comments/1j507tf/first_look_at_the_dualsense_wireless_controller/",
      "reddit",
    ],
    [
      "https://pk.ign.com/playstation-5-dualsense-controller/194313/review/ps5-dualsense-controller-review",
      "review_site",
    ],
    [
      "https://www.nytimes.com/wirecutter/blog/playstation-5-dualsense-edge-review/",
      "review_site",
    ],
    ["https://comicbook.com/gaming/news/ps5-dualsense-fix/", "other"],
    [
      "https://www.playstation.com/en-us/accessories/dualsense-wireless-controller/",
      "manufacturer_spec",
    ],
    [
      "https://direct.playstation.com/en-us/buy-accessories/dualsense-wireless-controller",
      "manufacturer_spec",
    ],
    ["https://electronics.sony.com/", "manufacturer_spec"],
    ["https://www.youtube.com/shorts/F91K059DwFs", "other"],
  ])("classifies %s", (url, type) => {
    expect(classifySource(url, "Sony")).toBe(type);
  });
});

describe("match signals", () => {
  it("records which query fields appear, without a verdict", () => {
    const signals = computeMatchSignals(
      DUALSENSE,
      "Sony DualSense Controller CFI-ZCT2W",
      "",
    );
    expect(signals).toMatchObject({
      exactModelNumber: true,
      normalizedModelNumber: true,
      brandMatch: true,
      productTermsMatched: ["dualsense", "controller"],
      productTermsMissing: ["wireless"],
    });
    expect(signals.titleTokenOverlap).toBeGreaterThan(0);
    expect(signals.titleTokenOverlap).toBeLessThanOrEqual(1);
  });

  it("uses null for fields the query did not include", () => {
    const signals = computeMatchSignals(
      { product: "DualSense" },
      "DualSense",
      "",
    );
    expect(signals.exactModelNumber).toBeNull();
    expect(signals.brandMatch).toBeNull();
  });
});

describe("search without a model number", () => {
  it("falls back to brand + product and records no model signals", async () => {
    const { providers, calls } = fixtureProviders();
    const result = await runProductSearch(
      { brand: "Sony", product: "DualSense Wireless Controller" },
      providers,
      { now: FIXED_NOW },
    );
    expect(
      calls.filter((c) => c.get("engine") === "google").map((c) => c.get("q")),
    ).toContain("Sony DualSense Wireless Controller");
    expect(calls.some((c) => c.get("q")?.startsWith('"'))).toBe(false);
    expect(result.candidates.length).toBeGreaterThan(0);
    for (const c of result.candidates)
      expect(c.matchSignals.exactModelNumber).toBeNull();
  });

  it("runs the fallback query when the exact query finds too little", async () => {
    const { providers, calls } = fixtureProviders(undefined, 10);
    await runProductSearch(DUALSENSE, providers, { now: FIXED_NOW });
    const webQueries = calls
      .filter((c) => c.get("engine") === "google")
      .map((c) => c.get("q"))
      .filter((q) => !/review|reddit/.test(q ?? ""));
    expect(webQueries).toEqual([
      '"CFI-ZCT2W" Sony',
      "Sony DualSense Wireless Controller",
    ]);
  });
});

describe("provider independence", () => {
  it("preserves provider observations with differing URL semantics", async () => {
    // A second, non-SerpApi provider returning the same real eBay listing.
    const real = (
      recorded("google_shopping", '"CFI-ZCT2W" Sony')
        .shopping_results as Record<string, string>[]
    )[0];
    const custom: SearchProvider = {
      id: "test:other-vendor",
      kind: "shopping",
      async search() {
        return {
          ...emptyOutput(),
          offers: [
            {
              queryId: "exact-model",
              field: "items",
              title: real.title,
              url: real.product_link,
              merchant: real.source,
              price: real.price,
              currencyHint: "USD",
              listPrice: null,
              availability: null,
              condition: real.second_hand_condition ?? null,
              shipping: null,
            },
          ],
        };
      },
    };
    const { providers } = fixtureProviders();
    const result = await runProductSearch(DUALSENSE, [...providers, custom], {
      now: FIXED_NOW,
    });
    const merged = result.offers.filter((o) => o.title === real.title);
    expect(merged).toHaveLength(2);
    expect(merged.flatMap((o) => o.foundBy.map((r) => r.provider))).toEqual([
      "serpapi:google_shopping",
      "test:other-vendor",
    ]);
  });

  it("reports a missing API key per provider instead of throwing", async () => {
    const { createSerpApiProviders } =
      await import("@/lib/search/product-search/serpapi");
    const result = await runProductSearch(
      DUALSENSE,
      createSerpApiProviders({
        apiKey: undefined,
        fetch: () => {
          throw new Error("network");
        },
      }),
      { imageUrl: IMAGE_URL, now: FIXED_NOW },
    );
    expect(
      result.providerRuns
        .filter((r) => r.kind !== "reviews")
        .every((r) => r.error?.code === "NOT_CONFIGURED"),
    ).toBe(true);
  });

  it("rate limiter rejects once the window is full", () => {
    const acquire = createRateLimiter(2, 1000);
    acquire(0);
    acquire(10);
    expect(() => acquire(20)).toThrow(/allowance/);
    expect(() => acquire(1001)).not.toThrow();
  });
});
