import { describe, expect, it } from "vitest";
import { productKey } from "@/lib/products/normalization";
import { sortOffers } from "@/lib/products/offers";
import { demoOffers } from "@/lib/mock/fixtures";
describe("product matching utilities", () => {
  it("normalizes queries without merging different variants", () => {
    const a = {
      brand: " LG ",
      productName: "UltraGear  Monitor",
      modelNumber: "27GP850-B",
      variant: "27 inch",
    };
    expect(productKey(a)).toBe(
      productKey({ ...a, brand: "lg", productName: "ultragear monitor" }),
    );
    expect(productKey(a)).not.toBe(productKey({ ...a, variant: "32 inch" }));
  });
  it("sorts within condition and currency groups without mutating input", () => {
    const base = demoOffers()[0];
    const offers = [
      { ...base, price: null },
      { ...base, price: 2, currency: "EUR" },
      { ...base, price: 1, condition: "used" as const },
      { ...base, price: 300 },
    ];
    const sorted = sortOffers(offers);
    expect(sorted.map((p) => [p.condition, p.currency, p.price])).toEqual([
      ["new", "EUR", 2],
      ["new", "USD", 300],
      ["new", "USD", null],
      ["used", "USD", 1],
    ]);
    expect(offers[0].price).toBeNull();
  });
});
