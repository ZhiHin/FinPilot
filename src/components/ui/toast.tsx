"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/cn";

/**
 * Minimal toast stack: sparse by design (design doc §7) — always paired with an
 * inline state change, auto-dismissing, announced politely to screen readers.
 */

interface Toast {
  id: number;
  message: string;
  variant: "neutral" | "positive" | "risk";
}

interface ToastContextValue {
  toast: (message: string, variant?: Toast["variant"]) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const toast = useCallback((message: string, variant: Toast["variant"] = "neutral") => {
    const id = nextId.current++;
    setToasts((current) => [...current.slice(-2), { id, message, variant }]);
    setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        className="fixed bottom-20 right-4 z-50 flex flex-col gap-2 sm:bottom-4"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "rounded-control border border-hairline bg-raised px-4 py-2.5 text-[13px] text-ink shadow-raised",
              t.variant === "positive" && "border-l-2 border-l-positive",
              t.variant === "risk" && "border-l-2 border-l-risk",
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
