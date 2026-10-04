import type { DerivProposal, ProposalRequest } from "../deriv/types";
import type { RiskConfig } from "./risk";
import { DEFAULT_RISK_CONFIG } from "./risk";
import type { TradingSession } from "./session";
import type { PaperTrade } from "./types";
import { openControlledPaperTrade } from "./controller";
import { applyProposalQuote } from "./paper-engine";
import { paperProposalRequest, parseProposalQuote } from "./proposal";
import type { SpecialistFit } from "./specialist-edge";

export type ArmedProposalClient = {
  requestProposal(
    request: Omit<ProposalRequest, "proposal" | "req_id">,
  ): Promise<DerivProposal>;
};

export async function openArmedPaperTrade(params: {
  client: ArmedProposalClient;
  symbol: string;
  fit: SpecialistFit;
  session: TradingSession;
  currency: string;
  targetProfit: number;
  riskConfig?: RiskConfig;
  inFlight: Record<string, boolean>;
}): Promise<PaperTrade | null> {
  const riskConfig = params.riskConfig ?? DEFAULT_RISK_CONFIG;
  if (!params.fit.qualified || params.inFlight[params.symbol] || riskConfig.stake <= 0) {
    return null;
  }

  params.inFlight[params.symbol] = true;
  try {
    const proposal = await params.client.requestProposal(
      paperProposalRequest({
        amount: riskConfig.stake,
        currency: params.currency,
        symbol: params.symbol,
        contractType: params.fit.contractType,
        barrier: params.fit.barrier,
      }),
    );
    const quote = parseProposalQuote(proposal);
    if (!quote) {
      return null;
    }

    const opened = openControlledPaperTrade(
      params.session,
      {
        strategy: params.fit.strategy,
        symbol: params.symbol,
        contractType: params.fit.contractType,
        barrier: params.fit.barrier,
        evenOddSide: params.fit.evenOddSide,
        entryDigit: params.fit.barrier ?? 0,
        confidence: params.fit.probability,
        quote,
        targetProfit: params.targetProfit,
      },
      riskConfig,
    );
    if (!opened.allowed || !opened.trade) {
      return null;
    }
    return applyProposalQuote(opened.trade, quote);
  } catch {
    return null;
  } finally {
    params.inFlight[params.symbol] = false;
  }
}
