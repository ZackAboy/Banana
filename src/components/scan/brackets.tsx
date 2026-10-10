import { cn } from "@/lib/utils";
export function Brackets({ className }: { className?: string }) {
  return (
    <div className={cn("absolute inset-0", className)} aria-hidden="true">
      <span className="bracket bracket-tl" />
      <span className="bracket bracket-tr" />
      <span className="bracket bracket-bl" />
      <span className="bracket bracket-br" />
    </div>
  );
}
