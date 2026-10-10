import { Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
export function RecommendationCard({
  recommendation,
  mock,
}: {
  recommendation: string;
  mock: boolean;
}) {
  return (
    <Card className="border-primary/20 bg-accent">
      <p className="flex items-center gap-2 text-xs font-semibold text-primary">
        <Sparkles className="size-4" />
        {mock
          ? "Example purchasing perspective"
          : "Your purchasing perspective"}
      </p>
      <p className="mt-3 text-base leading-7">{recommendation}</p>
      <p className="mt-4 text-xs text-muted-foreground">
        {mock
          ? "Synthetic interpretation for demonstration."
          : "AI interpretation of the linked evidence. Read original sources before deciding."}
      </p>
    </Card>
  );
}
