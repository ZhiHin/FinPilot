import { redirect } from "next/navigation";
import { cache } from "react";

import { getSessionToken } from "./cookies";
import { getAuthService } from "./instance";
import type { CurrentSession } from "./service";

/**
 * Resolves the current session from the cookie against the database.
 * Memoized per request. This is the real check — proxy.ts only does a
 * coarse cookie-presence redirect.
 */
export const getCurrentSession = cache(async (): Promise<CurrentSession | null> => {
  const token = await getSessionToken();
  if (!token) return null;
  return getAuthService().validateSession(token);
});

/**
 * Every protected page, layout, server action, and route handler goes through
 * this (or getCurrentSession) — the authenticated user id is ONLY ever taken
 * from here, never from client input.
 */
export async function requireUser(): Promise<CurrentSession> {
  const current = await getCurrentSession();
  if (!current) {
    redirect("/sign-in");
  }
  // Deletion-scheduled accounts see only the restore gate (Phase 10) —
  // every page, action, and API route funnels through here.
  if (current.user.status === "pending_purge") {
    redirect("/restore");
  }
  return current;
}
