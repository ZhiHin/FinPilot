"use server";

import { redirect } from "next/navigation";

import { ok, type Result } from "@/lib/result";
import { zodToErr } from "@/lib/zod";
import { clearSessionCookie, getSessionToken, setSessionCookie } from "@/server/auth/cookies";
import { requireUser } from "@/server/auth/guard";
import { getAuthService } from "@/server/auth/instance";
import { getAuthContext } from "@/server/auth/request-context";
import {
  changePasswordSchema,
  requestResetSchema,
  resetPasswordSchema,
  revokeSessionSchema,
  safeInternalPath,
  signInSchema,
  signUpSchema,
} from "@/server/auth/schemas";

/** Form state for useActionState: null until first submit; errors are user-safe. */
export type AuthFormState = Result<{ message?: string }> | null;

export async function signUpAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = signUpSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    displayName: (formData.get("displayName") as string) || undefined,
  });
  if (!parsed.success) return zodToErr(parsed.error);

  const result = await getAuthService().signUp(parsed.data, await getAuthContext());
  if (!result.ok) return result;

  await setSessionCookie(result.data.sessionToken);
  redirect("/onboarding");
}

export async function signInAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    next: (formData.get("next") as string) || undefined,
  });
  if (!parsed.success) return zodToErr(parsed.error);

  const result = await getAuthService().signIn(parsed.data, await getAuthContext());
  if (!result.ok) return result;

  await setSessionCookie(result.data.sessionToken);
  redirect(safeInternalPath(parsed.data.next, "/overview"));
}

export async function signOutAction(): Promise<void> {
  const token = await getSessionToken();
  if (token) {
    await getAuthService().signOut(token);
  }
  await clearSessionCookie();
  redirect("/sign-in");
}

export async function requestResetAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = requestResetSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return zodToErr(parsed.error);

  const result = await getAuthService().requestPasswordReset(parsed.data, await getAuthContext());
  if (!result.ok) return result;
  return ok({
    message: "If an account exists for that email, a reset link is on its way. Check your inbox.",
  });
}

export async function resetPasswordAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = resetPasswordSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
  });
  if (!parsed.success) return zodToErr(parsed.error);

  const result = await getAuthService().resetPassword(parsed.data, await getAuthContext());
  if (!result.ok) return result;
  redirect("/sign-in?reset=done");
}

export async function changePasswordAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const { user, session } = await requireUser();
  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
  });
  if (!parsed.success) return zodToErr(parsed.error);

  const ctx = await getAuthContext();
  const result = await getAuthService().changePassword(user.id, parsed.data, {
    ...ctx,
    currentSessionId: session.id,
  });
  if (!result.ok) return result;
  return ok({ message: "Password changed. Other devices have been signed out." });
}

export async function revokeSessionAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const { user } = await requireUser();
  const parsed = revokeSessionSchema.safeParse({ sessionId: formData.get("sessionId") });
  if (!parsed.success) return zodToErr(parsed.error);

  // Scoped to the authenticated user: a tampered sessionId from another account
  // matches nothing (proven by integration tests).
  await getAuthService().revokeSession(user.id, parsed.data.sessionId, await getAuthContext());
  return ok({ message: "Session signed out." });
}

export async function revokeOtherSessionsAction(): Promise<AuthFormState> {
  const { user, session } = await requireUser();
  const count = await getAuthService().revokeOtherSessions(user.id, session.id);
  return ok({
    message: count > 0 ? `Signed out ${count} other session(s).` : "No other sessions.",
  });
}
