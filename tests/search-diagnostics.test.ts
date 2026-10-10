import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ProviderError,
  runProductSearch,
  type ProductSearchQuery,
} from "@/lib/search/product-search";
import {
  deriveSearchAssociations,
  fuseProductEvidence,
} from "@/lib/identification/fusion";
import { inspectSearchAssociations } from "@/lib/identification/search-associations";
import {
  logSearchDiagnostics,
  summarizeSearchDiagnostics,
} from "@/lib/identification/search-diagnostics";
import {
  identifyWithEvidence,
  searchQueryFromOcr,
} from "@/lib/identification/runtime";
import { physical, images } from "./fixtures/runtime-evidence";

afterEach(() => vi.unstubAllEnvs());

async function source(
  query: ProductSearchQuery,
  title: string,
  snippet: string | null = null,
  brand?: string,
) {
  return runProductSearch(query, [
    {
      id: "offline",
      kind: "web",
      search: async (input) => ({
        pages: [
          {
            queryId: input.queries[0].id,
            field: "organic_results",
            title,
            snippet,
            brand,
            url: "https://example.com/product",
          },
        ],
        offers: [],
        reviews: [],
        raw: [],
      }),
    },
  ]);
}

describe("Search evidence diagnosis and subject association", () => {
  it("replays the captured manufacturer query and commerce title through runtime confirmation", async () => {
    const ocr = physical("CFI-ZCT2W");
    const manufacturer = "Sony Interactive Entertainment Inc.";
    ocr.images[1].regions[1].raw_text =
      ocr.images[1].regions[1].normalized_text = manufacturer;
    Object.assign(ocr.images[1].brand_clues[0], {
      kind: "manufacturer",
      extraction: "corporate_name",
      value: manufacturer,
    });
    ocr.images[1].brand_clues[0].value_span.end = manufacturer.length;
    const query = searchQueryFromOcr({ imageCount: 2, ocr })!;
    expect(query).toEqual({
      brand: manufacturer,
      identifiers: [{ kind: "model_number", value: "CFI-ZCT2W" }],
    });
    // Observed live title/snippet pattern, replayed offline. Web results omitted
    // a structured brand; the shorter name cannot satisfy the full query brand.
    const search = await source(
      query,
      "Sony PlayStation Dual Sense Wireless Controller CFI-Zct2w",
      "Find many great new & used options and get the best deals for Sony PlayStation Dual Sense Wireless Controller CFI-Zct2w at the best online prices at eBay!",
    );
    const summary = summarizeSearchDiagnostics(query, search);
    expect(summary.plannedQueries[0].text).toBe(
      '"CFI-ZCT2W" Sony Interactive Entertainment Inc.',
    );
    expect(summary.candidateCount).toBe(1);
    const observation = summary.candidates[0].observations[0];
    expect(observation.brandClue).toBeNull();
    expect(observation.identifiers).toContainEqual(
      expect.objectContaining({
        observedValue: "CFI-Zct2w",
        match: "literal",
        field: "organic_results.title",
      }),
    );
    expect(observation.rejectionReasons).toEqual([]);
    expect(observation.accepted).toBe(true);
    expect(summary.associationCount).toBe(1);
    const result = await identifyWithEvidence(images, {
      ocr: async () => ocr,
      search: async () => search,
    });
    expect(result.identification.identificationStatus).toBe("confirmed");
    expect(result.identification.suggestedNextImage).toBeNull();
    expect(result.fusion.reasonCodes).not.toContain("brand_conflict");
  });
  it("grounds an unrelated manufacturer from actual source text using the same generic rule", async () => {
    const query = {
      brand: "Example Interactive Products Inc.",
      identifiers: [{ kind: "model_number" as const, value: "AB-123" }],
    };
    const search = await source(query, "Example Precision Instrument AB-123");
    expect(inspectSearchAssociations(search).rejections).toEqual([]);
    expect(deriveSearchAssociations(search)[0].identity.brand).toBe("Example");
  });
  it.each([
    [
      "Example Protective Case for Instrument AB-123",
      "ambiguous_subject_title",
    ],
    ["Example Dock compatible with AB-123", "ambiguous_subject_title"],
    [
      "Example Instrument Not compatible with AB-123",
      "ambiguous_subject_title",
    ],
    ["Example Instrument AB-123-01", "literal_title_identifier_missing"],
    ["Example Instrument OTHER-99", "identifier_observation_missing"],
    ["Example Instrument AB-123 White", "identifier_not_title_suffix"],
  ])(
    "explains rejection of %s while retaining existing guards",
    async (title, reason) => {
      const query = {
        brand: "Example",
        identifiers: [{ kind: "model_number" as const, value: "AB-123" }],
      };
      const search = await source(query, title);
      const inspection = inspectSearchAssociations(search);
      expect(inspection.associations).toEqual(deriveSearchAssociations(search));
      expect(inspection.associations).toEqual([]);
      expect(
        inspection.rejections.some((rejection) => rejection.reason === reason),
      ).toBe(true);
    },
  );
  it("distinguishes nonexecuted requests, errors, empty success, and absent results", async () => {
    const query = {
      identifiers: [{ kind: "model_number" as const, value: "AB-123" }],
    };
    const search = await runProductSearch(query, [
      {
        id: "offline",
        kind: "web",
        search: async () => {
          throw new ProviderError("NOT_CONFIGURED", "unsafe private text");
        },
      },
    ]);
    expect(
      summarizeSearchDiagnostics(query, search).providers[0],
    ).toMatchObject({
      status: "error",
      errorCode: "NOT_CONFIGURED",
      requestCount: 0,
    });
    const empty = {
      ...search,
      providerRuns: [
        { ...search.providerRuns[0], status: "ok" as const, error: null },
      ],
    };
    expect(summarizeSearchDiagnostics(query, empty)).toMatchObject({
      candidateCount: 0,
      associationCount: 0,
      outcome: "search_result_returned",
    });
    expect(summarizeSearchDiagnostics(query)).toMatchObject({
      candidateCount: null,
      associationCount: null,
      outcome: "search_unavailable_or_invalid",
    });
    expect(
      JSON.stringify(summarizeSearchDiagnostics(query, search)),
    ).not.toContain("unsafe private text");
  });
  it("redacts credentials and embedded URLs, bounds output and leaves accepted associations unchanged", async () => {
    const query = {
      brand: "Example",
      identifiers: [{ kind: "model_number" as const, value: "AB-123" }],
    };
    const search = await source(
      query,
      "Example Instrument AB-123",
      "credential-secret https://user:pass@example.com/?api_key=another-secret",
    );
    const summary = summarizeSearchDiagnostics(query, search, [
      "credential-secret",
    ]);
    expect(summary.associationCount).toBe(1);
    expect(inspectSearchAssociations(search).associations).toEqual(
      deriveSearchAssociations(search),
    );
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toMatch(
      /credential-secret|another-secret|user:pass/,
    );
    expect(serialized).toContain("[REDACTED]");
    expect(serialized).toContain("[URL]");
    const many = {
      ...search,
      candidates: Array.from({ length: 20 }, (_, index) => ({
        ...search.candidates[0],
        id: `candidate-${index}`,
        title: "x".repeat(2000),
      })),
    };
    const bounded = summarizeSearchDiagnostics(query, many);
    expect(bounded.candidateCount).toBe(20);
    expect(bounded.candidates).toHaveLength(8);
    expect(bounded.candidates[0].title).toHaveLength(400);
  });
  it("logs only in development and includes safe Fusion reason codes", async () => {
    const query = {
      brand: "Example",
      identifiers: [{ kind: "model_number" as const, value: "AB-123" }],
    };
    const search = await source(query, "Example Instrument AB-123");
    const fusion = fuseProductEvidence({ imageCount: 1, search });
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.stubEnv("NODE_ENV", "production");
    logSearchDiagnostics(query, search, fusion);
    expect(log).not.toHaveBeenCalled();
    vi.stubEnv("NODE_ENV", "development");
    logSearchDiagnostics(query, search, fusion);
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.parse(log.mock.calls[0][1])).toMatchObject({
      fusion: { status: fusion.status, reasonCodes: fusion.reasonCodes },
      search: { associationCount: 1 },
    });
  });
});
