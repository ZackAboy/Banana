import { ArrowUpRight, Check, ScanLine } from "lucide-react";
import { Badge } from "@/components/ui/badge";
export function DemoPreview() {
  return (
    <div
      className="demo-preview relative flex min-h-[400px] flex-col justify-between overflow-hidden rounded-3xl border border-border bg-card p-7 sm:p-9"
      aria-label="Illustrative product intelligence preview"
    >
      <div className="flex items-center justify-between">
        <span className="eyebrow">From photo to perspective</span>
        <Badge>Sample preview</Badge>
      </div>
      <div
        className="relative mx-auto my-8 flex w-full max-w-[360px] flex-col items-center"
        role="img"
        aria-label="Illustration of a gaming monitor"
      >
        <div className="scan-corner left-0 top-0" />
        <div className="scan-corner right-0 top-0 rotate-90" />
        <div className="scan-corner bottom-8 left-0 -rotate-90" />
        <div className="scan-corner bottom-8 right-0 rotate-180" />
        <div className="monitor-screen m-5 flex aspect-[16/10] w-[85%] items-center justify-center rounded-lg border-[7px] border-[#252d35] shadow-xl">
          <div className="monitor-landscape" />
          <ScanLine className="absolute size-10 text-white/80" />
        </div>
        <div className="-mt-5 h-10 w-3 bg-[#343e48]" />
        <div className="h-2 w-28 rounded-t-full bg-[#343e48]" />
        <span className="absolute right-1 top-10 flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg">
          <Check className="size-4" />
        </span>
      </div>
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs text-muted-foreground">
            A clearer picture, in one place
          </p>
          <p className="mt-1 text-lg font-semibold">
            Identity. Offers. Real context.
          </p>
        </div>
        <ArrowUpRight className="mb-1 size-5 shrink-0 text-primary" />
      </div>
    </div>
  );
}
