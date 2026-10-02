import assert from "node:assert/strict";
import test from "node:test";
import { parseProposalQuote, paperProposalRequest } from "./proposal";
import { createPaperTrade, settlePaperTrade } from "./paper-engine";
import { calculateRecoveryStake } from "./recovery";
import { quoteAndOpenPaperTrade } from "./open-quoted-paper-trade";
import { createTradingSession } from "./session";
import { closeControlledPaperTrade } from "./controller";

const SIGNAL_ANALYSIS = {
  state: "SIGNAL" as const,
  strategy: "Digit Bias" as const,
  sampleSize: 20,
  dominantDigit: 7,
  dominantFrequency: 0.8,
};

const PAPER_RISK = {
  stake: 2,
  maxConsecutiveLosses: 3,
  maxSessionLoss: 50,
  maxTradesPerSession: 50,
  cooldownAfterLossMs: 0,
};

function sessionSnapshot(session: ReturnType<typeof createTradingSession>) {
  return { ...session };
}

test("parseProposalQuote uses Deriv payout and ask_price", () => {
  const quote = parseProposalQuote({ id: "prop-1", ask_price: "2.50", payout: "4.75" });
  assert.ok(quote);
  assert.equal(quote.askPrice, 2.5);
  assert.equal(quote.payout, 4.75);
  assert.equal(quote.payoutRatio, (4.75 - 2.5) / 2.5);
});

test("paper settlement uses the quoted Deriv payout, not a hardcoded ratio", () => {
  const trade = createPaperTrade({
    strategy: "UNDER_7",
    symbol: "1HZ100V",
    contractType: "DIGITUNDER",
    barrier: 7,
    stake: 2.5,
    quotedPayout: 4.75,
    entryDigit: 4,
  });

  const won = settlePaperTrade(trade, 3, true);
  assert.equal(won.payout, 4.75);
  assert.equal(won.profitLoss, 2.25);

  const lost = settlePaperTrade(trade, 8, false);
  assert.equal(lost.payout, 0);
  assert.equal(lost.profitLoss, -2.5);
});

test("recovery stake can exceed a $1 default without a ceiling", () => {
  const result = calculateRecoveryStake({
    accumulatedLoss: 10,
    targetProfit: 0.1,
    payoutRatio: 0.8,
    baseStake: 1,
  });

  assert.equal(result.allowed, true);
  assert.ok(result.stake > 1);
  assert.equal(result.stake, Math.ceil((10.1 / 0.8) * 100) / 100);
});

test("quoteAndOpenPaperTrade sizes recovery from the live proposal then re-quotes", async () => {
  const requests: number[] = [];
  const session = createTradingSession();
  session.consecutiveLosses = 1;
  session.profitLoss = -5;

  const trade = await quoteAndOpenPaperTrade({
    client: {
      async requestProposal(request) {
        requests.push(request.amount);
        return {
          id: "proposal-1",
          ask_price: request.amount,
          payout: request.amount * 1.8,
        };
      },
    },
    symbol: "1HZ100V",
    analysis: {
      state: "SIGNAL",
      strategy: "Digit Bias",
      sampleSize: 20,
      dominantDigit: 7,
      dominantFrequency: 0.8,
    },
    session,
    currency: "USD",
    targetProfit: 0.1,
    riskConfig: {
      stake: 2,
      maxConsecutiveLosses: 3,
      maxSessionLoss: 50,
      maxTradesPerSession: 50,
      cooldownAfterLossMs: 0,
    },
    inFlight: {},
  });

  assert.ok(trade);
  assert.equal(requests.length, 2);
  assert.equal(requests[0], 2);
  assert.ok(requests[1] > 2);
  assert.equal(trade.stake, requests[1]);
  assert.equal(trade.quotedPayout, requests[1] * 1.8);

  const closed = closeControlledPaperTrade(session, trade, 1);
  assert.equal(closed.trade.status, "WON");
  assert.equal(closed.trade.payout, trade.quotedPayout);
});

test("quoteAndOpenPaperTrade returns null and clears inFlight when the first proposal fails", async () => {
  const session = createTradingSession();
  const before = sessionSnapshot(session);
  const inFlight: Record<string, boolean> = {};

  const trade = await quoteAndOpenPaperTrade({
    client: {
      async requestProposal() {
        throw new Error("proposal unavailable");
      },
    },
    symbol: "1HZ100V",
    analysis: SIGNAL_ANALYSIS,
    session,
    currency: "USD",
    targetProfit: 0.1,
    riskConfig: PAPER_RISK,
    inFlight,
  });

  assert.equal(trade, null);
  assert.equal(inFlight["1HZ100V"], false);
  assert.deepEqual(session, before);
});

test("quoteAndOpenPaperTrade rejects invalid first proposal payloads without opening a trade", async () => {
  const session = createTradingSession();
  const before = sessionSnapshot(session);
  const inFlight: Record<string, boolean> = {};

  const trade = await quoteAndOpenPaperTrade({
    client: {
      async requestProposal() {
        return { id: "bad", ask_price: 2, payout: 2 };
      },
    },
    symbol: "1HZ100V",
    analysis: SIGNAL_ANALYSIS,
    session,
    currency: "USD",
    targetProfit: 0.1,
    riskConfig: PAPER_RISK,
    inFlight,
  });

  assert.equal(trade, null);
  assert.equal(inFlight["1HZ100V"], false);
  assert.deepEqual(session, before);
});

test("quoteAndOpenPaperTrade clears inFlight when recovery re-quote fails", async () => {
  const session = createTradingSession();
  session.consecutiveLosses = 1;
  session.profitLoss = -5;
  const before = sessionSnapshot(session);
  const inFlight: Record<string, boolean> = {};
  let calls = 0;

  const trade = await quoteAndOpenPaperTrade({
    client: {
      async requestProposal(request) {
        calls += 1;
        if (calls === 1) {
          return {
            id: "probe",
            ask_price: request.amount,
            payout: request.amount * 1.8,
          };
        }
        throw new Error("recovery quote failed");
      },
    },
    symbol: "1HZ100V",
    analysis: SIGNAL_ANALYSIS,
    session,
    currency: "USD",
    targetProfit: 0.1,
    riskConfig: PAPER_RISK,
    inFlight,
  });

  assert.equal(trade, null);
  assert.equal(calls, 2);
  assert.equal(inFlight["1HZ100V"], false);
  assert.deepEqual(session, before);
});

test("quoteAndOpenPaperTrade returns null when recovery re-quote payload is invalid", async () => {
  const session = createTradingSession();
  session.consecutiveLosses = 1;
  session.profitLoss = -5;
  const before = sessionSnapshot(session);
  const inFlight: Record<string, boolean> = {};
  let calls = 0;

  const trade = await quoteAndOpenPaperTrade({
    client: {
      async requestProposal(request) {
        calls += 1;
        if (calls === 1) {
          return {
            id: "probe",
            ask_price: request.amount,
            payout: request.amount * 1.8,
          };
        }
        return { id: "bad-recovery", ask_price: "x", payout: "y" };
      },
    },
    symbol: "1HZ100V",
    analysis: SIGNAL_ANALYSIS,
    session,
    currency: "USD",
    targetProfit: 0.1,
    riskConfig: PAPER_RISK,
    inFlight,
  });

  assert.equal(calls, 2);
  assert.equal(trade, null);
  assert.equal(inFlight["1HZ100V"], false);
  assert.deepEqual(session, before);
});

test("quoteAndOpenPaperTrade skips a symbol that already has a quote in flight", async () => {
  const session = createTradingSession();
  const before = sessionSnapshot(session);
  const inFlight = { "1HZ100V": true };

  const trade = await quoteAndOpenPaperTrade({
    client: {
      async requestProposal() {
        throw new Error("should not request");
      },
    },
    symbol: "1HZ100V",
    analysis: SIGNAL_ANALYSIS,
    session,
    currency: "USD",
    targetProfit: 0.1,
    riskConfig: PAPER_RISK,
    inFlight,
  });

  assert.equal(trade, null);
  assert.equal(inFlight["1HZ100V"], true);
  assert.deepEqual(session, before);
});

test("paperProposalRequest is a quote, not a buy", () => {
  const request = paperProposalRequest({
    amount: 3,
    currency: "USD",
    symbol: "R_100",
    contractType: "DIGITOVER",
    barrier: 2,
  });

  assert.equal(request.basis, "stake");
  assert.equal(request.amount, 3);
  assert.equal(request.barrier, "2");
  assert.equal(request.duration, 1);
  assert.equal(request.duration_unit, "t");
  assert.equal("buy" in request, false);
  assert.equal("subscribe" in request, false);
});

test("parseProposalQuote rejects missing id and expired proposals", () => {
  const now = 1_700_000_000_000;

  assert.equal(
    parseProposalQuote({ id: "", ask_price: 2, payout: 4 }, now),
    null,
  );
  assert.equal(
    parseProposalQuote(
      { id: "expired", ask_price: 2, payout: 4, date_expiry: 1_699_999_999 },
      now,
    ),
    null,
  );

  const live = parseProposalQuote(
    { id: "live", ask_price: 2, payout: 4, date_expiry: 1_700_000_001 },
    now,
  );
  assert.ok(live);
  assert.equal(live.payout, 4);
});

test("quoteAndOpenPaperTrade ignores expired and unidentified proposals", async () => {
  const session = createTradingSession();
  const before = sessionSnapshot(session);
  const inFlight: Record<string, boolean> = {};

  const expired = await quoteAndOpenPaperTrade({
    client: {
      async requestProposal() {
        return {
          id: "stale",
          ask_price: 2,
          payout: 3.8,
          date_expiry: 1,
        };
      },
    },
    symbol: "1HZ100V",
    analysis: SIGNAL_ANALYSIS,
    session,
    currency: "USD",
    targetProfit: 0.1,
    riskConfig: PAPER_RISK,
    inFlight,
  });

  assert.equal(expired, null);

  const unidentified = await quoteAndOpenPaperTrade({
    client: {
      async requestProposal() {
        return { id: "   ", ask_price: 2, payout: 3.8 };
      },
    },
    symbol: "1HZ100V",
    analysis: SIGNAL_ANALYSIS,
    session,
    currency: "USD",
    targetProfit: 0.1,
    riskConfig: PAPER_RISK,
    inFlight,
  });

  assert.equal(unidentified, null);
  assert.equal(inFlight["1HZ100V"], false);
  assert.deepEqual(session, before);
});
