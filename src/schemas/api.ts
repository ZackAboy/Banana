import { z } from "zod";
import {
  productIdentificationSchema,
  productOfferSchema,
  reviewInsightsSchema,
} from "./domain";
export const demoScenarioSchema = z.enum(["confirmed", "follow-up"]);
export const responseMetaSchema = z.object({
  mode: z.enum(["mock", "live"]),
  notice: z.string().nullable(),
});
export const identifyResponseSchema = z.object({
  identification: productIdentificationSchema,
  meta: responseMetaSchema,
});
export const productQuerySchema = z.object({
  brand: z.string().trim().max(120).default(""),
  productName: z.string().trim().min(1).max(200),
  modelNumber: z.string().trim().min(1).max(120),
  variant: z.string().trim().max(120).default(""),
});
export const verifyRequestSchema = z.object({
  candidateId: z.string().min(1).max(120),
  identification: productIdentificationSchema,
});
export const pricesResponseSchema = z.object({
  offers: z.array(productOfferSchema),
  meta: responseMetaSchema,
});
export const reviewsResponseSchema = z.object({
  insights: reviewInsightsSchema,
  meta: responseMetaSchema,
});
export const apiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
