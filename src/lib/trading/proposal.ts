import type { DerivProposal, ProposalRequest } from "../deriv/types";

const VALIDATED_PROPOSAL_QUOTE = Symbol("validatedProposalQuote");

export type PaperProposalQuote = {
  askPrice: number;
  payout: number;
  payoutRatio: number;
};

export type ValidatedPaperProposalQuote = PaperProposalQuote & {
  readonly [VALIDATED_PROPOSAL_QUOTE]: true;
};

export function isValidatedProposalQuote(
  quote: unknown,
): quote is ValidatedPaperProposalQuote {
  if (!quote || typeof quote !== "object") {
    return false;
  }

  const candidate = quote as Partial<ValidatedPaperProposalQuote>;
  if (candidate[VALIDATED_PROPOSAL_QUOTE] !== true) {
    return false;
  }

  if (
    !Number.isFinite(candidate.askPrice) ||
    (candidate.askPrice ?? 0) <= 0 ||
    !Number.isFinite(candidate.payout) ||
    (candidate.payout ?? 0) <= (candidate.askPrice ?? 0) ||
    !Number.isFinite(candidate.payoutRatio) ||
    (candidate.payoutRatio ?? 0) <= 0
  ) {
    return false;
  }

  const expectedRatio =
    (candidate.payout! - candidate.askPrice!) / candidate.askPrice!;
  return Math.abs(expectedRatio - candidate.payoutRatio!) <= 1e-9;
}

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
): ValidatedPaperProposalQuote | null {
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

  return {
    askPrice,
    payout,
    payoutRatio,
    [VALIDATED_PROPOSAL_QUOTE]: true,
  };
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
