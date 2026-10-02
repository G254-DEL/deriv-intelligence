import type { DerivProposal, ProposalRequest } from "../deriv/types";

export type PaperProposalQuote = {
  askPrice: number;
  payout: number;
  payoutRatio: number;
};

export function parsePositiveProposalNumber(
  value: number | string | undefined,
): number | null {
  const parsed = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

/**
 * Deriv `payout` is the total return if the contract wins.
 * `payoutRatio` is profit / ask_price, used by recovery stake sizing.
 * Expired or unidentified quotes are rejected so they cannot open a paper trade.
 */
export function parseProposalQuote(
  proposal: Pick<DerivProposal, "id" | "ask_price" | "payout" | "date_expiry">,
  now = Date.now(),
): PaperProposalQuote | null {
  if (typeof proposal.id !== "string" || proposal.id.trim() === "") {
    return null;
  }

  if (isProposalExpired(proposal.date_expiry, now)) {
    return null;
  }

  const askPrice = parsePositiveProposalNumber(proposal.ask_price);
  const payout = parsePositiveProposalNumber(proposal.payout);

  if (askPrice === null || payout === null) {
    return null;
  }

  const payoutRatio = (payout - askPrice) / askPrice;
  if (!Number.isFinite(payoutRatio) || payoutRatio <= 0) {
    return null;
  }

  return { askPrice, payout, payoutRatio };
}

function isProposalExpired(
  dateExpiry: number | string | undefined,
  now: number,
): boolean {
  if (dateExpiry === undefined) {
    return false;
  }

  const expiry = Number(dateExpiry);
  if (!Number.isFinite(expiry) || expiry <= 0) {
    return true;
  }

  const expiryMs = expiry > 1e12 ? expiry : expiry * 1000;
  return expiryMs <= now;
}

export function paperProposalRequest(params: {
  amount: number;
  currency: string;
  symbol: string;
  contractType: string;
  barrier?: number;
}): Omit<ProposalRequest, "proposal" | "req_id"> {
  return {
    amount: params.amount,
    basis: "stake",
    contract_type: params.contractType,
    currency: params.currency,
    underlying_symbol: params.symbol,
    duration: 1,
    duration_unit: "t",
    ...(params.barrier === undefined ? {} : { barrier: String(params.barrier) }),
  };
}
