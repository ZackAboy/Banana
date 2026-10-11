import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { createSerpApiProviders } from "@/lib/search/product-search/serpapi";
import { createRateLimiter } from "@/lib/search/product-search/provider";
import {
  prepareLensImage,
  LENS_MAX_BYTES,
} from "@/lib/search/product-search/lens-image";
import { runProductSearch } from "@/lib/search/product-search";
import { fuseProductEvidence } from "@/lib/identification/fusion";
import type { ImageInput } from "@/lib/providers/interfaces";

const smallImage = async (background = "red"): Promise<ImageInput> => ({
  mimeType: "image/png",
  data: await sharp({
    create: { width: 3, height: 2, channels: 3, background },
  })
    .png()
    .toBuffer(),
});
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status });
beforeEach(() =>
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Unexpected network request");
    }),
  ),
);
afterEach(() => vi.unstubAllGlobals());

describe("direct uploaded Lens candidate discovery (mock HTTP)", () => {
  it("uploads immediately, searches with image_id and preserves useful rows around malformed data", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        calls.push(url.pathname);
        if (url.pathname === "/image") {
          expect(init?.method).toBe("POST");
          const form = init?.body as FormData;
          const image = form.get("image") as File;
          expect(image.type).toBe("image/jpeg");
          expect(image.size).toBeLessThanOrEqual(LENS_MAX_BYTES);
          expect(form.get("api_key")).toBe("fixture-secret");
          return response({ image_id: "temporary-private-id" });
        }
        expect(url.searchParams.get("engine")).toBe("google_lens");
        expect(url.searchParams.get("image_id")).toBe("temporary-private-id");
        expect(url.searchParams.has("url")).toBe(false);
        expect(url.searchParams.has("type")).toBe(false);
        return response({
          search_metadata: { status: "Success" },
          visual_matches: [
            null,
            { title: 123 },
            { title: "Bad URL", link: "javascript:alert(1)" },
            {
              title: "Luma Nourish Cream",
              link: "https://store.example/cream",
              thumbnail: "https://store.example/cream.jpg",
              source: "Store",
            },
          ],
        });
      },
    ) as typeof fetch;
    const providers = createSerpApiProviders({
      apiKey: "fixture-secret",
      fetch: fetchImpl,
      acquire: createRateLimiter(10, 3_600_000),
    }).filter((p) => p.kind === "visual");
    const result = await runProductSearch({}, providers, {
      images: [await smallImage()],
    });
    expect(calls).toEqual(["/image", "/search.json"]);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      title: "Luma Nourish Cream",
      imageUrls: ["https://store.example/cream.jpg"],
      observations: [{ kind: "visual", sourceImageIndex: 1 }],
    });
    expect(result.providerRuns[0]).toMatchObject({
      status: "ok",
      discardedRows: 3,
    });
    expect(
      result.providerRuns[0].requests.map((r) => [r.engine, r.status]),
    ).toEqual([
      ["image_upload", "ok"],
      ["google_lens", "ok"],
    ]);
    expect(JSON.stringify(result)).not.toMatch(
      /fixture-secret|temporary-private-id/,
    );
    expect(
      fuseProductEvidence({ imageCount: 1, search: result }).identity
        ?.modelNumber,
    ).toBeNull();
  });

  it("preserves original image indexes when one upload fails and another succeeds", async () => {
    const first = await smallImage();
    const firstBytes = Buffer.from(await prepareLensImage(first));
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === "/image") {
        const file = (init!.body as FormData).get("image") as File;
        return Buffer.from(await file.arrayBuffer()).equals(firstBytes)
          ? response({ error: "private upstream error with secret" }, 429)
          : response({ image_id: "second-image" });
      }
      return response({
        visual_matches: [
          { title: "Gentle Soap", link: "https://source.example/soap" },
        ],
      });
    }) as typeof fetch;
    const providers = createSerpApiProviders({
      apiKey: "fixture-secret",
      fetch: fetchImpl,
      acquire: createRateLimiter(10, 3_600_000),
    }).filter((p) => p.kind === "visual");
    const result = await runProductSearch({}, providers, {
      images: [first, await smallImage("blue")],
    });
    expect(result.providerRuns.map((r) => r.status)).toEqual(["error", "ok"]);
    expect(result.providerRuns[0].error?.code).toBe("RATE_LIMITED");
    expect(result.candidates[0].observations[0].sourceImageIndex).toBe(2);
    expect(
      fuseProductEvidence({ imageCount: 2, search: result }).provenance,
    ).toContainEqual(
      expect.objectContaining({
        source: "google_lens",
        imageIndexes: [2],
        sourceUrl: "https://source.example/soap",
      }),
    );
    expect(JSON.stringify(result)).not.toMatch(
      /private upstream|fixture-secret|second-image/,
    );
  });

  it("bounds upload and search under the shared request allowance", async () => {
    const fetchImpl = vi.fn(async () =>
      response({ image_id: "uploaded" }),
    ) as typeof fetch;
    const providers = createSerpApiProviders({
      apiKey: "test",
      fetch: fetchImpl,
      acquire: createRateLimiter(1, 3_600_000),
    }).filter((p) => p.kind === "visual");
    const result = await runProductSearch({}, providers, {
      images: [await smallImage()],
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(result.candidates).toEqual([]);
    expect(result.providerRuns[0]).toMatchObject({
      status: "partial",
      error: { code: "RATE_LIMITED" },
    });
  });

  it("missing credentials and invalid upload payloads never produce synthetic candidates", async () => {
    const image = await smallImage();
    for (const apiKey of [undefined, "test"]) {
      const fetchImpl = vi.fn(async () =>
        response({ error: "private error", image_id: "unsafe&secret=x" }),
      );
      const providers = createSerpApiProviders({
        apiKey,
        fetch: fetchImpl,
      }).filter((p) => p.kind === "visual");
      const result = await runProductSearch({}, providers, { images: [image] });
      expect(result.candidates).toEqual([]);
      expect(result.providerRuns[0].status).toBe("error");
      expect(JSON.stringify(result)).not.toMatch(/private error|unsafe&secret/);
      if (!apiKey) expect(fetchImpl).not.toHaveBeenCalled();
    }
  });

  it("an upload timeout is bounded and safely recorded", async () => {
    const fetchImpl = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new Error("private timeout")),
            { once: true },
          );
        }),
    ) as typeof fetch;
    const providers = createSerpApiProviders({
      apiKey: "test",
      fetch: fetchImpl,
    }).filter((p) => p.kind === "visual");
    const result = await runProductSearch({}, providers, {
      images: [await smallImage()],
      timeoutMs: 40,
    });
    expect(result.providerRuns[0].error?.code).toBe("TIMEOUT");
    expect(result.candidates).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("private timeout");
  });
});

describe("bounded Lens image preparation", () => {
  it("compresses a large valid image below provider size limits", async () => {
    const pixels = Buffer.alloc(800 * 800 * 3);
    let seed = 42;
    for (let i = 0; i < pixels.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      pixels[i] = seed >>> 24;
    }
    const data = await sharp(pixels, {
      raw: { width: 800, height: 800, channels: 3 },
    })
      .png()
      .toBuffer();
    expect(data.length).toBeGreaterThan(LENS_MAX_BYTES);
    const result = await prepareLensImage({ mimeType: "image/png", data });
    expect(result.length).toBeLessThanOrEqual(LENS_MAX_BYTES);
    expect((await sharp(result).metadata()).format).toBe("jpeg");
  });

  it("applies photo orientation and strips metadata", async () => {
    const image = await smallImage();
    const data = await sharp(image.data)
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const result = await prepareLensImage({ mimeType: "image/jpeg", data });
    expect(await sharp(result).metadata()).toMatchObject({
      width: 2,
      height: 3,
    });
    expect((await sharp(result).metadata()).exif).toBeUndefined();
  });

  it("rejects malformed image bytes without decoder detail leakage", async () => {
    await expect(
      prepareLensImage({
        mimeType: "image/png",
        data: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      }),
    ).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      message: "Provider returned an invalid response.",
    });
  });
});
