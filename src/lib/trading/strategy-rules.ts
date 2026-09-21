import type { BotStrategy } from "./types";

export function strategyWins(
  strategy: BotStrategy,
  exitDigit: number,
  evenOddSide: "EVEN" | "ODD" = "EVEN",
): boolean {
  if (!Number.isInteger(exitDigit) || exitDigit < 0 || exitDigit > 9) {
    return false;
  }

  switch (strategy) {
    case "EVEN_ODD":
      return evenOddSide === "EVEN"
        ? exitDigit % 2 === 0
        : exitDigit % 2 !== 0;

    case "OVER_2":
      return exitDigit > 2;

    case "OVER_3":
      return exitDigit > 3;

    case "UNDER_7":
      return exitDigit < 7;

    case "UNDER_8":
      return exitDigit < 8;
  }
}
