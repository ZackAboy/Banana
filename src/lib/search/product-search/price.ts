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

/** Turn "1.234,56" / "1,234.56" / "59,99" / "7 980" into a decimal string. */
function toDecimal(raw: string, fractionDigits: number): string | null {
  const digits = raw.replace(/[\s\u00a0\u202f']/g, "");
  const separators = digits.match(/[.,]/g) ?? [];
  let integer = digits;
  let fraction = "";
  if (separators.length) {
    const last = Math.max(digits.lastIndexOf("."), digits.lastIndexOf(","));
    const tail = digits.slice(last + 1);
    const mixed = new Set(separators).size > 1;
    // One kind of separator, used once and followed by exactly three digits,
    // is a thousands separator ("1,234" / "1.234"); so is any repeated one.
    const thousandsOnly =
      fractionDigits === 0 ||
      (!mixed && (separators.length > 1 || tail.length === 3));
    if (!thousandsOnly) {
      integer = digits.slice(0, last);
      fraction = tail;
    }
    integer = integer.replace(/[.,]/g, "");
  }
  if (!/^\d+$/.test(integer) || !/^\d*$/.test(fraction)) return null;
  return fraction ? `${integer}.${fraction}` : integer;
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
  // First number only: ranges and "was/now" strings keep their first amount.
  const number = text.match(/\d(?:[\d.,'\s\u00a0\u202f]*\d)?/);
  if (!number || !currency) return { amountMinor: null, currency, original };
  const exponent = minorUnitDigits(currency);
  const decimal = toDecimal(number[0], exponent);
  if (decimal === null) return { amountMinor: null, currency, original };
  const amountMinor = Math.round(Number(decimal) * 10 ** exponent);
  return {
    amountMinor: Number.isSafeInteger(amountMinor) ? amountMinor : null,
    currency,
    original,
  };
}
