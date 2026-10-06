export const DIGIT_SAMPLE_LIMIT = 20;

export type DigitSampleBook = {
  digits: Record<string, number[]>;
  epochs: Record<string, number>;
};

export function emptyDigitSamples(): DigitSampleBook {
  return { digits: {}, epochs: {} };
}

export function recordDigitSample(
  book: DigitSampleBook,
  symbol: string,
  epoch: number,
  digit: number,
): { book: DigitSampleBook; accepted: boolean; history: number[] } {
  const code = symbol.trim();
  const history = book.digits[code] ?? [];
  if (!code || !Number.isInteger(digit) || digit < 0 || digit > 9) {
    return { book, accepted: false, history };
  }
  if (epoch > 0 && book.epochs[code] === epoch) {
    return { book, accepted: false, history };
  }

  const nextHistory = [...history, digit].slice(-DIGIT_SAMPLE_LIMIT);
  return {
    book: {
      digits: { ...book.digits, [code]: nextHistory },
      epochs: epoch > 0 ? { ...book.epochs, [code]: epoch } : book.epochs,
    },
    accepted: true,
    history: nextHistory,
  };
}
