import "server-only";
import { z } from "zod";
import { AppError } from "@/lib/errors";
export function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
export async function handle(operation: () => Promise<unknown>) {
  try {
    return json(await operation());
  } catch (error) {
    if (error instanceof AppError)
      return json(
        { error: { code: error.code, message: error.message } },
        error.status,
      );
    return json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "This request could not be completed. Please try again.",
        },
      },
      500,
    );
  }
}
export function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new AppError(
      "INVALID_REQUEST",
      result.error.issues[0]?.message ?? "Invalid request.",
      400,
    );
  return result.data;
}
export async function readBoundedBody(
  request: Request,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  if (Number(request.headers.get("content-length")) > maxBytes)
    throw new AppError(
      "PAYLOAD_TOO_LARGE",
      "Request exceeds the upload limit.",
      413,
    );
  if (!request.body)
    throw new AppError("INVALID_REQUEST", "Request body is required.", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new AppError(
          "PAYLOAD_TOO_LARGE",
          "Request exceeds the upload limit.",
          413,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
export async function readJson(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new AppError("INVALID_REQUEST", "Expected JSON.", 400);
  const body = await readBoundedBody(request, 64 * 1024);
  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new AppError("INVALID_REQUEST", "Malformed JSON.", 400);
  }
}
