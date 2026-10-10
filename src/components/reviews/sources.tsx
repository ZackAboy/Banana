import { ArrowUpRight } from "lucide-react";
import type { ReviewSource } from "@/types";
export function Sources({
  sources,
  mock,
}: {
  sources: ReviewSource[];
  mock: boolean;
}) {
  return (
    <section>
      <h3 className="mb-2.5 text-sm font-semibold">
        Sources
        {mock && (
          <span className="font-normal text-muted-foreground"> · sample</span>
        )}
      </h3>
      {sources.length ? (
        <div className="no-scrollbar -mx-5 flex snap-x gap-2.5 overflow-x-auto px-5 pb-1">
          {sources.map((source) => (
            <a
              key={source.url}
              href={source.url}
              target="_blank"
              rel="noreferrer"
              className="flex w-64 shrink-0 snap-start flex-col rounded-2xl bg-card p-4 transition active:scale-[0.98]"
            >
              <span className="flex items-start justify-between gap-2">
                <span className="text-[13px] font-semibold leading-5">
                  {source.title}
                </span>
                <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" />
              </span>
              {source.snippet && (
                <span className="mt-2 line-clamp-3 text-xs leading-5 text-muted-foreground">
                  {source.snippet}
                </span>
              )}
              <span className="mt-auto pt-3 text-[11px] text-muted-foreground">
                {source.source}
                {source.publishedAt &&
                  ` · ${new Date(source.publishedAt).getUTCFullYear()}`}
              </span>
            </a>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No review sources found.
        </p>
      )}
    </section>
  );
}
