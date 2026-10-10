import type { z } from "zod";
import { ocrEvidenceSchema } from "@/lib/identification/evidence-contracts";
import type { ImageInput } from "@/lib/providers/interfaces";
import type { SemanticVisionSignal } from "@/lib/identification/fusion";
import {
  runProductSearch,
  type ProductSearchQuery,
  type SearchProvider,
} from "@/lib/search/product-search";

export const images: ImageInput[] = [1, 2].map((index) => ({
  mimeType: "image/png",
  data: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, index]),
}));

export function physical(
  value = "CFI-ZCT1W",
  kind:
    "model_number" | "sku" | "part_number" | "serial_number" = "model_number",
): z.infer<typeof ocrEvidenceSchema> {
  const label = {
    model_number: "MODEL",
    sku: "SKU",
    part_number: "P/N",
    serial_number: "S/N",
  }[kind];
  return {
    schema_version: "ocr.v1",
    source: "paddleocr",
    images: [
      { source_image_index: 1, regions: [], identifiers: [], brand_clues: [] },
      {
        source_image_index: 2,
        regions: [
          {
            region_index: 1,
            raw_text: `${label} ${value}`,
            normalized_text: `${label} ${value}`,
          },
          { region_index: 2, raw_text: "Sony", normalized_text: "Sony" },
        ],
        identifiers: [
          {
            source_image_index: 2,
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
            source_image_index: 2,
            kind: "brand",
            value: "Sony",
            extraction: "standalone_allowlist",
            value_span: { region_index: 2, start: 0, end: 4 },
          },
        ],
      },
    ],
  };
}

export function provider(
  title = "Sony DualSense Wireless Controller CFI-ZCT1W",
): SearchProvider {
  return {
    id: "offline",
    kind: "web",
    search: async (input) => ({
      pages: [
        {
          queryId: input.queries[0].id,
          field: "organic_results",
          title,
          brand: "Sony",
          url: "https://example.com/controller",
        },
      ],
      offers: [],
      reviews: [],
      raw: [],
    }),
  };
}
export function search(query: ProductSearchQuery, title?: string) {
  return runProductSearch(query, [provider(title)], {
    now: () => new Date("2026-10-10T12:00:00Z"),
    includeReviews: false,
  });
}
export function semantic(): SemanticVisionSignal {
  return {
    source: "gemini",
    identification: {
      brand: "Sony",
      productName: "DualSense Wireless Controller",
      modelNumber: "CFI-ZCT1W",
      sku: null,
      variant: null,
      category: "Controller",
      visibleText: ["MODEL CFI-ZCT1W"],
      distinguishingFeatures: [],
      identificationStatus: "likely",
      reasoning: "Tentative semantic proposal.",
      suggestedNextImage: "Take a clear photo of the model/SKU label.",
      candidates: [],
    },
    evidence: {
      familySupported: true,
      conflictingImages: false,
      exactMatch: [
        {
          imageIndex: 2,
          kind: "model_number",
          observation: "MODEL CFI-ZCT1W",
          interpretation: "A model label on the same physical image.",
        },
      ],
    },
  };
}
