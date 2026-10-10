import {
  MANUFACTURER_DOMAINS,
  REVIEW_SITES,
} from "@/lib/search/product-search/sources";
import { hostOf } from "@/lib/search/product-search/url";
import type { ClassificationBasis, ReviewSourceType } from "./types";

// Small, readable rules. Not a trust ranking: a known site is not "better",
// it is only classified with a more specific basis.

// Product Search's editorial list plus a few review outlets seen in live data.
const PROFESSIONAL_SITES = [
  ...REVIEW_SITES,
  "gamesradar.com",
  "polygon.com",
  "pocket-lint.com",
  "t3.com",
  "androidauthority.com",
  "androidcentral.com",
  "techspot.com",
  "soundguys.com",
  "lifewire.com",
  "inverse.com",
  "slashgear.com",
];
const COMMUNITY_SITES = [
  "resetera.com",
  "neogaf.com",
  "steamcommunity.com",
  "quora.com",
  "gamefaqs.gamespot.com",
  "community.playstation.com",
];
const RETAILERS = [
  "amazon.com",
  "amazon.co.uk",
  "amazon.ca",
  "bestbuy.com",
  "walmart.com",
  "target.com",
  "samsclub.com",
  "gamestop.com",
  "newegg.com",
  "costco.com",
  "ebay.com",
];

const onDomain = (host: string, domain: string) =>
  host === domain || host.endsWith(`.${domain}`);
const listed = (host: string, path: string, list: string[]) =>
  list.some((entry) =>
    entry.includes("/") ? path.startsWith(entry) : onDomain(host, entry),
  );

export interface Classification {
  sourceType: ReviewSourceType;
  basis: ClassificationBasis;
  reddit: { subreddit: string | null; threadId: string | null } | null;
}

export function redditParts(url: string) {
  const path = new URL(url).pathname;
  return {
    subreddit: path.match(/^\/r\/([^/]+)/i)?.[1] ?? null,
    threadId:
      path.match(/\/comments\/([a-z0-9]+)/i)?.[1]?.toLowerCase() ?? null,
  };
}

export function classifySource(
  url: string,
  title: string,
  brand: string | undefined,
): Classification {
  const host = hostOf(url);
  const { pathname } = new URL(url);
  const path = `${host}${pathname}`.toLowerCase();
  const none = { reddit: null };
  if (onDomain(host, "reddit.com") || host === "redd.it")
    return {
      sourceType: "reddit",
      basis: "reddit_domain",
      reddit: redditParts(url),
    };

  const brandKey = brand?.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (
    brandKey &&
    (MANUFACTURER_DOMAINS[brandKey] ?? []).some((d) => onDomain(host, d))
  )
    return {
      sourceType: "manufacturer",
      basis: "manufacturer_domain",
      ...none,
    };

  // Before professional sites: gamefaqs lives under gamespot.com.
  if (
    listed(host, path, COMMUNITY_SITES) ||
    /^(?:forums?|community|boards|discussions?)\./.test(host) ||
    /\/(?:forums?|threads|community|discussions?|boards)\//.test(
      pathname.toLowerCase(),
    )
  )
    return { sourceType: "community", basis: "community_pattern", ...none };

  if (listed(host, path, RETAILERS)) {
    // Customer reviews, Q&A threads ("/site/questions/") and retailer-hosted
    // review videos are discussion; anything else is a product listing.
    // A product-page path stays a listing whatever its title says.
    const productPage =
      /\/(?:dp|gp\/product|ip|itm|p|product|products)\//i.test(pathname) ||
      /\.p$/i.test(pathname);
    const reviewPage =
      /\/(?:reviews?|customer-reviews|product-reviews|ratings|questions)(?:\/|$)/i.test(
        pathname,
      ) ||
      (!productPage &&
        /\b(?:reviews?|questions (?:&|and) answers)\b/i.test(title));
    return reviewPage
      ? {
          sourceType: "retailer_review",
          basis: "retailer_review_path",
          ...none,
        }
      : { sourceType: "other", basis: "retailer_listing", ...none };
  }

  if (listed(host, path, PROFESSIONAL_SITES))
    return {
      sourceType: "professional_review",
      basis: "known_review_site",
      ...none,
    };
  // An unlisted site publishing under a /review(s)/ path, e.g. a games blog.
  // Never a brand-named host (bose.com, store.anker.com): that may be the
  // manufacturer itself, which is not an independent reviewer.
  const brandHost = Boolean(brandKey && host.split(".").includes(brandKey));
  if (
    !brandHost &&
    (/\/reviews?\//i.test(pathname) || /-review\/?$/i.test(pathname))
  )
    return { sourceType: "professional_review", basis: "review_path", ...none };

  return { sourceType: "other", basis: "none", ...none };
}
