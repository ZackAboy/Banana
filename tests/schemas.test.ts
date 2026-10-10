import { describe, expect, it } from "vitest";
import {
  productIdentificationSchema,
  productOfferSchema,
  reviewSourceSchema,
  httpUrlSchema,
} from "@/schemas/domain";
import { productQuerySchema } from "@/schemas/api";
import { demoIdentification, demoOffers } from "@/lib/mock/fixtures";
describe("shared domain schemas", () => {
  it("preserves unknown fields rather than inventing values", () => {
    const p = productIdentificationSchema.parse(demoIdentification(false));
    expect(p.modelNumber).toBeNull();
    expect(p.sku).toBeNull();
    expect(p.identificationStatus).toBe("likely");
  });
  it("rejects invented status labels and confirmed products with no name", () => {
    expect(
      productIdentificationSchema.safeParse({
        ...demoIdentification(true),
        identificationStatus: "99%",
      }).success,
    ).toBe(false);
    expect(
      productIdentificationSchema.safeParse({
        ...demoIdentification(true),
        productName: null,
      }).success,
    ).toBe(false);
  });
  it("allows unknown price and condition but rejects negative prices", () => {
    const offer = demoOffers()[0];
    expect(
      productOfferSchema.parse({
        ...offer,
        price: null,
        currency: null,
        condition: "unknown",
      }).price,
    ).toBeNull();
    expect(productOfferSchema.safeParse({ ...offer, price: -1 }).success).toBe(
      false,
    );
  });
  it("rejects executable links while allowing missing review dates", () => {
    expect(httpUrlSchema.safeParse("javascript:alert(1)").success).toBe(false);
    expect(
      reviewSourceSchema.parse({
        title: "Review",
        source: "Community",
        url: "https://example.com/review",
        snippet: null,
        publishedAt: null,
      }).publishedAt,
    ).toBeNull();
  });
  it("requires an exact model query for offers and reviews", () => {
    expect(
      productQuerySchema.safeParse({ productName: "Monitor" }).success,
    ).toBe(false);
  });
});
