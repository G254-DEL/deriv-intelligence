import type { DigitAnalysis } from "../strategy/digit-bias";
import type { TradingSession } from "./session";
import type { RiskConfig } from "./risk";

import { createTradingSignal } from "./signal";
import {
  openControlledPaperTrade,
  type OpenTradeResult,
  type PaperTradeSignal,
} from "./controller";

export type BotEngineInput = {
  symbol: string;
  analysis: DigitAnalysis;
  session: TradingSession;
  payoutRatio: number;
  targetProfit?: number;
  riskConfig?: RiskConfig;
};

export function evaluatePaperTrade(
  input: BotEngineInput,
): OpenTradeResult | null {
  const signal = createTradingSignal(input.analysis);

  if (!signal) {
    return null;
  }

  const paperSignal: PaperTradeSignal = {
    ...signal,
    symbol: input.symbol,
    payoutRatio: input.payoutRatio,
    targetProfit: input.targetProfit,
  };

  return openControlledPaperTrade(
    input.session,
    paperSignal,
    input.riskConfig,
  );
}
