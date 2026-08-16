"use client";

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";

/**
 * Balance-privacy toggle (design doc §7): masks every AmountText globally.
 * Persisted per device in localStorage — deliberately not in the database,
 * so a shared screen can be masked without touching account state.
 */

const STORAGE_KEY = "finpilot_privacy_hidden";

const listeners = new Set<() => void>();

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

function writeStored(hidden: boolean): void {
  window.localStorage.setItem(STORAGE_KEY, hidden ? "1" : "0");
  listeners.forEach((listener) => listener());
}

interface PrivacyContextValue {
  hidden: boolean;
  toggle: () => void;
}

const PrivacyContext = createContext<PrivacyContextValue>({ hidden: false, toggle: () => {} });

export function PrivacyProvider({
  children,
  defaultHidden = false,
}: {
  children: React.ReactNode;
  defaultHidden?: boolean;
}) {
  const hidden = useSyncExternalStore(
    subscribe,
    () => {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      return stored === null ? defaultHidden : stored === "1";
    },
    () => defaultHidden,
  );

  const toggle = useCallback(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const current = stored === null ? defaultHidden : stored === "1";
    writeStored(!current);
  }, [defaultHidden]);

  const value = useMemo(() => ({ hidden, toggle }), [hidden, toggle]);
  return <PrivacyContext.Provider value={value}>{children}</PrivacyContext.Provider>;
}

export function usePrivacy(): PrivacyContextValue {
  return useContext(PrivacyContext);
}
