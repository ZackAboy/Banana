"use client";
import { Button } from "@/components/ui/button";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto max-w-xl px-6 py-24">
      <h1 className="text-3xl font-semibold">
        Something interrupted your search.
      </h1>
      <p className="my-5 text-muted-foreground">
        Try again to start a fresh analysis.
      </p>
      <Button onClick={reset}>Try again</Button>
    </main>
  );
}
