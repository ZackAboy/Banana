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

const timestamp = "2026-10-10T12:00:00.000Z";
async function searchFixture({
  value = "CFI-ZCT1W",
  brand = "Sony",
  product = "DualSense Wireless Controller",
  title = `${brand} ${product} ${value}`,
  kind = "model_number",
  snippet = "Product listing.",
}: {
  value?: string;
  brand?: string;
  product?: string;
  title?: string;
  kind?: SearchIdentifier["kind"];
  snippet?: string;
} = {}) {
  return runProductSearch(
    { brand, product, identifiers: [{ kind, value }] },
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
              brand,
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
    const normal = await searchFixture();
    normal.candidates[0].observations[0].brandClue = null;
    expect(deriveSearchAssociations(normal)).toEqual([]);
    const snippetOnly = await searchFixture({
      title: "Sony DualSense Wireless Controller",
      snippet: "MODEL CFI-ZCT1W",
    });
    expect(deriveSearchAssociations(snippetOnly)).toEqual([]);
  });
});
