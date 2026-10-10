import "server-only";
import { z } from "zod";
import { AppError } from "@/lib/errors";
const envSchema = z.object({
  USE_MOCK_SERVICES: z.enum(["true", "false"]).default("true"),
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
      "USE_MOCK_SERVICES must be true or false.",
      503,
    );
  const values = parsed.data;
  const mock = values.USE_MOCK_SERVICES === "true";
  if (!mock && (!values.GEMINI_API_KEY || !values.GEMINI_VISION_MODEL)) {
    throw new AppError(
      "CONFIGURATION_ERROR",
      "Live identification requires GEMINI_API_KEY and GEMINI_VISION_MODEL on the server. Configure both or explicitly enable demo mode.",
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
