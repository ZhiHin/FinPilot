import { cookies } from "next/headers";

export const SESSION_COOKIE = "finpilot_session";

// Cookie lifetime matches the absolute session cap; the database decides real
// validity (idle timeout, revocation), so a lingering cookie is inert.
const COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** Only callable from Server Actions / Route Handlers (Next 16 cookie-write rule). */
export async function setSessionCookie(token: string): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function getSessionToken(): Promise<string | null> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
}
