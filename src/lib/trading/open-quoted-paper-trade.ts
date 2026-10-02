import type { DigitAnalysis } from "../strategy/digit-bias";
import type { DerivProposal, ProposalRequest } from "../deriv/types";
import type { RiskConfig } from "./risk";
import { DEFAULT_RISK_CONFIG } from "./risk";
import type { TradingSession } from "./session";
import type { PaperTrade } from "./types";
import { createTradingSignal } from "./signal";
import { openControlledPaperTrade } from "./controller";
import { applyProposalQuote } from "./paper-engine";
import { paperProposalRequest, parseProposalQuote } from "./proposal";

export type PaperProposalClient = {
  requestProposal(
    request: Omit<ProposalRequest, "proposal" | "req_id">,
  ): Promise<DerivProposal>;
};

export async function quoteAndOpenPaperTrade(params: {
  client: PaperProposalClient;
  symbol: string;
  analysis: DigitAnalysis;
  session: TradingSession;
  currency: string;
  targetProfit: number;
  riskConfig?: RiskConfig;
  inFlight: Record<string, boolean>;
}): Promise<PaperTrade | null> {
  const {
    client,
    symbol,
    analysis,
    session,
    currency,
    targetProfit,
    inFlight,
  } = params;
  const riskConfig = params.riskConfig ?? DEFAULT_RISK_CONFIG;

  if (inFlight[symbol] || riskConfig.stake <= 0) {
    return null;
  }

  const signal = createTradingSignal(analysis);
  if (!signal) {
    return null;
  }

  inFlight[symbol] = true;

  try {
    const probeQuote = await requestQuote(client, {
      amount: riskConfig.stake,
      currency,
      symbol,
      contractType: signal.contractType,
      barrier: signal.barrier,
    });

    if (!probeQuote) {
      return null;
    }

    const opened = openControlledPaperTrade(
      session,
      {
        ...signal,
        symbol,
        payoutRatio: probeQuote.payoutRatio,
        quotedPayout: probeQuote.payout,
        targetProfit,
      },
      riskConfig,
    );

    if (!opened.allowed || !opened.trade) {
      return null;
    }

    if (Math.abs(opened.trade.stake - probeQuote.askPrice) <= 0.0001) {
      return applyProposalQuote(opened.trade, probeQuote);
    }

    const liveQuote = await requestQuote(client, {
      amount: opened.trade.stake,
      currency,
      symbol,
      contractType: signal.contractType,
      barrier: signal.barrier,
    });

    if (!liveQuote) {
      return null;
    }

    return applyProposalQuote(opened.trade, liveQuote);
  } finally {
    inFlight[symbol] = false;
  }
}

async function requestQuote(
  client: PaperProposalClient,
  params: {
    amount: number;
    currency: string;
    symbol: string;
    contractType: string;
    barrier?: number;
  },
) {
  try {
    const proposal = await client.requestProposal(paperProposalRequest(params));
    return parseProposalQuote(proposal);
  } catch {
    return null;
  }
}
