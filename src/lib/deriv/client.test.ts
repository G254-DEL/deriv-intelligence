import assert from "node:assert/strict";
import test from "node:test";
import {
  DerivMarketDataClient,
  mapConnectionStatus,
} from "./client";
import { DerivNotConnectedError } from "./errors";
import { parseTicksHistory } from "./public-market-data";
import { assertAllowedPublicMarketDataRequest } from "./public-request-guard";
import { DERIV_PUBLIC_WS_URL } from "./constants";

test("mapConnectionStatus preserves connected, connecting, and error", () => {
  assert.equal(mapConnectionStatus("disconnected"), "not_connected");
  assert.equal(mapConnectionStatus("connecting"), "connecting");
  assert.equal(mapConnectionStatus("connected"), "connected");
  assert.equal(mapConnectionStatus("error"), "error");
});

test("parseTicksHistory maps Deriv history prices and times", () => {
  const ticks = parseTicksHistory(
    {
      msg_type: "history",
      history: {
        prices: ["100.12", 100.13, "bad"],
        times: [1_700_000_000, 1_700_000_001, 1_700_000_002],
      },
    },
    "R_100",
  );

  assert.equal(ticks.length, 2);
  assert.deepEqual(ticks[0], {
    symbol: "R_100",
    quote: 100.12,
    epoch: 1_700_000_000,
  });
  assert.deepEqual(ticks[1], {
    symbol: "R_100",
    quote: 100.13,
    epoch: 1_700_000_001,
  });
});

test("parseTicksHistory returns an empty list for invalid payloads", () => {
  assert.deepEqual(parseTicksHistory({}, "R_100"), []);
  assert.deepEqual(parseTicksHistory({ history: { prices: [1] } }, "R_100"), []);
});

test("DerivMarketDataClient uses the public endpoint and rejects work while disconnected", async () => {
  const client = new DerivMarketDataClient();

  assert.equal(client.publicEndpoint, DERIV_PUBLIC_WS_URL);
  assert.equal(client.getStatus(), "not_connected");
  assert.match(client.getConnectionLabel(), /Disconnected/i);
  assert.deepEqual(client.getScannerSnapshot().rows, []);

  await assert.rejects(
    () => client.getActiveSymbols(),
    DerivNotConnectedError,
  );
  await assert.rejects(
    () => client.getTicksHistory({ ticks_history: "R_100", end: "latest" }),
    DerivNotConnectedError,
  );
  await assert.rejects(
    () => client.getContractsFor({ contracts_for: "R_100" }),
    DerivNotConnectedError,
  );
  assert.throws(
    () =>
      client.subscribeTicks({ ticks: "R_100", subscribe: 1 }, () => undefined),
    DerivNotConnectedError,
  );
});

test("ticks_history requests are allowed and buy remains rejected", () => {
  assert.doesNotThrow(() =>
    assertAllowedPublicMarketDataRequest({
      ticks_history: "R_100",
      end: "latest",
      count: 20,
      style: "ticks",
    }),
  );
  assert.throws(
    () =>
      assertAllowedPublicMarketDataRequest({
        ticks_history: "R_100",
        buy: 1,
      }),
    /buy/i,
  );
});
