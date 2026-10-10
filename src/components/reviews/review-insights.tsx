import { Info, Minus, Plus } from "lucide-react";
import { order } from "@/components/ui/stagger";
import { Sources } from "./sources";
import type { ReviewInsights as Insights } from "@/types";
export function ReviewInsights({
  insights,
  mock,
}: {
  insights: Insights;
  mock: boolean;
}) {
  return (
    <div className="stagger space-y-6">
      <p className="text-[15px] leading-6" style={order(0)}>
        {insights.overallSummary}
      </p>
      <div className="grid gap-3 sm:grid-cols-2" style={order(1)}>
        <List title="Loved" items={insights.pros} positive />
        <List title="Watch out" items={insights.cons} />
      </div>
      {insights.recurringThemes.length > 0 && (
        <section style={order(2)}>
          <h3 className="mb-2.5 text-sm font-semibold">Themes</h3>
          <div className="flex flex-wrap gap-2">
            {insights.recurringThemes.map((theme) => (
              <span
                key={theme}
                className="rounded-full bg-card px-3 py-1.5 text-[13px]"
              >
                {theme}
              </span>
            ))}
          </div>
        </section>
      )}
      {insights.caveats.length > 0 && (
        <ul
          className="space-y-2 rounded-2xl bg-muted p-4 text-[13px] leading-5 text-muted-foreground"
          style={order(3)}
        >
          {insights.caveats.map((caveat) => (
            <li key={caveat} className="flex gap-2">
              <Info className="mt-0.5 size-3.5 shrink-0" />
              {caveat}
            </li>
          ))}
        </ul>
      )}
      <div style={order(4)}>
        <Sources sources={insights.sources} mock={mock} />
      </div>
    </div>
  );
}
function List({
  title,
  items,
  positive,
}: {
  title: string;
  items: string[];
  positive?: boolean;
}) {
  const Icon = positive ? Plus : Minus;
  return (
    <section className="rounded-2xl bg-card p-4">
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      <ul className="space-y-2.5">
        {items.map((item) => (
          <li key={item} className="flex gap-2.5 text-[13px] leading-5">
            <span
              className={
                positive
                  ? "flex size-5 shrink-0 items-center justify-center rounded-full bg-success/15 text-success"
                  : "flex size-5 shrink-0 items-center justify-center rounded-full bg-destructive/12 text-destructive"
              }
            >
              <Icon className="size-3" strokeWidth={3} />
            </span>
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}
