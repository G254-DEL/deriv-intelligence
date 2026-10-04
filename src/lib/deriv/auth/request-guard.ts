const LIVE_ORDER_KEYS = [
  "buy",
  "sell",
  "cashier",
  "cancel",
  "contract_update",
  "proposal",
  "paymentagent_transfer",
  "paymentagent_withdraw",
  "p2p_order_create",
  "mt5_new_account",
  "mt5_deposit",
  "transfer_between_accounts",
] as const;

const ALLOWED_OPERATIONS = [
  "authorize",
  "logout",
  "balance",
  "ping",
  "pong",
] as const;

export function assertAllowedAuthenticatedAccountRequest(
  body: Record<string, unknown>,
): void {
  for (const key of LIVE_ORDER_KEYS) {
    if (body[key] !== undefined && body[key] !== null) {
      throw new Error(
        `Rejected live-order request on the authenticated account client: ${key}`,
      );
    }
  }

  const hasAllowed = ALLOWED_OPERATIONS.some(
    (key) => body[key] !== undefined && body[key] !== null,
  );

  if (!hasAllowed) {
    throw new Error(
      "Rejected WebSocket request: authenticated client only allows authorize, balance, logout, and ping.",
    );
  }
}
