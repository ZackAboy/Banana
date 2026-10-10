import {
  extractModelNumbers,
  identifierObservations,
  normalizeModelNumber,
} from "@/lib/search/product-search/model-number";
import { tokens } from "@/lib/search/product-search/signals";
import type { IdentifierObservation } from "@/lib/search/product-search";
import type { Relevance, ReviewQueryInput } from "./types";

// Deterministic relevance labels from title/snippet text only. The pages
// themselves are never fetched, so a label says what the search result shows,
// not what the full article discusses. Rules were checked against live results
// for four products in different categories (controller, headphones, monitor,
// earbuds); see README.

/** Matching-only word form: "controllers" -> "controller", "cancelling" -> "canceling". */
const normalizeWord = (t: string) => {
  const w = t.replace(/ll(ing|ation|ed)$/, "l$1");
  return w.length > 4 && w.endsWith("s") && !w.endsWith("ss")
    ? w.slice(0, -1)
    : w;
};
const words = (text: string) => tokens(text).map(normalizeWord);

// Category and feature words that don't distinguish one product from its
// siblings. Used only to find the distinctive words of the supplied name.
const GENERIC = new Set(
  [
    "wireless",
    "wired",
    "bluetooth",
    "controller",
    "gamepad",
    "headphones",
    "headset",
    "earbuds",
    "earphones",
    "speaker",
    "keyboard",
    "mouse",
    "monitor",
    "display",
    "camera",
    "phone",
    "laptop",
    "tablet",
    "watch",
    "console",
    "edition",
    "version",
    "new",
    "gaming",
    "noise",
    "canceling",
    "cancelation",
    "active",
    "anc",
    "over",
    "ear",
    "true",
    "smart",
    "portable",
    "inch",
  ].map(normalizeWord),
);
// Words that, right after a family word, usually name a sibling product
// ("DualSense Edge", "AirPods Max"). Ignored when the query contains them.
const VARIANT_WORDS = new Set([
  "edge",
  "pro",
  "lite",
  "mini",
  "max",
  "plus",
  "ultra",
  "slim",
  "elite",
  "se",
  "xl",
  "neo",
  "air",
]);
// Title words that mark an accessory listing rather than the product itself.
const ACCESSORY_CUES = [
  "case",
  "cover",
  "skin",
  "decal",
  "sticker",
  "charger",
  "charging station",
  "charging dock",
  "dock",
  "charging stand",
  "holder",
  "mount",
  "grip",
  "thumb grip",
  "faceplate",
  "shell",
  "protector",
  "button set",
  "replacement",
  "adapter",
  "cable",
].map((cue) => cue.split(" ").map(normalizeWord).join(" "));

const phraseIn = (haystack: string[], phrase: string) => {
  const needle = phrase.split(" ");
  return haystack.some((_, i) =>
    needle.every((word, j) => haystack[i + j] === word),
  );
};

/**
 * Classes and lengths of a model number's first two letter/digit runs:
 * "CFI-ZCT2W" -> "L3L3", "27GP850-B" -> "D2L2", "WH-1000XM5" -> "L2D4".
 * Another model with the same shape is likely a sibling (CFI-ZCT1W, 32GS95UE,
 * WH-1000XM4); promo codes or board numbers (PLAY5, BDM-060) differ.
 */
const modelShape = (value: string) => {
  const runs = value.toUpperCase().match(/[A-Z]+|\d+/g) ?? [];
  return runs.length < 2
    ? ""
    : runs
        .slice(0, 2)
        .map((r) => (/\d/.test(r) ? "D" : "L") + r.length)
        .join("");
};

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Separators around the model that the identifier matcher would otherwise read
 * as part of a longer identifier (all seen in live titles):
 * - "/" or "+" before it lists alternatives ("V2/CFI-ZCT2W");
 * - "/" or "+" after it, when another full identifier follows
 *   ("27GP850-B/27GP83B-B", "A2698+A2699");
 * - a lowercase plural "s" ("WH-1000XM5s").
 * A short suffix ("CFI-ZCT2W/01", "WH-1000XM5/B") still marks a longer identifier.
 */
function separateAlternatives(text: string, model: string) {
  const m = escapeRegex(model.trim());
  return text
    .replace(new RegExp(`[/+](?=${m})`, "gi"), "$& ")
    .replace(new RegExp(`(${m})([/+])([^\\s/+]+)`, "gi"), (all, a, sep, b) =>
      /^(?=.*\d)(?=.*[a-z])[a-z0-9.-]{4,}$/i.test(b) ? `${a} ${sep} ${b}` : all,
    )
    .replace(new RegExp(`(${m})s(?![\\p{L}\\p{N}])`, "gu"), "$1 s");
}

/** "WH 1000XM5", "CFI ZCT2W": the model split by spaces into 2-3 words. */
function spacedObservations(
  text: string,
  model: string,
  field: string,
): IdentifierObservation[] {
  const target = normalizeModelNumber(model);
  const parts = text
    .split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter(Boolean);
  const out: IdentifierObservation[] = [];
  for (let size = 2; size <= 3; size++)
    for (let i = 0; i + size <= parts.length; i++) {
      const observed = parts.slice(i, i + size).join(" ");
      if (normalizeModelNumber(observed) === target)
        out.push({
          kind: "model_number",
          queryValue: model,
          normalizedQueryValue: target,
          caseSensitive: false,
          observedValue: observed,
          normalizedObservedValue: target,
          match: "normalized",
          field,
        });
    }
  return out;
}

function modelObservationsIn(text: string, model: string, field: string) {
  const found = identifierObservations(
    { kind: "model_number", value: model },
    separateAlternatives(text, model),
    field,
  );
  return found.some((o) => o.match !== "extension")
    ? found
    : [...found, ...spacedObservations(text, model, field)];
}

export function assessRelevance(
  query: ReviewQueryInput,
  title: string,
  snippet: string | null,
): Relevance {
  const titleTokens = words(title);
  const all = new Set([...titleTokens, ...words(snippet ?? "")]);
  const productTerms = [...new Set(words(query.product ?? ""))];
  const distinctive = productTerms.filter((t) => !GENERIC.has(t));
  const familyTerms = distinctive.length ? distinctive : productTerms;
  // Words with digits name a generation or model ("2" in AirPods Pro 2,
  // "1000xm5") and are required; two-thirds of the other words are enough.
  const required = familyTerms.filter((t) => /\d/.test(t));
  const rest = familyTerms.filter((t) => !/\d/.test(t));
  const familyMatched = familyTerms.filter((t) => all.has(t));
  const familyAll =
    familyTerms.length > 0 &&
    required.every((t) => all.has(t)) &&
    rest.filter((t) => all.has(t)).length >= Math.ceil((rest.length * 2) / 3);
  const matched = productTerms.filter((t) => all.has(t));
  const nameMatch =
    familyAll && matched.length >= Math.ceil(productTerms.length / 2);

  const model = query.modelNumber;
  const modelObservations = model
    ? [
        ...modelObservationsIn(title, model, "title"),
        ...modelObservationsIn(snippet ?? "", model, "snippet"),
      ]
    : [];
  const target = model ? normalizeModelNumber(model) : null;
  const otherModelNumbers = extractModelNumbers(
    `${title}\n${snippet ?? ""}`,
  ).filter((m) => !target || !normalizeModelNumber(m).startsWith(target));
  const shape = model ? modelShape(model) : "";
  const siblingModels = otherModelNumbers.filter(
    (m) => shape && modelShape(m) === shape,
  );
  const variantConflicts = [
    ...new Set(
      titleTokens.flatMap((t, i) =>
        familyTerms.includes(t) &&
        VARIANT_WORDS.has(titleTokens[i + 1] ?? "") &&
        !productTerms.includes(titleTokens[i + 1])
          ? [titleTokens[i + 1]]
          : [],
      ),
    ),
  ];
  const accessoryCues = ACCESSORY_CUES.filter((cue) =>
    phraseIn(titleTokens, cue),
  );
  // "Thumbstick caps compatible with DualSense CFI-ZCT2W", "Not compatible
  // with CFI-ZCT2W": the product is a compatibility target, not the subject.
  // "Is the DualSense CFI-ZCT2W compatible with PC?" is unaffected.
  const compat = title.search(/\bcompatib(?:le|ility)\s+(?:with|for)\b/i);
  if (compat >= 0) {
    const after = title.slice(compat);
    const afterWords = words(after);
    if (
      familyTerms.some((t) => afterWords.includes(t)) ||
      (target !== null && normalizeModelNumber(after).includes(target))
    )
      accessoryCues.push("compatible with");
  }
  const brandTokens = words(query.brand ?? "");

  const exactModel = modelObservations.some((o) => o.match !== "extension");
  const extensionOnly =
    !exactModel && modelObservations.some((o) => o.match === "extension");
  const notes: string[] = [];
  let level: Relevance["level"];
  if (accessoryCues.length) {
    level = "weak";
    notes.push(
      `Title looks like an accessory or compatibility listing (${accessoryCues.join(", ")})`,
    );
  } else if (exactModel) {
    level = "exact_model";
    if (variantConflicts.length)
      notes.push(
        `Also names a sibling product (${variantConflicts.join(", ")})`,
      );
  } else if (extensionOnly) {
    // e.g. "27GP850-B.AUS": a regional or packaging variant of the model.
    level = "product_family";
    notes.push("Only a longer model number containing the query model appears");
  } else if (nameMatch && !variantConflicts.length && !siblingModels.length) {
    level = "product_name";
  } else if (familyAll) {
    level = "product_family";
    if (variantConflicts.length)
      notes.push(`Names a sibling product (${variantConflicts.join(", ")})`);
    if (siblingModels.length)
      notes.push(`Names a different model (${siblingModels.join(", ")})`);
    if (!nameMatch) notes.push("Only the product family appears");
  } else {
    level = "weak";
    notes.push("Supplied product or model does not appear in title or snippet");
  }
  if (model && !exactModel && !extensionOnly && level !== "weak")
    notes.push(`Model ${model} is not mentioned`);

  return {
    level,
    modelObservations,
    otherModelNumbers,
    siblingModelNumbers: siblingModels,
    brandMatch: brandTokens.length
      ? brandTokens.every((t) => all.has(t))
      : null,
    productTermsMatched: matched,
    productTermsMissing: productTerms.filter((t) => !all.has(t)),
    familyTermsMatched: familyMatched,
    variantConflicts,
    accessoryCues,
    notes,
  };
}
