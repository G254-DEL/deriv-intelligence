export const MAX_TICKS_PER_MARKET = 100;

export type TickHistoryEntry = {
  symbol: string;
  quote: number | string;
  formattedQuote: string;
  epoch: number;
  digit: string;
  id?: string;
};

export class TickHistoryStore {
  private readonly histories = new Map<string, TickHistoryEntry[]>();

  push(entry: TickHistoryEntry): TickHistoryEntry[] {
    const current = this.histories.get(entry.symbol) ?? [];
    const next = [...current, entry];
    if (next.length > MAX_TICKS_PER_MARKET) {
      next.splice(0, next.length - MAX_TICKS_PER_MARKET);
    }
    this.histories.set(entry.symbol, next);
    return next;
  }

  get(symbol: string): TickHistoryEntry[] {
    return this.histories.get(symbol) ?? [];
  }

  clear(symbol?: string): void {
    if (symbol) {
      this.histories.delete(symbol);
      return;
    }
    this.histories.clear();
  }
}
