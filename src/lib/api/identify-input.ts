import "server-only";
import { demoScenarioSchema } from "@/schemas/api";
import { parseInput, readBoundedBody } from "./http";
import { AppError } from "@/lib/errors";
import {
  IMAGE_TYPES,
  MAX_TOTAL_IMAGE_BYTES,
  imageSignatureMatches,
  validateImageFiles,
} from "@/lib/upload";
import type { ImageInput } from "@/lib/providers/interfaces";
export async function readIdentifyInput(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.startsWith("multipart/form-data"))
    throw new AppError(
      "INVALID_REQUEST",
      "Upload images as multipart form data.",
      400,
    );
  const body = await readBoundedBody(
    request,
    MAX_TOTAL_IMAGE_BYTES + 64 * 1024,
  );
  let form: FormData;
  try {
    form = await new Response(body, {
      headers: { "Content-Type": contentType },
    }).formData();
  } catch {
    throw new AppError("INVALID_REQUEST", "Malformed image upload.", 400);
  }
  const entries = form.getAll("images");
  if (entries.some((entry) => typeof entry === "string"))
    throw new AppError("INVALID_REQUEST", "Expected image files.", 400);
  const files = entries as File[];
  const error = validateImageFiles(files);
  if (error) throw new AppError("INVALID_IMAGES", error, 400);
  const images: ImageInput[] = [];
  for (const file of files) {
    const data = new Uint8Array(await file.arrayBuffer());
    if (!imageSignatureMatches(file.type, data))
      throw new AppError(
        "INVALID_IMAGES",
        "An image does not match its declared file type.",
        400,
      );
    images.push({ mimeType: file.type as (typeof IMAGE_TYPES)[number], data });
  }
  return {
    images,
    scenario: parseInput(
      demoScenarioSchema,
      form.get("scenario") ?? "confirmed",
    ),
  };
}
