import { describe, expect, it } from "vitest";
import {
  validateImageFiles,
  imageSignatureMatches,
  MAX_IMAGE_BYTES,
} from "@/lib/upload";
describe("upload validation", () => {
  const image = { type: "image/png", size: 100 };
  it("accepts multiple supported images", () =>
    expect(
      validateImageFiles([image, { ...image, type: "image/webp" }]),
    ).toBeNull());
  it("rejects empty, unsupported, oversized and too many images", () => {
    for (const files of [
      [],
      [{ ...image, size: 0 }],
      [{ ...image, type: "image/svg+xml" }],
      [{ ...image, size: MAX_IMAGE_BYTES + 1 }],
      Array(5).fill(image),
    ])
      expect(validateImageFiles(files)).not.toBeNull();
  });
  it("enforces the aggregate serverless upload limit", () =>
    expect(
      validateImageFiles([
        { ...image, size: MAX_IMAGE_BYTES },
        { ...image, size: MAX_IMAGE_BYTES },
      ]),
    ).toMatch(/together/));
  it("checks JPEG, PNG and WebP signatures and rejects forged MIME types", () => {
    expect(
      imageSignatureMatches("image/jpeg", new Uint8Array([255, 216, 255])),
    ).toBe(true);
    expect(
      imageSignatureMatches(
        "image/png",
        new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      ),
    ).toBe(true);
    expect(
      imageSignatureMatches(
        "image/webp",
        new TextEncoder().encode("RIFF1234WEBP"),
      ),
    ).toBe(true);
    expect(
      imageSignatureMatches("image/png", new TextEncoder().encode("not a png")),
    ).toBe(false);
  });
});
