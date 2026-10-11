"use client";
import { useRef, useState } from "react";
import {
  Camera,
  CircleAlert,
  Images,
  RotateCcw,
  SwitchCamera,
  X,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { MAX_IMAGES } from "@/lib/upload";
import { cn } from "@/lib/utils";
import type { DemoScenario } from "@/types";
import { useCamera } from "./use-camera";
import { Brackets } from "./brackets";

export interface UploadPreview {
  id: string;
  file: File;
  url: string;
}
const ACCEPT = "image/*";

export function CameraView({
  images,
  onAdd,
  onRemove,
  scenario,
  onScenario,
  error,
  onDismissError,
  onRetry,
}: {
  images: UploadPreview[];
  onAdd: (files: File[]) => void;
  onRemove: (id: string) => void;
  scenario: DemoScenario;
  onScenario: (scenario: DemoScenario) => void;
  error: string | null;
  onDismissError: () => void;
  onRetry: (() => void) | null;
}) {
  const gallery = useRef<HTMLInputElement>(null);
  const native = useRef<HTMLInputElement>(null);
  const { videoRef, status, supported, start, flip } = useCamera(true);
  const [dragging, setDragging] = useState(false);
  const full = images.length >= MAX_IMAGES;
  const live = status === "live";

  const pick = (files: FileList | null) => {
    if (files?.length) onAdd(Array.from(files));
  };

  return (
    <div
      className="fixed inset-0 overflow-hidden bg-black text-white select-none"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        pick(e.dataTransfer.files);
      }}
    >
      <input
        ref={gallery}
        type="file"
        accept={ACCEPT}
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-label="Upload product images"
        onChange={(e) => {
          pick(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={native}
        type="file"
        accept={ACCEPT}
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-label="Capture product photo"
        onChange={(e) => {
          pick(e.target.files);
          e.target.value = "";
        }}
      />

      {/* Viewfinder background */}
      <div className="viewfinder-idle absolute inset-0" />
      <video
        ref={videoRef}
        playsInline
        muted
        className={cn(
          "absolute inset-0 size-full object-cover transition-opacity duration-700",
          live ? "opacity-100" : "opacity-0",
        )}
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-36 bg-gradient-to-b from-black/60 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-72 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />

      {/* Top bar */}
      <header className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-4 pt-[max(env(safe-area-inset-top),14px)]">
        <span className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
          <span className="size-2.5 rounded-full bg-brand shadow-[0_0_12px_var(--brand)]" />
          banana lens
        </span>
        <div className="flex items-center gap-2">
          <label className="relative flex h-9 items-center rounded-full bg-white/12 pl-3 pr-2 text-xs font-medium backdrop-blur-md">
            <span className="mr-1 text-white/60">Demo</span>
            <select
              aria-label="Demo scenario"
              value={scenario}
              onChange={(e) => onScenario(e.target.value as DemoScenario)}
              className="appearance-none bg-transparent pr-1 text-white outline-none [&>option]:text-black"
            >
              <option value="confirmed">Instant match</option>
              <option value="follow-up">Needs a label</option>
            </select>
          </label>
          <ThemeToggle className="size-9 rounded-full bg-white/12 text-white backdrop-blur-md hover:bg-white/20" />
        </div>
      </header>

      {/* Frame */}
      <div className="absolute inset-0 flex flex-col items-center justify-center pb-40">
        <div className="relative aspect-[4/5] w-[min(74vw,340px)] text-white/90">
          <div className="animate-breathe absolute inset-0">
            <Brackets />
          </div>
          {!live && supported && (
            <button
              type="button"
              onClick={() => void start()}
              className="absolute inset-0 m-auto flex size-20 flex-col items-center justify-center gap-1 rounded-full bg-white/10 text-white/90 backdrop-blur-md transition hover:bg-white/15 active:scale-95"
              aria-label="Turn on camera"
              disabled={status === "starting"}
            >
              <Camera className="size-7" />
            </button>
          )}
        </div>
        <p className="mt-6 text-sm font-medium text-white/70">
          {dragging
            ? "Drop to scan"
            : status === "blocked"
              ? "Camera unavailable · use the shutter"
              : "Point at a product"}
        </p>
      </div>

      {dragging && (
        <div className="pointer-events-none absolute inset-3 rounded-[32px] border-2 border-dashed border-brand/80 bg-brand/5" />
      )}

      {/* Bottom controls */}
      <div className="absolute inset-x-0 bottom-0 z-10 pb-[max(env(safe-area-inset-bottom),20px)]">
        {error && (
          <div
            role="alert"
            className="animate-toast mx-auto mb-4 flex w-[min(92vw,420px)] items-center gap-3 rounded-2xl bg-white/95 py-2.5 pl-3.5 pr-2 text-sm text-neutral-900 shadow-2xl"
          >
            <CircleAlert className="size-4 shrink-0 text-red-600" />
            <span className="flex-1 leading-5">{error}</span>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="flex h-8 items-center gap-1 rounded-full bg-neutral-900 px-3 text-xs font-semibold text-white"
              >
                <RotateCcw className="size-3.5" />
                Retry
              </button>
            )}
            <button
              type="button"
              onClick={onDismissError}
              aria-label="Dismiss message"
              className="flex size-8 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-100"
            >
              <X className="size-4" />
            </button>
          </div>
        )}

        {images.length > 0 && (
          <div
            className="animate-fade-up mb-5 flex justify-center gap-2"
            aria-label="Selected images"
          >
            {images.map((image, index) => (
              <div
                key={image.id}
                className="relative size-14 overflow-hidden rounded-2xl ring-2 ring-white/80"
              >
                {/* Blob URLs are transient local previews, not optimizable remote assets. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.url}
                  alt={`Your product photo ${index + 1}: ${image.file.name}`}
                  className="size-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => onRemove(image.id)}
                  aria-label={`Remove photo ${index + 1}`}
                  className="absolute right-0.5 top-0.5 flex size-5 items-center justify-center rounded-full bg-black/70 text-white"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="mx-auto flex max-w-sm items-center justify-between px-8">
          <button
            type="button"
            onClick={() => gallery.current?.click()}
            disabled={full}
            aria-label="Choose from gallery"
            className="flex size-13 items-center justify-center rounded-2xl bg-white/12 backdrop-blur-md transition hover:bg-white/20 active:scale-90 disabled:opacity-40"
          >
            <Images className="size-6" />
          </button>

          <button
            type="button"
            onClick={() => native.current?.click()}
            disabled={full}
            aria-label={
              images.length ? "Scan with another photo" : "Scan a product"
            }
            className="group relative flex size-20 items-center justify-center rounded-full disabled:opacity-40"
          >
            <span className="animate-ring absolute inset-0 rounded-full border-2 border-white/70" />
            <span className="absolute inset-0 rounded-full border-4 border-white" />
            <span className="size-[62px] rounded-full bg-white transition-transform duration-150 group-active:scale-85 group-hover:scale-95" />
          </button>

          {live ? (
            <button
              type="button"
              onClick={flip}
              aria-label="Switch camera"
              className="flex size-13 items-center justify-center rounded-full bg-white/12 backdrop-blur-md transition hover:bg-white/20 active:rotate-180"
            >
              <SwitchCamera className="size-6" />
            </button>
          ) : (
            <span className="size-13" aria-hidden="true" />
          )}
        </div>
        <p className="mt-4 text-center text-[11px] text-white/45">
          {images.length
            ? `${images.length}/${MAX_IMAGES} photos · add an angle to rescan`
            : "Photos stay in memory, never stored"}
        </p>
      </div>
    </div>
  );
}
