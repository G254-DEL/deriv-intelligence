import type { DigitAnalysis } from "../strategy/digit-bias";
import type { DerivProposal } from "../deriv/types";
import type { TradingSession } from "./session";
import type { RiskConfig } from "./risk";

import { createTradingSignal } from "./signal";
import {
  openControlledPaperTrade,
  type OpenTradeResult,
  type PaperTradeSignal,
} from "./controller";
import { parseProposalQuote } from "./proposal";

export type BotEngineInput = {
  symbol: string;
  analysis: DigitAnalysis;
  session: TradingSession;
  proposal: DerivProposal;
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

  const quote = parseProposalQuote(input.proposal);
  if (!quote) {
    return {
      allowed: false,
      reason: "Live proposal quote is required",
    };
  }

  const paperSignal: PaperTradeSignal = {
    ...signal,
    symbol: input.symbol,
    quote,
    targetProfit: input.targetProfit,
  };

  return openControlledPaperTrade(
    input.session,
    paperSignal,
    input.riskConfig,
  );
}
