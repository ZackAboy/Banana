import "server-only";
import sharp from "sharp";
import type { ImageInput } from "@/lib/providers/interfaces";
import { imageSignatureMatches, MAX_IMAGE_BYTES } from "@/lib/upload";
import { ProviderError } from "./provider";

export const LENS_MAX_BYTES = 500_000;

/** Bounded decode, orientation, metadata removal and compression; no disk/hosting. */
export async function prepareLensImage(image: ImageInput): Promise<Uint8Array> {
  try {
    if (
      !image.data.length ||
      image.data.length > MAX_IMAGE_BYTES ||
      !imageSignatureMatches(image.mimeType, image.data)
    )
      throw new Error("Invalid image");
    const decoder = sharp(image.data, {
      limitInputPixels: 40_000_000,
      animated: false,
    });
    const metadata = await decoder.metadata();
    if ((metadata.pages ?? 1) !== 1) throw new Error("Static image required");
    for (const [width, quality] of [
      [1600, 85],
      [1200, 70],
      [800, 55],
    ]) {
      const bytes = await decoder
        .clone()
        .rotate()
        .resize({
          width,
          height: width,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality })
        .timeout({ seconds: 3 })
        .toBuffer();
      if (bytes.length <= LENS_MAX_BYTES) return bytes;
    }
  } catch {
    // Decoder diagnostics can contain private input details.
  }
  throw new ProviderError("INVALID_RESPONSE");
}
