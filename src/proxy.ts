import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE } from "@/server/auth/cookies";

/**
 * Coarse cookie-presence gate only. The real session check (database-backed)
 * happens in the protected layout / requireUser(); server actions re-authenticate
 * individually, since proxy exclusions also skip server-function calls.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isAuthSurface =
    pathname.startsWith("/sign-in") ||
    pathname.startsWith("/sign-up") ||
    pathname.startsWith("/reset-password");
  const hasSessionCookie = request.cookies.has(SESSION_COOKIE);

  if (!hasSessionCookie && !isAuthSurface && pathname !== "/") {
    const url = new URL("/sign-in", request.url);
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Nonce-based CSP in production; dev tooling (HMR, eval source maps) is exempt.
  if (process.env.NODE_ENV === "production") {
    const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
    const csp = [
      "default-src 'self'",
      `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' blob: data:",
      "font-src 'self'",
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; ");

    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("Content-Security-Policy", csp);
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set("Content-Security-Policy", csp);
    return response;
  }

  return NextResponse.next();
}

export const config = {
  // Everything except Next internals, API routes, and static files.
  matcher: ["/((?!_next|api|favicon\\.ico|.*\\..*).*)"],
};
