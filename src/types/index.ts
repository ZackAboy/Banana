import type { z } from "zod";
import type * as domain from "@/schemas/domain";
import type * as api from "@/schemas/api";
export type IdentificationStatus = z.infer<
  typeof domain.identificationStatusSchema
>;
export type ProductIdentification = z.infer<
  typeof domain.productIdentificationSchema
>;
export type ProductCandidate = z.infer<typeof domain.productCandidateSchema>;
export type ProductOffer = z.infer<typeof domain.productOfferSchema>;
export type ReviewSource = z.infer<typeof domain.reviewSourceSchema>;
export type ReviewInsights = z.infer<typeof domain.reviewInsightsSchema>;
export type DemoScenario = z.infer<typeof api.demoScenarioSchema>;
export type ResponseMeta = z.infer<typeof api.responseMetaSchema>;
export type IdentifyResponse = z.infer<typeof api.identifyResponseSchema>;
export type ProductQuery = z.infer<typeof api.productQuerySchema>;
export type VerifyRequest = z.infer<typeof api.verifyRequestSchema>;
export type PricesResponse = z.infer<typeof api.pricesResponseSchema>;
export type ReviewsResponse = z.infer<typeof api.reviewsResponseSchema>;
