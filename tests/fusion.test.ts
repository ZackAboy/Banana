import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fuseProductEvidence,
  suggestedFusionImage,
  toProductIdentification,
  type ExternalAssociation,
  type FusionInput,
} from "@/lib/identification/fusion";
import {
  runProductSearch,
  identifierObservations,
  type SearchIdentifier,
} from "@/lib/search/product-search";
import { ocrEvidenceSchema } from "@/lib/identification/evidence-contracts";

// Handcrafted source findings, not real external verification. The OCR fixture
// exercises the existing Python JSON shape without loading Python/models.
const pythonOcr = JSON.parse(
  readFileSync(
    new URL(
      "../vision-service/tests/fixtures/ocr_typeset_dualsense.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
function physical(
  value = "CFI-ZCT1W",
  kind:
    "model_number" | "sku" | "part_number" | "serial_number" = "model_number",
) {
  const ocr = ocrEvidenceSchema.parse(structuredClone(pythonOcr));
  const image = ocr.images[0];
  const identifier = image.identifiers[0];
  const label = {
    model_number: "MODEL",
    sku: "SKU",
    part_number: "P/N",
    serial_number: "S/N",
  }[kind];
  image.source_image_index = identifier.source_image_index = 2;
  image.brand_clues[0].source_image_index = 2;
  identifier.kind = kind;
  identifier.value = value;
  identifier.label = label;
  identifier.label_span.end = label.length;
  identifier.value_span.start = label.length + 1;
  identifier.value_span.end = label.length + 1 + value.length;
  image.regions[2].normalized_text =
    image.regions[2].raw_text = `${label} ${value}`;
  return ocr;
}
async function fixture(
  value = "CFI-ZCT1W",
  kind: SearchIdentifier["kind"] = "model_number",
) {
  const search = await runProductSearch(
    {
      brand: "Sony",
      product: "DualSense Wireless Controller",
      identifiers: [{ kind, value }],
    },
    [
      {
        id: "offline",
        kind: "web",
        search: async () => ({
          pages: [
            {
              queryId: "identifier-0",
              field: "organic_results",
              title: "Sony DualSense Wireless Controller",
              snippet: `Product ${kind}: ${value}`,
              url: "https://example.com/controller",
              imageUrls: ["https://example.com/controller.jpg"],
              brand: "Sony",
            },
          ],
          offers: [],
          reviews: [],
          raw: [],
        }),
      },
    ],
    { now: () => new Date("2026-10-10T12:00:00Z") },
  );
  const candidate = search.candidates[0];
  const association: ExternalAssociation = {
    candidateId: candidate.id,
    observationIndex: 0,
    relation: "product_identity",
    identity: {
      brand: "Sony",
      productName: "Sony DualSense Wireless Controller",
      variant: null,
    },
    identifiers: [{ kind, value }],
    basis:
      "Fixture: product specification explicitly associates this model with the subject controller.",
  };
  const model = {
    model_family: "siglip",
    checkpoint: "fixture",
    revision: "fixture-revision",
    embedding_dimension: 2,
    preprocessing: "fixture",
  };
  const retrieval = {
    schema_version: "retrieval.v1",
    source: "visual_retrieval",
    metric: "cosine",
    aggregation: "mean_query_cosine",
    tie_break: "candidate_id_ascending",
    model,
    query_images: [
      { source_image_index: 1, image_id: "front", source_url: null },
    ],
    candidates: [
      {
        candidate_id: candidate.id,
        image_id: "candidate-image",
        source_url: candidate.imageUrls[0],
        rank: 1,
        similarity: 0.95,
        query_similarities: [{ source_image_index: 1, similarity: 0.95 }],
        model,
      },
    ],
  };
  return {
    imageCount: 2,
    ocr: physical(value, kind),
    search,
    associations: [association],
    retrieval,
    visualAssessments: [
      {
        candidateId: candidate.id,
        imageId: "candidate-image",
        finding: "compatible",
        basis: "Fixture inspection finds compatible shape.",
      },
    ],
  } satisfies FusionInput;
}

beforeEach(() =>
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Fusion tests must be offline");
    }),
  ),
);
afterEach(() => vi.unstubAllGlobals());

describe("deterministic evidence fusion acceptance", () => {
  it.each(["CFI-ZCT1W", "CFI-ZCT2W", "OTHER-901"])(
    "confirms exact physical/external %s without Gemini (cases 1/2)",
    async (value) => {
      const input = await fixture(value);
      const before = structuredClone(input);
      const result = fuseProductEvidence(input);
      expect(result).toMatchObject({
        status: "confirmed",
        needsMoreEvidence: false,
        missingEvidenceType: null,
        identity: {
          productName: "Sony DualSense Wireless Controller",
          modelNumber: value,
        },
      });
      expect(suggestedFusionImage(result)).toBeNull();
      expect(toProductIdentification(result, input)).toMatchObject({
        identificationStatus: "confirmed",
        modelNumber: value,
        suggestedNextImage: null,
      });
      expect(result.supportingEvidence).toContain("ocr:2:identifier:0");
      expect(result.supportingEvidence).toContain("association:0");
      expect(input).toEqual(before);
      expect(
        fuseProductEvidence({
          ...input,
          retrieval: undefined,
          visualAssessments: undefined,
        }).status,
      ).toBe("confirmed");
    },
  );
  it("OCR alone does not confirm or repeat the label request (cases 3/7)", () => {
    const result = fuseProductEvidence({ imageCount: 2, ocr: physical() });
    expect(result).toMatchObject({
      status: "uncertain",
      needsMoreEvidence: true,
      missingEvidenceType: "external_association",
      followUpOwner: "product_search",
    });
    expect(suggestedFusionImage(result)).toBeNull();
  });
  it("visual similarity alone cannot establish exact identity (case 4)", async () => {
    const input = await fixture();
    Reflect.deleteProperty(input, "ocr");
    input.associations = [];
    const result = fuseProductEvidence(input);
    expect(result.status).toBe("likely");
    expect(result.reasonCodes).toContain("raw_similarity_is_not_identity");
    expect(result.missingEvidenceType).toBe("distinguishing_view");
  });
  it("identifier conflict wins over strong visual compatibility (case 5)", async () => {
    const input = await fixture("CFI-ZCT2W");
    input.ocr = physical("CFI-ZCT1W");
    const result = fuseProductEvidence(input);
    expect(result.status).toBe("uncertain");
    expect(result.conflictingEvidence).toContainEqual({
      code: "physical_external_identifier_conflict",
      evidenceRefs: ["ocr:2:identifier:0", "association:0"],
      material: true,
    });
    input.associations = [];
    expect(fuseProductEvidence(input).conflictingEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "unresolved_external_identifier_disagreement",
          material: false,
        }),
      ]),
    );
  });
  it("accessory identifier occurrence cannot confirm even if mislabeled as an association (case 6)", async () => {
    const input = await fixture();
    input.search.candidates[0].observations[0].title =
      "Protective Case compatible with Sony DualSense CFI-ZCT1W";
    const result = fuseProductEvidence(input);
    expect(result.status).not.toBe("confirmed");
    expect(result.reasonCodes).toContain("external_association_unresolved");
    expect(result.missingEvidenceType).toBe("external_association");
    expect(suggestedFusionImage(result)).toBeNull();
  });
  it("does not confuse a subject model with an unrelated compatibility target", async () => {
    const input = await fixture();
    input.search.candidates[0].observations[0].snippet =
      "Product model_number: CFI-ZCT1W; compatible with a gaming console.";
    expect(fuseProductEvidence(input).status).toBe("confirmed");
  });
  it("requests distinguishing evidence for multiple visually plausible candidates (case 8)", async () => {
    const input = await fixture();
    Reflect.deleteProperty(input, "ocr");
    input.associations = [];
    const other = structuredClone(input.search.candidates[0]);
    other.id = "second-source-group";
    other.title = "Another controller variant";
    input.search.candidates.push(other);
    input.retrieval.candidates.push({
      ...input.retrieval.candidates[0],
      candidate_id: other.id,
      rank: 2,
      similarity: 0.949,
    });
    const result = fuseProductEvidence(input);
    expect(result).toMatchObject({
      status: "uncertain",
      needsMoreEvidence: true,
      missingEvidenceType: "distinguishing_view",
    });
    expect(suggestedFusionImage(result)).toContain("distinguish");
  });
});

describe("provenance, weaker matches and contradictions", () => {
  it.each(["sku", "part_number"] as const)(
    "supports typed %s and preserves part numbers in the detailed result",
    async (kind) => {
      const input = await fixture("AB-123", kind);
      const result = fuseProductEvidence(input);
      expect(result.status).toBe("confirmed");
      expect(result.identity?.[kind === "sku" ? "sku" : "partNumber"]).toBe(
        "AB-123",
      );
      input.associations[0].identifiers[0].kind = "model_number";
      expect(fuseProductEvidence(input).status).not.toBe("confirmed");
    },
  );
  it("never uses serial numbers or spatial-label inference for exact identity", async () => {
    const input = await fixture();
    input.ocr = physical("CFI-ZCT1W", "serial_number");
    expect(fuseProductEvidence(input).status).not.toBe("confirmed");
    expect(fuseProductEvidence(input).reasonCodes).toContain(
      "serial_number_excluded",
    );
    input.ocr = physical();
    input.ocr.images[0].identifiers[0].extraction = "spatial_label";
    expect(fuseProductEvidence(input).status).not.toBe("confirmed");
  });
  it.each(["CFIZCT1W", "CFI-ZCT1W01"])(
    "does not promote normalized/suffix identifier %s to exact",
    async (external) => {
      const input = await fixture(external);
      input.ocr = physical();
      expect(fuseProductEvidence(input).status).not.toBe("confirmed");
    },
  );
  it("respects Search's model-insensitive and SKU-sensitive literal semantics", async () => {
    const model = await fixture("cfi-zct1w");
    model.ocr = physical("CFI-ZCT1W");
    expect(fuseProductEvidence(model).status).toBe("confirmed");
    const sku = await fixture("sku-123", "sku");
    sku.ocr = physical("SKU-123", "sku");
    expect(fuseProductEvidence(sku).status).not.toBe("confirmed");
  });
  it("Search occurrence/rank alone is insufficient and duplicate observations are not votes", async () => {
    const input = await fixture();
    input.associations = [];
    input.search.candidates[0].observations.push(
      structuredClone(input.search.candidates[0].observations[0]),
    );
    const result = fuseProductEvidence(input);
    expect(result.status).not.toBe("confirmed");
    expect(result.missingEvidenceType).toBe("external_association");
    const refs = result.provenance.filter((r) =>
      r.id.startsWith("search:candidate"),
    );
    expect(new Set(refs.map((r) => r.observationGroup)).size).toBe(1);
  });
  it("preserves contradictory identifiers/variants in a single source group", async () => {
    const input = await fixture();
    const other = structuredClone(input.search.candidates[0].observations[0]);
    other.snippet = "Product model_number: CFI-ZCT2W";
    other.identifiers = identifierObservations(
      { kind: "model_number", value: "CFI-ZCT2W" },
      other.snippet,
      "snippet",
    );
    other.variantClue = "Black";
    input.associations[0].identity.variant = "White";
    input.search.candidates[0].observations.push(other);
    const result = fuseProductEvidence(input);
    expect(result.status).toBe("uncertain");
    expect(result.reasonCodes).toEqual(
      expect.arrayContaining([
        "source_group_identifier_conflict",
        "variant_conflict",
      ]),
    );
  });
  it("keeps distinct external identities ambiguous rather than choosing a top candidate", async () => {
    const input = await fixture();
    const other = structuredClone(input.search.candidates[0]);
    other.id = "another-source";
    input.search.candidates.push(other);
    input.associations.push({
      ...input.associations[0],
      candidateId: other.id,
      identity: {
        brand: "Sony",
        productName: "Different product",
        variant: null,
      },
    });
    expect(fuseProductEvidence(input).reasonCodes).toContain(
      "multiple_supported_identities",
    );
    expect(fuseProductEvidence(input).status).toBe("uncertain");
  });
  it("keeps a weak visual concern as likely; a material contradiction as uncertain", async () => {
    const input: FusionInput = await fixture();
    input.visualAssessments![0].finding = "concern";
    expect(fuseProductEvidence(input)).toMatchObject({
      status: "likely",
      missingEvidenceType: "distinguishing_view",
    });
    expect(fuseProductEvidence(input).supportingEvidence).toContain(
      "ocr:2:identifier:0",
    );
    input.visualAssessments![0].finding = "contradiction";
    expect(fuseProductEvidence(input).status).toBe("uncertain");
  });
  it("Gemini never supplies a second physical confirmation or mandatory authority", async () => {
    const input: FusionInput = await fixture();
    const proposal = toProductIdentification(fuseProductEvidence(input), input);
    proposal.identificationStatus = "likely";
    proposal.suggestedNextImage = "Take a model label photo.";
    input.semantic = {
      source: "gemini",
      identification: proposal,
      evidence: {
        familySupported: true,
        conflictingImages: false,
        exactMatch: [
          {
            imageIndex: 2,
            kind: "model_number",
            observation: "MODEL CFI-ZCT1W",
            interpretation: "Reported model",
          },
        ],
      },
    };
    expect(fuseProductEvidence(input).status).toBe("confirmed");
    expect(
      toProductIdentification(fuseProductEvidence(input), input)
        .suggestedNextImage,
    ).toBeNull();
    input.associations = [];
    const result = fuseProductEvidence(input);
    expect(result.status).not.toBe("confirmed");
    expect(
      result.provenance.find((r) => r.id === "gemini:0")?.observationGroup,
    ).toBe(
      result.provenance.find((r) => r.id === "ocr:2:identifier:0")
        ?.observationGroup,
    );
    expect(suggestedFusionImage(result)).toBeNull();
  });
  it("rejects invalid image provenance, OCR spans and ungrounded external associations", async () => {
    const input = await fixture();
    expect(() => fuseProductEvidence({ ...input, imageCount: 1 })).toThrow(
      /unavailable image/,
    );
    input.ocr.images[0].identifiers[0].value_span.end--;
    expect(() => fuseProductEvidence(input)).toThrow(/span/);
    input.ocr = physical();
    input.associations[0].identifiers[0].value = "INVENTED-123";
    expect(() => fuseProductEvidence(input)).toThrow(/literal source/);
  });
  it("preserves contradictory physical labels, brands and Gemini transcriptions", async () => {
    const input: FusionInput = await fixture();
    const ocr = physical();
    const otherImage = physical("CFI-ZCT2W").images[0];
    otherImage.source_image_index =
      otherImage.identifiers[0].source_image_index =
      otherImage.brand_clues[0].source_image_index =
        1;
    ocr.images.push(otherImage);
    input.ocr = ocr;
    expect(fuseProductEvidence(input).reasonCodes).toContain(
      "physical_identifier_conflict",
    );
    input.ocr = physical();
    input.associations![0].identity.brand = "Different brand";
    expect(fuseProductEvidence(input).reasonCodes).toContain("brand_conflict");
    input.associations![0].identity.brand = "Sony";
    const proposal = toProductIdentification(fuseProductEvidence(input), input);
    proposal.modelNumber = "CFI-ZCT2W";
    proposal.visibleText = ["MODEL CFI-ZCT2W"];
    input.semantic = {
      source: "gemini",
      identification: proposal,
      evidence: {
        familySupported: true,
        conflictingImages: false,
        exactMatch: [
          {
            imageIndex: 1,
            kind: "model_number",
            observation: "MODEL CFI-ZCT2W",
            interpretation: "Conflicting transcription fixture",
          },
        ],
      },
    };
    const result = fuseProductEvidence(input);
    expect(result.status).toBe("uncertain");
    expect(result.reasonCodes).toContain("semantic_label_conflict");
  });
});
