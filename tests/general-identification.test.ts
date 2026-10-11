import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ProductIdentityCard } from "@/components/identification/product-identity-card";
import {
  fuseProductEvidence,
  toProductIdentification,
} from "@/lib/identification/fusion";
import { identifyWithEvidence } from "@/lib/identification/runtime";
import {
  runProductSearch,
  type PageHit,
  type ProductSearchQuery,
} from "@/lib/search/product-search";
import type { FusionInput } from "@/lib/identification/evidence-contracts";
import {
  images,
  physical,
  search,
  semantic,
} from "./fixtures/runtime-evidence";

function wording(lines: string[]) {
  return {
    schema_version: "ocr.v1",
    source: "paddleocr",
    images: [
      {
        source_image_index: 1,
        regions: lines.map((text, i) => ({
          region_index: i + 1,
          raw_text: text,
          normalized_text: text,
        })),
        identifiers: [],
        brand_clues: [],
      },
    ],
  };
}
function candidates(
  titles: { title: string; brand?: string; variant?: string; url?: string }[],
  kind: "web" | "visual" = "web",
  query: ProductSearchQuery = { product: "discovery clue" },
) {
  return runProductSearch(query, [
    {
      id: `fixture-${kind}`,
      kind,
      search: async () => ({
        pages: titles.map((row, i): PageHit => ({
          ...row,
          url: row.url ?? `https://source${i}.example/product`,
          queryId: kind === "visual" ? "lens-image" : "brand-product",
          field: kind === "visual" ? "visual_matches" : "organic_results",
        })),
        offers: [],
        reviews: [],
        raw: [],
      }),
    },
  ]);
}
beforeEach(() =>
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Unexpected live call");
    }),
  ),
);
afterEach(() => vi.unstubAllGlobals());

describe("general product identity", () => {
  it.each([
    {
      lines: ["Coca-Cola", "Diet Coke", "Caffeine Free"],
      title: "Diet Coke Caffeine Free 12 fl oz",
      brand: "Coca-Cola",
      family: "Diet Coke",
      variant: "Caffeine Free",
    },
    {
      lines: ["Luma", "Nourish Cream", "Fragrance Free"],
      title: "Luma Nourish Cream Fragrance Free 50 ml",
      brand: "Luma",
      family: "Nourish Cream",
      variant: "Fragrance Free",
    },
  ])(
    "confirms physical wording plus an independent source: $title",
    async ({ lines, title, brand, family, variant }) => {
      const input: FusionInput = {
        imageCount: 1,
        ocr: wording(lines),
        search: await candidates([{ title, brand }]),
      };
      const result = fuseProductEvidence(input);
      const product = toProductIdentification(result, input);
      expect(product).toMatchObject({
        identificationStatus: "confirmed",
        productName: `${family} ${variant}`,
        variant,
        modelNumber: null,
        sku: null,
        suggestedNextImage: null,
        identityResolution: {
          granularity: "variant",
          productFamily: family,
          unresolvedFields: ["size"],
        },
      });
      expect(product.identityResolution!.evidence.map((e) => e.source)).toEqual(
        expect.arrayContaining(["paddleocr", "product_search"]),
      );
      expect(
        product.identityResolution!.evidence.some(
          (e) => e.sourceUrl === "https://source0.example/product",
        ),
      ).toBe(true);
      expect(
        renderToStaticMarkup(
          createElement(ProductIdentityCard, {
            identification: product,
            mock: false,
          }),
        ),
      ).not.toMatch(/Model needs confirmation/);
    },
  );

  it("preserves a confirmed family across conflicting variants, even within one source group", async () => {
    const input = {
      imageCount: 1,
      ocr: wording(["Diet Coke", "Caffeine Free"]),
      search: await candidates([
        { title: "Diet Coke Caffeine Free", url: "https://same.example/item" },
        { title: "Diet Coke Original", url: "https://same.example/item" },
      ]),
    };
    const result = fuseProductEvidence(input);
    expect(result).toMatchObject({
      status: "confirmed",
      needsMoreEvidence: false,
      identity: { productName: "Diet Coke", variant: null },
      identityResolution: {
        granularity: "product_family",
        unresolvedFields: ["variant"],
      },
    });
    expect(result.conflictingEvidence).toContainEqual(
      expect.objectContaining({
        code: "semantic_variant_conflict",
        material: false,
      }),
    );
    expect(toProductIdentification(result, input).suggestedNextImage).toMatch(
      /variant, flavor or style/,
    );
  });

  it("normalizes an optional physical manufacturer prefix without collapsing variants", async () => {
    const input = {
      imageCount: 1,
      ocr: wording(["Coca-Cola", "Diet Coke", "Caffeine Free"]),
      search: await candidates([
        { title: "Coca-Cola Diet Coke Caffeine Free 12 oz" },
        { title: "Diet Coke Caffeine Free 12 oz" },
      ]),
    };
    expect(
      toProductIdentification(fuseProductEvidence(input), input),
    ).toMatchObject({
      identificationStatus: "confirmed",
      productName: "Diet Coke Caffeine Free",
      variant: "Caffeine Free",
      identityResolution: {
        granularity: "variant",
        productFamily: "Diet Coke",
      },
    });
    input.search = await candidates([
      { title: "Coca-Cola Diet Coke Original" },
      { title: "Diet Coke Caffeine Free" },
    ]);
    expect(
      toProductIdentification(fuseProductEvidence(input), input),
    ).toMatchObject({
      identificationStatus: "confirmed",
      productName: "Diet Coke",
      variant: null,
      identityResolution: {
        granularity: "product_family",
        unresolvedFields: ["variant"],
      },
    });
  });

  it.each([
    ["Apple", "AirPods Pro", "Apple AirPods Pro 2", "Apple AirPods Pro"],
    ["Sony", "DualSense", "Sony DualSense Edge", "Sony DualSense"],
  ])(
    "does not collapse materially different variants for %s",
    async (brand, name, a, b) => {
      const input = {
        imageCount: 1,
        ocr: wording([brand, name]),
        search: await candidates([
          { title: a, brand },
          { title: b, brand },
        ]),
      };
      const result = fuseProductEvidence(input);
      expect(result.status).toBe("confirmed");
      expect(result.identity).toMatchObject({
        productName: name,
        variant: null,
        modelNumber: null,
      });
      expect(result.identityResolution?.unresolvedFields).toContain("variant");
    },
  );

  it("keeps the CFI-ZCT2W exact-identifier path and skips optional Gemini", async () => {
    const gemini = vi.fn();
    const result = await identifyWithEvidence(images, {
      ocr: async () => physical("CFI-ZCT2W"),
      search: (q) => search(q, "Sony DualSense Wireless Controller CFI-ZCT2W"),
      semantic: gemini,
    });
    expect(result.identification).toMatchObject({
      identificationStatus: "confirmed",
      modelNumber: "CFI-ZCT2W",
      identityResolution: { granularity: "exact_model" },
    });
    expect(gemini).not.toHaveBeenCalled();
  });

  it("visual candidate alone cannot manufacture a model/SKU", async () => {
    const input = {
      imageCount: 1,
      search: await candidates(
        [{ title: "Sony DualSense CFI-ZCT2W", brand: "Sony" }],
        "visual",
      ),
    };
    const product = toProductIdentification(fuseProductEvidence(input), input);
    expect(product.identificationStatus).toBe("likely");
    expect(product.modelNumber).toBeNull();
    expect(product.sku).toBeNull();
    expect(product.identityResolution?.granularity).not.toBe("exact_model");
    expect(product.suggestedNextImage).toMatch(/front or side/);
  });

  it("Lens unavailable preserves OCR + text Search confirmation without Gemini", async () => {
    const result = await identifyWithEvidence([images[0]], {
      ocr: async () => wording(["Diet Coke", "Caffeine Free"]),
      search: (query) =>
        candidates([{ title: "Diet Coke Caffeine Free" }], "web", query),
      lens: async () => {
        throw new Error("private token");
      },
      semantic: async () => {
        throw new Error("Gemini unavailable");
      },
    });
    expect(result.identification).toMatchObject({
      identificationStatus: "confirmed",
      variant: "Caffeine Free",
      suggestedNextImage: null,
    });
    expect(result.notice).toMatch(/Lens is unavailable/);
    expect(JSON.stringify(result)).not.toContain("private token");
  });

  it("physical wording plus Lens candidates can confirm without text Search or Gemini", async () => {
    const result = await identifyWithEvidence([images[0]], {
      ocr: async () => wording(["Acme", "Gentle Soap", "Lavender"]),
      search: async () => {
        throw new Error("Search unavailable");
      },
      lens: () =>
        candidates(
          [{ title: "Acme Gentle Soap Lavender", brand: "Acme" }],
          "visual",
        ),
    });
    expect(result.identification).toMatchObject({
      identificationStatus: "confirmed",
      productName: "Gentle Soap Lavender",
      modelNumber: null,
    });
    expect(
      result.identification.identityResolution?.evidence.some(
        (e) => e.source === "google_lens",
      ),
    ).toBe(true);
  });

  it("does not count OCR and Gemini processing the same label as external confirmation", () => {
    const signal = semantic();
    signal.identification.productName = "Gentle Soap";
    signal.identification.variant = "Lavender";
    signal.identification.visibleText = ["Gentle Soap Lavender"];
    signal.evidence.exactMatch = [
      {
        imageIndex: 1,
        kind: "packaging",
        observation: "Gentle Soap Lavender",
        interpretation: "Product label",
      },
    ];
    const result = fuseProductEvidence({
      imageCount: 1,
      ocr: wording(["Gentle Soap", "Lavender"]),
      semantic: signal,
    });
    expect(result.status).not.toBe("confirmed");
    expect(
      new Set(
        result.provenance
          .filter((p) => p.source === "paddleocr" || p.id === "gemini:0")
          .map((p) => p.observationGroup),
      ),
    ).toEqual(new Set(["physical:1"]));
  });

  it("strong physical wording conflicting with an exact external identity blocks confirmation", async () => {
    const ocr = physical("CFI-ZCT2W");
    ocr.images[0].regions.push({
      region_index: 1,
      raw_text: "DualSense",
      normalized_text: "DualSense",
    });
    const result = await identifyWithEvidence(images, {
      ocr: async () => ocr,
      search: (query) => search(query, "Sony Different Controller CFI-ZCT2W"),
      lens: () =>
        candidates([{ title: "Sony DualSense", brand: "Sony" }], "visual"),
    });
    expect(result.fusion.status).toBe("uncertain");
    expect(result.fusion.conflictingEvidence).toContainEqual(
      expect.objectContaining({
        code: "physical_semantic_product_conflict",
        material: true,
      }),
    );
  });

  it("retains family confirmation when an observed model lacks exact association", async () => {
    const ocr = physical("CFI-ZCT2W");
    ocr.images[0].regions.push({
      region_index: 1,
      raw_text: "DualSense",
      normalized_text: "DualSense",
    });
    const result = await identifyWithEvidence(images, {
      ocr: async () => ocr,
      search: (q) =>
        candidates([{ title: "Sony DualSense", brand: "Sony" }], "web", q),
    });
    expect(result.identification).toMatchObject({
      identificationStatus: "confirmed",
      productName: "DualSense",
      modelNumber: null,
      identityResolution: {
        granularity: "product_family",
        unresolvedFields: ["modelNumber"],
      },
    });
  });

  it("asks for readable product wording when no name/identifier is available", async () => {
    const result = await identifyWithEvidence([images[0]], {
      ocr: async () => wording([]),
      search: vi.fn(),
    });
    expect(result.identification.suggestedNextImage).toMatch(
      /brand, product name/,
    );
    expect(result.identification.suggestedNextImage).not.toMatch(/model|SKU/);
  });

  it("an identifier-only label cannot bypass exact association through semantic rules", async () => {
    const input = {
      imageCount: 2,
      ocr: physical("CFI-ZCT2W"),
      search: await candidates([
        { title: "Sony MODEL CFI-ZCT2W", brand: "Sony" },
      ]),
    };
    expect(fuseProductEvidence({ ...input, associations: [] }).status).not.toBe(
      "confirmed",
    );
  });

  it("indexed Gemini packaging text can ground a variant with Search when OCR is empty", async () => {
    const signal = semantic();
    signal.identification = {
      ...signal.identification,
      brand: "Acme",
      productName: "Gentle Soap",
      variant: "Lavender",
      modelNumber: "UNSUPPORTED-99",
      visibleText: ["Acme Gentle Soap Lavender"],
    };
    signal.evidence.exactMatch = [
      {
        imageIndex: 1,
        kind: "packaging",
        observation: "Acme Gentle Soap Lavender",
        interpretation: "Transcribed front label",
      },
    ];
    const result = await identifyWithEvidence([images[0]], {
      ocr: async () => wording([]),
      semantic: async () => signal,
      search: (q) =>
        candidates(
          [{ title: "Acme Gentle Soap Lavender", brand: "Acme" }],
          "web",
          q,
        ),
    });
    expect(result.identification).toMatchObject({
      identificationStatus: "confirmed",
      productName: "Gentle Soap Lavender",
      variant: "Lavender",
      modelNumber: null,
      identityResolution: { granularity: "variant" },
    });
    expect(
      result.identification.identityResolution?.evidence.some(
        (e) => e.source === "gemini" && e.observationGroup === "physical:1",
      ),
    ).toBe(true);
  });

  it("a consistent Lens hypothesis seeds text Search without claiming physical confirmation", async () => {
    const searchMock = vi.fn((q: ProductSearchQuery) =>
      candidates(
        [{ title: "Acme Gentle Soap Lavender", brand: "Acme" }],
        "web",
        q,
      ),
    );
    const events: string[] = [];
    const result = await identifyWithEvidence([images[0]], {
      ocr: async () => {
        events.push("ocr");
        return wording([]);
      },
      lens: () => {
        events.push("lens");
        return candidates(
          [{ title: "Acme Gentle Soap Lavender", brand: "Acme" }],
          "visual",
        );
      },
      search: searchMock,
    });
    expect(events).toEqual(["lens", "ocr"]);
    expect(searchMock).toHaveBeenCalledWith({
      product: "Acme Gentle Soap Lavender",
    });
    expect(result.identification.identificationStatus).not.toBe("confirmed");
    expect(result.identification.modelNumber).toBeNull();
  });

  it("Lens wording on the same URL does not erase an independently confirmed exact identifier", async () => {
    const result = await identifyWithEvidence(images, {
      ocr: async () => physical("CFI-ZCT2W"),
      search: (q) => search(q, "Sony DualSense Wireless Controller CFI-ZCT2W"),
      lens: () =>
        candidates(
          [
            {
              title: "Sony DualSense Wireless Controller",
              brand: "Sony",
              url: "https://example.com/controller",
            },
          ],
          "visual",
        ),
    });
    expect(result.identification).toMatchObject({
      identificationStatus: "confirmed",
      modelNumber: "CFI-ZCT2W",
      identityResolution: { granularity: "exact_model" },
    });
  });

  it("rejects accessory titles and partial product-word matches", async () => {
    for (const title of [
      "Case for Acme Gentle Soap Lavender",
      "Acme Gentle Soapy Lavender",
    ]) {
      const input = {
        imageCount: 1,
        ocr: wording(["Acme", "Gentle Soap", "Lavender"]),
        search: await candidates([{ title, brand: "Acme" }]),
      };
      expect(fuseProductEvidence(input).status).not.toBe("confirmed");
    }
  });
});
