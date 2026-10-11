"use client";
import { useState } from "react";
import { Camera, RotateCcw, ScanLine, X } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { ProductIdentityCard } from "@/components/identification/product-identity-card";
import { IdentificationEvidence } from "@/components/identification/identification-evidence";
import { CandidateProducts } from "@/components/identification/candidate-products";
import {
  PriceComparison,
  formatPrice,
  lowestOffer,
} from "@/components/prices/price-comparison";
import { ReviewInsights } from "@/components/reviews/review-insights";
import { RecommendationCard } from "@/components/recommendation/recommendation-card";
import { Brackets } from "@/components/scan/brackets";
import type { UploadPreview } from "@/components/scan/camera-view";
import { cn } from "@/lib/utils";
import { order } from "@/components/ui/stagger";
import type {
  IdentifyResponse,
  PricesResponse,
  ReviewsResponse,
} from "@/types";

export type LoadState<T> =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; message: string };

const TABS = ["Prices", "Reviews", "Details"] as const;
type Tab = (typeof TABS)[number];

export function ResultSheet({
  result,
  images,
  offers,
  reviews,
  busy,
  error,
  onSelectCandidate,
  onAddPhoto,
  onNewScan,
  onRetryOffers,
  onRetryReviews,
}: {
  result: IdentifyResponse;
  images: UploadPreview[];
  offers: LoadState<PricesResponse>;
  reviews: LoadState<ReviewsResponse>;
  busy: boolean;
  error: string | null;
  onSelectCandidate: (id: string) => void;
  onAddPhoto: () => void;
  onNewScan: () => void;
  onRetryOffers: () => void;
  onRetryReviews: () => void;
}) {
  const [tab, setTab] = useState<Tab>("Prices");
  const id = result.identification;
  const confirmed = id.identificationStatus === "confirmed";
  const mock = result.meta.mode === "mock";
  const cover = images[images.length - 1];
  const best =
    offers.status === "ready" ? lowestOffer(offers.data.offers) : null;

  return (
    <div className="min-h-svh bg-black lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(420px,520px)]">
      {/* Photo panel */}
      <div className="fixed inset-x-0 top-0 h-[46svh] overflow-hidden lg:sticky lg:top-0 lg:h-svh">
        {cover && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cover.url}
            alt="Your scanned product"
            className="size-full object-cover"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/45 via-transparent to-black/30" />
        <div className="absolute inset-x-0 top-0 flex h-[calc(38svh+8px)] items-center justify-center pt-8 text-white lg:h-full lg:pt-0">
          <div className="relative aspect-[4/5] h-[68%] max-h-[420px] lg:h-[55%]">
            <Brackets className="animate-lock" />
          </div>
        </div>
        <div className="absolute inset-x-0 top-0 flex items-center justify-between px-4 pt-[max(env(safe-area-inset-top),14px)] text-white">
          <button
            type="button"
            onClick={onNewScan}
            aria-label="Close results"
            className="flex size-10 items-center justify-center rounded-full bg-black/40 backdrop-blur-md transition hover:bg-black/60 active:scale-90"
          >
            <X className="size-5" />
          </button>
          <ThemeToggle className="size-10 rounded-full bg-black/40 text-white backdrop-blur-md hover:bg-black/60" />
        </div>
        {images.length > 1 && (
          <div className="absolute bottom-[calc(8svh+12px)] left-4 flex -space-x-3 lg:bottom-6">
            {images.map((image) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={image.id}
                src={image.url}
                alt=""
                className="size-9 rounded-lg object-cover ring-2 ring-black/60"
              />
            ))}
          </div>
        )}
      </div>

      {/* Sheet */}
      <main
        id="main"
        aria-label="Scan results"
        aria-live="polite"
        className="animate-sheet relative z-10 mt-[38svh] min-h-[62svh] rounded-t-[28px] bg-background px-5 pb-32 pt-3 shadow-[0_-12px_40px_rgba(0,0,0,0.35)] lg:mt-0 lg:min-h-svh lg:rounded-none lg:px-8 lg:pt-10"
      >
        <div className="mx-auto mb-5 h-1.5 w-10 rounded-full bg-muted-foreground/30 lg:hidden" />
        <ProductIdentityCard identification={id} mock={mock} />

        {confirmed ? (
          <>
            <div className="stagger mt-6 grid grid-cols-3 gap-2.5">
              <Stat
                i={4}
                label="From"
                value={best ? formatPrice(best) : null}
                loading={offers.status === "loading"}
                highlight
              />
              <Stat
                i={5}
                label="Offers"
                value={
                  offers.status === "ready"
                    ? String(offers.data.offers.length)
                    : null
                }
                loading={offers.status === "loading"}
              />
              <Stat
                i={6}
                label="Sources"
                value={
                  reviews.status === "ready"
                    ? String(reviews.data.insights.sources.length)
                    : null
                }
                loading={reviews.status === "loading"}
              />
            </div>

            <div className="mt-4">
              {reviews.status === "loading" && (
                <div className="skeleton h-32 rounded-3xl" />
              )}
              {reviews.status === "ready" && (
                <RecommendationCard
                  recommendation={reviews.data.insights.recommendation}
                  mock={reviews.data.meta.mode === "mock"}
                />
              )}
            </div>

            {!id.modelNumber && (
              // TODO(ProductSearch): consume identityResolution for general-product
              // shopping queries and variant-safe matching without a model number.
              // TODO(Reviews): consume supported family/variant precision for review
              // matching without requiring an electronics-style model number.
              <p className="mt-4 rounded-2xl bg-muted p-4 text-sm">
                {id.identityResolution?.granularity
                  ? "Product identified. Shopping and review matching for products without model numbers is not available yet."
                  : "An exact model number is needed before matching offers and reviews."}
                {id.suggestedNextImage && (
                  <span className="mt-2 block">{id.suggestedNextImage}</span>
                )}
              </p>
            )}

            <div
              role="tablist"
              aria-label="Result sections"
              className="sticky top-2 z-10 mt-6 grid grid-cols-3 rounded-full bg-muted p-1 shadow-sm lg:top-4"
            >
              <span
                aria-hidden="true"
                className="absolute inset-y-1 left-1 w-[calc((100%-0.5rem)/3)] rounded-full bg-card shadow transition-transform duration-300 ease-[var(--ease-spring)]"
                style={{
                  transform: `translateX(${TABS.indexOf(tab) * 100}%)`,
                }}
              />
              {TABS.map((t) => (
                <button
                  key={t}
                  role="tab"
                  type="button"
                  aria-selected={tab === t}
                  aria-controls={`panel-${t}`}
                  onClick={() => setTab(t)}
                  className={cn(
                    "relative h-9 rounded-full text-sm font-semibold transition-colors",
                    tab === t ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {t}
                </button>
              ))}
            </div>

            <div
              key={tab}
              id={`panel-${tab}`}
              role="tabpanel"
              aria-label={tab}
              className="mt-5"
            >
              {tab === "Prices" && (
                <Section
                  state={offers}
                  title="Offers couldn’t load"
                  onRetry={onRetryOffers}
                >
                  {(data) => (
                    <PriceComparison
                      offers={data.offers}
                      mock={data.meta.mode === "mock"}
                    />
                  )}
                </Section>
              )}
              {tab === "Reviews" && (
                <Section
                  state={reviews}
                  title="Reviews couldn’t load"
                  onRetry={onRetryReviews}
                >
                  {(data) => (
                    <ReviewInsights
                      insights={data.insights}
                      mock={data.meta.mode === "mock"}
                    />
                  )}
                </Section>
              )}
              {tab === "Details" && (
                <IdentificationEvidence identification={id} />
              )}
            </div>
          </>
        ) : (
          <div className="mt-6 space-y-8">
            <CandidateProducts
              identification={id}
              onSelect={onSelectCandidate}
              onAddPhoto={onAddPhoto}
              busy={busy}
            />
            <IdentificationEvidence identification={id} />
          </div>
        )}

        {(mock || result.meta.notice) && (
          <p className="mt-10 text-center text-[11px] leading-5 text-muted-foreground">
            {result.meta.notice ??
              "Demo mode · results are sample data, not an analysis of your photo."}
          </p>
        )}
      </main>

      {/* Floating action */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 flex flex-col items-center gap-3 pb-[max(env(safe-area-inset-bottom),18px)] lg:left-auto lg:w-[min(520px,100%)] lg:max-w-[520px]">
        {error && (
          <p
            role="alert"
            className="animate-toast pointer-events-auto mx-4 rounded-2xl bg-destructive px-4 py-2.5 text-sm text-white shadow-xl"
          >
            {error}
          </p>
        )}
        <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-foreground p-1 text-background shadow-2xl">
          <button
            type="button"
            onClick={onNewScan}
            className="flex h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold transition active:scale-95"
          >
            <ScanLine className="size-4" />
            New scan
          </button>
          <span className="h-6 w-px bg-background/20" />
          <button
            type="button"
            onClick={onAddPhoto}
            className="flex h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold transition active:scale-95"
          >
            <Camera className="size-4" />
            Add angle
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  loading,
  highlight,
  i,
}: {
  label: string;
  value: string | null;
  loading: boolean;
  highlight?: boolean;
  i: number;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl p-3",
        highlight ? "bg-brand text-neutral-900" : "bg-card",
      )}
      style={order(i)}
    >
      <p
        className={cn(
          "text-[11px] font-medium",
          highlight ? "text-neutral-900/70" : "text-muted-foreground",
        )}
      >
        {label}
      </p>
      {loading ? (
        <div className="skeleton mt-1.5 h-6 w-3/4 rounded-md" />
      ) : (
        <p className="mt-0.5 truncate text-lg font-bold tracking-tight">
          {value ?? "—"}
        </p>
      )}
    </div>
  );
}

function Section<T>({
  state,
  title,
  onRetry,
  children,
}: {
  state: LoadState<T>;
  title: string;
  onRetry: () => void;
  children: (data: T) => React.ReactNode;
}) {
  if (state.status === "ready") return children(state.data);
  if (state.status === "error")
    return (
      <div role="alert" className="rounded-2xl bg-card p-5 text-center">
        <h3 className="font-semibold">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{state.message}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex h-10 items-center gap-2 rounded-full bg-foreground px-5 text-sm font-semibold text-background active:scale-95"
        >
          <RotateCcw className="size-4" />
          Retry
        </button>
      </div>
    );
  return (
    <div role="status" aria-label="Loading" className="space-y-2.5">
      {[0, 1, 2].map((i) => (
        <div key={i} className="skeleton h-[72px] rounded-2xl" />
      ))}
    </div>
  );
}
