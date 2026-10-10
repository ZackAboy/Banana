import "server-only";
import { z } from "zod";
import { AppError } from "@/lib/errors";
const envSchema = z.object({
  USE_MOCK_SERVICES: z.enum(["true", "false"]).default("true"),
  IDENTIFICATION_MODE: z.enum(["evidence", "gemini"]).default("evidence"),
  OCR_PYTHON: z.string().trim().optional(),
  OCR_TIMEOUT_MS: z.coerce.number().int().min(1000).max(180000).default(60000),
  GEMINI_API_KEY: z.string().trim().optional(),
  SERPAPI_API_KEY: z.string().trim().optional(),
  GEMINI_VISION_MODEL: z.string().trim().optional(),
  GEMINI_TEXT_MODEL: z.string().trim().optional(),
});
export function getConfig(
  env: Record<string, string | undefined> = process.env,
) {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success)
    throw new AppError(
      "CONFIGURATION_ERROR",
      "Invalid server configuration: USE_MOCK_SERVICES must be true or false; IDENTIFICATION_MODE must be evidence or gemini; OCR_TIMEOUT_MS must be 1000–180000.",
      503,
    );
  const values = parsed.data;
  const mock = values.USE_MOCK_SERVICES === "true";
  if (
    !mock &&
    values.IDENTIFICATION_MODE === "gemini" &&
    (!values.GEMINI_API_KEY || !values.GEMINI_VISION_MODEL)
  ) {
    throw new AppError(
      "CONFIGURATION_ERROR",
      "Live identification requires GEMINI_API_KEY and GEMINI_VISION_MODEL on the server. Configure both or explicitly enable demo mode.",
      503,
    );
  }
  return {
    mock,
    identificationMode: values.IDENTIFICATION_MODE,
    ocrPython: values.OCR_PYTHON,
    ocrTimeoutMs: values.OCR_TIMEOUT_MS,
    geminiApiKey: values.GEMINI_API_KEY,
    serpApiKey: values.SERPAPI_API_KEY,
    visionModel: values.GEMINI_VISION_MODEL,
    textModel: values.GEMINI_TEXT_MODEL,
  };
}
