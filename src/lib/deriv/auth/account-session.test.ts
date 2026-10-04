import assert from "node:assert/strict";
import test from "node:test";
import { accountKindFromLoginid, parseAuthorizePayload, parseBalancePayload } from "./parse-account";
import { parseOAuthRedirectSearch, stripOAuthParamsFromUrl } from "./oauth";
import { assertAllowedAuthenticatedAccountRequest } from "./request-guard";
import { parseRestAccounts } from "./rest-accounts";
import { assertAllowedPublicMarketDataRequest } from "../public-request-guard";

test("accountKindFromLoginid distinguishes demo and real accounts", () => {
  assert.equal(accountKindFromLoginid("VRTC123", 1), "demo");
  assert.equal(accountKindFromLoginid("CR12345", 0), "real");
  assert.equal(accountKindFromLoginid("VRW1"), "demo");
  assert.equal(accountKindFromLoginid("MF123"), "real");
});

test("parseAuthorizePayload reads loginid, currency, and balance", () => {
  const parsed = parseAuthorizePayload({
    authorize: {
      loginid: "VRTC1001",
      currency: "USD",
      balance: 1000.5,
      is_virtual: 1,
      account_list: [
        { loginid: "VRTC1001", currency: "USD", is_virtual: 1 },
        { loginid: "CR9001", currency: "USD", is_virtual: 0 },
      ],
    },
  });

  assert.ok(parsed);
  assert.equal(parsed.loginid, "VRTC1001");
  assert.equal(parsed.currency, "USD");
  assert.equal(parsed.balance, 1000.5);
  assert.equal(parsed.kind, "demo");
  assert.equal(parsed.accounts.length, 2);
  assert.equal(parsed.accounts[1]?.kind, "real");
});

test("parseBalancePayload reads subscribed balance updates", () => {
  const parsed = parseBalancePayload({
    msg_type: "balance",
    balance: { balance: "12.34", currency: "USD", loginid: "VRTC1001" },
  });
  assert.ok(parsed);
  assert.equal(parsed.balance, 12.34);
  assert.equal(parsed.currency, "USD");
});

test("parseOAuthRedirectSearch reads legacy acct/token/cur pairs", () => {
  const parsed = parseOAuthRedirectSearch(
    "?acct1=VRTC1&token1=a1-secret&cur1=USD&acct2=CR1&token2=a1-other&cur2=USD",
  );
  assert.equal(parsed.type, "legacy_tokens");
  if (parsed.type === "legacy_tokens") {
    assert.equal(parsed.accounts[0]?.loginid, "VRTC1");
    assert.equal(parsed.accounts[0]?.currency, "USD");
    assert.equal(parsed.accounts.length, 2);
  }
});

test("parseOAuthRedirectSearch reads OAuth2 code and state", () => {
  const parsed = parseOAuthRedirectSearch("?code=abc&state=xyz");
  assert.deepEqual(parsed, { type: "oauth2_code", code: "abc", state: "xyz" });
});

test("stripOAuthParamsFromUrl removes tokens from the address bar", () => {
  const cleaned = stripOAuthParamsFromUrl(
    "http://localhost:3000/auth/deriv/callback?acct1=VRTC1&token1=a1-secret&cur1=USD&keep=1",
  );
  assert.equal(cleaned.includes("token1"), false);
  assert.equal(cleaned.includes("a1-secret"), false);
  assert.equal(cleaned.includes("keep=1"), true);
});

test("authenticated account guard allows authorize and balance but rejects buy", () => {
  assert.doesNotThrow(() =>
    assertAllowedAuthenticatedAccountRequest({ authorize: "session-token" }),
  );
  assert.doesNotThrow(() =>
    assertAllowedAuthenticatedAccountRequest({ balance: 1, subscribe: 1 }),
  );
  assert.doesNotThrow(() =>
    assertAllowedAuthenticatedAccountRequest({ logout: 1 }),
  );
  assert.throws(
    () => assertAllowedAuthenticatedAccountRequest({ buy: 1 }),
    /buy/i,
  );
  assert.throws(
    () => assertAllowedAuthenticatedAccountRequest({ proposal: 1 }),
    /proposal/i,
  );
});

test("public market-data guard still rejects authorize", () => {
  assert.throws(
    () => assertAllowedPublicMarketDataRequest({ authorize: "token" }),
    /authorize/i,
  );
});

test("parseRestAccounts maps flexible account payloads", () => {
  const accounts = parseRestAccounts({
    data: {
      accounts: [
        { loginid: "VRTC9", currency: "USD", is_virtual: true, balance: 10 },
      ],
    },
  });
  assert.equal(accounts[0]?.loginid, "VRTC9");
  assert.equal(accounts[0]?.kind, "demo");
  assert.equal(accounts[0]?.balance, 10);
});
