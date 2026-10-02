export type EntryMapStatus =
  | "WAITING"
  | "TRIGGERED"
  | "CONFIRMING"
  | "SIGNAL";

export type EntryMapConfig = {
  triggerDigit: number;
  confirmation: number[];
};

export type ConsecutiveRun = {
  digit: number | null;
  count: number;
};

export type EntryMapEvaluation = {
  status: EntryMapStatus;
  matchedLength: number;
  pattern: number[];
  consecutive: ConsecutiveRun;
};

const VALID_DIGIT = (digit: number): boolean =>
  Number.isInteger(digit) && digit >= 0 && digit <= 9;

export function sanitizeDigit(value: number): number {
  if (!VALID_DIGIT(value)) {
    return 0;
  }
  return value;
}

export function buildEntryPattern(config: EntryMapConfig): number[] {
  const trigger = sanitizeDigit(config.triggerDigit);
  const confirmation = config.confirmation
    .filter(VALID_DIGIT)
    .map(sanitizeDigit);
  return [trigger, ...confirmation];
}

export function evaluateEntryMap(
  digits: number[],
  config: EntryMapConfig,
): EntryMapEvaluation {
  const valid = digits.filter(VALID_DIGIT);
  const pattern = buildEntryPattern(config);
  const consecutive = consecutiveRun(valid);

  if (pattern.length === 0) {
    return {
      status: "WAITING",
      matchedLength: 0,
      pattern,
      consecutive,
    };
  }

  if (matchesTail(valid, pattern)) {
    return {
      status: "SIGNAL",
      matchedLength: pattern.length,
      pattern,
      consecutive,
    };
  }

  const matchedLength = longestPrefixAsSuffix(valid, pattern);

  if (matchedLength <= 0) {
    return {
      status: "WAITING",
      matchedLength: 0,
      pattern,
      consecutive,
    };
  }

  if (matchedLength === 1) {
    return {
      status: "TRIGGERED",
      matchedLength,
      pattern,
      consecutive,
    };
  }

  return {
    status: "CONFIRMING",
    matchedLength,
    pattern,
    consecutive,
  };
}

function consecutiveRun(digits: number[]): ConsecutiveRun {
  if (digits.length === 0) {
    return { digit: null, count: 0 };
  }

  const digit = digits[digits.length - 1];
  let count = 0;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    if (digits[index] !== digit) {
      break;
    }
    count += 1;
  }

  return { digit, count };
}

function matchesTail(digits: number[], pattern: number[]): boolean {
  if (digits.length < pattern.length) {
    return false;
  }

  const tail = digits.slice(-pattern.length);
  return tail.every((digit, index) => digit === pattern[index]);
}

function longestPrefixAsSuffix(digits: number[], pattern: number[]): number {
  const max = Math.min(pattern.length - 1, digits.length);

  for (let length = max; length >= 1; length -= 1) {
    const tail = digits.slice(-length);
    const prefix = pattern.slice(0, length);
    if (tail.every((digit, index) => digit === prefix[index])) {
      return length;
    }
  }

  return 0;
}
