import "server-only";
import { z } from "zod";
import { AppError } from "@/lib/errors";
const envSchema = z.object({
  USE_MOCK_SERVICES: z.enum(["true", "false"]).default("true"),
  GEMINI_API_KEY: z.string().optional(),
  SERPAPI_API_KEY: z.string().optional(),
  GEMINI_VISION_MODEL: z.string().optional(),
  GEMINI_TEXT_MODEL: z.string().optional(),
});
export function getConfig(
  env: Record<string, string | undefined> = process.env,
) {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success)
    throw new AppError(
      "CONFIGURATION_ERROR",
      "USE_MOCK_SERVICES must be true or false.",
      503,
    );
  const values = parsed.data;
  const mock = values.USE_MOCK_SERVICES === "true";
  if (
    !mock &&
    [
      values.GEMINI_API_KEY,
      values.SERPAPI_API_KEY,
      values.GEMINI_VISION_MODEL,
      values.GEMINI_TEXT_MODEL,
    ].some((v) => !v?.trim())
  ) {
    throw new AppError(
      "CONFIGURATION_ERROR",
      "Live mode requires server API keys and both Gemini model settings. Configure the server or explicitly enable demo mode.",
      503,
    );
  }
  return {
    mock,
    geminiApiKey: values.GEMINI_API_KEY,
    serpApiKey: values.SERPAPI_API_KEY,
    visionModel: values.GEMINI_VISION_MODEL,
    textModel: values.GEMINI_TEXT_MODEL,
  };
}
