import { z } from "zod";

/**
 * Zod schemas for every auth boundary. Unknown fields are stripped by default
 * (mass-assignment protection); user ids never appear in any input schema —
 * identity always comes from the server-side session.
 */

const emailSchema = z
  .string()
  .trim()
  .min(1, "Enter your email address.")
  .max(254, "That email address is too long.")
  .email("Enter a valid email address.");

const passwordInputSchema = z
  .string()
  .min(1, "Enter your password.")
  .max(1024, "That password is too long.");

export const signUpSchema = z.object({
  email: emailSchema,
  password: passwordInputSchema,
  displayName: z.string().trim().max(80, "Keep your name under 80 characters.").optional(),
});

export const signInSchema = z.object({
  email: emailSchema,
  password: passwordInputSchema,
  next: z.string().optional(),
});

export const requestResetSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1).max(512),
  password: passwordInputSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: passwordInputSchema,
  newPassword: passwordInputSchema,
});

export const revokeSessionSchema = z.object({
  sessionId: z.string().uuid("Invalid session."),
});

export const deleteAccountSchema = z.object({
  password: z.string().min(1, "Enter your password to confirm."),
});

/** Internal redirect targets only — blocks open-redirect via ?next=. */
export function safeInternalPath(next: string | undefined, fallback: string): string {
  if (next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\")) {
    return next;
  }
  return fallback;
}
