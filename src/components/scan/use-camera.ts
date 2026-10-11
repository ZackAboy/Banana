"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { MAX_IMAGE_BYTES } from "@/lib/upload";

export type CameraStatus = "off" | "starting" | "live" | "blocked";
const MAX_EDGE = 1600;
const noop = () => () => undefined;

/** Live rear-camera preview with still capture. Falls back to "off" when unavailable. */
export function useCamera(active: boolean) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const generationRef = useRef(0);
  const [status, setStatus] = useState<CameraStatus>("off");
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const supported = useSyncExternalStore(
    noop,
    // Use native file capture on iOS, including iPads with a desktop user agent.
    () =>
      !/iPhone|iPad|iPod/.test(navigator.userAgent) &&
      !(navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) &&
      !!navigator.mediaDevices?.getUserMedia,
    () => false,
  );

  const stop = useCallback(() => {
    generationRef.current += 1;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(
    async (mode = facing) => {
      if (!supported) return;
      stop();
      const generation = generationRef.current;
      setStatus("starting");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: mode },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        // Permission can resolve after unmount, cancellation, or a camera flip.
        if (generation !== generationRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        if (generation === generationRef.current) setStatus("live");
      } catch {
        if (generation === generationRef.current) setStatus("blocked");
      }
    },
    [facing, stop, supported],
  );

  // Resume automatically only when permission was granted before; never prompt on load.
  useEffect(() => {
    if (!active || !supported) return;
    let cancelled = false;
    navigator.permissions
      ?.query({ name: "camera" as PermissionName })
      .then((p) => {
        if (!cancelled && p.state === "granted") void start();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      stop();
      setStatus("off");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, supported]);

  const flip = useCallback(() => {
    const next = facing === "environment" ? "user" : "environment";
    setFacing(next);
    void start(next);
  }, [facing, start]);

  const capture = useCallback(async (): Promise<File | null> => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return null;
    const scale = Math.min(
      1,
      MAX_EDGE / Math.max(video.videoWidth, video.videoHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas
      .getContext("2d")
      ?.drawImage(video, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.86, 0.72, 0.58]) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", quality),
      );
      if (blob && blob.size <= MAX_IMAGE_BYTES)
        return new File([blob], `scan-${Date.now()}.jpg`, {
          type: "image/jpeg",
        });
    }
    return null;
  }, []);

  return { videoRef, status, supported, start, flip, capture };
}
