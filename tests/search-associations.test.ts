import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deriveSearchAssociations,
  fuseProductEvidence,
  suggestedFusionImage,
} from "@/lib/identification/fusion";
import {
  runProductSearch,
  type SearchIdentifier,
} from "@/lib/search/product-search";
import { brandRelationship } from "@/lib/identification/brand-relationships";

const timestamp = "2026-10-10T12:00:00.000Z";
async function searchFixture({
  value = "CFI-ZCT1W",
  brand = "Sony",
  product = "DualSense Wireless Controller",
  title = `${brand} ${product} ${value}`,
  kind = "model_number",
  snippet = "Product listing.",
  queryBrand = brand,
  sourceBrand = brand,
}: {
  value?: string;
  brand?: string;
  product?: string;
  title?: string;
  kind?: SearchIdentifier["kind"];
  snippet?: string;
  queryBrand?: string;
  sourceBrand?: string | null;
} = {}) {
  return runProductSearch(
    { brand: queryBrand, product, identifiers: [{ kind, value }] },
    [
      {
        id: "offline-source",
        kind: "web",
        search: async () => ({
          pages: [
            {
              queryId: "exact-model",
              requestId: "request-1",
              field: "organic_results",
              title,
              snippet,
              brand: sourceBrand ?? undefined,
              url: "https://example.com/product",
              urlType: "source_page",
            },
          ],
          offers: [],
          reviews: [],
          raw: [],
          requests: [
            {
              id: "request-1",
              queryId: "exact-model",
              engine: "google",
              queryText: value,
              inputImageUrl: null,
              inputImageId: null,
              country: "us",
              language: "en",
              executed: true,
              status: "ok",
              error: null,
              retrievedAt: timestamp,
              discardedRows: 0,
            },
          ],
        }),
      },
    ],
    { now: () => new Date(timestamp) },
  );
}
function physical(
  value = "CFI-ZCT1W",
  brand = "Sony",
  kind: SearchIdentifier["kind"] = "model_number",
) {
  const label = { model_number: "MODEL", sku: "SKU", part_number: "P/N" }[kind];
  return {
    schema_version: "ocr.v1",
    source: "paddleocr",
    images: [
      {
        source_image_index: 1,
        regions: [
          {
            region_index: 1,
            raw_text: `${label} ${value}`,
            normalized_text: `${label} ${value}`,
          },
          { region_index: 2, raw_text: brand, normalized_text: brand },
        ],
        identifiers: [
          {
            source_image_index: 1,
            kind,
            value,
            label,
            extraction: "explicit_label",
            label_span: { region_index: 1, start: 0, end: label.length },
            value_span: {
              region_index: 1,
              start: label.length + 1,
              end: label.length + 1 + value.length,
            },
          },
        ],
        brand_clues: [
          {
            source_image_index: 1,
            value: brand,
            kind: "brand",
            extraction: "explicit_label",
            value_span: { region_index: 2, start: 0, end: brand.length },
          },
        ],
      },
    ],
  };
}

beforeEach(() =>
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("No network allowed");
    }),
  ),
);
afterEach(() => vi.unstubAllGlobals());

describe("Search source-linked subject association", () => {
  it.each([
    {
      value: "CFI-ZCT1W",
      brand: "Sony",
      product: "DualSense Wireless Controller",
    },
    {
      value: "CFI-ZCT2W",
      brand: "Sony",
      product: "DualSense Wireless Controller",
    },
    { value: "TS-930", brand: "Acme", product: "Trail Sensor" },
  ])(
    "associates $value with its subject and confirms offline without hand-authored findings",
    async (clues) => {
      const search = await searchFixture(clues);
      const before = structuredClone(search);
      expect(deriveSearchAssociations(search)).toEqual([
        expect.objectContaining({
          candidateId: search.candidates[0].id,
          observationIndex: 0,
          relation: "product_identity",
          identity: {
            brand: clues.brand,
            productName: `${clues.brand} ${clues.product}`,
            variant: null,
          },
          identifiers: [
            { kind: "model_number", value: clues.value, caseSensitive: false },
          ],
        }),
      ]);
      const result = fuseProductEvidence({
        imageCount: 1,
        ocr: physical(clues.value, clues.brand),
        search,
      });
      expect(result).toMatchObject({
        status: "confirmed",
        needsMoreEvidence: false,
        identity: {
          productName: `${clues.brand} ${clues.product}`,
          modelNumber: clues.value,
        },
      });
      expect(suggestedFusionImage(result)).toBeNull();
      expect(search).toEqual(before);
      expect(
        fuseProductEvidence({
          imageCount: 1,
          ocr: physical(clues.value, clues.brand),
          search,
          associations: [],
        }).status,
      ).not.toBe("confirmed");
    },
  );
  it.each([
    "Protective Case for Sony DualSense CFI-ZCT1W",
    "Sony Protective Case for DualSense CFI-ZCT1W",
    "Charging Dock compatible with CFI-ZCT1W",
    "Sony Charging Dock compatible with CFI-ZCT1W",
    "Not compatible with CFI-ZCT1W",
    "Sony DualSense Wireless Controller not compatible with CFI-ZCT1W",
  ])("rejects accessory/compatibility/negation: %s", async (title) => {
    const search = await searchFixture({ title });
    expect(deriveSearchAssociations(search)).toEqual([]);
    const result = fuseProductEvidence({
      imageCount: 1,
      ocr: physical(),
      search,
    });
    expect(result.status).not.toBe("confirmed");
    expect(result.missingEvidenceType).toBe("external_association");
    expect(suggestedFusionImage(result)).toBeNull();
  });
  it("rejects a positive-looking title when its snippet negates the claim", async () => {
    const search = await searchFixture({
      snippet: "Not compatible with CFI-ZCT1W",
    });
    expect(deriveSearchAssociations(search)).toEqual([]);
  });
  it("leaves conflicting physical and external identifiers unconfirmed", async () => {
    const search = await searchFixture({ value: "CFI-ZCT2W" });
    const result = fuseProductEvidence({
      imageCount: 1,
      ocr: physical(),
      search,
    });
    expect(result.status).toBe("uncertain");
    expect(result.reasonCodes).toContain(
      "physical_external_identifier_conflict",
    );
  });
  it.each([
    "title",
    "snippet",
    "brandClue",
    "variantClue",
    "identifiers",
  ] as const)(
    "suppresses a source group with conflicting %s and preserves references",
    async (field) => {
      const search = await searchFixture();
      const candidate = search.candidates[0];
      const other = structuredClone(candidate.observations[0]);
      if (field === "identifiers")
        other.identifiers[0].observedValue = "CFI-ZCT2W";
      else if (field === "snippet")
        other.snippet = "Not compatible with CFI-ZCT1W";
      else if (field === "variantClue") {
        candidate.observations[0].variantClue = "White";
        other.variantClue = "Black";
      } else other[field] = "Different identity";
      candidate.observations.push(other);
      expect(deriveSearchAssociations(search)).toEqual([]);
      const result = fuseProductEvidence({
        imageCount: 1,
        ocr: physical(),
        search,
      });
      expect(result.status).toBe("uncertain");
      expect(result.conflictingEvidence).toContainEqual({
        code: "source_group_identity_conflict",
        material: true,
        evidenceRefs: [`search:${candidate.id}:0`, `search:${candidate.id}:1`],
      });
    },
  );
  it("does not promote separator-folded observations to exact association", async () => {
    const search = await searchFixture({
      title: "Sony DualSense Wireless Controller CFIZCT1W",
    });
    expect(search.candidates[0].observations[0].identifiers[0].match).toBe(
      "normalized",
    );
    expect(deriveSearchAssociations(search)).toEqual([]);
    expect(
      fuseProductEvidence({ imageCount: 1, ocr: physical(), search }).status,
    ).not.toBe("confirmed");
  });
  it.each(["sku", "part_number"] as const)(
    "requires an explicit title label for %s and preserves spelling",
    async (kind) => {
      const label = kind === "sku" ? "SKU" : "P/N";
      const search = await searchFixture({
        value: "Ab-930",
        brand: "Acme",
        product: "Trail Sensor",
        kind,
        title: `Acme Trail Sensor ${label}: Ab-930`,
      });
      expect(deriveSearchAssociations(search)[0].identifiers[0]).toEqual({
        kind,
        value: "Ab-930",
        caseSensitive: true,
      });
      expect(
        fuseProductEvidence({
          imageCount: 1,
          ocr: physical("Ab-930", "Acme", kind),
          search,
        }).status,
      ).toBe("confirmed");
      expect(
        deriveSearchAssociations(
          await searchFixture({
            value: "Ab-930",
            brand: "Acme",
            kind,
            title: "Acme Trail Sensor Ab-930",
          }),
        ),
      ).toEqual([]);
    },
  );
  it("retains source/provider/engine/query/URL/title and the reason for acceptance", async () => {
    const search = await searchFixture();
    const [association] = deriveSearchAssociations(search);
    expect(association.basis).toContain("literal organic_results.title suffix");
    const result = fuseProductEvidence({
      imageCount: 1,
      ocr: physical(),
      search,
    });
    const sourceRef = `search:${association.candidateId}:${association.observationIndex}`;
    expect(
      result.provenance.find((r) => r.id === "association:0")?.observation,
    ).toMatchObject({ ...association, sourceRef });
    expect(result.provenance.find((r) => r.id === sourceRef)).toMatchObject({
      sourceUrl: "https://example.com/product",
      observation: {
        provider: "offline-source",
        engine: "google",
        queryId: "exact-model",
        requestId: "request-1",
        domain: "example.com",
        retrievedAt: timestamp,
        title: "Sony DualSense Wireless Controller CFI-ZCT1W",
      },
    });
  });
  it("does not manufacture a name or use a query brand when source identity is missing", async () => {
    const search = await searchFixture({ title: "Sony CFI-ZCT1W" });
    expect(deriveSearchAssociations(search)).toEqual([]);
    const normal = await searchFixture({
      title: "Globex Wireless Controller CFI-ZCT1W",
    });
    normal.candidates[0].observations[0].brandClue = null;
    expect(deriveSearchAssociations(normal)).toEqual([]);
    const snippetOnly = await searchFixture({
      title: "Sony DualSense Wireless Controller",
      snippet: "MODEL CFI-ZCT1W",
    });
    expect(deriveSearchAssociations(snippetOnly)).toEqual([]);
  });
});

describe("text-grounded association without provider brand metadata", () => {
  const manufacturer = "Acme Electronics Inc.";
  function label(kind: SearchIdentifier["kind"] = "model_number") {
    const ocr = physical("TS-930", manufacturer, kind);
    ocr.images[0].brand_clues[0].kind = "manufacturer";
    return ocr;
  }
  function textual(
    title = "Acme Trail Sensor TS-930",
    snippet = "Product listing.",
    kind: SearchIdentifier["kind"] = "model_number",
  ) {
    return searchFixture({
      value: "TS-930",
      brand: "Acme",
      product: "Trail Sensor",
      queryBrand: manufacturer,
      sourceBrand: null,
      title,
      snippet,
      kind,
    });
  }
  it.each([
    "Product listing.",
    "Get the best deals for Acme Trail Sensor TS-930",
  ])(
    "confirms a source title despite unstructured commerce prose: %s",
    async (snippet) => {
      const search = await textual(undefined, snippet);
      expect(search.candidates[0].observations[0].brandClue).toBeNull();
      const [association] = deriveSearchAssociations(search);
      expect(association.identity).toMatchObject({
        brand: "Acme",
        productName: "Acme Trail Sensor",
      });
      expect(association.basis).toContain("literal source-title brand prefix");
      const result = fuseProductEvidence({
        imageCount: 1,
        ocr: label(),
        search,
      });
      expect(result.status).toBe("confirmed");
      expect(result.reasonCodes).toContain(
        "manufacturer_brand_name_relationship",
      );
      expect(
        result.provenance.find((ref) => ref.id === "ocr:1:brand:0")
          ?.observation,
      ).toMatchObject({ value: manufacturer, kind: "manufacturer" });
      expect(suggestedFusionImage(result)).toBeNull();
    },
  );
  it.each([
    "Protective Case Compatible with Acme Trail Sensor TS-930",
    "Replacement Battery for Acme Trail Sensor TS-930",
    "Works with Acme Trail Sensor TS-930",
    "Not compatible with Acme Trail Sensor TS-930",
    "Acme Trail Sensor TS-930 vs TS-940",
    "Acme Trail Sensor TS-930 support guide",
    "Acme Trail Sensor TS-930-01",
    "Globex Trail Sensor TS-930",
    "Acme Trail Sensor OTHER-99",
  ])("rejects unsafe or unrelated source text: %s", async (title) => {
    const search = await textual(title);
    expect(deriveSearchAssociations(search)).toEqual([]);
    expect(
      fuseProductEvidence({ imageCount: 1, ocr: label(), search }).status,
    ).not.toBe("confirmed");
  });
  it.each([
    "Protective Case for Acme Trail Sensor TS-930",
    "Replacement Battery for Acme Trail Sensor TS-930",
    "Works with Acme Trail Sensor TS-930",
    "Not compatible with Acme Trail Sensor TS-930",
    "Not TS-930",
    "Acme Trail Sensor TS-930 vs TS-940",
  ])(
    "retains a relationship-target veto from the snippet: %s",
    async (snippet) => {
      expect(
        deriveSearchAssociations(await textual(undefined, snippet)),
      ).toEqual([]);
    },
  );
  it("records an unrelated structured source brand as a Fusion conflict", async () => {
    const search = await searchFixture({
      value: "TS-930",
      brand: "Globex",
      product: "Trail Sensor",
      queryBrand: manufacturer,
    });
    expect(deriveSearchAssociations(search)).toHaveLength(1);
    const result = fuseProductEvidence({ imageCount: 1, ocr: label(), search });
    expect(result.status).toBe("uncertain");
    expect(result.reasonCodes).toContain("brand_conflict");
  });
  it.each([
    ["Acme Electronics Inc.", "Acme", "manufacturer", "corporate_name"],
    ["Acme Inc.", "Acme", "manufacturer", "corporate_name"],
    ["Acme Electronics Inc.", "Acme", "brand", null],
    ["Globex Acme Electronics Inc.", "Acme", "manufacturer", null],
    ["Acme Research Inc.", "Acme", "manufacturer", null],
    ["Acme Electronics Inc.", "Electronics", "manufacturer", null],
    ["Acme Electronics Inc.", "AcmeCo", "manufacturer", null],
    ["Acme Electronics", "Acme", "manufacturer", null],
    ["Acme Electronics Inc.", "Globex Electronics", "manufacturer", null],
  ] as const)(
    "bounded name relationship: %s / %s (%s)",
    (physical, external, kind, expected) => {
      expect(brandRelationship(physical, external, kind)).toBe(expected);
    },
  );
  it.each([
    ["part_number", "Brand: Acme; Model: Trail Sensor; MPN: TS-930"],
    [
      "model_number",
      "Brand: Acme; Product: Trail Sensor; Model Number: TS-930",
    ],
    ["sku", "Specifications: Brand, Acme; Model, Trail Sensor; SKU, TS-930"],
  ] as const)(
    "accepts consistent explicitly typed %s specifications",
    async (kind, snippet) => {
      const search = await textual("Acme Trail Sensor", snippet, kind);
      const [association] = deriveSearchAssociations(search);
      expect(association.identifiers[0]).toMatchObject({
        kind,
        value: "TS-930",
      });
      expect(association.basis).toContain(
        "labeled specification product name agrees",
      );
      expect(
        fuseProductEvidence({ imageCount: 1, ocr: label(kind), search }).status,
      ).toBe("confirmed");
    },
  );
  it.each([
    "Brand: Acme; Model: Trail Sensor; MPN: TS-930", // MPN cannot be relabeled a model
    "Brand: Acme; Product: Different Sensor; Model Number: TS-930",
    "Brand: Acme; Product: Trail Sensor; Model Number: TS-930; Model Number: TS-940",
    "Brand: Acme; Brand: Globex; Product: Trail Sensor; Model Number: TS-930",
    "Brand: Acme; Model: Trail Sensor; Case works with Acme TS-930",
    "Brand: Acme; Product: Trail Sensor; Model Number: TS-930-01",
  ])(
    "rejects ambiguous/incorrectly typed specification: %s",
    async (snippet) => {
      expect(
        deriveSearchAssociations(await textual("Acme Trail Sensor", snippet)),
      ).toEqual([]);
    },
  );
});
