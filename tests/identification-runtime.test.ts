import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { CandidateProducts } from "@/components/identification/candidate-products";
import {
  identifyWithEvidence,
  searchQueryFromOcr,
  type IdentificationDependencies,
} from "@/lib/identification/runtime";
import { runLocalOcr } from "@/lib/identification/local-ocr";
import { identifySemanticVision } from "@/lib/ai/identification";
import {
  liveProductSearchProviders,
  runProductSearch,
} from "@/lib/search/product-search";
import { POST } from "@/app/api/identify/route";
import { identifyResponseSchema } from "@/schemas/api";
import { AppError } from "@/lib/errors";
import {
  images,
  physical,
  provider,
  search,
  semantic,
} from "./fixtures/runtime-evidence";

vi.mock("@/lib/identification/local-ocr", () => ({ runLocalOcr: vi.fn() }));
vi.mock("@/lib/ai/identification", () => ({
  identifySemanticVision: vi.fn(),
  liveIdentification: { identify: vi.fn() },
}));
vi.mock("@/lib/search/product-search", async (original) => ({
  ...(await original<typeof import("@/lib/search/product-search")>()),
  liveProductSearchProviders: vi.fn(),
}));

function dependencies(value = "CFI-ZCT1W"): IdentificationDependencies {
  return {
    ocr: vi.fn().mockResolvedValue(physical(value)),
    search: vi.fn((query) =>
      search(query, `Sony DualSense Wireless Controller ${value}`),
    ),
    semantic: vi.fn().mockResolvedValue(semantic()),
  };
}
function upload() {
  const form = new FormData();
  images.forEach((image, index) =>
    form.append(
      "images",
      new File([new Uint8Array(image.data)], `image-${index}.png`, {
        type: image.mimeType,
      }),
    ),
  );
  return new Request("http://localhost/api/identify", {
    method: "POST",
    body: form,
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("USE_MOCK_SERVICES", "false");
  vi.stubEnv("IDENTIFICATION_MODE", "evidence");
  vi.stubEnv("GEMINI_API_KEY", "");
  vi.stubEnv("GEMINI_VISION_MODEL", "");
  vi.mocked(runLocalOcr).mockResolvedValue(physical());
  vi.mocked(liveProductSearchProviders).mockReturnValue([provider()]);
});
afterEach(() => vi.unstubAllEnvs());

describe("live evidence orchestration (offline dependencies)", () => {
  it.each(["CFI-ZCT1W", "CFI-ZCT2W"])(
    "confirms %s without invoking configured Gemini",
    async (value) => {
      const deps = dependencies(value);
      const result = await identifyWithEvidence(images, deps);
      expect(result.identification).toMatchObject({
        identificationStatus: "confirmed",
        modelNumber: value,
        suggestedNextImage: null,
      });
      expect(result.fusion.needsMoreEvidence).toBe(false);
      expect(deps.semantic).not.toHaveBeenCalled();
      expect(deps.search).toHaveBeenCalledWith({
        brand: "Sony",
        identifiers: [{ kind: "model_number", value }],
      });
      expect(deps.ocr).toHaveBeenCalledWith(images);
    },
  );
  it("Search failure preserves the label and rejects Gemini's repeat as another confirmation", async () => {
    const deps = dependencies();
    vi.mocked(deps.search).mockRejectedValue(new Error("provider failure"));
    const repeated = semantic();
    repeated.identification.identificationStatus = "confirmed";
    vi.mocked(deps.semantic!).mockResolvedValue(repeated);
    const result = await identifyWithEvidence(images, deps);
    expect(result.identification).toMatchObject({
      identificationStatus: "likely",
      modelNumber: "CFI-ZCT1W",
      suggestedNextImage: null,
    });
    expect(result.fusion.missingEvidenceType).toBe("external_association");
    expect(result.notice).toMatch(/Search is unavailable/);
    expect(
      result.fusion.provenance
        .filter((ref) => ref.observationGroup === "physical:2")
        .map((ref) => ref.source),
    ).toContain("gemini");
    const html = renderToStaticMarkup(
      createElement(CandidateProducts, {
        identification: result.identification,
        onSelect: vi.fn(),
        onAddPhoto: vi.fn(),
        busy: false,
      }),
    );
    expect(html).toContain("independent product association is missing");
    expect(html).not.toMatch(
      /Add photo|Take a clear photo|Add a photo of the model label/,
    );
  });
  it("keeps exact independent confirmation while exposing another provider's failure", async () => {
    const deps = dependencies();
    deps.search = (query) =>
      runProductSearch(
        query,
        [
          provider(),
          {
            id: "optional-failure",
            kind: "shopping",
            search: async () => {
              throw new Error("offline failure");
            },
          },
        ],
        { includeReviews: false },
      );
    const result = await identifyWithEvidence(images, deps);
    expect(result.identification.identificationStatus).toBe("confirmed");
    expect(result.identification.suggestedNextImage).toBeNull();
    expect(result.fusion.reasonCodes).toContain(
      "search_incomplete_or_unavailable",
    );
    expect(result.notice).toMatch(/unavailable or incomplete/);
    expect(result.fusion.provenance).toContainEqual(
      expect.objectContaining({
        source: "product_search",
        observation: expect.objectContaining({
          provider: "optional-failure",
          status: "error",
        }),
      }),
    );
    expect(deps.semantic).not.toHaveBeenCalled();
  });
  it("records intentional optional skips without calling them Search failures", async () => {
    const deps = dependencies();
    deps.search = (query) =>
      runProductSearch(
        query,
        [
          provider(),
          {
            id: "optional-reviews",
            kind: "reviews",
            search: vi.fn(() => {
              throw new Error("must not execute when reviews are disabled");
            }),
          },
        ],
        { includeReviews: false },
      );
    const result = await identifyWithEvidence(images, deps);
    expect(result.fusion.status).toBe("confirmed");
    expect(result.fusion.reasonCodes).not.toContain(
      "search_incomplete_or_unavailable",
    );
    expect(result.notice).toBeNull();
    expect(result.fusion.provenance).toContainEqual(
      expect.objectContaining({
        source: "product_search",
        observation: expect.objectContaining({
          provider: "optional-reviews",
          status: "skipped",
        }),
      }),
    );
  });
  it("successful OCR with no identifier uses semantic family fallback and requests missing label", async () => {
    const deps = dependencies();
    const ocr = physical();
    ocr.images[1].identifiers = [];
    vi.mocked(deps.ocr).mockResolvedValue(ocr);
    const result = await identifyWithEvidence(images, deps);
    expect(deps.search).not.toHaveBeenCalled();
    expect(result.identification.identificationStatus).toBe("likely");
    expect(result.identification.modelNumber).toBeNull();
    expect(result.identification.suggestedNextImage).toMatch(/label/);
  });
  it.each([
    "Sony Protective Case for DualSense CFI-ZCT1W",
    "Sony Charging Dock compatible with CFI-ZCT1W",
  ])("rejects accessory/compatibility title %s", async (title) => {
    const deps = dependencies();
    deps.search = (query) => search(query, title);
    const result = await identifyWithEvidence(images, deps);
    expect(result.fusion.status).not.toBe("confirmed");
    expect(result.identification.suggestedNextImage).toBeNull();
  });
  it("retains a typed physical/external identifier conflict", async () => {
    const deps = dependencies();
    // Search's existing observation extraction is query-specific. This fixture
    // supplies an independently typed external claim, not a guessed token.
    deps.search = () =>
      search(
        {
          brand: "Sony",
          identifiers: [{ kind: "model_number", value: "CFI-ZCT2W" }],
        },
        "Sony DualSense Wireless Controller CFI-ZCT2W",
      );
    const result = await identifyWithEvidence(images, deps);
    expect(result.fusion.status).toBe("uncertain");
    expect(
      result.fusion.conflictingEvidence.some(
        (conflict) => conflict.code === "physical_external_identifier_conflict",
      ),
    ).toBe(true);
    expect(result.identification.suggestedNextImage).toBeNull();
  });
  it("OCR unavailable uses Gemini family only, without fabricated physical evidence", async () => {
    const deps = dependencies();
    vi.mocked(deps.ocr).mockRejectedValue(
      new AppError("OCR_UNAVAILABLE", "Local OCR unavailable.", 503),
    );
    const result = await identifyWithEvidence(images, deps);
    expect(result.fusion.status).toBe("likely");
    expect(
      result.fusion.provenance.some((ref) => ref.source === "paddleocr"),
    ).toBe(false);
    expect(deps.search).not.toHaveBeenCalled();
    expect(result.notice).toMatch(/No physical OCR evidence/);
  });
  it("returns a clear error when no identification component can run", async () => {
    const deps = dependencies();
    delete deps.semantic;
    vi.mocked(deps.ocr).mockRejectedValue(
      new AppError("OCR_UNAVAILABLE", "Local OCR unavailable.", 503),
    );
    await expect(identifyWithEvidence(images, deps)).rejects.toMatchObject({
      code: "OCR_UNAVAILABLE",
      status: 503,
    });
  });
  it("successful empty OCR is distinct from unavailable OCR, even without Gemini", async () => {
    const deps = dependencies();
    delete deps.semantic;
    const ocr = physical();
    ocr.images[1].identifiers = [];
    vi.mocked(deps.ocr).mockResolvedValue(ocr);
    const result = await identifyWithEvidence(images, deps);
    expect(result.fusion.status).toBe("uncertain");
    expect(result.notice).toBeNull();
    expect(result.identification.suggestedNextImage).toMatch(/label/);
  });
  it.each(["sku", "part_number"] as const)(
    "preserves %s typing and spelling",
    (kind) => {
      expect(
        searchQueryFromOcr({ imageCount: 2, ocr: physical("Ab-012", kind) })
          ?.identifiers,
      ).toEqual([{ kind, value: "Ab-012" }]);
    },
  );
  it("does not search by serial number", () => {
    expect(
      searchQueryFromOcr({
        imageCount: 2,
        ocr: physical("SN-012", "serial_number"),
      }),
    ).toBeNull();
  });
});

describe("application route wiring", () => {
  it("returns an unavailable error rather than demo evidence when OCR cannot run and Gemini is absent", async () => {
    vi.mocked(runLocalOcr).mockRejectedValueOnce(
      new AppError("OCR_UNAVAILABLE", "Local OCR unavailable.", 503),
    );
    const response = await POST(upload());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: { code: "OCR_UNAVAILABLE", message: "Local OCR unavailable." },
    });
    expect(liveProductSearchProviders).not.toHaveBeenCalled();
  });
  it("returns confirmed through the real analysis/association/Fusion projection without Gemini credentials", async () => {
    const response = await POST(upload());
    expect(response.status).toBe(200);
    const body = identifyResponseSchema.parse(await response.json());
    expect(body.meta).toEqual({ mode: "live", notice: null });
    expect(body.identification).toMatchObject({
      identificationStatus: "confirmed",
      modelNumber: "CFI-ZCT1W",
      suggestedNextImage: null,
    });
    expect(identifySemanticVision).not.toHaveBeenCalled();
    expect(runLocalOcr).toHaveBeenCalledOnce();
  });
  it("surfaces failed provider runs without asking for the physical label again", async () => {
    vi.mocked(liveProductSearchProviders).mockReturnValue([
      {
        id: "failed",
        kind: "web",
        search: async () => {
          throw new Error("offline failure");
        },
      },
    ]);
    const response = await POST(upload());
    const body = identifyResponseSchema.parse(await response.json());
    expect(body.identification.identificationStatus).not.toBe("confirmed");
    expect(body.identification.suggestedNextImage).toBeNull();
    expect(body.meta.notice).toMatch(/unavailable or incomplete/);
  });
  it("mock mode stays deterministic and invokes none of the live components", async () => {
    vi.stubEnv("USE_MOCK_SERVICES", "true");
    const first = await (await POST(upload())).json();
    expect(await (await POST(upload())).json()).toEqual(first);
    expect(first.meta.mode).toBe("mock");
    expect(first.meta.notice).toMatch(/Synthetic demo/);
    expect(runLocalOcr).not.toHaveBeenCalled();
    expect(liveProductSearchProviders).not.toHaveBeenCalled();
    expect(identifySemanticVision).not.toHaveBeenCalled();
  });
});
