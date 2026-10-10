import "server-only";
import { getConfig } from "@/lib/config/env";
import { AppError } from "@/lib/errors";
import { identifySemanticVision } from "@/lib/ai/identification";
import type { ImageInput } from "@/lib/providers/interfaces";
import {
  liveProductSearchProviders,
  productSearchConfig,
  productSearchQuerySchema,
  productSearchResultSchema,
  runProductSearch,
  type ProductSearchQuery,
  type ProductSearchResult,
} from "@/lib/search/product-search";
import { runLocalOcr } from "./local-ocr";
import { ocrEvidenceSchema } from "./evidence-contracts";
import { adaptEvidence, comparableText } from "./evidence-adapters";
import { logSearchDiagnostics } from "./search-diagnostics";
import {
  fuseProductEvidence,
  toProductIdentification,
  type FusionInput,
  type SemanticVisionSignal,
} from "./fusion";

export interface IdentificationDependencies {
  ocr: (images: ImageInput[]) => Promise<unknown>;
  search: (query: ProductSearchQuery) => Promise<ProductSearchResult>;
  semantic?: (images: ImageInput[]) => Promise<SemanticVisionSignal>;
}

function liveDependencies(): IdentificationDependencies {
  const config = getConfig();
  return {
    ocr: runLocalOcr,
    search: (query) =>
      runProductSearch(query, liveProductSearchProviders(), {
        timeoutMs: productSearchConfig().timeoutMs,
        includeReviews: false,
      }),
    semantic:
      config.geminiApiKey && config.visionModel
        ? identifySemanticVision
        : undefined,
  };
}

/** Search receives only the strong, span-grounded typed OCR claims. All original
 * claims still reach Fusion, even when Search's bounded query cannot accept them. */
export function searchQueryFromOcr(
  input: FusionInput,
): ProductSearchQuery | null {
  const evidence = adaptEvidence(input);
  const identifiers = [
    ...new Map(
      evidence.physical.map(({ identifier }) => [
        JSON.stringify(identifier),
        identifier,
      ]),
    ).values(),
  ];
  if (!identifiers.length) return null;
  const brands = [
    ...new Map(
      evidence.brands.map(({ value }) => [comparableText(value), value]),
    ).values(),
  ];
  return productSearchQuerySchema.parse({
    identifiers,
    ...(brands.length === 1 ? { brand: brands[0] } : {}),
  });
}

/** Provider failures are unavailable evidence, never fabricated observations.
 * Detailed Fusion findings remain available here; the existing API projects the
 * decision and safe component notices without changing its public schema. */
export async function identifyWithEvidence(
  images: ImageInput[],
  dependencies = liveDependencies(),
) {
  const input: FusionInput = { imageCount: images.length };
  const notices: string[] = [];
  let ocrFailure: AppError | undefined;
  let query: ProductSearchQuery | null = null;
  try {
    const ocr = ocrEvidenceSchema.parse(await dependencies.ocr(images));
    adaptEvidence({ ...input, ocr });
    input.ocr = ocr;
  } catch (error) {
    if (error instanceof AppError && error.status === 400) throw error;
    ocrFailure =
      error instanceof AppError
        ? error
        : new AppError(
            "OCR_UNAVAILABLE",
            "Local PaddleOCR is unavailable.",
            503,
          );
    notices.push(
      `${ocrFailure.message} No physical OCR evidence was supplied to Fusion.`,
    );
  }
  if (input.ocr) {
    try {
      query = searchQueryFromOcr(input);
    } catch {
      notices.push(
        "OCR identifiers exceed Product Search's input contract; external search was not run.",
      );
    }
    if (query) {
      try {
        const search = productSearchResultSchema.parse(
          await dependencies.search(query),
        );
        // Validate source links before retaining any external evidence.
        adaptEvidence({ ...input, search });
        input.search = search;
        if (
          search.providerRuns.some(
            (run) => run.status === "error" || run.status === "partial",
          )
        )
          notices.push(
            "Product Search was unavailable or incomplete for one or more providers; only returned evidence was used.",
          );
      } catch {
        notices.push(
          "Product Search is unavailable or returned invalid evidence; no external search evidence was supplied to Fusion.",
        );
      }
    }
  }
  let fusion = fuseProductEvidence(input); // Existing adapter derives associations.
  if (fusion.status !== "confirmed" && dependencies.semantic) {
    try {
      const semantic = await dependencies.semantic(images);
      const reconciled = fuseProductEvidence({ ...input, semantic });
      input.semantic = semantic;
      fusion = reconciled;
    } catch {
      notices.push(
        "Gemini fallback is unavailable; the decision uses only available independent evidence.",
      );
    }
  }
  if (query) logSearchDiagnostics(query, input.search, fusion);
  if (ocrFailure && !input.semantic) throw ocrFailure;
  return {
    identification: toProductIdentification(fusion, input),
    fusion,
    notice: notices.length ? notices.join(" ") : null,
  };
}
