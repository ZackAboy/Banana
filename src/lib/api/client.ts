import { z } from "zod";
import { apiErrorSchema } from "@/schemas/api";
export async function fetchApi<T>(
  url: string,
  schema: z.ZodType<T>,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error(
      "The server returned an unreadable response. Please try again.",
    );
  }
  if (!response.ok) {
    const error = apiErrorSchema.safeParse(data);
    throw new Error(
      error.success
        ? error.data.error.message
        : "This request failed. Please try again.",
    );
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success)
    throw new Error("The server response did not match the expected format.");
  return parsed.data;
}
