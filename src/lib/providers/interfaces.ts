import type {
  DemoScenario,
  ProductCandidate,
  ProductIdentification,
  ProductOffer,
  ProductQuery,
  ReviewInsights,
  ReviewSource,
  VerifyRequest,
} from "@/types";
export interface ImageInput {
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  data: Uint8Array;
}
export interface IdentificationProvider {
  identify(
    images: ImageInput[],
    scenario: DemoScenario,
  ): Promise<ProductIdentification>;
}
export interface LensProvider {
  search(images: ImageInput[]): Promise<ProductCandidate[]>;
}
export interface ShoppingProvider {
  search(product: ProductQuery): Promise<ProductOffer[]>;
}
export interface ReviewSearchProvider {
  search(product: ProductQuery): Promise<ReviewSource[]>;
}
export interface ReviewAnalysisProvider {
  summarize(
    product: ProductQuery,
    sources: ReviewSource[],
  ): Promise<ReviewInsights>;
}
export interface VerificationProvider {
  verify(input: VerifyRequest): Promise<ProductIdentification>;
}
export interface Providers {
  identification: IdentificationProvider;
  lens: LensProvider;
  shopping: ShoppingProvider;
  reviewSearch: ReviewSearchProvider;
  reviewAnalysis: ReviewAnalysisProvider;
  verification: VerificationProvider;
}
