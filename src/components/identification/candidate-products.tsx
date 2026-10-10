import { Camera, Check, ExternalLink, LoaderCircle } from "lucide-react";
import { order } from "@/components/ui/stagger";
import type { ProductIdentification } from "@/types";
export function CandidateProducts({
  identification: p,
  onSelect,
  onAddPhoto,
  busy,
}: {
  identification: ProductIdentification;
  onSelect: (id: string) => void;
  onAddPhoto: () => void;
  busy: boolean;
}) {
  return (
    <div className="stagger space-y-6">
      <section
        className="rounded-3xl border-2 border-dashed border-brand bg-accent p-5"
        style={order(0)}
      >
        <h2 className="text-lg font-bold tracking-tight">Almost there</h2>
        <p className="mt-1.5 text-sm leading-6 text-foreground/75">
          {p.suggestedNextImage ?? p.reasoning}
        </p>
        {p.suggestedNextImage && (
          <button
            type="button"
            onClick={onAddPhoto}
            className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-foreground text-sm font-semibold text-background transition active:scale-[0.97]"
          >
            <Camera className="size-4" />
            Add photo
          </button>
        )}
      </section>
      {p.candidates.length > 0 && (
        <section style={order(1)}>
          <h3 className="mb-2.5 text-sm font-semibold">Is it one of these?</h3>
          <ul className="space-y-2.5">
            {p.candidates.map((candidate) => (
              <li key={candidate.id} className="rounded-2xl bg-card p-4">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">
                      {[candidate.brand, candidate.productName]
                        .filter(Boolean)
                        .join(" ")}
                    </p>
                    {candidate.variant && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {candidate.variant}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onSelect(candidate.id)}
                    disabled={busy}
                    className="flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-brand px-4 text-sm font-semibold text-neutral-900 transition active:scale-95 disabled:opacity-60"
                  >
                    {busy ? (
                      <LoaderCircle className="size-4 animate-spin" />
                    ) : (
                      <Check className="size-4" />
                    )}
                    That’s it
                  </button>
                </div>
                <p className="mt-3 text-xs leading-5 text-muted-foreground">
                  {candidate.matchReason}
                </p>
                {candidate.evidence.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {candidate.evidence.map((e) => (
                      <span
                        key={e}
                        className="rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground"
                      >
                        {e}
                      </span>
                    ))}
                  </div>
                )}
                {candidate.sourceUrl && (
                  <a
                    href={candidate.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-flex items-center gap-1 text-xs font-medium underline-offset-4 hover:underline"
                  >
                    {candidate.source}
                    <ExternalLink className="size-3" />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
