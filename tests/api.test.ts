import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as identify } from "@/app/api/identify/route";
import { POST as verify } from "@/app/api/products/verify/route";
import { GET as prices } from "@/app/api/prices/route";
import { GET as reviews } from "@/app/api/reviews/route";
import {
  identifyResponseSchema,
  pricesResponseSchema,
  reviewsResponseSchema,
} from "@/schemas/api";
import { demoIdentification } from "@/lib/mock/fixtures";
import { getConfig } from "@/lib/config/env";
import { MAX_TOTAL_IMAGE_BYTES } from "@/lib/upload";
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);
function upload(scenario = "confirmed", count = 1, data = png) {
  const form = new FormData();
  form.set("scenario", scenario);
  for (let i = 0; i < count; i++)
    form.append(
      "images",
      new File([data], `image${i}.png`, { type: "image/png" }),
    );
  return new Request("http://localhost/api/identify", {
    method: "POST",
    body: form,
  });
}
const query = new URLSearchParams({
  brand: "LG",
  productName: "UltraGear 27GP850-B",
  modelNumber: "27GP850-B",
  variant: "27-inch · QHD · 165 Hz",
});
beforeEach(() => vi.stubEnv("USE_MOCK_SERVICES", "true"));
afterEach(() => vi.unstubAllEnvs());
describe("API demo integration", () => {
  it("runs confirmed identification, prices and review recommendation with explicit mock metadata", async () => {
    const response = await identify(upload());
    expect(response.status).toBe(200);
    const id = identifyResponseSchema.parse(await response.json());
    expect(id.identification.identificationStatus).toBe("confirmed");
    expect(id.meta.mode).toBe("mock");
    const [p, r] = await Promise.all([
      prices(new Request(`http://localhost/api/prices?${query}`)),
      reviews(new Request(`http://localhost/api/reviews?${query}`)),
    ]);
    expect(pricesResponseSchema.parse(await p.json()).offers.length).toBe(3);
    expect(
      reviewsResponseSchema.parse(await r.json()).insights.recommendation,
    ).toMatch(/Example/);
  });
  it("requests a model label then confirms with two images", async () => {
    const first = await (await identify(upload("follow-up"))).json();
    expect(first.identification.identificationStatus).toBe("likely");
    expect(first.identification.modelNumber).toBeNull();
    expect(first.identification.suggestedNextImage).toMatch(/label/);
    const second = await (await identify(upload("follow-up", 2))).json();
    expect(second.identification.modelNumber).toBe("27GP850-B");
  });
  it("verifies a known selected candidate and rejects unknown candidates", async () => {
    const body = {
      identification: demoIdentification(false),
      candidateId: "lg-27gp850-b",
    };
    const request = (candidateId: string) =>
      new Request("http://localhost/api/products/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, candidateId }),
      });
    expect((await verify(request(body.candidateId))).status).toBe(200);
    expect((await verify(request("unknown"))).status).toBe(400);
  });
  it("rejects malformed requests, spoofed files and excess bodies", async () => {
    expect(
      (
        await identify(
          new Request("http://localhost/api/identify", {
            method: "POST",
            body: "bad",
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await identify(
          upload("confirmed", 1, new TextEncoder().encode("forged")),
        )
      ).status,
    ).toBe(400);
    expect((await identify(upload("confirmed", 0))).status).toBe(400);
    const req = new Request("http://localhost/api/identify", {
      method: "POST",
      headers: {
        "Content-Type": "multipart/form-data; boundary=x",
        "Content-Length": String(MAX_TOTAL_IMAGE_BYTES * 2),
      },
      body: "x",
    });
    expect((await identify(req)).status).toBe(413);
    expect(
      (await prices(new Request("http://localhost/api/prices"))).status,
    ).toBe(400);
  });
  it("does not serve demo offers for an arbitrary product", async () => {
    const other = new URLSearchParams(query);
    other.set("modelNumber", "another-model");
    expect(
      (await prices(new Request(`http://localhost/api/prices?${other}`)))
        .status,
    ).toBe(404);
  });
  it("keeps live failures explicit instead of returning mock data", async () => {
    vi.stubEnv("USE_MOCK_SERVICES", "false");
    for (const key of [
      "GEMINI_API_KEY",
      "SERPAPI_API_KEY",
      "GEMINI_VISION_MODEL",
      "GEMINI_TEXT_MODEL",
    ])
      vi.stubEnv(key, "test-placeholder");
    for (const response of [
      await prices(new Request(`http://localhost/api/prices?${query}`)),
      await reviews(new Request(`http://localhost/api/reviews?${query}`)),
    ]) {
      expect(response.status).toBe(501);
      expect((await response.json()).error.code).toBe(
        "PROVIDER_NOT_IMPLEMENTED",
      );
    }
  });
  it("validates explicit configuration without leaking credentials", () => {
    expect(getConfig({}).mock).toBe(true);
    expect(getConfig({ USE_MOCK_SERVICES: "false" }).identificationMode).toBe(
      "evidence",
    );
    expect(() => getConfig({ USE_MOCK_SERVICES: "yes" })).toThrow(
      /true or false/,
    );
    expect(() =>
      getConfig({
        USE_MOCK_SERVICES: "false",
        IDENTIFICATION_MODE: "gemini",
        GEMINI_API_KEY: "secret",
      }),
    ).toThrow(/requires/);
  });
});
