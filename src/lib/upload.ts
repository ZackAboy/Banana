export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_IMAGES = 4;
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
export const MAX_TOTAL_IMAGE_BYTES = 4 * 1024 * 1024;
export function validateImageFiles(
  files: Pick<File, "type" | "size">[],
): string | null {
  if (!files.length) return "Choose at least one image.";
  if (files.length > MAX_IMAGES)
    return `Use up to ${MAX_IMAGES} images per product.`;
  for (const file of files) {
    if (!(IMAGE_TYPES as readonly string[]).includes(file.type))
      return "Use JPEG, PNG, or WebP images.";
    if (!file.size) return "One of the images is empty.";
    if (file.size > MAX_IMAGE_BYTES)
      return "Each image must be 3 MB or smaller.";
  }
  if (files.reduce((sum, f) => sum + f.size, 0) > MAX_TOTAL_IMAGE_BYTES)
    return "Keep all images together under 4 MB. Try a smaller photo.";
  return null;
}
export function imageSignatureMatches(
  type: string,
  bytes: Uint8Array,
): boolean {
  if (type === "image/jpeg")
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/png")
    return [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b);
  if (type === "image/webp")
    return (
      String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
    );
  return false;
}
