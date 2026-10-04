export class DerivNotConnectedError extends Error {
  constructor(method?: string) {
    const suffix = method ? ` (${method})` : "";
    super(`Deriv market data is not connected${suffix}.`);
    this.name = "DerivNotConnectedError";
  }
}
