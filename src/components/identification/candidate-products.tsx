import { ArrowRight, ExternalLink, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { ProductIdentification } from "@/types";
export function CandidateProducts({
  identification: p,
  onSelect,
  busy,
}: {
  identification: ProductIdentification;
  onSelect: (id: string) => void;
  busy: boolean;
}) {
  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <p className="eyebrow">One more detail makes a difference</p>
      <h3 className="mt-2 text-xl font-semibold">Help us confirm it.</h3>
      <p className="mt-2 text-sm leading-6">
        {p.suggestedNextImage ??
          "Add another angle with identifying text or a model label."}
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        Add the photo to your existing images, then analyze again. Prices and
        reviews stay paused until the identity is confirmed.
      </p>
      {p.candidates.length > 0 && (
        <div className="mt-5 border-t border-border pt-4">
          <p className="mb-3 text-sm font-medium">
            Or select a matching candidate
          </p>
          {p.candidates.map((candidate) => (
            <div
              key={candidate.id}
              className="mt-3 rounded-xl border border-border bg-card p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">
                    {candidate.brand} {candidate.productName}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {candidate.variant}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onSelect(candidate.id)}
                  disabled={busy}
                >
                  {busy ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <ArrowRight />
                  )}
                  Select candidate
                </Button>
              </div>
              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                {candidate.matchReason}
              </p>
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                {candidate.evidence.map((e) => (
                  <li key={e}>• {e}</li>
                ))}
              </ul>
              {candidate.sourceUrl && (
                <a
                  href={candidate.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  {candidate.source}
                  <ExternalLink className="size-3" />
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
