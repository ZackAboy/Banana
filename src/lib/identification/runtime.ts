import "server-only";
import { getConfig } from "@/lib/config/env";
import { AppError } from "@/lib/errors";
import { identifySemanticVision } from "@/lib/ai/identification";
import { discoverLensCandidates } from "@/lib/search/lens";
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
import { combineCandidateEvidence } from "./candidate-evidence";
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
  lens?: (images: ImageInput[]) => Promise<ProductSearchResult>;
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
    lens: config.serpApiKey ? discoverLensCandidates : undefined,
    semantic:
      config.geminiApiKey && config.visionModel
        ? identifySemanticVision
        : undefined,
  };
}

/** Strong typed identifiers retain priority. Otherwise use literal physical
 * product wording only as discovery clues; all original evidence reaches Fusion. */
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
  const brands = [
    ...new Map(
      evidence.brands.map(({ value }) => [comparableText(value), value]),
    ).values(),
  ];
  if (!identifiers.length) {
    // Literal physical wording is only a discovery query, never identity proof.
    const words = evidence.visibleText
      .map((t) => t.trim())
      .filter(
        (t) =>
          /\p{L}/u.test(t) && !/^(?:model|sku|p\/n|s\/n|serial)\b/i.test(t),
      );
    const product = words.join(" ").slice(0, 500).trim();
    if (!product || product.split(/\s+/).length < 2) return null;
    return productSearchQuerySchema.parse({
      product,
      ...(brands.length === 1 ? { brand: brands[0] } : {}),
    });
  }
  return productSearchQuerySchema.parse({
    identifiers,
    ...(brands.length === 1 ? { brand: brands[0] } : {}),
  });
}

/** Provider failures are unavailable evidence, never fabricated observations.
 * Detailed Fusion findings remain available here; the existing API projects the
 * decision, additive resolution metadata and safe component notices. */
export async function identifyWithEvidence(
  images: ImageInput[],
  dependencies = liveDependencies(),
) {
  const input: FusionInput = { imageCount: images.length };
  const notices: string[] = [];
  // Start upload/discovery immediately. Settle errors now to avoid unhandled
  // rejection while local OCR runs; no live operation is entered in mock mode.
  const lensPending = dependencies.lens?.(images).then(
    (result) => ({ result }),
    () => ({ result: null }),
  );
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
  if (lensPending) {
    const { result } = await lensPending;
    try {
      if (!result) throw new Error("Lens unavailable");
      const lens = productSearchResultSchema.parse(result);
      const search = combineCandidateEvidence(input.search, lens);
      adaptEvidence({ ...input, search });
      input.search = search;
      if (!query && lens.candidates.length) {
        const titles = new Set(
          lens.candidates.flatMap((c) =>
            c.observations.map((o) => comparableText(o.title)),
          ),
        );
        // A single consistent visual hypothesis can seed one text query. It is
        // still not physical confirmation, and conflicting variants are not
        // collapsed or selected by Lens rank.
        if (titles.size === 1) {
          try {
            query = productSearchQuerySchema.parse({
              product: lens.candidates[0].title.slice(0, 500),
            });
            const enriched = combineCandidateEvidence(
              input.search,
              productSearchResultSchema.parse(await dependencies.search(query)),
            );
            adaptEvidence({ ...input, search: enriched });
            input.search = enriched;
          } catch {
            notices.push(
              "Product Search is unavailable for the visual candidate; only returned Lens evidence was used.",
            );
          }
        }
      }
      if (
        lens.providerRuns.some(
          (run) => run.status === "error" || run.status === "partial",
        )
      )
        notices.push(
          "Google Lens was unavailable or incomplete for one or more images; only returned candidates were used.",
        );
    } catch {
      notices.push(
        "Google Lens is unavailable; no visual candidates were supplied to Fusion.",
      );
    }
  }
  let fusion = fuseProductEvidence(input);
  if (fusion.status !== "confirmed" && dependencies.semantic) {
    try {
      const semantic = await dependencies.semantic(images);
      adaptEvidence({ ...input, semantic });
      input.semantic = semantic;
      if (
        !query &&
        semantic.evidence.familySupported &&
        semantic.identification.productName
      ) {
        try {
          query = productSearchQuerySchema.parse({
            product: semantic.identification.productName,
            ...(semantic.identification.brand
              ? { brand: semantic.identification.brand }
              : {}),
            ...(semantic.identification.variant
              ? { variant: semantic.identification.variant }
              : {}),
          });
          const search = combineCandidateEvidence(
            input.search,
            productSearchResultSchema.parse(await dependencies.search(query)),
          );
          adaptEvidence({ ...input, search });
          input.search = search;
        } catch {
          notices.push(
            "Product Search is unavailable for the semantic candidate; only available evidence was used.",
          );
        }
      }
      fusion = fuseProductEvidence(input);
    } catch {
      notices.push(
        "Gemini fallback is unavailable; the decision uses only available independent evidence.",
      );
    }
  }
  if (query) logSearchDiagnostics(query, input.search, fusion);
  if (ocrFailure && !input.semantic && !input.search?.candidates.length)
    throw ocrFailure;
  return {
    identification: toProductIdentification(fusion, input),
    fusion,
    notice: notices.length ? notices.join(" ") : null,
  };
}
