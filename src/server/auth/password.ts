import { hash, verify } from "@node-rs/argon2";

/**
 * Argon2id parameters per OWASP password-storage guidance (2025):
 * 19 MiB memory, 2 iterations, parallelism 1.
 */
const ARGON2_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    // Malformed hash — treat as non-matching, never throw into auth flows.
    return false;
  }
}

/**
 * Small denylist of overlong-but-common passwords; the 12-char floor already
 * excludes the classic top-10k. Compared case-insensitively.
 */
const WEAK_PASSWORDS = new Set([
  "password12345",
  "password123456",
  "passwordpassword",
  "1234567890123",
  "qwertyuiop123",
  "iloveyou12345",
  "adminadmin123",
  "welcome123456",
  "letmein123456",
  "malaysia123456",
]);

/**
 * Returns a list of user-facing problems; empty means the password is acceptable.
 */
export function validatePasswordPolicy(password: string, email: string): string[] {
  const problems: string[] = [];
  if (password.length < 12) {
    problems.push("Use at least 12 characters — a passphrase works well.");
  }
  if (password.length > 128) {
    problems.push("Use at most 128 characters.");
  }
  if (WEAK_PASSWORDS.has(password.toLowerCase())) {
    problems.push("That password is too common. Choose something more unique.");
  }
  const localPart = email.split("@")[0]?.toLowerCase();
  if (localPart && localPart.length >= 4 && password.toLowerCase().includes(localPart)) {
    problems.push("Don’t include your email address in your password.");
  }
  return problems;
}
