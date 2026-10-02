import assert from "node:assert/strict";
import test from "node:test";
import { assertAllowedPublicMarketDataRequest } from "./public-request-guard";
import { PublicMarketDataClient } from "./public-market-data";
import { paperProposalRequest } from "../trading/proposal";

test("public market-data requests allow ticks, symbols, forget, and quote-only proposals", () => {
  assert.doesNotThrow(() =>
    assertAllowedPublicMarketDataRequest({
      active_symbols: "brief",
      req_id: 1,
    }),
  );
  assert.doesNotThrow(() =>
    assertAllowedPublicMarketDataRequest({
      ticks: "1HZ100V",
      subscribe: 1,
      req_id: 2,
    }),
  );
  assert.doesNotThrow(() =>
    assertAllowedPublicMarketDataRequest({
      forget: "abc",
      req_id: 3,
    }),
  );
  assert.doesNotThrow(() =>
    assertAllowedPublicMarketDataRequest({
      forget_all: "ticks",
      req_id: 4,
    }),
  );
  assert.doesNotThrow(() =>
    assertAllowedPublicMarketDataRequest({
      pong: 1,
    }),
  );
  assert.doesNotThrow(() =>
    assertAllowedPublicMarketDataRequest({
      proposal: 1,
      amount: 1,
      basis: "stake",
      contract_type: "DIGITUNDER",
      currency: "USD",
      underlying_symbol: "R_100",
      req_id: 5,
    }),
  );
});

test("public market-data client rejects buy and other live-order requests", () => {
  assert.throws(
    () => assertAllowedPublicMarketDataRequest({ buy: 1, price: 10 }),
    /live-order/i,
  );
  assert.throws(
    () =>
      assertAllowedPublicMarketDataRequest({
        proposal: 1,
        buy: "proposal-id",
        amount: 1,
      }),
    /buy/i,
  );
  assert.throws(
    () => assertAllowedPublicMarketDataRequest({ sell: 1 }),
    /live-order/i,
  );
  assert.throws(
    () => assertAllowedPublicMarketDataRequest({ authorize: "token" }),
    /live-order/i,
  );
});

test("requestProposal rejects a buy payload before connecting", async () => {
  const client = new PublicMarketDataClient();
  const quote = paperProposalRequest({
    amount: 1,
    currency: "USD",
    symbol: "R_100",
    contractType: "DIGITUNDER",
    barrier: 7,
  });

  await assert.rejects(
    () =>
      client.requestProposal({
        ...quote,
        buy: 1,
      } as typeof quote & { buy: number }),
    /buy/i,
  );
});
