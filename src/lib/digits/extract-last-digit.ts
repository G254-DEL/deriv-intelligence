/**
 * Extracts the last displayed digit from a quoted price.
 *
 * Uses the quote’s decimal places (or an explicit decimalPlaces value)
 * instead of converting the whole price to an integer.
 * This helper does not compute strategies or probabilities.
 */
export function extractLastDisplayedDigit(
  quote: number | string,
  decimalPlaces?: number,
): { formatted: string; digit: string } | null {
  const formatted = formatQuote(quote, decimalPlaces);
  if (!formatted) {
    return null;
  }

  const lastDigit = formatted.match(/[0-9](?=[^0-9]*$)/);
  if (!lastDigit) {
    return null;
  }

  return { formatted, digit: lastDigit[0] };
}

export function formatQuote(
  quote: number | string,
  decimalPlaces?: number,
): string | null {
  if (typeof quote === "string") {
    const trimmed = quote.trim();
    if (!trimmed || !Number.isFinite(Number(trimmed))) {
      return null;
    }

    if (typeof decimalPlaces === "number" && decimalPlaces >= 0) {
      return Number(trimmed).toFixed(decimalPlaces);
    }

    return trimmed;
  }

  if (!Number.isFinite(quote)) {
    return null;
  }

  if (typeof decimalPlaces === "number" && decimalPlaces >= 0) {
    return quote.toFixed(decimalPlaces);
  }

  return toPlainDecimalString(quote);
}

/**
 * Interprets pip_size when present.
 * Active-symbol responses may send a fraction (0.0001).
 * Tick responses may send a decimal-place count (5).
 * Returns undefined when the value cannot be used safely.
 */
export function decimalPlacesFromPipSize(pipSize: number): number | undefined {
  if (!Number.isFinite(pipSize) || pipSize < 0) {
    return undefined;
  }

  if (Number.isInteger(pipSize) && pipSize <= 12) {
    return pipSize;
  }

  if (pipSize > 0 && pipSize < 1) {
    const places = Math.round(-Math.log10(pipSize));
    if (places >= 0 && places <= 12) {
      return places;
    }
  }

  return undefined;
}

function toPlainDecimalString(value: number): string {
  const asString = value.toString();
  if (!/[eE]/.test(asString)) {
    return asString;
  }

  const [mantissa, exponentPart] = asString.toLowerCase().split("e");
  const exponent = Number(exponentPart);
  const sign = mantissa.startsWith("-") ? "-" : "";
  const digits = mantissa.replace("-", "").replace(".", "");
  const decimalIndex = mantissa.replace("-", "").indexOf(".");
  const fractionLength = decimalIndex === -1 ? 0 : mantissa.replace("-", "").length - decimalIndex - 1;
  const shift = exponent - fractionLength;

  if (shift >= 0) {
    return `${sign}${digits}${("0").repeat(shift)}`;
  }

  const pad = Math.abs(shift);
  if (digits.length <= pad) {
    return `${sign}0.${"0".repeat(pad - digits.length)}${digits}`;
  }

  const splitAt = digits.length - pad;
  return `${sign}${digits.slice(0, splitAt)}.${digits.slice(splitAt)}`;
}
