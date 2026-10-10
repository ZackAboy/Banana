import { MessageSquareText, Minus, Plus } from "lucide-react";
import { Card } from "@/components/ui/card";
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
    <Card>
      <h3 className="flex items-center gap-2 font-semibold">
        <MessageSquareText className="size-4 text-primary" />
        {mock ? "Sample review intelligence" : "Review intelligence"}
      </h3>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        {insights.overallSummary}
      </p>
      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <div>
          <h4 className="text-xs font-semibold">Common praise</h4>
          <ul className="mt-3 space-y-3">
            {insights.pros.map((pro) => (
              <li key={pro} className="flex gap-2 text-xs leading-5">
                <Plus className="mt-0.5 size-3.5 shrink-0 text-primary" />
                {pro}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4 className="text-xs font-semibold">Common complaints</h4>
          <ul className="mt-3 space-y-3">
            {insights.cons.map((con) => (
              <li key={con} className="flex gap-2 text-xs leading-5">
                <Minus className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                {con}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="mt-5">
        <h4 className="eyebrow">Recurring themes</h4>
        <ul className="mt-2 space-y-1 text-xs leading-5 text-muted-foreground">
          {insights.recurringThemes.map((theme) => (
            <li key={theme}>• {theme}</li>
          ))}
        </ul>
      </div>
      {insights.caveats.length > 0 && (
        <div className="mt-5 rounded-xl bg-muted p-4">
          <h4 className="mb-2 text-xs font-semibold">Keep in mind</h4>
          <ul className="space-y-2 text-xs leading-5 text-muted-foreground">
            {insights.caveats.map((caveat) => (
              <li key={caveat}>{caveat}</li>
            ))}
          </ul>
        </div>
      )}
      <Sources sources={insights.sources} />
    </Card>
  );
}
