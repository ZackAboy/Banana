import "server-only";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { getConfig } from "@/lib/config/env";
import { AppError } from "@/lib/errors";
import type { ImageInput } from "@/lib/providers/interfaces";
import { imageSignatureMatches, validateImageFiles } from "@/lib/upload";
import { ocrEvidenceSchema } from "./evidence-contracts";
import { adaptEvidence } from "./evidence-adapters";

const execute = promisify(execFile);
const extensions = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const safeErrors: Record<string, [string, number]> = {
  OCR_UNAVAILABLE: [
    "Local PaddleOCR is unavailable. Check the configured Python environment and cached models.",
    503,
  ],
  OCR_INVALID_INPUT: ["PaddleOCR rejected the image input.", 400],
  OCR_INVALID_IMAGE: ["PaddleOCR could not decode an uploaded image.", 400],
  OCR_IMAGE_READ_FAILED: [
    "PaddleOCR could not read its temporary image input.",
    502,
  ],
  OCR_INFERENCE_FAILED: ["Local PaddleOCR inference failed.", 502],
};

function processFailure(error: unknown): AppError {
  const failure = error as { code?: string; signal?: string; stderr?: string };
  if (failure.signal === "SIGKILL")
    return new AppError(
      "OCR_TIMEOUT",
      "Local PaddleOCR exceeded its execution time limit.",
      504,
    );
  if (failure.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
    return new AppError(
      "OCR_INVALID_RESPONSE",
      "Local PaddleOCR exceeded its output limit.",
      502,
    );
  // Only accept known codes from the CLI's final JSON error line. Never expose
  // arbitrary Python diagnostics, filesystem paths or environment details.
  try {
    const lastLine = failure.stderr?.trim().split("\n").at(-1);
    const code = JSON.parse(lastLine ?? "").error?.code;
    if (typeof code === "string" && Object.hasOwn(safeErrors, code))
      return new AppError(code, ...safeErrors[code]);
  } catch {
    /* A startup/import failure need not be JSON. */
  }
  return new AppError("OCR_UNAVAILABLE", safeErrors.OCR_UNAVAILABLE[0], 503);
}

/** Ordered, bounded local CLI bridge. No shell, provider calls or OCR reimplementation. */
export async function runLocalOcr(images: ImageInput[]) {
  const invalid = validateImageFiles(
    images.map((image) => ({
      type: image.mimeType,
      size: image.data.byteLength,
    })),
  );
  if (
    invalid ||
    images.some((image) => !imageSignatureMatches(image.mimeType, image.data))
  )
    throw new AppError(
      "OCR_INVALID_INPUT",
      invalid ?? "Image content does not match its type.",
      400,
    );
  const config = getConfig();
  if (!config.ocrPython || !isAbsolute(config.ocrPython))
    throw new AppError(
      "OCR_UNAVAILABLE",
      "Set OCR_PYTHON to the absolute Python executable in the local PaddleOCR environment.",
      503,
    );
  const directory = await mkdtemp(join(tmpdir(), "banana-ocr-"));
  try {
    const paths: string[] = [];
    for (const [index, image] of images.entries()) {
      const path = join(
        directory,
        `image-${index + 1}.${extensions[image.mimeType]}`,
      );
      await writeFile(path, image.data, { mode: 0o600, flag: "wx" });
      paths.push(path);
    }
    let stdout: string;
    try {
      ({ stdout } = await execute(
        config.ocrPython,
        ["-m", "app.services.ocr_cli", ...paths],
        {
          cwd: join(process.cwd(), "vision-service"),
          timeout: config.ocrTimeoutMs,
          killSignal: "SIGKILL",
          maxBuffer: 4 * 1024 * 1024,
          encoding: "utf8",
          env: {
            ...process.env,
            DISABLE_MODEL_SOURCE_CHECK: "True",
            PYTHONDONTWRITEBYTECODE: "1",
          },
        },
      ));
    } catch (error) {
      throw processFailure(error);
    }
    try {
      const evidence = ocrEvidenceSchema.parse(JSON.parse(stdout));
      if (
        evidence.images.length !== images.length ||
        evidence.images.some(
          (image, index) => image.source_image_index !== index + 1,
        )
      )
        throw new Error("OCR image order does not match the request.");
      adaptEvidence({ imageCount: images.length, ocr: evidence });
      return evidence;
    } catch {
      throw new AppError(
        "OCR_INVALID_RESPONSE",
        "Local PaddleOCR returned invalid or ungrounded evidence.",
        502,
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
