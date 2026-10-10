import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { recordedRoute } from "../product-search/helpers";

// Review Intelligence recordings live here, separate from Product Search's, so
// a new recording can never change Product Search's tests. Requests not found
// in either set are answered with HTTP 500: a failure, never invented data.
const DIR = join(__dirname, "fixtures", "recorded");
const own = new Map<string, unknown>();
if (existsSync(DIR))
  for (const run of readdirSync(DIR))
    for (const file of readdirSync(join(DIR, run))) {
      if (file === "recording.json") continue;
      const body = JSON.parse(readFileSync(join(DIR, run, file), "utf8"));
      own.set(
        `${body.search_parameters.engine}|${body.search_parameters.q}`,
        body,
      );
    }

/** Organic rows of a Review Intelligence recording, by exact query text. */
export function reviewRows(q: string) {
  const body = own.get(`google|${q}`) as
    | { organic_results: { title: string; link: string; snippet?: string }[] }
    | undefined;
  if (!body) throw new Error(`No review recording for "${q}"`);
  return body.organic_results;
}

/** The first recorded Review Intelligence row whose title contains `text`. */
export function recordedRow(text: string) {
  for (const body of own.values())
    for (const row of (
      body as {
        organic_results?: { title: string; link: string; snippet?: string }[];
      }
    ).organic_results ?? [])
      if (row.title.includes(text)) return row;
  throw new Error(`No recorded row titled like "${text}"`);
}

export function reviewRoute(p: URLSearchParams) {
  return (
    own.get(`${p.get("engine")}|${p.get("q")}`) ??
    recordedRoute(p) ??
    new Response(JSON.stringify({ error: "not recorded" }), { status: 500 })
  );
}
