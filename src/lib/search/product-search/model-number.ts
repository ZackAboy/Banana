// Model-number handling. Matching is tolerant of case, spacing and separators,
// but every function returns the strings as originally written so evidence can
// quote the source exactly.

/** Case-, space- and separator-insensitive form: "cfi zct2w" -> "CFIZCT2W". */
export function normalizeModelNumber(value: string): string {
  return value
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[\s\p{Pd}_./]+/gu, "");
}

// Em dash and horizontal bar separate clauses ("280 g—CFI-ZCT1W"), unlike the
// hyphens and en dashes used inside model numbers.
const CLAUSE_DASHES = new RegExp(
  `[${String.fromCharCode(0x2014, 0x2015)}]`,
  "g",
);

// Model numbers mix letters and digits ("CFI-ZCT2W", "27GP850-B"); requiring
// both skips ordinary words and plain numbers such as years or prices.
const MIN_NORMALIZED_LENGTH = 5;
const MAX_JOINED_WORDS = 3;
const MIN_JOINED_LENGTH = 7;
// Common non-model tokens that also mix letters and digits.
// Times ("7am-11pm") and console names ("PS5TM") came up in live results.
const NOISE =
  /^(?:\d+(?:GB|TB|MB|HZ|MM|CM|W|MAH|K|P|X|G)|[A-Z]?\d{1,2}(?:ST|ND|RD|TH)|USB\d.*|PS\d(?:TM)?|MP\d|H\d{3}|COVID19|\d{1,2}(?:AM|PM)(?:\d{1,2}(?:AM|PM))?)$/;
// Six or more letters in a row make a segment a word ("experience1").
const LETTER_RUN = /[A-Za-z]{6}/;

function isModelLike(token: string) {
  const normalized = normalizeModelNumber(token);
  return (
    // Model numbers are written in one case ("CFI-ZCT2W" or "cfi-zct2w"); mixed
    // case is a word or handle, e.g. "r/PS5HelpSupport" or "PS5's" in live data.
    !(/[a-z]/.test(token) && /[A-Z]/.test(token)) &&
    !token.split(/[\s\p{Pd}_./]+/u).some((part) => LETTER_RUN.test(part)) &&
    normalized.length >= MIN_NORMALIZED_LENGTH &&
    /[A-Z]/.test(normalized) &&
    /\d/.test(normalized) &&
    !NOISE.test(normalized)
  );
}

interface Word {
  text: string;
  /** Separated from the next word by whitespace only. */
  joinsNext: boolean;
}

/** Words with edge punctuation removed; "a, b" and "a/b" do not join. */
function words(text: string): Word[] {
  const out: Word[] = [];
  for (const chunk of text.replace(CLAUSE_DASHES, ", ").split(/\s+/)) {
    const pieces = chunk.split(/[,;:/|()[\]{}!?"“”«»]+/);
    pieces.forEach((raw, i) => {
      const word = raw.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
      if (!word) {
        if (out.length) out[out.length - 1].joinsNext = false;
        return;
      }
      out.push({
        text: word,
        joinsNext: i === pieces.length - 1 && raw.endsWith(word),
      });
    });
  }
  return out;
}

// A word that may be one piece of a space-separated model number, e.g. the
// "CFI" and "ZCT2W" in "CFI ZCT2W": short, no lowercase, and either containing
// a digit or at most three characters. Excludes brand names like "SONY".
const isJoinablePiece = (w: string) =>
  w.length <= 5 &&
  !/[a-z]/.test(w) &&
  (/\d/.test(w) || w.length <= 3) &&
  !NOISE.test(w.toUpperCase());

/**
 * Model-number-like tokens in free text, as written. A single word such as
 * "CFI-ZCT2W" or "cfi-zct2w" stands alone; adjacent short capitalised pieces
 * such as "CFI ZCT2W" are joined, longest window first, so the pieces are not
 * reported again on their own. Duplicates (after normalisation) keep the first
 * spelling.
 */
export function extractModelNumbers(text: string): string[] {
  const list = words(text);
  const seen = new Map<string, string>();
  for (let i = 0; i < list.length;) {
    let consumed = 1;
    for (
      let size = Math.min(MAX_JOINED_WORDS, list.length - i);
      size >= 1;
      size--
    ) {
      const window = list.slice(i, i + size);
      if (
        size > 1 &&
        !window.every(
          (w, j) => isJoinablePiece(w.text) && (j === size - 1 || w.joinsNext),
        )
      )
        continue;
      const candidate = window.map((w) => w.text).join(" ");
      if (!isModelLike(candidate)) continue;
      // Joined pieces need more substance than a lone token: rejects "AKA V1".
      if (
        size > 1 &&
        normalizeModelNumber(candidate).length < MIN_JOINED_LENGTH
      )
        continue;
      const key = normalizeModelNumber(candidate);
      if (!seen.has(key)) seen.set(key, candidate);
      consumed = size;
      break;
    }
    i += consumed;
  }
  return [...seen.values()];
}

export interface ModelNumberMatch {
  exact: boolean;
  normalized: boolean;
  /** Tokens that start with the query model and add a short suffix. */
  suffixVariants: string[];
  seen: string[];
}

const MAX_SUFFIX_LENGTH = 3;

export function matchModelNumber(
  queryModel: string,
  text: string,
): ModelNumberMatch {
  const seen = extractModelNumbers(text);
  const target = normalizeModelNumber(queryModel);
  const escaped = queryModel.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const exact = new RegExp(
    `(?<![A-Za-z0-9-])${escaped}(?![A-Za-z0-9])`,
    "i",
  ).test(text);
  const normalizedSeen = seen.map(normalizeModelNumber);
  const normalized = exact || normalizedSeen.includes(target);
  const suffixVariants = seen.filter((token, i) => {
    const n = normalizedSeen[i];
    return (
      n !== target &&
      n.startsWith(target) &&
      n.length - target.length <= MAX_SUFFIX_LENGTH
    );
  });
  return { exact, normalized, suffixVariants, seen };
}
