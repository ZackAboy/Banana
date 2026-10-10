import { hostOf } from "./url";
import type { ReviewSourceType } from "./types";

// Editorial review publications. Extend deliberately; unknown sites stay "other".
export const REVIEW_SITES = [
  "rtings.com",
  "ign.com",
  "theverge.com",
  "tomsguide.com",
  "tomshardware.com",
  "techradar.com",
  "pcmag.com",
  "cnet.com",
  "wired.com",
  "engadget.com",
  "gamespot.com",
  "digitaltrends.com",
  "eurogamer.net",
  "pushsquare.com",
  "trustedreviews.com",
  "whathifi.com",
  "consumerreports.org",
  "wirecutter.com",
  "nytimes.com/wirecutter",
  "arstechnica.com",
  "notebookcheck.net",
  "digitalfoundry.net",
];

// Explicit manufacturer domains only. A brand-shaped hostname is not ownership.
export const MANUFACTURER_DOMAINS: Record<string, string[]> = {
  sony: ["sony.com", "playstation.com", "sony.net"],
  lg: ["lg.com"],
  samsung: ["samsung.com"],
  apple: ["apple.com"],
  microsoft: ["microsoft.com", "xbox.com"],
  nintendo: ["nintendo.com", "nintendo.co.uk", "nintendo.co.jp"],
  logitech: ["logitech.com", "logitechg.com"],
};

const onDomain = (host: string, domain: string) =>
  host === domain || host.endsWith(`.${domain}`);

export function classifySource(
  url: string,
  brand: string | undefined,
): ReviewSourceType {
  const parsed = new URL(url);
  const host = hostOf(url);
  const path = `${host}${parsed.pathname}`;
  if (onDomain(host, "reddit.com") || host === "redd.it") return "reddit";
  const brandKey = brand?.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (brandKey) {
    const known = MANUFACTURER_DOMAINS[brandKey] ?? [];
    if (known.some((d) => onDomain(host, d))) return "manufacturer_spec";
  }
  if (
    REVIEW_SITES.some((site) =>
      site.includes("/") ? path.startsWith(site) : onDomain(host, site),
    )
  )
    return "review_site";
  return "other";
}
