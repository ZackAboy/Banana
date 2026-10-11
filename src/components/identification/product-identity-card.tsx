import { BadgeCheck, CircleHelp, CircleDashed } from "lucide-react";
import { cn } from "@/lib/utils";
import { order } from "@/components/ui/stagger";
import type { IdentificationStatus, ProductIdentification } from "@/types";

const STATUS: Record<
  IdentificationStatus,
  { label: string; icon: typeof BadgeCheck; className: string }
> = {
  confirmed: {
    label: "Confirmed",
    icon: BadgeCheck,
    className: "bg-success/12 text-success",
  },
  likely: {
    label: "Likely",
    icon: CircleHelp,
    className: "bg-warning/12 text-warning",
  },
  uncertain: {
    label: "Uncertain",
    icon: CircleDashed,
    className: "bg-muted text-muted-foreground",
  },
};

export function StatusPill({ status }: { status: IdentificationStatus }) {
  const { label, icon: Icon, className } = STATUS[status];
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold",
        className,
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </span>
  );
}

export function ProductIdentityCard({
  identification: p,
  mock,
}: {
  identification: ProductIdentification;
  mock: boolean;
}) {
  return (
    <div className="stagger">
      <div className="flex flex-wrap items-center gap-2" style={order(0)}>
        <StatusPill status={p.identificationStatus} />
        {mock && (
          <span className="inline-flex h-7 items-center rounded-full bg-accent px-2.5 text-xs font-semibold text-foreground/80">
            Demo data
          </span>
        )}
      </div>
      <p
        className="mt-4 text-[13px] font-medium text-muted-foreground"
        style={order(1)}
      >
        {[p.brand ?? "Unknown brand", p.category].filter(Boolean).join(" · ")}
      </p>
      <h1
        className="mt-1 text-[28px] font-bold leading-[1.1] tracking-tight text-balance"
        style={order(2)}
      >
        {p.productName ?? "Not identified yet"}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground" style={order(3)}>
        {p.modelNumber
          ? `Model ${p.modelNumber}`
          : p.identityResolution?.granularity === "variant"
            ? "Variant identified"
            : p.identityResolution?.granularity === "product_family"
              ? "Product family identified"
              : "Product details need confirmation"}
        {p.variant && !p.productName?.includes(p.variant)
          ? ` · ${p.variant}`
          : ""}
        {p.identityResolution?.unresolvedFields.includes("variant")
          ? " · Variant unresolved"
          : ""}
      </p>
    </div>
  );
}
