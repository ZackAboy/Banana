import { z } from "zod";

export const httpUrlSchema = z
  .url()
  .refine(
    (url) => ["https:", "http:"].includes(new URL(url).protocol),
    "Expected an HTTP(S) URL",
  );
const nullableText = z.string().trim().min(1).nullable();
export const identificationStatusSchema = z.enum([
  "confirmed",
  "likely",
  "uncertain",
]);
export const productCandidateSchema = z.object({
  id: z.string().min(1),
  brand: nullableText,
  productName: z.string().min(1),
  modelNumber: nullableText,
  variant: nullableText,
  source: z.string().min(1),
  sourceUrl: httpUrlSchema.nullable(),
  evidence: z.array(z.string()),
  matchReason: z.string(),
});
export const productIdentificationSchema = z
  .object({
    brand: nullableText,
    productName: nullableText,
    modelNumber: nullableText,
    sku: nullableText,
    variant: nullableText,
    category: nullableText,
    visibleText: z.array(z.string()),
    distinguishingFeatures: z.array(z.string()),
    identificationStatus: identificationStatusSchema,
    reasoning: z.string(),
    suggestedNextImage: nullableText,
    candidates: z.array(productCandidateSchema),
  })
  .superRefine((value, ctx) => {
    if (value.identificationStatus === "confirmed" && !value.productName) {
      ctx.addIssue({
        code: "custom",
        path: ["productName"],
        message: "Confirmed identity needs a product name",
      });
    }
  });
export const offerConditionSchema = z.enum([
  "new",
  "used",
  "refurbished",
  "unknown",
]);
export const productOfferSchema = z.object({
  retailer: z.string().min(1),
  productName: z.string().min(1),
  price: z.number().nonnegative().nullable(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable(),
  condition: offerConditionSchema,
  availability: nullableText,
  productUrl: httpUrlSchema,
  imageUrl: httpUrlSchema.nullable(),
  retrievedAt: z.iso.datetime(),
});
export const reviewSourceSchema = z.object({
  title: z.string().min(1),
  source: z.string().min(1),
  url: httpUrlSchema,
  snippet: nullableText,
  publishedAt: z.iso.datetime().nullable(),
});
export const reviewInsightsSchema = z.object({
  pros: z.array(z.string()),
  cons: z.array(z.string()),
  recurringThemes: z.array(z.string()),
  caveats: z.array(z.string()),
  overallSummary: z.string(),
  recommendation: z.string(),
  sources: z.array(reviewSourceSchema),
});
