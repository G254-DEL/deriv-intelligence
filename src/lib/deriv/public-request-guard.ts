const LIVE_ORDER_KEYS = [
  "buy",
  "sell",
  "authorize",
  "cashier",
  "cancel",
  "contract_update",
  "transfer_between_accounts",
  "topup_virtual",
  "paymentagent_transfer",
  "paymentagent_withdraw",
  "p2p_order_create",
  "mt5_new_account",
  "mt5_deposit",
  "new_account_real",
  "new_account_virtual",
] as const;

const ALLOWED_OPERATIONS = [
  "proposal",
  "active_symbols",
  "ticks",
  "ticks_history",
  "contracts_for",
  "forget",
  "forget_all",
  "ping",
  "pong",
] as const;

export function assertAllowedPublicMarketDataRequest(
  body: Record<string, unknown>,
): void {
  for (const key of LIVE_ORDER_KEYS) {
    if (body[key] !== undefined && body[key] !== null) {
      throw new Error(
        `Rejected live-order WebSocket request: ${key}`,
      );
    }
  }

  const hasAllowedOperation = ALLOWED_OPERATIONS.some((key) => {
    if (body[key] === undefined || body[key] === null) {
      return false;
    }
    if (key === "proposal") {
      return body.proposal === 1;
    }
    return true;
  });

  if (!hasAllowedOperation) {
    throw new Error(
      "Rejected WebSocket request: only public market-data and proposal quotes are allowed.",
    );
  }
}
