"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleAlert,
  Fingerprint,
  LoaderCircle,
  LockKeyhole,
  RotateCcw,
  ScanLine,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  ImageUpload,
  type UploadPreview,
} from "@/components/upload/image-upload";
import { DemoPreview } from "@/components/product/demo-preview";
import { ProductIdentityCard } from "@/components/identification/product-identity-card";
import { IdentificationEvidence } from "@/components/identification/identification-evidence";
import { CandidateProducts } from "@/components/identification/candidate-products";
import { PriceComparison } from "@/components/prices/price-comparison";
import { ReviewInsights } from "@/components/reviews/review-insights";
import { RecommendationCard } from "@/components/recommendation/recommendation-card";
import { fetchApi } from "@/lib/api/client";
import { validateImageFiles } from "@/lib/upload";
import {
  identifyResponseSchema,
  pricesResponseSchema,
  reviewsResponseSchema,
} from "@/schemas/api";
import type {
  DemoScenario,
  IdentifyResponse,
  PricesResponse,
  ProductIdentification,
  ReviewsResponse,
} from "@/types";

type LoadState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; message: string };
const messageOf = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";

export function ShoppingAssistant() {
  const [images, setImages] = useState<UploadPreview[]>([]);
  const previewRef = useRef<UploadPreview[]>([]);
  const requestRef = useRef<AbortController | null>(null);
  const [scenario, setScenario] = useState<DemoScenario>("confirmed");
  const [result, setResult] = useState<IdentifyResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offers, setOffers] = useState<LoadState<PricesResponse>>({
    status: "idle",
  });
  const [reviews, setReviews] = useState<LoadState<ReviewsResponse>>({
    status: "idle",
  });

  useEffect(
    () => () => {
      requestRef.current?.abort();
      previewRef.current.forEach((image) => URL.revokeObjectURL(image.url));
    },
    [],
  );

  function clearAnalysis() {
    requestRef.current?.abort();
    setBusy(false);
    setResult(null);
    setError(null);
    setOffers({ status: "idle" });
    setReviews({ status: "idle" });
  }
  function addImages(files: File[]) {
    if (!files.length) return;
    const validation = validateImageFiles([
      ...previewRef.current.map((i) => i.file),
      ...files,
    ]);
    if (validation) {
      setError(validation);
      return;
    }
    clearAnalysis();
    const next = [
      ...previewRef.current,
      ...files.map((file) => ({
        id: crypto.randomUUID(),
        file,
        url: URL.createObjectURL(file),
      })),
    ];
    previewRef.current = next;
    setImages(next);
  }
  function removeImage(id: string) {
    clearAnalysis();
    const removed = previewRef.current.find((image) => image.id === id);
    if (removed) URL.revokeObjectURL(removed.url);
    const next = previewRef.current.filter((image) => image.id !== id);
    previewRef.current = next;
    setImages(next);
  }
  function reset() {
    clearAnalysis();
    previewRef.current.forEach((i) => URL.revokeObjectURL(i.url));
    previewRef.current = [];
    setImages([]);
  }
  function getQuery(identity: ProductIdentification) {
    if (!identity.productName || !identity.modelNumber) return null;
    return new URLSearchParams({
      brand: identity.brand ?? "",
      productName: identity.productName,
      modelNumber: identity.modelNumber,
      variant: identity.variant ?? "",
    }).toString();
  }
  async function loadOffers(
    identity: ProductIdentification,
    controller: AbortController,
  ) {
    const query = getQuery(identity);
    if (!query) return;
    setOffers({ status: "loading" });
    try {
      const data = await fetchApi(
        `/api/prices?${query}`,
        pricesResponseSchema,
        { signal: controller.signal },
      );
      if (!controller.signal.aborted) setOffers({ status: "ready", data });
    } catch (e) {
      if (!controller.signal.aborted)
        setOffers({ status: "error", message: messageOf(e) });
    }
  }
  async function loadReviews(
    identity: ProductIdentification,
    controller: AbortController,
  ) {
    const query = getQuery(identity);
    if (!query) return;
    setReviews({ status: "loading" });
    try {
      const data = await fetchApi(
        `/api/reviews?${query}`,
        reviewsResponseSchema,
        { signal: controller.signal },
      );
      if (!controller.signal.aborted) setReviews({ status: "ready", data });
    } catch (e) {
      if (!controller.signal.aborted)
        setReviews({ status: "error", message: messageOf(e) });
    }
  }
  async function acceptResult(
    data: IdentifyResponse,
    controller: AbortController,
  ) {
    if (controller.signal.aborted) return;
    setResult(data);
    setBusy(false);
    if (data.identification.identificationStatus === "confirmed") {
      await Promise.all([
        loadOffers(data.identification, controller),
        loadReviews(data.identification, controller),
      ]);
    }
  }
  async function analyze() {
    const validation = validateImageFiles(images.map((i) => i.file));
    if (validation) {
      setError(validation);
      return;
    }
    clearAnalysis();
    const controller = new AbortController();
    requestRef.current = controller;
    setBusy(true);
    const form = new FormData();
    images.forEach((i) => form.append("images", i.file));
    form.append("scenario", scenario);
    try {
      await acceptResult(
        await fetchApi("/api/identify", identifyResponseSchema, {
          method: "POST",
          body: form,
          signal: controller.signal,
        }),
        controller,
      );
    } catch (e) {
      if (!controller.signal.aborted) {
        setError(messageOf(e));
        setBusy(false);
      }
    }
  }
  async function selectCandidate(candidateId: string) {
    if (!result) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setBusy(true);
    setError(null);
    try {
      await acceptResult(
        await fetchApi("/api/products/verify", identifyResponseSchema, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            candidateId,
            identification: result.identification,
          }),
          signal: controller.signal,
        }),
        controller,
      );
    } catch (e) {
      if (!controller.signal.aborted) {
        setError(messageOf(e));
        setBusy(false);
      }
    }
  }
  const confirmed = result?.identification.identificationStatus === "confirmed";
  const mock = result?.meta.mode === "mock";
  return (
    <div className="min-h-screen">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>
      <header className="border-b border-border/80 bg-background/90">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-5 sm:px-8 lg:px-12">
          <Link
            href="/"
            className="flex items-center gap-2.5"
            aria-label="Banana Lens home"
          >
            <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <ScanLine className="size-5" />
            </span>
            <span className="text-lg font-semibold tracking-tight">
              banana
              <span className="font-normal text-muted-foreground"> lens</span>
            </span>
          </Link>
          <nav
            className="flex items-center gap-4 sm:gap-7"
            aria-label="Main navigation"
          >
            <a
              href="#how-it-works"
              className="hidden text-xs font-medium text-muted-foreground hover:text-foreground sm:block"
            >
              How it works
            </a>
            <span className="hidden border-l border-border pl-7 text-[11px] text-muted-foreground md:block">
              Made for the curious buyer.
            </span>
            <ThemeToggle />
          </nav>
        </div>
      </header>
      <main
        id="main"
        className="mx-auto max-w-7xl px-5 pb-16 pt-10 sm:px-8 sm:pt-14 lg:px-12"
      >
        <div className="mb-8 flex flex-wrap items-center gap-3">
          <Badge className="border-primary/20 bg-accent text-primary">
            <span className="size-1.5 rounded-full bg-primary" />A little
            clarity before you buy
          </Badge>
          <span className="text-[11px] text-muted-foreground">
            Banana Hacks / Visual shopping assistant
          </span>
        </div>
        {result && (
          <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="eyebrow">Your product, in perspective</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">
                {confirmed ? "A clearer picture." : "Getting closer."}
              </h1>
            </div>
            <Button variant="outline" size="sm" onClick={reset}>
              <RotateCcw />
              Start over
            </Button>
          </div>
        )}
        <div
          className={
            result
              ? "grid items-start gap-7 lg:grid-cols-[320px_minmax(0,1fr)]"
              : "grid items-start gap-7 lg:grid-cols-2"
          }
        >
          {!result && (
            <div className="max-w-3xl lg:col-start-1 lg:row-start-1">
              <h1 className="hero-title text-[2.65rem] leading-[1.1] font-semibold tracking-[-0.055em] sm:text-6xl lg:text-[3.6rem]">
                Take a photo.
                <br />
                Know what it is.
                <br />
                <span className="text-primary">Know what it’s worth.</span>
              </h1>
              <p className="mt-6 max-w-lg text-base leading-7 text-muted-foreground">
                From a curious find to a considered purchase. Identify the
                product, explore offers, and make sense of the reviews.
              </p>
            </div>
          )}
          <div
            className={
              result
                ? "space-y-4"
                : "space-y-4 lg:col-start-2 lg:row-start-1 lg:row-span-2"
            }
          >
            <Card className="p-5 sm:p-7">
              <div className="mb-5 flex items-center justify-between">
                <h2 className="text-base font-semibold">
                  {images.length
                    ? "Your product photos"
                    : "Meet your next good find"}
                </h2>
                <span className="text-xs text-muted-foreground">
                  {images.length}/4 photos
                </span>
              </div>
              <ImageUpload
                images={images}
                onAdd={addImages}
                onRemove={removeImage}
                disabled={busy}
              />
              <div className="mt-5">
                <label htmlFor="scenario" className="eyebrow">
                  Demo scenario
                </label>
                <select
                  id="scenario"
                  value={scenario}
                  disabled={busy}
                  onChange={(event) => {
                    clearAnalysis();
                    setScenario(event.target.value as DemoScenario);
                  }}
                  className="mt-2 h-10 w-full rounded-lg border border-border bg-card px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="confirmed">Identify the sample product</option>
                  <option value="follow-up">Ask for another image first</option>
                </select>
                <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
                  These scenarios apply in demo mode. Live identification uses
                  image evidence.
                </p>
              </div>
              <Button
                className="mt-5 w-full"
                size="lg"
                onClick={analyze}
                disabled={busy || !images.length}
              >
                {busy ? (
                  <>
                    <LoaderCircle className="animate-spin" />
                    Analyzing your product…
                  </>
                ) : (
                  <>
                    {images.length > 1
                      ? "Analyze all images"
                      : "Identify this product"}
                    <ArrowRight />
                  </>
                )}
              </Button>
              {busy && (
                <p
                  role="status"
                  className="mt-3 text-center text-xs text-muted-foreground"
                >
                  Gathering identity and model evidence…
                </p>
              )}
              {error && (
                <div
                  role="alert"
                  className="mt-4 flex gap-2 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-xs leading-5 text-destructive"
                >
                  <CircleAlert className="mt-0.5 size-4 shrink-0" />
                  {error}
                </div>
              )}
              <p className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
                <LockKeyhole className="size-3" />
                Images are processed in memory, never stored.
              </p>
              {(images.length > 0 || busy) && !result && (
                <button
                  onClick={reset}
                  className="mt-3 w-full text-center text-xs text-muted-foreground underline underline-offset-4"
                >
                  {busy ? "Cancel and start over" : "Clear photos"}
                </button>
              )}
            </Card>
            <div className="rounded-xl border border-border bg-card/50 px-4 py-3">
              <div className="flex items-center gap-2 text-xs font-medium">
                <Sparkles className="size-3.5 text-primary" />
                {result
                  ? mock
                    ? "Demo mode · synthetic data"
                    : "Live mode"
                  : "Mock-first starter · demo available"}
              </div>
              <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">
                {result?.meta.notice ??
                  (result
                    ? "Results are based on configured providers and retrieved evidence."
                    : "The default demo uses a sample LG monitor regardless of your photo. Offers and opinions are illustrative, with no live API calls.")}
              </p>
            </div>
          </div>
          {!result ? (
            <div className="space-y-5 lg:col-start-1 lg:row-start-2">
              <DemoPreview />
              <div className="grid grid-cols-3 gap-3 text-center">
                {[
                  { icon: Fingerprint, label: "Exact identity" },
                  { icon: Search, label: "Offer comparison" },
                  { icon: ShieldCheck, label: "Evidence first" },
                ].map(({ icon: Icon, label }) => (
                  <div
                    key={label}
                    className="rounded-xl border border-border bg-card/50 px-2 py-4"
                  >
                    <Icon className="mx-auto mb-2 size-4 text-muted-foreground" />
                    <p className="text-[11px] font-medium">{label}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <section
              className="min-w-0 space-y-5"
              aria-label="Product intelligence dashboard"
              aria-live="polite"
            >
              {mock && (
                <div className="flex items-start gap-2 rounded-xl border border-primary/20 bg-accent px-4 py-3 text-xs leading-5 text-primary">
                  <Sparkles className="mt-0.5 size-4 shrink-0" />
                  Synthetic demo — identity, evidence, offers, and review
                  opinions below are sample data, not findings from your photos.
                </div>
              )}
              <ProductIdentityCard
                identification={result.identification}
                image={images[0]?.url}
              />
              <IdentificationEvidence identification={result.identification} />
              {!confirmed && (
                <CandidateProducts
                  identification={result.identification}
                  onSelect={selectCandidate}
                  busy={busy}
                />
              )}
              {confirmed && !result.identification.modelNumber && (
                <Card>
                  <p className="text-sm">
                    An exact model number is still needed before matching offers
                    and reviews.
                  </p>
                </Card>
              )}
              {confirmed && (
                <div className="grid items-start gap-5 xl:grid-cols-2">
                  <div>
                    {offers.status === "loading" && (
                      <LoadingPanel label="Finding matching offers" />
                    )}
                    {offers.status === "error" && (
                      <ErrorPanel
                        title="Offers couldn’t load"
                        message={offers.message}
                        onRetry={() => {
                          if (requestRef.current)
                            void loadOffers(
                              result.identification,
                              requestRef.current,
                            );
                        }}
                      />
                    )}
                    {offers.status === "ready" && (
                      <PriceComparison
                        offers={offers.data.offers}
                        mock={offers.data.meta.mode === "mock"}
                      />
                    )}
                  </div>
                  <div>
                    {reviews.status === "loading" && (
                      <LoadingPanel label="Gathering review evidence" />
                    )}
                    {reviews.status === "error" && (
                      <ErrorPanel
                        title="Reviews couldn’t load"
                        message={reviews.message}
                        onRetry={() => {
                          if (requestRef.current)
                            void loadReviews(
                              result.identification,
                              requestRef.current,
                            );
                        }}
                      />
                    )}
                    {reviews.status === "ready" && (
                      <ReviewInsights
                        insights={reviews.data.insights}
                        mock={reviews.data.meta.mode === "mock"}
                      />
                    )}
                  </div>
                </div>
              )}
              {reviews.status === "ready" && (
                <RecommendationCard
                  recommendation={reviews.data.insights.recommendation}
                  mock={reviews.data.meta.mode === "mock"}
                />
              )}
            </section>
          )}
        </div>
        <section
          id="how-it-works"
          className="mt-16 border-t border-border pt-9"
        >
          <div className="mb-7 flex items-center justify-between">
            <h2 className="eyebrow">Less guesswork. More perspective.</h2>
            <span className="hidden text-[11px] text-muted-foreground sm:block">
              Three steps to a better-informed decision{" "}
              <ArrowUpRight className="ml-1 inline size-3" />
            </span>
          </div>
          <div className="grid gap-7 sm:grid-cols-3">
            {[
              {
                number: "01",
                title: "Start with what you see",
                text: "Upload a photo or use your camera. More angles help tell the whole story.",
              },
              {
                number: "02",
                title: "Follow the evidence",
                text: "Find the brand, model, and details. If we’re unsure, we’ll ask for another useful photo.",
              },
              {
                number: "03",
                title: "Buy with more context",
                text: "Compare matching offers, explore the sources, and weigh what matters to you.",
              },
            ].map((step) => (
              <div key={step.number} className="flex gap-4">
                <span className="mt-0.5 font-mono text-xs text-primary">
                  {step.number}
                </span>
                <div>
                  <h3 className="text-sm font-semibold">{step.title}</h3>
                  <p className="mt-2 max-w-xs text-xs leading-6 text-muted-foreground">
                    {step.text}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-6 text-[11px] text-muted-foreground sm:px-8 lg:px-12">
          <p className="flex items-center gap-1.5">
            <ScanLine className="size-3.5" />
            Banana Lens <ChevronRight className="size-3" />A Banana Hacks
            project
          </p>
          <p className="flex items-center gap-1.5">
            <Check className="size-3" />
            Evidence over guesswork. Always.
          </p>
        </div>
      </footer>
    </div>
  );
}
function LoadingPanel({ label }: { label: string }) {
  return (
    <Card role="status">
      <div className="flex items-center gap-2 text-sm">
        <LoaderCircle className="size-4 animate-spin text-primary" />
        {label}…
      </div>
      <div className="mt-5 space-y-3" aria-hidden="true">
        {["w-full", "w-3/4", "w-5/6"].map((width) => (
          <div
            key={width}
            className={`h-4 animate-pulse rounded bg-muted ${width}`}
          />
        ))}
      </div>
    </Card>
  );
}
function ErrorPanel({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <Card role="alert">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{message}</p>
      <Button className="mt-4" variant="outline" size="sm" onClick={onRetry}>
        <RotateCcw />
        Retry
      </Button>
    </Card>
  );
}
