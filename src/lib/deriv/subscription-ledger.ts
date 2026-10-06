export type SubscriptionOwner = {
  symbols: string[];
  priority: number;
};

export type SubscriptionLedger = {
  owners: Record<string, SubscriptionOwner>;
  consumers: Record<string, number>;
};

export function emptySubscriptionLedger(): SubscriptionLedger {
  return { owners: {}, consumers: {} };
}

export function setOwnerSymbols(
  ledger: SubscriptionLedger,
  owner: string,
  symbols: string[],
  priority = 0,
): SubscriptionLedger {
  return {
    ...ledger,
    owners: {
      ...ledger.owners,
      [owner]: { symbols: uniqueSymbols(symbols), priority },
    },
  };
}

export function releaseOwner(ledger: SubscriptionLedger, owner: string): SubscriptionLedger {
  if (!ledger.owners[owner]) {
    return ledger;
  }
  const owners = { ...ledger.owners };
  delete owners[owner];
  return { ...ledger, owners };
}

export function retainConsumer(ledger: SubscriptionLedger, symbol: string): SubscriptionLedger {
  const trimmed = symbol.trim();
  if (!trimmed) {
    return ledger;
  }
  return {
    ...ledger,
    consumers: {
      ...ledger.consumers,
      [trimmed]: (ledger.consumers[trimmed] ?? 0) + 1,
    },
  };
}

export function releaseConsumer(ledger: SubscriptionLedger, symbol: string): SubscriptionLedger {
  const trimmed = symbol.trim();
  const count = ledger.consumers[trimmed] ?? 0;
  if (count <= 1) {
    const consumers = { ...ledger.consumers };
    delete consumers[trimmed];
    return { ...ledger, consumers };
  }
  return {
    ...ledger,
    consumers: { ...ledger.consumers, [trimmed]: count - 1 },
  };
}

export function requiredSubscriptionSymbols(
  ledger: SubscriptionLedger,
  ceiling: number,
): string[] {
  return activeSymbols(ledger, ceiling);
}

export function activeSymbols(ledger: SubscriptionLedger, limit: number): string[] {
  const unique: string[] = [];
  const push = (symbol: string) => {
    if (!symbol || unique.includes(symbol) || unique.length >= limit) {
      return;
    }
    unique.push(symbol);
  };

  const owners = Object.values(ledger.owners).sort((left, right) => right.priority - left.priority);
  for (const owner of owners) {
    for (const symbol of owner.symbols) {
      push(symbol);
    }
  }
  for (const [symbol, count] of Object.entries(ledger.consumers)) {
    if (count > 0) {
      push(symbol);
    }
  }
  return unique;
}

function uniqueSymbols(symbols: string[]): string[] {
  const unique: string[] = [];
  for (const raw of symbols) {
    const symbol = raw.trim();
    if (symbol && !unique.includes(symbol)) {
      unique.push(symbol);
    }
  }
  return unique;
}
