import "server-only";
import { GoogleGenAI } from "@google/genai";
import { getConfig } from "@/lib/config/env";
import { AppError } from "@/lib/errors";
export function createGeminiClient() {
  const config = getConfig();
  if (!config.geminiApiKey)
    throw new AppError(
      "CONFIGURATION_ERROR",
      "Gemini credentials are not configured.",
      503,
    );
  return new GoogleGenAI({ apiKey: config.geminiApiKey });
}
