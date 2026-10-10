import { Sparkles } from "lucide-react";
export function RecommendationCard({
  recommendation,
  mock,
}: {
  recommendation: string;
  mock: boolean;
}) {
  return (
    <section className="animate-fade-up relative overflow-hidden rounded-3xl bg-neutral-900 p-5 text-white ring-1 ring-white/10">
      <div className="pointer-events-none absolute -right-10 -top-12 size-40 rounded-full bg-brand/30 blur-3xl" />
      <p className="flex items-center gap-1.5 text-xs font-semibold text-brand">
        <Sparkles className="size-3.5" />
        {mock ? "Example verdict" : "Verdict"}
      </p>
      <p className="relative mt-2 text-[15px] leading-6">{recommendation}</p>
      <p className="relative mt-3 text-[11px] text-white/55">
        {mock
          ? "Synthetic interpretation for the demo."
          : "AI interpretation of the linked sources."}
      </p>
    </section>
  );
}
