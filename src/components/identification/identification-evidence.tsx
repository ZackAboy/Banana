import { ScanText } from "lucide-react";
import { Card } from "@/components/ui/card";
import type { ProductIdentification } from "@/types";
export function IdentificationEvidence({
  identification: p,
}: {
  identification: ProductIdentification;
}) {
  return (
    <Card>
      <h3 className="flex items-center gap-2 font-semibold">
        <ScanText className="size-4 text-primary" />
        What supports this match
      </h3>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        {p.reasoning}
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <h4 className="eyebrow">Visible text</h4>
          <p className="mt-2 text-sm">
            {p.visibleText.length
              ? p.visibleText.join(" · ")
              : "No readable text found."}
          </p>
        </div>
        <div>
          <h4 className="eyebrow">Distinguishing features</h4>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            {p.distinguishingFeatures.map((feature) => (
              <li key={feature}>{feature}</li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}
