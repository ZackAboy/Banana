// Locale-tolerant price parsing into integer minor units. Currencies are never
// converted and never guessed: an ambiguous symbol such as a bare "$" or "kr"
// only resolves through an explicit hint from the provider's market setting.

export interface ParsedPrice {
  amountMinor: number | null;
  currency: string | null;
  original: string;
}

// Longest symbols first so "US$" wins over "$".
const SYMBOLS: [string, string | null][] = [
  ["US$", "USD"],
  ["CA$", "CAD"],
  ["AU$", "AUD"],
  ["NZ$", "NZD"],
  ["HK$", "HKD"],
  ["MX$", "MXN"],
  ["CN¥", "CNY"],
  ["R$", "BRL"],
  ["C$", "CAD"],
  ["A$", "AUD"],
  ["€", "EUR"],
  ["£", "GBP"],
  ["₹", "INR"],
  ["₩", "KRW"],
  ["₽", "RUB"],
  ["₺", "TRY"],
  ["zł", "PLN"],
  ["円", "JPY"],
  ["¥", "JPY"],
  ["￥", "JPY"],
  ["$", null],
  ["kr", null],
];
const DOLLAR_CURRENCIES = new Set([
  "USD",
  "CAD",
  "AUD",
  "NZD",
  "HKD",
  "SGD",
  "MXN",
]);
const KRONA_CURRENCIES = new Set(["SEK", "NOK", "DKK", "ISK"]);

let isoCodes: Set<string> | null = null;
function isIsoCurrency(code: string) {
  isoCodes ??= new Set(Intl.supportedValuesOf("currency"));
  return isoCodes.has(code);
}

export function minorUnitDigits(currency: string): number {
  return (
    new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2
  );
}

function detectCurrency(text: string, hint: string | null): string | null {
  // Only codes written in capitals, so words like "all" never read as ALL (lek).
  const iso = text.match(/(?<![A-Za-z])[A-Z]{3}(?![A-Za-z])/g);
  const code = iso?.find(isIsoCurrency);
  if (code) return code;
  for (const [symbol, currency] of SYMBOLS) {
    if (!text.includes(symbol)) continue;
    if (currency) return currency;
    if (symbol === "$" && hint && DOLLAR_CURRENCIES.has(hint)) return hint;
    if (symbol === "kr" && hint && KRONA_CURRENCIES.has(hint)) return hint;
    return null;
  }
  return hint;
}

/** Parse one standalone displayed amount. Ambiguous formats stay unknown. */
function toDecimal(raw: string, digits: number): string | null {
  if (
    /[\s']/.test(raw) &&
    !/^\d{1,3}(?:[\s']\d{3})+(?:[.,]\d{1,2})?$/.test(raw)
  )
    return null;
  const compact = raw.replace(/[\s\u00a0\u202f']/g, "");
  if (/^\d+$/.test(compact)) return compact;
  // Three-decimal currencies and fractional zero-decimal amounts are intentionally
  // unsupported; interpreting their separators as thousands would be dangerous.
  if (digits !== 2) {
    return /^\d{1,3}(?:[.,]\d{3})+$/.test(compact) && digits === 0
      ? compact.replace(/[.,]/g, "")
      : null;
  }
  if (/^\d+[.,]\d{1,2}$/.test(compact)) return compact.replace(",", ".");
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(compact))
    return compact.replace(/,/g, "");
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(compact))
    return compact.replace(/\./g, "").replace(",", ".");
  return null;
}
export function parsePrice(
  original: string,
  currencyHint: string | null = null,
): ParsedPrice {
  const text = original.normalize("NFKC").trim();
  const hint = currencyHint?.toUpperCase() ?? null;
  const currency = detectCurrency(
    text,
    hint && isIsoCurrency(hint) ? hint : null,
  );
  const unknown = { amountMinor: null, currency, original };
  if (!currency || /[-−–—]/.test(text)) return unknown;
  const explicitCodes =
    text.match(/(?<![A-Za-z])[A-Z]{3}(?![A-Za-z])/g)?.filter(isIsoCurrency) ??
    [];
  if (new Set(explicitCodes).size > 1) return unknown;
  const symbol = SYMBOLS.find(([notation]) => text.includes(notation));
  if (symbol?.[1] && symbol[1] !== currency) return unknown;
  if (symbol?.[0] === "$" && !DOLLAR_CURRENCIES.has(currency)) return unknown;
  if (symbol?.[0] === "kr" && !KRONA_CURRENCIES.has(currency)) return unknown;
  // Remove only currency notation and the provider's footnote marker. No prose,
  // ranges, installment counts or "was/now" interpretation.
  let amount = text.replace(/\*$/, "").trim();
  amount = amount
    .replace(new RegExp(`^${currency}\\s*|\\s*${currency}$`), "")
    .trim();
  const notation = SYMBOLS.find(
    ([symbol]) => amount.startsWith(symbol) || amount.endsWith(symbol),
  )?.[0];
  if (notation)
    amount = (
      amount.startsWith(notation)
        ? amount.slice(notation.length)
        : amount.slice(0, -notation.length)
    ).trim();
  if (!/^\d[\d.,'\s]*$/.test(amount)) return unknown;
  const decimal = toDecimal(amount, minorUnitDigits(currency));
  if (decimal === null) return unknown;
  const amountMinor = Math.round(
    Number(decimal) * 10 ** minorUnitDigits(currency),
  );
  return {
    amountMinor: Number.isSafeInteger(amountMinor) ? amountMinor : null,
    currency,
    original,
  };
}
