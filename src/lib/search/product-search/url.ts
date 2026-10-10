// Only well-known tracking keys are discarded. Variant/seller/path/protocol/
// fragment distinctions survive; a canonical URL is not proof of one offer.
const TRACKING = new Set([
  "gclid",
  "gclsrc",
  "dclid",
  "gbraid",
  "wbraid",
  "fbclid",
  "msclkid",
  "srsltid",
  "mc_cid",
  "mc_eid",
]);
const SENSITIVE =
  /api[_-]?key|token|secret|password|authorization|credential|signature|^x-amz-|^x-goog-/i;
export function normalizeHost(host: string): string {
  return host
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^www\d?\./, "");
}
export function hostOf(value: string): string {
  return normalizeHost(new URL(value).hostname);
}
export function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
/** Credential-bearing evidence URLs cannot safely be returned as source links. */
export function isEvidenceUrl(value: unknown): value is string {
  if (!isHttpUrl(value)) return false;
  const url = new URL(value);
  return (
    !url.username &&
    !url.password &&
    ![...url.searchParams.keys()].some((k) => SENSITIVE.test(k))
  );
}
export function canonicalizeUrl(input: string): string {
  const url = new URL(input.trim());
  const entries = [...url.searchParams.entries()].filter(
    ([key]) =>
      !TRACKING.has(key.toLowerCase()) && !key.toLowerCase().startsWith("utm_"),
  );
  entries.sort(
    ([ak, av], [bk, bv]) => ak.localeCompare(bk) || av.localeCompare(bv),
  );
  url.search = new URLSearchParams(entries).toString();
  return url.toString();
}
/** Safe Lens reference only; the full URL must never be echoed in results. */
export function imageReferenceUrl(value: string): string {
  const url = new URL(value);
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return url.toString();
}
export function isPublicImageUrl(value: string): boolean {
  if (!isHttpUrl(value)) return false;
  const u = new URL(value);
  const h = u.hostname.toLowerCase();
  // No network resolution/fetch here. Provider still determines reachability.
  return (
    !u.username &&
    !u.password &&
    !h.includes(":") &&
    h.includes(".") &&
    !/^(?:localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(
      h,
    ) &&
    !/\.(?:local|localhost)$/.test(h)
  );
}
/** Debug output is allowlisted by the adapter; sanitize URL strings recursively. */
export function sanitizeRaw(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeRaw);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => !SENSITIVE.test(k) && k !== "error")
        .map(([k, v]) => [k, sanitizeRaw(v)]),
    );
  if (typeof value === "string" && isHttpUrl(value)) {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()])
      if (SENSITIVE.test(key)) url.searchParams.delete(key);
    // Input image URLs may be nested/encoded in provider request links.
    for (const [key, entry] of [...url.searchParams.entries()])
      if (isHttpUrl(entry)) url.searchParams.set(key, imageReferenceUrl(entry));
    return url.toString();
  }
  return value;
}
