import "server-only";
import { GoogleGenAI } from "@google/genai";
import { getConfig } from "@/lib/config/env";
import { AppError } from "@/lib/errors";
export function createGeminiClient(config = getConfig()) {
  if (!config.geminiApiKey)
    throw new AppError(
      "CONFIGURATION_ERROR",
      "GEMINI_API_KEY is not configured on the server.",
      503,
    );
  return new GoogleGenAI({
    apiKey: config.geminiApiKey,
    httpOptions: { timeout: 60_000, retryOptions: { attempts: 1 } },
  });
}
