import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, FinishReason, GenerateContentResponse } from "@google/genai";
import { POST } from "@/app/api/identify/route";
import { liveIdentification } from "@/lib/ai/identification";
import {
  identificationJsonSchema,
  parseGeminiIdentification,
} from "@/lib/ai/identification-output";
import { getConfig } from "@/lib/config/env";
import { identifyResponseSchema } from "@/schemas/api";
import type { ImageInput } from "@/lib/providers/interfaces";
import type { ProductIdentification } from "@/types";
import { MAX_IMAGE_BYTES, MAX_IMAGES } from "@/lib/upload";
import { fuseEvidence } from "@/lib/identification/fusion";
import { semanticVisionEvidenceSchema } from "@/schemas/evidence";

const { generateContent, clientOptions } = vi.hoisted(() => ({
  generateContent: vi.fn(),
  clientOptions: vi.fn(),
}));
// Keep real SDK error/response types; replace the only network entry point.
vi.mock("@google/genai", async (importOriginal) => {
  const sdk = await importOriginal<typeof import("@google/genai")>();
  return {
    ...sdk,
    GoogleGenAI: vi.fn(function (options) {
      clientOptions(options);
      return { models: { generateContent } };
    }),
  };
});

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);
const images: ImageInput[] = [{ mimeType: "image/png", data: png }];
function modelOutput() {
  const identification: ProductIdentification = {
    brand: "Logitech",
    productName: "MX Master 3S",
    modelNumber: "MR0077",
    sku: null,
    variant: "Graphite",
    category: "Mouse",
    visibleText: ["Logitech", "Model: MR0077"],
    distinguishingFeatures: ["Thumb wheel", "Graphite housing"],
    identificationStatus: "confirmed",
    reasoning:
      "Observation: image 1 shows Model: MR0077 on the bottom label. Inference: this identifies the MX Master 3S; the housing is graphite.",
    suggestedNextImage: null,
    candidates: [],
  };
  return {
    identification,
    evidence: {
      familySupported: true,
      conflictingImages: false,
      exactMatch: [
        {
          imageIndex: 1,
          kind: "model_number",
          observation: "Model: MR0077",
          interpretation: "The readable model label distinguishes this model.",
        },
      ],
    },
  };
}
function upload(data = png, mimeType = "image/png", count = 1) {
  const form = new FormData();
  for (let i = 0; i < count; i++)
    form.append("images", new File([data], `photo-${i}`, { type: mimeType }));
  return new Request("http://localhost/api/identify", {
    method: "POST",
    body: form,
  });
}
function respond(output = modelOutput()) {
  generateContent.mockResolvedValue({
    text: JSON.stringify(output),
    candidates: [{ finishReason: FinishReason.STOP }],
  });
}
beforeEach(() => {
  generateContent.mockReset();
  clientOptions.mockClear();
  vi.stubEnv("USE_MOCK_SERVICES", "false");
  vi.stubEnv("IDENTIFICATION_MODE", "gemini");
  vi.stubEnv("GEMINI_API_KEY", "test-secret-never-log");
  vi.stubEnv("GEMINI_VISION_MODEL", "test-configured-vision-model");
  vi.stubEnv("SERPAPI_API_KEY", "");
  vi.stubEnv("GEMINI_TEXT_MODEL", "");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  respond();
});
afterEach(() => vi.unstubAllEnvs());

describe("Gemini structured identification parsing and evidence policy", () => {
  it("keeps CFI-ZCT2W likely pending independent manufacturer-label provenance", () => {
    const output = modelOutput();
    Object.assign(output.identification, {
      brand: "Sony",
      productName: "PlayStation 5 DualSense controller",
      modelNumber: "CFI-ZCT2W",
      variant: "White",
      category: "Controller",
      visibleText: ["Sony", "MODEL CFI-ZCT2W"],
      distinguishingFeatures: ["White controller housing"],
      identificationStatus: "likely",
      suggestedNextImage: "Photograph the manufacturer model/SKU label.",
    });
    output.evidence.exactMatch = [
      {
        imageIndex: 2,
        kind: "model_number",
        observation: "MODEL CFI-ZCT2W",
        interpretation:
          "Gemini reports the rear-label model matches the controller.",
      },
    ];
    const result = parseGeminiIdentification(JSON.stringify(output), 2);
    expect(result.modelNumber).toBe("CFI-ZCT2W");
    expect(result.identificationStatus).toBe("likely");
    // Known limitation, not the desired final rule: see ARCHITECTURE.md.
    output.evidence.conflictingImages = true;
    expect(
      parseGeminiIdentification(JSON.stringify(output), 2).identificationStatus,
    ).toBe("uncertain");
  });
  it("adjudicates semantic evidence without mutating the provider proposal", () => {
    const { identification, evidence } = modelOutput();
    evidence.exactMatch = [];
    expect(
      fuseEvidence({
        source: "gemini",
        identification,
        evidence: semanticVisionEvidenceSchema.parse(evidence),
      }).identificationStatus,
    ).toBe("likely");
    expect(identification.identificationStatus).toBe("confirmed");
    expect(identification.suggestedNextImage).toBeNull();
  });
  it("parses a confirmed readable model label into the existing domain type", () => {
    expect(parseGeminiIdentification(JSON.stringify(modelOutput()), 1)).toEqual(
      modelOutput().identification,
    );
  });
  it("preserves likely identity and a tailored next photograph", () => {
    const output = modelOutput();
    output.identification.identificationStatus = "likely";
    output.identification.modelNumber = null;
    output.identification.suggestedNextImage =
      "Photograph the bottom model label in focus.";
    output.evidence.exactMatch = [];
    const result = parseGeminiIdentification(JSON.stringify(output), 1);
    expect(result.identificationStatus).toBe("likely");
    expect(result.modelNumber).toBeNull();
    expect(result.suggestedNextImage).toBe(
      output.identification.suggestedNextImage,
    );
  });
  it("preserves uncertainty and supplies a missing next photograph", () => {
    const output = modelOutput();
    output.identification.identificationStatus = "uncertain";
    output.identification.modelNumber = null;
    output.evidence.exactMatch = [];
    output.evidence.familySupported = false;
    const result = parseGeminiIdentification(JSON.stringify(output), 1);
    expect(result.identificationStatus).toBe("uncertain");
    expect(result.suggestedNextImage).toMatch(
      /model\/SKU label.*back or bottom/,
    );
  });
  it("downgrades unsupported confirmation without treating numeric confidence as evidence", () => {
    const output = { ...modelOutput(), confidence: 0.9999 };
    output.evidence.exactMatch = [];
    const result = parseGeminiIdentification(JSON.stringify(output), 1);
    expect(result.identificationStatus).toBe("likely");
    expect(result.reasoning).toMatch(/tentative/);
    expect(result.suggestedNextImage).toMatch(/label/);
    expect(result).not.toHaveProperty("confidence");
  });
  it("requires an exact identifier in faithfully transcribed text", () => {
    const output = modelOutput();
    output.identification.modelNumber = "MR007";
    expect(
      parseGeminiIdentification(JSON.stringify(output), 1).identificationStatus,
    ).toBe("likely");
    output.identification.modelNumber = "MR0077";
    output.identification.visibleText = ["Logitech"];
    expect(
      parseGeminiIdentification(JSON.stringify(output), 1).identificationStatus,
    ).toBe("likely");
  });
  it("does not confirm a model prefix when the visible label includes a variant suffix", () => {
    const output = modelOutput();
    output.identification.modelNumber = "27GP850";
    output.identification.visibleText = ["Model: 27GP850-B"];
    output.evidence.exactMatch[0].observation = "Model: 27GP850-B";
    expect(
      parseGeminiIdentification(JSON.stringify(output), 1).identificationStatus,
    ).toBe("likely");
  });
  it.each(["sku", "unique_label", "packaging"])(
    "accepts exact %s evidence",
    (kind) => {
      const output = modelOutput();
      output.evidence.exactMatch[0].kind = kind;
      if (kind === "sku") output.identification.sku = "MR0077";
      expect(
        parseGeminiIdentification(JSON.stringify(output), 1)
          .identificationStatus,
      ).toBe("confirmed");
    },
  );
  it("allows independent exact-model visual clues but rejects duplicated clues", () => {
    const output = modelOutput();
    output.evidence.exactMatch =
      output.identification.distinguishingFeatures.map((observation) => ({
        imageIndex: 1,
        kind: "visual_feature",
        observation,
        interpretation:
          "Test model assessment: this clue excludes a similar model.",
      }));
    expect(
      parseGeminiIdentification(JSON.stringify(output), 1).identificationStatus,
    ).toBe("confirmed");
    output.evidence.exactMatch[1] = output.evidence.exactMatch[0];
    expect(
      parseGeminiIdentification(JSON.stringify(output), 1).identificationStatus,
    ).toBe("likely");
  });
  it("does not upgrade a cautious model status even with matching text", () => {
    const output = modelOutput();
    output.identification.identificationStatus = "uncertain";
    expect(
      parseGeminiIdentification(JSON.stringify(output), 1).identificationStatus,
    ).toBe("uncertain");
  });
  it("requires family evidence for likely and treats conflicting images as uncertain", () => {
    const output = modelOutput();
    output.evidence.conflictingImages = true;
    expect(
      parseGeminiIdentification(JSON.stringify(output), 2).identificationStatus,
    ).toBe("uncertain");
    output.evidence.conflictingImages = false;
    output.evidence.familySupported = false;
    output.identification.identificationStatus = "likely";
    expect(
      parseGeminiIdentification(JSON.stringify(output), 1).identificationStatus,
    ).toBe("uncertain");
  });
  it.each(["", "```json\n{}\n```", "{", "null", "{}", "[]"])(
    "rejects malformed or incomplete model output: %s",
    (text) => {
      expect(() => parseGeminiIdentification(text, 1)).toThrow(
        /valid product identification/,
      );
    },
  );
  it("enforces shared schema refinements and evidence image references", () => {
    const output = modelOutput();
    output.identification.productName = null;
    expect(() =>
      parseGeminiIdentification(JSON.stringify(output), 1),
    ).toThrow();
    output.identification.productName = "MX Master 3S";
    output.evidence.exactMatch[0].imageIndex = 2;
    expect(() =>
      parseGeminiIdentification(JSON.stringify(output), 1),
    ).toThrow();
  });
  it("rejects invalid field types, statuses, and invented retrieved candidates", () => {
    for (const fields of [
      { modelNumber: 77 },
      { identificationStatus: "certain" },
      { candidates: [{ id: "invented", sourceUrl: "https://example.com" }] },
    ]) {
      const output = modelOutput();
      expect(() =>
        parseGeminiIdentification(
          JSON.stringify({
            ...output,
            identification: { ...output.identification, ...fields },
          }),
          1,
        ),
      ).toThrow(/valid product identification/);
    }
  });
});

describe("Gemini provider and existing identification endpoint", () => {
  it("sends all four image views in a single configured structured-output request", async () => {
    const views: ImageInput[] = [
      ...images,
      { mimeType: "image/jpeg", data: new Uint8Array([255, 216, 255]) },
      {
        mimeType: "image/webp",
        data: new TextEncoder().encode("RIFF1234WEBP"),
      },
      ...images,
    ];
    const output = modelOutput();
    output.evidence.exactMatch[0].imageIndex = 2;
    respond(output);
    const result = await liveIdentification.identify(views, "follow-up");
    expect(result.identificationStatus).toBe("confirmed");
    expect(generateContent).toHaveBeenCalledOnce();
    const request = generateContent.mock.calls[0][0];
    expect(request.model).toBe("test-configured-vision-model");
    expect(request.config.responseMimeType).toBe("application/json");
    expect(request.config.responseJsonSchema).toEqual(identificationJsonSchema);
    expect(request.config.systemInstruction).toContain(
      "ALL supplied images together",
    );
    expect(request.contents).toHaveLength(1);
    expect(
      request.contents[0].parts.filter(
        (part: { inlineData?: unknown }) => part.inlineData,
      ),
    ).toEqual(
      views.map((view) => ({
        inlineData: {
          mimeType: view.mimeType,
          data: Buffer.from(view.data).toString("base64"),
        },
      })),
    );
    expect(clientOptions).toHaveBeenCalledWith({
      apiKey: "test-secret-never-log",
      httpOptions: { timeout: 60_000, retryOptions: { attempts: 1 } },
    });
  });
  it("returns the unchanged identify envelope with live metadata", async () => {
    const response = await POST(upload());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = identifyResponseSchema.parse(await response.json());
    expect(body.meta).toEqual({ mode: "live", notice: null });
    expect(body.identification).toEqual(modelOutput().identification);
    expect(body).not.toHaveProperty("evidence");
  });
  it("parses JSON text through the real SDK response accessor", async () => {
    const response = new GenerateContentResponse();
    response.candidates = [
      {
        finishReason: FinishReason.STOP,
        content: {
          role: "model",
          parts: [{ text: JSON.stringify(modelOutput()) }],
        },
      },
    ];
    generateContent.mockResolvedValue(response);
    const result = await POST(upload());
    expect(result.status).toBe(200);
    expect((await result.json()).identification).toEqual(
      modelOutput().identification,
    );
  });
  it("combines front and rear images through the endpoint", async () => {
    const output = modelOutput();
    output.evidence.exactMatch[0].imageIndex = 2;
    respond(output);
    const response = await POST(upload(png, "image/png", 2));
    expect(response.status).toBe(200);
    expect(generateContent).toHaveBeenCalledOnce();
    expect((await response.json()).identification.modelNumber).toBe("MR0077");
  });
  it.each(["GEMINI_API_KEY", "GEMINI_VISION_MODEL"])(
    "reports missing %s without contacting Gemini",
    async (name) => {
      vi.stubEnv(name, "  ");
      const response = await POST(upload());
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: {
          code: "CONFIGURATION_ERROR",
          message: expect.stringContaining(name),
        },
      });
      expect(generateContent).not.toHaveBeenCalled();
    },
  );
  it("requires only Gemini vision settings and keeps configuration server-only", () => {
    const config = getConfig({
      USE_MOCK_SERVICES: "false",
      GEMINI_API_KEY: " key ",
      GEMINI_VISION_MODEL: " model ",
    });
    expect(config.geminiApiKey).toBe("key");
    expect(config.visionModel).toBe("model");
    expect(config.serpApiKey).toBeUndefined();
    expect(getConfig({}).mock).toBe(true);
  });
  it.each([
    [429, "GEMINI_RATE_LIMITED", 429],
    [500, "GEMINI_REQUEST_FAILED", 502],
    [400, "GEMINI_REQUEST_FAILED", 502],
    [401, "CONFIGURATION_ERROR", 503],
    [403, "CONFIGURATION_ERROR", 503],
    [404, "CONFIGURATION_ERROR", 503],
  ])(
    "sanitizes SDK failure %s and never falls back",
    async (status, code, expectedStatus) => {
      generateContent.mockRejectedValue(
        new ApiError({
          status: Number(status),
          message: "private provider details test-secret-never-log",
        }),
      );
      const response = await POST(upload());
      expect(response.status).toBe(expectedStatus);
      const body = await response.json();
      expect(body.error.code).toBe(code);
      expect(JSON.stringify(body)).not.toMatch(/private provider|test-secret/);
      expect(body).not.toHaveProperty("identification");
      expect(console.warn).toHaveBeenCalledWith(
        "Gemini identification failed",
        { code },
      );
    },
  );
  it("sanitizes transport failures", async () => {
    generateContent.mockRejectedValue(new Error("secret network detail"));
    const response = await POST(upload());
    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe("GEMINI_REQUEST_FAILED");
  });
  it.each([
    { text: "not JSON", candidates: [{ finishReason: FinishReason.STOP }] },
    { text: "{}", candidates: [{ finishReason: FinishReason.STOP }] },
    { text: "", candidates: [{ finishReason: FinishReason.STOP }] },
    {
      text: JSON.stringify(modelOutput()),
      candidates: [{ finishReason: FinishReason.MAX_TOKENS }],
    },
    {
      text: JSON.stringify(modelOutput()),
      candidates: [{ finishReason: FinishReason.SAFETY }],
    },
    { text: JSON.stringify(modelOutput()), candidates: [] },
    { promptFeedback: { blockReason: "SAFETY" } },
  ])(
    "safely rejects malformed, truncated, blocked, or schema-invalid responses %#",
    async (result) => {
      generateContent.mockResolvedValue(result);
      const response = await POST(upload());
      expect(response.status).toBe(502);
      expect((await response.json()).error.code).toBe(
        "GEMINI_INVALID_RESPONSE",
      );
    },
  );
  it("rejects invalid, unsupported, oversized, and excess images before SDK calls", async () => {
    for (const request of [
      upload(new Uint8Array(), "image/png"),
      upload(new TextEncoder().encode("forged")),
      upload(png, "image/svg+xml"),
      upload(new Uint8Array(MAX_IMAGE_BYTES + 1)),
      upload(png, "image/png", MAX_IMAGES + 1),
      upload(png, "image/png", 0),
    ]) {
      const response = await POST(request);
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe("INVALID_IMAGES");
    }
    expect(generateContent).not.toHaveBeenCalled();
  });
  it("keeps mock identification functional with no keys or network calls", async () => {
    vi.stubEnv("USE_MOCK_SERVICES", "true");
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GEMINI_VISION_MODEL", "");
    const response = await POST(upload());
    expect(response.status).toBe(200);
    const body = identifyResponseSchema.parse(await response.json());
    expect(body.meta.mode).toBe("mock");
    expect(body.identification.modelNumber).toBe("27GP850-B");
    expect(generateContent).not.toHaveBeenCalled();
    expect(clientOptions).not.toHaveBeenCalled();
  });
});
