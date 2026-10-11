"use client";
import { useEffect, useRef, useState } from "react";
import { CameraView, type UploadPreview } from "@/components/scan/camera-view";
import { ScanningView } from "@/components/scan/scanning-view";
import { ResultSheet, type LoadState } from "@/components/results/result-sheet";
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

/** Keep the scanning animation on screen long enough to read as a step. */
const MIN_SCAN_MS = 1600;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
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
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);
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
  const phase = scanning ? "scanning" : result ? "results" : "camera";
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [phase]);

  function showError(message: string, retry = false) {
    setError(message);
    setCanRetry(retry);
  }
  function clearAnalysis() {
    requestRef.current?.abort();
    setBusy(false);
    setScanning(false);
    setResult(null);
    setError(null);
    setOffers({ status: "idle" });
    setReviews({ status: "idle" });
  }
  function setPreviews(next: UploadPreview[]) {
    previewRef.current = next;
    setImages(next);
  }
  function addImages(files: File[]) {
    if (!files.length) return;
    const validation = validateImageFiles([
      ...previewRef.current.map((i) => i.file),
      ...files,
    ]);
    if (validation) return showError(validation);
    clearAnalysis();
    const next = [
      ...previewRef.current,
      ...files.map((file) => {
        // Blob URLs are unique and work on HTTP LAN origins too.
        const url = URL.createObjectURL(file);
        return { id: url, file, url };
      }),
    ];
    setPreviews(next);
    void analyze(next);
  }
  function removeImage(id: string) {
    clearAnalysis();
    const removed = previewRef.current.find((image) => image.id === id);
    if (removed) URL.revokeObjectURL(removed.url);
    setPreviews(previewRef.current.filter((image) => image.id !== id));
  }
  function reset() {
    clearAnalysis();
    previewRef.current.forEach((i) => URL.revokeObjectURL(i.url));
    setPreviews([]);
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
    setScanning(false);
    if (data.identification.identificationStatus === "confirmed") {
      await Promise.all([
        loadOffers(data.identification, controller),
        loadReviews(data.identification, controller),
      ]);
    }
  }
  async function analyze(list: UploadPreview[] = previewRef.current) {
    const validation = validateImageFiles(list.map((i) => i.file));
    if (validation) return showError(validation);
    clearAnalysis();
    const controller = new AbortController();
    requestRef.current = controller;
    setBusy(true);
    setScanning(true);
    const form = new FormData();
    list.forEach((i) => form.append("images", i.file));
    form.append("scenario", scenario);
    try {
      const [data] = await Promise.all([
        fetchApi("/api/identify", identifyResponseSchema, {
          method: "POST",
          body: form,
          signal: controller.signal,
        }),
        wait(MIN_SCAN_MS),
      ]);
      await acceptResult(data, controller);
    } catch (e) {
      if (!controller.signal.aborted) {
        showError(messageOf(e), true);
        setBusy(false);
        setScanning(false);
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
        showError(messageOf(e));
        setBusy(false);
      }
    }
  }
  function retry(load: typeof loadOffers) {
    if (result && requestRef.current)
      void load(result.identification, requestRef.current);
  }

  if (scanning) return <ScanningView images={images} onCancel={reset} />;
  if (result)
    return (
      <ResultSheet
        result={result}
        images={images}
        offers={offers}
        reviews={reviews}
        busy={busy}
        error={error}
        onSelectCandidate={(id) => void selectCandidate(id)}
        onAddPhoto={clearAnalysis}
        onNewScan={reset}
        onRetryOffers={() => retry(loadOffers)}
        onRetryReviews={() => retry(loadReviews)}
      />
    );
  return (
    <CameraView
      images={images}
      onAdd={addImages}
      onRemove={removeImage}
      scenario={scenario}
      onScenario={(next) => {
        clearAnalysis();
        setScenario(next);
      }}
      error={error}
      onDismissError={() => setError(null)}
      onRetry={canRetry && images.length ? () => void analyze() : null}
    />
  );
}
