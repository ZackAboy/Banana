import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { vi } from "vitest";
import { createSerpApiProviders } from "@/lib/search/product-search/serpapi";

// Tests replay real SerpApi responses recorded by live.test.ts on 2026-10-10
// (trimmed by record.ts). Nothing here is invented; failure scenarios are
// injected as HTTP errors around the recorded data.

const RECORDED = join(__dirname, "fixtures", "recorded");

export const DUALSENSE = {
  brand: "Sony",
  product: "DualSense Wireless Controller",
  modelNumber: "CFI-ZCT2W",
};
/** The public Wikimedia Commons photo the Lens recording was made with. */
export const IMAGE_URL =
  "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/Playstation_Dualsense_controller.jpg/1280px-Playstation_Dualsense_controller.jpg";
export const FIXED_NOW = () => new Date("2026-10-10T12:00:00.000Z");

type Json = Record<string, unknown>;
type Route = (params: URLSearchParams) => unknown | Response | undefined;

const keyOf = (engine: string | null, q: string | null, url: string | null) =>
  `${engine}|${q ?? url ?? ""}`;

/** Every recorded response, indexed by engine and query (or image URL for Lens). */
export const recordings: Map<string, Json> = (() => {
  const index = new Map<string, Json>();
  for (const dir of readdirSync(RECORDED))
    for (const file of readdirSync(join(RECORDED, dir))) {
      if (file === "recording.json") continue;
      const body = JSON.parse(
        readFileSync(join(RECORDED, dir, file), "utf8"),
      ) as Json;
      const p = body.search_parameters as Record<string, string | undefined>;
      index.set(keyOf(p.engine ?? null, p.q ?? null, p.url ?? null), body);
    }
  return index;
})();

/** Look up a recording by the request SerpApi would receive. */
export function recorded(engine: string, queryOrUrl: string) {
  const body = recordings.get(`${engine}|${queryOrUrl}`);
  if (!body) throw new Error(`No recording for ${engine} "${queryOrUrl}"`);
  return body;
}

export const recordedRoute: Route = (p) =>
  recordings.get(keyOf(p.get("engine"), p.get("q"), p.get("url")));

/**
 * A fetch that never touches the network: it answers from recordings and fails
 * the test loudly for any request that was not recorded.
 */
export function fixtureFetch(route: Route = recordedRoute) {
  const calls: URLSearchParams[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.hostname !== "serpapi.com")
      throw new Error(`Unexpected network request to ${url.hostname}`);
    calls.push(url.searchParams);
    const body = route(url.searchParams);
    if (body instanceof Response) return body;
    if (body === undefined)
      throw new Error(
        `No recording for ${url.searchParams.get("engine")} "${url.searchParams.get("q") ?? url.searchParams.get("url")}"`,
      );
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

export function fixtureProviders(route?: Route, minResults?: number) {
  const { fetchImpl, calls } = fixtureFetch(route);
  const providers = createSerpApiProviders({
    apiKey: "test-key-not-real",
    fetch: fetchImpl,
    minResultsBeforeFallback: minResults,
  });
  return { providers, calls };
}

/** Any real fetch during a test is a bug: fail loudly instead of reaching out. */
export function blockNetwork() {
  vi.stubGlobal("fetch", () => {
    throw new Error("Network access is not allowed in product-search tests");
  });
  return () => vi.unstubAllGlobals();
}
