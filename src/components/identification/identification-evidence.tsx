import { ScanText } from "lucide-react";
import { order } from "@/components/ui/stagger";
import type { ProductIdentification } from "@/types";
export function IdentificationEvidence({
  identification: p,
}: {
  identification: ProductIdentification;
}) {
  return (
    <div className="stagger space-y-6">
      <section style={order(0)}>
        <h3 className="mb-2.5 flex items-center gap-2 text-sm font-semibold">
          <ScanText className="size-4" />
          Text found
        </h3>
        {p.visibleText.length ? (
          <div className="flex flex-wrap gap-2">
            {p.visibleText.map((text) => (
              <span
                key={text}
                className="rounded-lg border border-brand/60 bg-accent px-2.5 py-1 font-mono text-[13px]"
              >
                {text}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No readable text.</p>
        )}
      </section>
      {p.distinguishingFeatures.length > 0 && (
        <section style={order(1)}>
          <h3 className="mb-2.5 text-sm font-semibold">Features</h3>
          <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-card">
            {p.distinguishingFeatures.map((feature) => (
              <li key={feature} className="px-4 py-3 text-sm">
                {feature}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section style={order(2)}>
        <h3 className="mb-2 text-sm font-semibold">Why this match</h3>
        <p className="text-sm leading-6 text-muted-foreground">{p.reasoning}</p>
      </section>
    </div>
  );
}
