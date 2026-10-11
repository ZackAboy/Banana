import "server-only";
import type { ProductIdentification } from "@/types";
import { ocrEvidenceSchema, type FusionInput } from "./evidence-contracts";
import type { AdaptedEvidence } from "./evidence-adapters";

// Whole ordered phrases only: never stemming, edit-distance or bag-of-words.
export const productWords = (text: string) =>
  text
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .match(/[\p{L}\p{N}]+/gu) ?? [];
const key = (text: string) => productWords(text).join(" ");
const prefix = (text: string, phrase: string) =>
  text === phrase || text.startsWith(`${phrase} `);
const contains = (text: string, phrase: string) =>
  phrase && ` ${key(text)} `.includes(` ${key(phrase)} `);
const unsafeSubject =
  /\b(compatible|compatibility|replacement|for|fits?|case|cover|dock|not|except|versus|vs|review|manual|guide)\b/i;
const boilerplate =
  /^(model|sku|mpn|part|p\s*[/.]?\s*n|serial|s\s*[/.]?\s*n|ingredients?|nutrition|warning|caution|distributed|manufactured|made|net\s+(weight|contents))\b/i;
const sizeSuffix =
  /(?:\s|^)(?:\d+(?:[.,]\d+)?\s*(?:fl\s*)?(?:oz|ounces?|ml|cl|liters?|litres?|l|g|kg|lb|lbs|ct|count|pack|packs)|pack\s+of\s+\d+)\b.*$/i;

function titlePrefix(title: string, count: number) {
  const words = [...title.matchAll(/[\p{L}\p{N}]+/gu)];
  const last = words[count - 1];
  return last ? title.slice(0, last.index! + last[0].length).trim() : title;
}

interface PhysicalWording {
  text: string;
  ref: string;
}
function physicalWording(input: FusionInput): PhysicalWording[] {
  const ocr = input.ocr
    ? ocrEvidenceSchema.parse(input.ocr).images.flatMap((image) => {
        const lines = image.regions
          .map((region) => region.raw_text.trim())
          .filter(
            (text) =>
              text &&
              !boilerplate.test(text) &&
              !image.identifiers.some((id) => contains(text, id.value)),
          );
        // OCR may split a product wordmark across adjacent regions. Joining a
        // bounded sequence retains literal order and the same physical source.
        return lines.flatMap((_, start) =>
          [1, 2, 3]
            .filter((length) => start + length <= lines.length)
            .map((length) => ({
              text: lines.slice(start, start + length).join(" "),
              ref: `ocr:${image.source_image_index}`,
            })),
        );
      })
    : [];
  // A model's semantic interpretation is not physical wording. Only explicitly
  // indexed, transcribed packaging/label observations can ground a broad name.
  const semantic = input.semantic;
  if (!semantic?.evidence.familySupported) return ocr;
  return [
    ...ocr,
    ...semantic.evidence.exactMatch
      .filter(
        (clue) =>
          ["packaging", "unique_label"].includes(clue.kind) &&
          semantic.identification.visibleText.includes(clue.observation),
      )
      .map((clue) => ({
        text: clue.observation,
        ref: `gemini:${semantic.evidence.exactMatch.indexOf(clue)}`,
      })),
  ];
}

export interface SemanticProductDecision {
  family: string;
  productName: string;
  brand: string | null;
  variant: string | null;
  variantConflict: boolean;
  familyConflict: boolean;
  unresolved: NonNullable<
    ProductIdentification["identityResolution"]
  >["unresolvedFields"];
  refs: string[];
}

/** Small source/physical-phrase join. Candidate titles never supply unseen
 * variant precision. Different tails remain different hypotheses, not aliases. */
export function identifySemanticProduct(
  input: FusionInput,
  evidence: AdaptedEvidence,
): SemanticProductDecision | null {
  const physical = physicalWording(input).filter(
    (line) => !boilerplate.test(line.text) && key(line.text),
  );
  const proposal = input.semantic?.evidence.familySupported
    ? input.semantic.identification
    : undefined;
  const matches: {
    family: string;
    brand: string | null;
    variant: string | null;
    tail: string;
    ref: string;
    physicalRefs: string[];
    size: boolean;
  }[] = [];
  for (const candidate of evidence.search?.candidates ?? []) {
    candidate.observations.forEach((observation, index) => {
      // Strip only delimited publisher/retailer suffixes. Snippets never create
      // subject identity; query echoes and identifier-shaped tokens are unused.
      const title = observation.title.split(/\s+[|–—]\s+/)[0].trim();
      if (unsafeSubject.test(title)) return;
      const normalized = key(title);
      const brand =
        observation.brandClue &&
        physical.some((p) => contains(p.text, observation.brandClue!))
          ? observation.brandClue
          : (evidence.brands.find((b) => prefix(normalized, key(b.value)))
              ?.value ?? null);
      const brandPrefix =
        brand &&
        productWords(brand).length === 1 &&
        prefix(normalized, key(brand))
          ? 1
          : 0;
      const subject = productWords(title).slice(brandPrefix).join(" ");
      // A complete product line/name may be multiword without a brand clue.
      // A single word needs separately grounded branding (e.g. a wordmark).
      const anchors = physical
        .flatMap((line) => {
          let phrase = key(line.text);
          if (brandPrefix && prefix(phrase, key(brand!)))
            phrase = phrase.slice(key(brand!).length).trim();
          const length = phrase.split(" ").filter(Boolean).length;
          if (
            !phrase ||
            !(length >= 2 || (brand && phrase.length >= 4)) ||
            !prefix(subject, phrase)
          )
            return [];
          return [{ line, phrase, length }];
        })
        .sort(
          (a, b) => a.length - b.length || a.phrase.localeCompare(b.phrase),
        );
      const anchor = anchors[0];
      if (!anchor) return;
      let family = titlePrefix(title, brandPrefix + anchor.length);
      if (brandPrefix)
        family = family.slice(titlePrefix(title, brandPrefix).length).trim();
      let tail = subject.slice(anchor.phrase.length).trim();
      const size = sizeSuffix.test(tail);
      tail = tail.replace(sizeSuffix, "").trim();
      let variant: string | null = null;
      const physicalRefs = [anchor.line.ref];
      // Explicit source/model variant labels may split a full physical phrase,
      // but only when both name and variant occur verbatim in physical wording.
      const declaredVariant = observation.variantClue ?? proposal?.variant;
      if (
        declaredVariant &&
        contains(family, declaredVariant) &&
        physical.some((p) => contains(p.text, declaredVariant))
      ) {
        const familyKey = key(family);
        const variantKey = key(declaredVariant);
        if (familyKey.endsWith(` ${variantKey}`)) {
          family = titlePrefix(
            family,
            productWords(family).length - productWords(declaredVariant).length,
          );
          tail = `${variantKey} ${tail}`.trim();
          variant = declaredVariant;
        }
      }
      const extensions = physical
        .filter(
          (p) => prefix(tail, key(p.text)) && key(p.text) !== anchor.phrase,
        )
        .sort(
          (a, b) => productWords(b.text).length - productWords(a.text).length,
        );
      if (!variant && extensions[0]) {
        variant = extensions[0].text.trim();
        physicalRefs.push(extensions[0].ref);
      }
      // A transcribed model/SKU line is never a semantic variant extension.
      if (variant && /^(model|sku|part|p\s*n|serial|s\s*n)\b/i.test(variant))
        variant = null;
      matches.push({
        family,
        brand,
        variant,
        tail,
        ref: `search:${candidate.id}:${index}`,
        physicalRefs,
        size,
      });
    });
  }
  // Sources may include/omit a physically observed manufacturer prefix. Keep a
  // shared literal family only when it occurs in EVERY matched subject title.
  // This changes family granularity, never merges differing variant tails.
  const familyNames = [
    ...new Map(matches.map((m) => [key(m.family), m.family])).values(),
  ];
  if (familyNames.length > 1) {
    const shared = familyNames.filter((family) =>
      matches.every((m) => contains(`${m.family} ${m.tail}`, family)),
    );
    if (shared.length === 1) {
      for (const match of matches) {
        const subject = key(`${match.family} ${match.tail}`);
        const family = key(shared[0]);
        const position = ` ${subject} `.indexOf(` ${family} `);
        match.family = shared[0];
        match.tail = subject.slice(position + family.length).trim();
        const extension = physical
          .filter((p) => prefix(match.tail, key(p.text)))
          .sort(
            (a, b) => productWords(b.text).length - productWords(a.text).length,
          )[0];
        match.variant = extension?.text.trim() ?? null;
        if (extension) match.physicalRefs.push(extension.ref);
      }
    }
  }
  const families = new Set(matches.map((m) => key(m.family)));
  if (!families.size) return null;
  const family = matches[0].family;
  const variants = new Map(
    matches.filter((m) => m.variant).map((m) => [key(m.variant!), m.variant!]),
  );
  const variant = variants.size === 1 ? [...variants.values()][0] : null;
  const variantConflict =
    variants.size > 1 ||
    Boolean(
      variant && matches.some((m) => m.tail && !prefix(m.tail, key(variant))),
    );
  const resolvedVariant = variantConflict ? null : variant;
  const brands = new Map(
    matches.filter((m) => m.brand).map((m) => [key(m.brand!), m.brand!]),
  );
  return {
    family,
    productName: [family, resolvedVariant].filter(Boolean).join(" "),
    brand: brands.size === 1 ? [...brands.values()][0] : null,
    variant: resolvedVariant,
    variantConflict,
    familyConflict: families.size > 1,
    unresolved: [
      ...(variantConflict || (!resolvedVariant && matches.some((m) => m.tail))
        ? ["variant" as const]
        : []),
      ...(matches.some((m) => m.size) ? ["size" as const] : []),
    ],
    refs: [...new Set(matches.flatMap((m) => [m.ref, ...m.physicalRefs]))],
  };
}

export function sameProductFamily(name: string, family: string) {
  return contains(name, family);
}
