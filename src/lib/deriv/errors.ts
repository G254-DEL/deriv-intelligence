export class DerivNotConnectedError extends Error {
  constructor(method?: string) {
    const suffix = method ? ` (${method})` : "";
    super(
      `Deriv market data is not connected${suffix}. This milestone does not open a live WebSocket.`,
    );
    this.name = "DerivNotConnectedError";
  }
}
