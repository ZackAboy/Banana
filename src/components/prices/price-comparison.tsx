import { ExternalLink, ShoppingBag } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ProductOffer } from "@/types";
function formatPrice(offer: ProductOffer) {
  if (offer.price === null || !offer.currency) return "Price unavailable";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: offer.currency,
    }).format(offer.price);
  } catch {
    return `${offer.price.toFixed(2)} ${offer.currency}`;
  }
}
export function PriceComparison({
  offers,
  mock,
}: {
  offers: ProductOffer[];
  mock: boolean;
}) {
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 font-semibold">
          <ShoppingBag className="size-4 text-primary" />
          {mock ? "Illustrative offers" : "Price comparison"}
        </h3>
        <Badge>{offers.length} offers</Badge>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Grouped by condition and currency, then by price. Verify shipping, tax,
        and warranty.
      </p>
      {!offers.length && (
        <p className="py-6 text-sm text-muted-foreground">
          No matching offers were found for this exact product.
        </p>
      )}
      <div className="mt-4 divide-y divide-border">
        {offers.map((offer, index) => (
          <div
            key={`${offer.retailer}-${index}`}
            className="flex items-center justify-between gap-3 py-4"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">{offer.retailer}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                <span className="capitalize">{offer.condition}</span> ·{" "}
                {offer.availability ?? "Availability unknown"}
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {offer.currency ?? "Currency unknown"} · Retrieved{" "}
                {new Intl.DateTimeFormat("en-US", {
                  dateStyle: "medium",
                  timeZone: "America/New_York",
                }).format(new Date(offer.retrievedAt))}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-lg font-semibold tracking-tight">
                {formatPrice(offer)}
              </p>
              <a
                className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                href={offer.productUrl}
                target="_blank"
                rel="noreferrer"
              >
                {mock ? "Demo link" : "View offer"}
                <ExternalLink className="size-3" />
              </a>
            </div>
          </div>
        ))}
      </div>
      {mock && (
        <p className="mt-2 rounded-lg bg-muted p-3 text-xs leading-5 text-muted-foreground">
          Synthetic prices and retailers for the demo. Links are placeholders,
          not shopping listings.
        </p>
      )}
    </Card>
  );
}
