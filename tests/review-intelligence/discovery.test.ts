import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildReviewQueries,
  discoverReviewSources,
  reviewDiscoveryResultSchema,
} from "@/lib/review-intelligence";
import { assessRelevance } from "@/lib/review-intelligence/relevance";
import { classifySource } from "@/lib/review-intelligence/classify";
import { absoluteDate, sourceKey } from "@/lib/review-intelligence/discover";
import {
  emptyOutput,
  type SearchProvider,
} from "@/lib/search/product-search/provider";
import {
  DUALSENSE,
  blockNetwork,
  fixtureProviders,
  recorded,
} from "../product-search/helpers";
import { recordedRow, reviewRoute, reviewRows } from "./helpers";

// Every input is a real SerpApi response: Review Intelligence's own live run
// (tests/review-intelligence/fixtures/recorded, 2026-10-10) and Product
// Search's recordings for titles/URLs. Unrecorded requests get HTTP 500, so no
// response is invented; malformed cases are deliberate corruptions of real data.

let restoreNetwork: () => void;
beforeAll(() => {
  restoreNetwork = blockNetwork();
});
afterAll(() => restoreNetwork());

type Row = { title: string; link: string; snippet?: string; date?: string };
const rows = (engine: string, q: string) =>
  recorded(engine, q).organic_results as Row[];
const REVIEW_Q = "Sony DualSense Wireless Controller review";
const REDDIT_Q = "Sony DualSense Wireless Controller reddit";
const webRow = (match: string) =>
  rows("google", '"CFI-ZCT2W" Sony').find((r) => r.link.includes(match))!;
const lensTitle = (match: string) =>
  (recorded("google_lens", LENS_URL).visual_matches as Row[]).find((r) =>
    r.title.includes(match),
  )!.title;
const LENS_URL =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/Playstation_Dualsense_controller.jpg/1280px-Playstation_Dualsense_controller.jpg";

const reviewProvider = (route = reviewRoute) =>
  fixtureProviders(route).providers.find((p) => p.kind === "reviews")!;

describe("query plan", () => {
  it("puts quoted exact-model queries first, then product queries", () => {
    expect(buildReviewQueries(DUALSENSE).map((q) => q.text)).toEqual([
      '"CFI-ZCT2W" review',
      '"CFI-ZCT2W" reddit',
      REVIEW_Q,
      REDDIT_Q,
      "Sony DualSense Wireless Controller long term review",
      "Sony DualSense Wireless Controller problems reddit",
    ]);
    expect(buildReviewQueries({ brand: "Sony" })).toEqual([]);
  });
});

describe("relevance (real titles and snippets)", () => {
  it("labels an exact model-number mention and records where it was seen", () => {
    const row = webRow("comicbook.com");
    const r = assessRelevance(DUALSENSE, row.title, row.snippet!);
    expect(r.level).toBe("exact_model");
    expect(r.modelObservations[0]).toMatchObject({
      observedValue: "CFI-ZCT2W",
      match: "literal",
      field: "snippet",
    });
    expect(r.otherModelNumbers).toContain("BDM-060");
  });

  it("does not claim the exact model for a different revision", () => {
    const row = webRow("techpowerup.com");
    const r = assessRelevance(DUALSENSE, row.title, row.snippet!);
    expect(r.level).toBe("product_family");
    expect(r.siblingModelNumbers).toEqual(["CFI-ZCT1W"]);
    expect(r.notes).toContain("Model CFI-ZCT2W is not mentioned");
  });

  it("does not penalise unrelated codes such as a promo code", () => {
    // Real thread: "[Controller] Playstation 5 Dualsense - $54 (w/ code PLAY5 ..."
    const deal = rows("google", REDDIT_Q).find((r) =>
      r.title.includes("PLAY5"),
    )!;
    const r = assessRelevance(DUALSENSE, deal.title, deal.snippet!);
    expect(r.otherModelNumbers).toContain("PLAY5");
    expect(r.siblingModelNumbers).toEqual([]);
    expect(r.level).toBe("product_name");
  });

  it("separates the product name from a sibling product (DualSense Edge)", () => {
    const [ign, edge] = rows("google", REVIEW_Q);
    expect(assessRelevance(DUALSENSE, ign.title, ign.snippet!).level).toBe(
      "product_name",
    );
    const r = assessRelevance(DUALSENSE, edge.title, edge.snippet!);
    expect(r.level).toBe("product_family");
    expect(r.variantConflicts).toEqual(["edge"]);
  });

  it("keeps accessory listings weak even though they name the product", () => {
    const title = lensTitle("Textured Button set");
    const r = assessRelevance(DUALSENSE, title, null);
    expect(r.familyTermsMatched).toEqual(["dualsense"]);
    expect(r.level).toBe("weak");
    expect(r.accessoryCues).toEqual(["button set"]);
    // Hand-written contract case: a model mention as a compatibility target.
    expect(
      assessRelevance(
        DUALSENSE,
        "Thumbstick Caps Compatible with DualSense CFI-ZCT2W",
        null,
      ).level,
    ).toBe("weak");
  });
});

describe("classification (real URLs)", () => {
  it.each([
    [
      "https://www.reddit.com/r/PS5/comments/1j507tf/first_look_at_the_dualsense_wireless_controller/",
      "reddit",
      "reddit_domain",
    ],
    [
      "https://pk.ign.com/playstation-5-dualsense-controller/194313/review/ps5-dualsense-controller-review",
      "professional_review",
      "known_review_site",
    ],
    [
      "https://godisageek.com/reviews/dualsense-edge-controller-review/",
      "professional_review",
      "review_path",
    ],
    [
      "https://www.samsclub.com/reviews/product/13612962668?page=491",
      "retailer_review",
      "retailer_review_path",
    ],
    [
      "https://www.walmart.com/ip/Sony-PS5-DualSense-Edge-Wireless-Controller/1707140316",
      "other",
      "retailer_listing",
    ],
    [
      "https://www.techpowerup.com/forums/threads/sony-ps5-v2-dualsense-controller-leaked-by-best-buy.317714/",
      "community",
      "community_pattern",
    ],
    [
      "https://www.playstation.com/en-us/accessories/dualsense-wireless-controller/",
      "manufacturer",
      "manufacturer_domain",
    ],
    ["https://www.youtube.com/shorts/F91K059DwFs", "other", "none"],
  ])("%s -> %s", (url, type, basis) => {
    const c = classifySource(url, "", "Sony");
    expect([c.sourceType, c.basis]).toEqual([type, basis]);
  });

  it("never labels a brand's own site or a product listing as a review", () => {
    // Hand-written contract cases (no real recording contains them).
    expect(
      classifySource("https://www.bose.com/reviews/qc-ultra", "", "Bose")
        .sourceType,
    ).not.toBe("professional_review");
    expect(
      classifySource(
        "https://www.amazon.com/dp/B0FY6Y9WZT",
        "DualSense Controller - Top Reviews",
        "Sony",
      ).basis,
    ).toBe("retailer_listing");
  });

  it("extracts subreddit and thread ID from Reddit URLs", () => {
    const c = classifySource(rows("google", REDDIT_Q)[2].link, "", "Sony");
    expect(c.reddit).toEqual({
      subreddit: "playstation5",
      threadId: "1jfgljf",
    });
  });
});

describe("deduplication", () => {
  it("merges the same page, never different threads with similar titles", () => {
    const thread = rows("google", REDDIT_Q)[1].link;
    expect(sourceKey(thread)).toBe(
      sourceKey(
        thread.replace("www.reddit.com", "old.reddit.com") +
          "?utm_source=share",
      ),
    );
    const ign = rows("google", REVIEW_Q)[0].link;
    expect(sourceKey(`${ign}/?utm_medium=x`)).toBe(sourceKey(ign));
    // Two real r/buildapcsales DualSense threads with near-identical titles.
    const deals = rows("google", REDDIT_Q).filter((r) =>
      r.link.includes("/r/buildapcsales/"),
    );
    expect(deals).toHaveLength(2);
    expect(sourceKey(deals[0].link)).not.toBe(sourceKey(deals[1].link));
  });

  it("keeps every query that discovered the same source", async () => {
    // A non-SerpApi provider returning one real thread through two queries.
    const row = rows("google", REDDIT_Q)[5];
    const provider: SearchProvider = {
      id: "test:other-vendor",
      kind: "reviews",
      async search() {
        return {
          ...emptyOutput(),
          reviews: [
            {
              queryId: "product-reddit",
              field: "results",
              title: row.title,
              url: row.link,
              snippet: row.snippet,
            },
            {
              queryId: "problems-reddit",
              field: "results",
              title: row.title,
              url: row.link.replace("www.", "old.") + "?utm_source=share",
              snippet: null,
            },
          ],
        };
      },
    };
    const result = await discoverReviewSources(DUALSENSE, provider);
    expect(result.sources).toHaveLength(1);
    const [source] = result.sources;
    expect(
      source.discoveredBy.map((d) => [d.provider, d.queryId, d.queryText]),
    ).toEqual([
      ["test:other-vendor", "product-reddit", REDDIT_Q],
      [
        "test:other-vendor",
        "problems-reddit",
        "Sony DualSense Wireless Controller problems reddit",
      ],
    ]);
    expect(source.reddit).toEqual({
      subreddit: "buildapcsales",
      threadId: "15mu91i",
    });
  });
});

describe("discovery with the SerpApi review adapter (replayed live run)", () => {
  it("returns classified, ranked sources with provenance", async () => {
    const result = await discoverReviewSources(DUALSENSE, reviewProvider());
    expect(() => reviewDiscoveryResultSchema.parse(result)).not.toThrow();
    expect(result.providerRun.status).toBe("ok");
    expect(result.providerRun.requests.map((r) => r.queryId)).toEqual(
      buildReviewQueries(DUALSENSE).map((q) => q.id),
    );

    // Exact-model sources come first and say where the model was seen.
    expect(result.sources[0].relevance.level).toBe("exact_model");
    const gameChanger = result.sources.find((s) =>
      s.title.startsWith("DualSense V2 CFI-ZCT2W is an absolute game changer"),
    )!;
    expect(gameChanger).toMatchObject({
      sourceType: "reddit",
      reddit: { subreddit: "Dualsense" },
      relevance: { level: "exact_model" },
      discoveredBy: [
        {
          provider: "serpapi:google_reviews",
          engine: "google",
          queryId: "model-reddit",
          queryText: '"CFI-ZCT2W" reddit',
        },
      ],
    });
    expect(gameChanger.relevance.modelObservations[0]).toMatchObject({
      observedValue: "CFI-ZCT2W",
      match: "literal",
      field: "title",
    });
    expect(gameChanger.id).toMatch(/^review_[0-9a-f]{16}$/);

    // A real source found by two different queries keeps both discoveries.
    const godisageek = result.sources.find(
      (s) => s.domain === "godisageek.com",
    )!;
    expect(godisageek.discoveredBy.map((d) => d.queryId)).toEqual([
      "product-review",
      "long-term",
    ]);
    expect(godisageek.relevance).toMatchObject({
      level: "product_family",
      variantConflicts: ["edge"],
    });

    expect(result.sources.find((s) => s.domain === "pk.ign.com")).toMatchObject(
      {
        sourceType: "professional_review",
        publishedDate: "2020-11-06",
        relevance: { level: "product_name" },
      },
    );
    expect(
      result.sources.find((s) => s.domain === "playstation.com")?.sourceType,
    ).toBe("manufacturer");
    expect(
      result.sources.find((s) => s.url.includes("bestbuy.com/site/questions/")),
    ).toMatchObject({
      sourceType: "retailer_review",
      relevance: { level: "exact_model" },
    });
    // An Amazon product listing is excluded, with the reason recorded.
    const listing = result.excluded.find(
      (s) => s.url.includes("amazon.com/") && s.url.includes("/dp/"),
    )!;
    expect(listing.exclusionReasons).toContain(
      "Retailer product listing, not a review page",
    );

    // Strongest first; no level appears after a weaker one.
    const order = ["exact_model", "product_name", "product_family", "weak"];
    const ranks = result.sources.map((s) => order.indexOf(s.relevance.level));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    const ids = [...result.sources, ...result.excluded].map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("separates a model listed after a slash (V2/CFI-ZCT2W)", () => {
    const row = reviewRows('"CFI-ZCT2W" reddit').find((r) =>
      r.title.includes("V2/CFI-ZCT2W"),
    )!;
    const r = assessRelevance(DUALSENSE, row.title, row.snippet ?? null);
    expect(r.level).toBe("exact_model");
    // A slash AFTER the model still means a longer identifier.
    expect(
      assessRelevance(DUALSENSE, "Japan CFI-ZCT2W/01 bundle", null).level,
    ).not.toBe("exact_model");
  });

  it("discards malformed rows and survives a malformed response", async () => {
    const real = recorded("google", REVIEW_Q);
    const good = real.organic_results as Row[];
    const corrupted = {
      ...real,
      organic_results: [
        { ...good[0], title: undefined },
        { ...good[1], link: "javascript:alert(1)" },
        { ...good[2], link: `${good[2].link}?api_key=leak` },
        "not a row",
        ...good.slice(3),
      ],
    };
    const result = await discoverReviewSources(
      DUALSENSE,
      reviewProvider((p) =>
        p.get("q") === REVIEW_Q
          ? corrupted
          : p.get("q") === REDDIT_Q
            ? { organic_results: "not a list" }
            : reviewRoute(p),
      ),
    );
    expect(result.providerRun.discardedRows).toBe(4);
    expect(result.providerRun.status).toBe("partial");
    const byQuery = Object.fromEntries(
      result.providerRun.requests.map((r) => [
        r.queryId,
        r.error?.code ?? r.status,
      ]),
    );
    expect(byQuery["product-review"]).toBe("ok");
    expect(byQuery["product-reddit"]).toBe("INVALID_RESPONSE");
    const fromCorrupted = [...result.sources, ...result.excluded].filter((s) =>
      s.discoveredBy.some((d) => d.queryId === "product-review"),
    );
    expect(
      fromCorrupted
        .map(
          (s) =>
            s.discoveredBy.find((d) => d.queryId === "product-review")!.url,
        )
        .sort(),
    ).toEqual(
      good
        .slice(3)
        .map((r) => r.link)
        .sort(),
    );
  });

  it("reports a missing API key instead of throwing", async () => {
    const { createSerpApiProviders } =
      await import("@/lib/search/product-search/serpapi");
    const provider = createSerpApiProviders({ apiKey: undefined }).find(
      (p) => p.kind === "reviews",
    )!;
    const result = await discoverReviewSources(DUALSENSE, provider);
    expect(result.providerRun).toMatchObject({
      status: "error",
      error: { code: "NOT_CONFIGURED" },
    });
    expect(result.sources).toEqual([]);
  });
});

describe("other products (recorded live runs, 2026-10-10)", () => {
  const SONY = {
    brand: "Sony",
    product: "WH-1000XM5 Wireless Noise Canceling Headphones",
    modelNumber: "WH-1000XM5",
  };
  const LG = {
    brand: "LG",
    product: "UltraGear Gaming Monitor",
    modelNumber: "27GP850-B",
  };
  const AIRPODS = {
    brand: "Apple",
    product: "AirPods Pro 2",
    modelNumber: "A2698",
  };
  const assess = (query: typeof SONY, title: string) => {
    const row = recordedRow(title);
    return assessRelevance(query, row.title, row.snippet ?? null);
  };

  it("recognises spaced, plural and listed model numbers", () => {
    const spaced = recordedRow("Sony WH 1000XM5 Wireless Noise Cancelling");
    const r = assessRelevance(SONY, spaced.title, null);
    expect(r.level).toBe("exact_model");
    expect(r.modelObservations[0]).toMatchObject({
      observedValue: "WH 1000XM5",
      match: "normalized",
    });
    expect(assess(SONY, "WH-1000XM5s have failed").level).toBe("exact_model");
    expect(assess(AIRPODS, "A2698+A2699").level).toBe("exact_model");
    expect(assess(LG, "27GP850-B/27GP83B-B").level).toBe("exact_model");
  });

  it("flags other models of the same line, whatever their naming scheme", () => {
    const r = assess(LG, "LG UltraGear 32GS95UE OLED");
    expect(r.level).toBe("product_family");
    expect(r.siblingModelNumbers).toEqual(["32GS95UE"]);
  });

  it("treats a regional suffix as the product family, not a match", () => {
    const r = assess(LG, "27GP850-B.AUS");
    expect(r.level).toBe("product_family");
    expect(r.notes).toContain(
      "Only a longer model number containing the query model appears",
    );
  });

  it("keeps a generation number required and 'Pro' in the name allowed", () => {
    const pro2 = assess(AIRPODS, "AirPods Pro 2: Long-Term Review");
    expect(pro2.level).toBe("product_name");
    expect(pro2.variantConflicts).toEqual([]);
    // "AirPods 2" is a different product.
    expect(assess(AIRPODS, "AirPods 2 Issues, Bugs").level).toBe("weak");
  });
});

describe("dates", () => {
  it("converts absolute dates only", () => {
    expect(absoluteDate("Nov 6, 2020")).toBe("2020-11-06");
    expect(absoluteDate("3 months ago")).toBeNull();
    expect(absoluteDate(null)).toBeNull();
  });
});
