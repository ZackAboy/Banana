import "server-only";
import { ApiError, FinishReason } from "@google/genai";
import type { IdentificationProvider } from "@/lib/providers/interfaces";
import { AppError } from "@/lib/errors";
import { getConfig } from "@/lib/config/env";
import { createGeminiClient } from "./client";
import { identificationInstruction } from "./identification-prompt";
import {
  identificationJsonSchema,
  invalidGeminiResponse,
  parseGeminiIdentification,
} from "./identification-output";

function requestError(error: unknown) {
  if (error instanceof ApiError && error.status === 429)
    return new AppError(
      "GEMINI_RATE_LIMITED",
      "Gemini is rate limited or its quota is exhausted. Please try again later.",
      429,
    );
  if (error instanceof ApiError && [401, 403, 404].includes(error.status))
    return new AppError(
      "CONFIGURATION_ERROR",
      "Gemini access is unavailable. Check the server API key, GEMINI_VISION_MODEL, and model permissions.",
      503,
    );
  return new AppError(
    "GEMINI_REQUEST_FAILED",
    "Gemini could not analyze these images. Please try again with clear, valid product photos. If this continues, check the server model configuration.",
    502,
  );
}

export const liveIdentification: IdentificationProvider = {
  async identify(images) {
    const config = getConfig();
    if (!config.visionModel)
      throw new AppError(
        "CONFIGURATION_ERROR",
        "GEMINI_VISION_MODEL is not configured on the server.",
        503,
      );
    const client = createGeminiClient(config);
    let response;
    try {
      response = await client.models.generateContent({
        model: config.visionModel,
        contents: [
          {
            role: "user",
            parts: [
              { text: "Identify the product using all these views together." },
              ...images.flatMap((image, index) => [
                { text: `Image ${index + 1}` },
                {
                  inlineData: {
                    mimeType: image.mimeType,
                    data: Buffer.from(image.data).toString("base64"),
                  },
                },
              ]),
            ],
          },
        ],
        config: {
          systemInstruction: identificationInstruction,
          responseMimeType: "application/json",
          responseJsonSchema: identificationJsonSchema,
          candidateCount: 1,
        },
      });
    } catch (error) {
      const safeError = requestError(error);
      console.warn("Gemini identification failed", { code: safeError.code });
      throw safeError;
    }
    try {
      if (
        response.promptFeedback?.blockReason ||
        response.candidates?.[0]?.finishReason !== FinishReason.STOP ||
        !response.text
      )
        return invalidGeminiResponse();
      return parseGeminiIdentification(response.text, images.length);
    } catch (error) {
      console.warn("Gemini identification failed", {
        code: "GEMINI_INVALID_RESPONSE",
      });
      if (error instanceof AppError) throw error;
      return invalidGeminiResponse();
    }
  },
};
