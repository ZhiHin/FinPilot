import { headers } from "next/headers";

import type { AuthContext } from "./service";

/** Client IP (best effort behind proxies) and user agent for audit/rate limiting. */
export async function getAuthContext(): Promise<AuthContext> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  return { ip, userAgent: h.get("user-agent") };
}
