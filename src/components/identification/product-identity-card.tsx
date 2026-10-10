import { BadgeCheck, HelpCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ProductIdentification } from "@/types";
export function ProductIdentityCard({
  identification: p,
  image,
}: {
  identification: ProductIdentification;
  image?: string;
}) {
  return (
    <Card className="flex flex-col gap-5 sm:flex-row sm:items-center">
      {image && (
        <div className="size-24 shrink-0 overflow-hidden rounded-xl bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image}
            alt="Your uploaded product"
            className="size-full object-cover"
          />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="eyebrow">
          {p.brand ?? "Brand unknown"} · {p.category ?? "Product"}
        </p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight">
          {p.productName ?? "Product not yet identified"}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {p.modelNumber
            ? `Model ${p.modelNumber}`
            : "Exact model still needs confirmation"}
          {p.variant ? ` · ${p.variant}` : ""}
        </p>
      </div>
      <Badge
        className={
          p.identificationStatus === "confirmed"
            ? "border-primary/20 bg-accent text-primary"
            : "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
        }
      >
        {p.identificationStatus === "confirmed" ? (
          <BadgeCheck className="size-3.5" />
        ) : (
          <HelpCircle className="size-3.5" />
        )}
        <span className="capitalize">{p.identificationStatus}</span>
      </Badge>
    </Card>
  );
}
