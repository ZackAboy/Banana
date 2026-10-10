"use client";
import { useRef, useState } from "react";
import { Camera, ImagePlus, Plus, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
export interface UploadPreview {
  id: string;
  file: File;
  url: string;
}
export function ImageUpload({
  images,
  onAdd,
  onRemove,
  disabled,
}: {
  images: UploadPreview[];
  onAdd: (files: File[]) => void;
  onRemove: (id: string) => void;
  disabled: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const add = (files: FileList | null) => {
    if (files && !disabled) onAdd(Array.from(files));
  };
  return (
    <div className="space-y-4">
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-label="Upload product images"
        disabled={disabled}
        onChange={(event) => {
          add(event.target.files);
          event.target.value = "";
        }}
      />
      <input
        ref={camera}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-label="Capture product photo"
        disabled={disabled}
        onChange={(event) => {
          add(event.target.files);
          event.target.value = "";
        }}
      />
      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          add(event.dataTransfer.files);
        }}
        className={cn(
          "upload-zone rounded-2xl border border-dashed border-border px-5 py-9 text-center transition-colors",
          dragging && "border-primary bg-accent",
        )}
      >
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl border border-border bg-card">
          <Upload className="size-5 text-primary" />
        </div>
        <p className="font-semibold">A photo is all it takes.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Drop your product photos here
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || images.length >= 4}
            onClick={() => input.current?.click()}
          >
            <ImagePlus />
            {images.length ? "Add photos" : "Choose photos"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled || images.length >= 4}
            onClick={() => camera.current?.click()}
          >
            <Camera />
            Use camera
          </Button>
        </div>
        <p className="mt-5 text-[11px] leading-5 text-muted-foreground">
          JPEG, PNG, WebP · 3 MB each · 4 MB total
          <br />
          Up to 4 angles of the same product
        </p>
      </div>
      {images.length > 0 && (
        <div className="grid grid-cols-4 gap-2" aria-label="Selected images">
          {images.map((image, index) => (
            <div
              key={image.id}
              className="relative aspect-square overflow-hidden rounded-xl border border-border bg-muted"
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
                disabled={disabled}
                aria-label={`Remove photo ${index + 1}`}
                className="absolute right-1 top-1 flex size-7 items-center justify-center rounded-full bg-black/70 text-white hover:bg-black focus-visible:outline-2 focus-visible:outline-primary"
              >
                <X className="size-3.5" />
              </button>
              <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 text-[10px] text-white">
                {index + 1}
              </span>
            </div>
          ))}
          {images.length < 4 && (
            <button
              type="button"
              aria-label="Add another angle"
              disabled={disabled}
              onClick={() => input.current?.click()}
              className="flex aspect-square items-center justify-center rounded-xl border border-dashed border-border text-muted-foreground hover:bg-muted"
            >
              <Plus className="size-5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
