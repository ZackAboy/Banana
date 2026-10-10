// URL canonicalisation for deduplication. The original URL is always kept
// alongside the canonical one.

const TRACKING_PARAMS = new Set([
  "gclid",
  "gclsrc",
  "dclid",
  "gbraid",
  "wbraid",
  "fbclid",
  "msclkid",
  "yclid",
  "mc_cid",
  "mc_eid",
  "srsltid",
  "_ga",
  "_gl",
  "ref",
  "ref_",
  "referrer",
  "tag",
  "affid",
  "affiliate",
  "clickid",
  "irclickid",
  "cmpid",
  "spm",
  "psc",
  "th",
]);
const TRACKING_PREFIXES = ["utm_", "pf_rd_", "pd_rd_", "_hs", "hsa_"];

/** www./m./amp. and redd.it style hosts collapse onto the primary host. */
export function normalizeHost(host: string): string {
  return host
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^(?:www\d?|m|mobile|amp|old)\./, "");
}

export function hostOf(url: string): string {
  return normalizeHost(new URL(url).hostname);
}

export function canonicalizeUrl(input: string): string {
  const url = new URL(input.trim());
  url.protocol = "https:";
  url.hostname = normalizeHost(url.hostname);
  url.hash = "";
  url.username = "";
  url.password = "";
  if (url.port === "443" || url.port === "80") url.port = "";

  // Amazon product URLs carry slugs and ref paths; the ASIN is the identity.
  const asin = url.hostname.startsWith("amazon.")
    ? url.pathname.match(
        /\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:[/?]|$)/i,
      )
    : null;
  if (asin) {
    url.pathname = `/dp/${asin[1].toUpperCase()}`;
    url.search = "";
    return url.toString();
  }

  const kept = [...url.searchParams.entries()]
    .filter(([key]) => {
      const k = key.toLowerCase();
      return (
        !TRACKING_PARAMS.has(k) &&
        !TRACKING_PREFIXES.some((prefix) => k.startsWith(prefix))
      );
    })
    .sort(([a], [b]) => a.localeCompare(b));
  url.search = new URLSearchParams(kept).toString();
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

export function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
