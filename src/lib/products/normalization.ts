import type { ProductQuery } from "@/types";
export function normalizeText(text: string) {
  return text.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}
export function productKey(product: ProductQuery) {
  return JSON.stringify(
    [
      product.brand,
      product.productName,
      product.modelNumber,
      product.variant,
    ].map(normalizeText),
  );
}
