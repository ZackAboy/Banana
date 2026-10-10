import type { ProductOffer } from "@/types";
const conditionOrder = { new: 0, refurbished: 1, used: 2, unknown: 3 };
export function sortOffers(offers: ProductOffer[]): ProductOffer[] {
  return [...offers].sort((a, b) => {
    const group =
      conditionOrder[a.condition] - conditionOrder[b.condition] ||
      (a.currency ?? "ZZZ").localeCompare(b.currency ?? "ZZZ");
    return (
      group ||
      (a.price ?? Infinity) - (b.price ?? Infinity) ||
      a.retailer.localeCompare(b.retailer)
    );
  });
}
