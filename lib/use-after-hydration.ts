import { useSyncExternalStore } from "react";

let afterHydration = false;
const listeners = new Set<() => void>();

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);

  if (!afterHydration) {
    afterHydration = true;
    queueMicrotask(() => {
      listeners.forEach((listener) => listener());
    });
  }

  return () => {
    listeners.delete(onStoreChange);
  };
}

function getSnapshot(): boolean {
  return afterHydration;
}

function getServerSnapshot(): boolean {
  return false;
}

/** False on the server and during hydration; true only after subscribe. */
export function useAfterHydration(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
