import { ArrowUpRight } from "lucide-react";
import type { ReviewSource } from "@/types";
export function Sources({ sources }: { sources: ReviewSource[] }) {
  return (
    <div className="mt-5 border-t border-border pt-4">
      <h4 className="eyebrow">Sources behind the summary</h4>
      {sources.length ? (
        sources.map((source) => (
          <a
            key={source.url}
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className="mt-3 flex items-start justify-between gap-3 rounded-lg p-2 -mx-2 hover:bg-muted"
          >
            <div>
              <p className="text-xs font-medium">{source.title}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {source.source}
                {source.publishedAt
                  ? ` · ${new Date(source.publishedAt).getUTCFullYear()}`
                  : " · Date unavailable"}
              </p>
              {source.snippet && (
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {source.snippet}
                </p>
              )}
            </div>
            <ArrowUpRight className="size-3.5 shrink-0 text-primary" />
          </a>
        ))
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          No review evidence is available.
        </p>
      )}
    </div>
  );
}
