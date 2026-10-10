import { ArrowUpRight } from "lucide-react";
import { order } from "@/components/ui/stagger";
import { cn } from "@/lib/utils";
import type { ProductOffer } from "@/types";

export function formatPrice(offer: Pick<ProductOffer, "price" | "currency">) {
  if (offer.price === null || !offer.currency) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: offer.currency,
    }).format(offer.price);
  } catch {
    return `${offer.price.toFixed(2)} ${offer.currency}`;
  }
}
/** Cheapest priced offer. Only compares offers sharing the first priced offer's currency. */
export function lowestOffer(offers: ProductOffer[]) {
  const priced = offers.filter((o) => o.price !== null && o.currency);
  const currency = priced[0]?.currency;
  return priced
    .filter((o) => o.currency === currency)
    .reduce<ProductOffer | null>(
      (best, o) => (!best || o.price! < best.price! ? o : best),
      null,
    );
}
const CONDITION: Record<ProductOffer["condition"], string> = {
  new: "bg-success/12 text-success",
  refurbished: "bg-sky-500/12 text-sky-600 dark:text-sky-400",
  used: "bg-warning/12 text-warning",
  unknown: "bg-muted text-muted-foreground",
};

export function PriceComparison({
  offers,
  mock,
}: {
  offers: ProductOffer[];
  mock: boolean;
}) {
  const best = lowestOffer(offers);
  if (!offers.length)
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        No offers for this exact model.
      </p>
    );
  return (
    <div>
      <ul className="stagger space-y-2.5">
        {offers.map((offer, index) => (
          <li key={`${offer.retailer}-${index}`} style={order(index)}>
            <a
              href={offer.productUrl}
              target="_blank"
              rel="noreferrer"
              className={cn(
                "group flex items-center gap-3.5 rounded-2xl bg-card p-3.5 transition active:scale-[0.98]",
                offer === best && "ring-2 ring-brand",
              )}
            >
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted text-base font-bold">
                {offer.retailer.charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold">
                  {offer.retailer}
                </span>
                <span className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span
                    className={cn(
                      "rounded-md px-1.5 py-0.5 font-medium capitalize",
                      CONDITION[offer.condition],
                    )}
                  >
                    {offer.condition}
                  </span>
                  <span className="truncate">
                    {offer.availability ?? "Availability unknown"}
                  </span>
                </span>
              </span>
              <span className="shrink-0 text-right">
                {offer === best && (
                  <span className="mb-0.5 block text-[10px] font-bold uppercase tracking-wider text-warning">
                    Lowest
                  </span>
                )}
                <span className="flex items-center gap-1 text-lg font-bold tracking-tight">
                  {formatPrice(offer)}
                  <ArrowUpRight className="size-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </span>
              </span>
            </a>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-center text-[11px] leading-5 text-muted-foreground">
        {mock
          ? "Sample prices and retailers · links are placeholders"
          : `Check shipping, tax and warranty · retrieved ${new Intl.DateTimeFormat(
              "en-US",
              { dateStyle: "medium", timeZone: "America/New_York" },
            ).format(new Date(offers[0].retrievedAt))}`}
      </p>
    </div>
  );
}
