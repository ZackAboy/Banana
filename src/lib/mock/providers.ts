import "server-only";
import type { Providers } from "@/lib/providers/interfaces";
import type { ProductQuery } from "@/types";
import { AppError } from "@/lib/errors";
import {
  demoCandidate,
  demoIdentification,
  demoInsights,
  demoOffers,
  demoSources,
} from "./fixtures";
import { normalizeText } from "@/lib/products/normalization";
const pause = () =>
  new Promise<void>((resolve) =>
    setTimeout(resolve, process.env.NODE_ENV === "test" ? 0 : 450),
  );
function assertDemoProduct(product: ProductQuery) {
  if (
    normalizeText(product.modelNumber) !== "27gp850-b" ||
    normalizeText(product.productName) !== "ultragear 27gp850-b" ||
    normalizeText(product.brand) !== "lg" ||
    normalizeText(product.variant) !==
      normalizeText(demoCandidate.variant ?? "")
  ) {
    throw new AppError(
      "DEMO_PRODUCT_UNAVAILABLE",
      "Demo mode only has the sample LG 27GP850-B product. Start a new demo analysis.",
      404,
    );
  }
}
export const mockProviders: Providers = {
  identification: {
    async identify(images, scenario) {
      await pause();
      return demoIdentification(scenario === "confirmed" || images.length > 1);
    },
  },
  lens: {
    async search() {
      await pause();
      return [demoCandidate];
    },
  },
  shopping: {
    async search(product) {
      assertDemoProduct(product);
      await pause();
      return demoOffers();
    },
  },
  reviewSearch: {
    async search(product) {
      assertDemoProduct(product);
      await pause();
      return structuredClone(demoSources);
    },
  },
  reviewAnalysis: {
    async summarize(product, sources) {
      assertDemoProduct(product);
      await pause();
      return demoInsights(sources);
    },
  },
  verification: {
    async verify(input) {
      if (
        input.candidateId !== demoCandidate.id ||
        !input.identification.candidates.some((c) => c.id === demoCandidate.id)
      )
        throw new AppError(
          "INVALID_CANDIDATE",
          "Select a candidate from the current identification.",
          400,
        );
      await pause();
      return demoIdentification(true, true);
    },
  },
};
