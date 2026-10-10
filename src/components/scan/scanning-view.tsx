"use client";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Brackets } from "./brackets";
import type { UploadPreview } from "./camera-view";

const STEPS = ["Looking closely", "Reading labels", "Matching products"];
// Fixed positions keep the render deterministic between server and client.
const DOTS = [
  [22, 30],
  [68, 22],
  [44, 48],
  [76, 58],
  [30, 66],
  [58, 76],
  [16, 50],
  [84, 38],
  [50, 18],
  [38, 84],
];

export function ScanningView({
  images,
  onCancel,
}: {
  images: UploadPreview[];
  onCancel: () => void;
}) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = setInterval(
      () => setStep((s) => Math.min(s + 1, STEPS.length - 1)),
      700,
    );
    return () => clearInterval(id);
  }, []);
  const cover = images[images.length - 1];

  return (
    <div className="fixed inset-0 overflow-hidden bg-black text-white">
      {cover && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={cover.url}
          alt=""
          className="animate-slow-zoom absolute inset-0 size-full object-cover"
        />
      )}
      <div className="absolute inset-0 bg-black/35" />
      <div className="absolute inset-x-0 bottom-0 h-64 bg-gradient-to-t from-black/85 to-transparent" />

      <button
        type="button"
        onClick={onCancel}
        aria-label="Cancel scan"
        className="absolute left-4 top-[max(env(safe-area-inset-top),14px)] z-10 flex size-10 items-center justify-center rounded-full bg-black/40 backdrop-blur-md transition hover:bg-black/60 active:scale-90"
      >
        <X className="size-5" />
      </button>

      <div className="absolute inset-0 flex items-center justify-center pb-24">
        <div className="relative aspect-[4/5] w-[min(74vw,340px)]">
          <Brackets className="animate-lock text-brand" />
          <div className="absolute inset-3 overflow-hidden rounded-[18px]">
            <div className="animate-sweep absolute inset-x-0 h-16 -translate-y-1/2">
              <div className="h-full bg-gradient-to-b from-transparent via-brand/25 to-transparent" />
              <div className="absolute inset-x-0 top-1/2 h-0.5 bg-brand shadow-[0_0_18px_4px_var(--brand)]" />
            </div>
            {DOTS.map(([x, y], i) => (
              <span
                key={i}
                className="animate-dot absolute size-2.5 rounded-full bg-white shadow-[0_0_10px_2px_rgba(255,255,255,0.8)]"
                style={{
                  left: `${x}%`,
                  top: `${y}%`,
                  animationDelay: `${(i * 0.37) % 2.2}s`,
                }}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-4 pb-[max(env(safe-area-inset-bottom),36px)]">
        {images.length > 1 && (
          <div className="flex -space-x-3">
            {images.map((image) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={image.id}
                src={image.url}
                alt=""
                className="size-10 rounded-xl object-cover ring-2 ring-black"
              />
            ))}
          </div>
        )}
        <div
          role="status"
          className="flex h-11 items-center gap-3 rounded-full bg-white/12 px-5 text-sm font-medium backdrop-blur-xl"
        >
          <span className="flex gap-1" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="size-1.5 animate-bounce rounded-full bg-brand"
                style={{ animationDelay: `${i * 120}ms` }}
              />
            ))}
          </span>
          <span key={step} className="animate-fade-up">
            {STEPS[step]}…
          </span>
        </div>
      </div>
    </div>
  );
}
