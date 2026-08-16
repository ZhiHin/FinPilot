import { uuidv7 } from "@/lib/ids";
import { err, ok, type Result } from "@/lib/result";

import type { Db } from "../db/client";
import { auditRepo } from "../db/repositories/audit";
import { preferencesRepo } from "../db/repositories/preferences";
import { resetTokensRepo } from "../db/repositories/reset-tokens";
import { sessionsRepo, type SessionRow } from "../db/repositories/sessions";
import { usersRepo, type UserRow } from "../db/repositories/users";
import { hashPassword, validatePasswordPolicy, verifyPassword } from "./password";
import { generateToken, hashIdentifier, sha256Hex } from "./tokens";

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(mail: OutgoingMail): Promise<void>;
}

interface RateLimit {
  max: number;
  windowMs: number;
}

export interface AuthLimits {
  signInPerIdentifier: RateLimit;
  signInPerIp: RateLimit;
  signUpPerIp: RateLimit;
  resetPerIdentifier: RateLimit;
  resetPerIp: RateLimit;
}

const DEFAULT_LIMITS: AuthLimits = {
  signInPerIdentifier: { max: 10, windowMs: 15 * 60_000 },
  signInPerIp: { max: 30, windowMs: 15 * 60_000 },
  signUpPerIp: { max: 10, windowMs: 60 * 60_000 },
  resetPerIdentifier: { max: 3, windowMs: 60 * 60_000 },
  resetPerIp: { max: 10, windowMs: 60 * 60_000 },
};

const SESSION_IDLE_MS = 14 * 24 * 60 * 60_000; // 14 days
const SESSION_ABSOLUTE_MS = 30 * 24 * 60 * 60_000; // 30 days
const SESSION_TOUCH_THROTTLE_MS = 5 * 60_000;
const RESET_TOKEN_TTL_MS = 30 * 60_000; // 30 minutes

// Enumeration-safe copy: identical for wrong password and unknown email.
const GENERIC_CREDENTIALS_MESSAGE = "That email and password combination didn’t work.";
const RATE_LIMIT_MESSAGE = "Too many attempts. Please wait a moment and try again.";

export interface AuthContext {
  ip: string | null;
  userAgent: string | null;
}

export interface AuthServiceConfig {
  db: Db;
  mailer: Mailer;
  /** Server-side secret for keyed identifier hashes (AUTH_SECRET). */
  secret: string;
  limits?: Partial<AuthLimits>;
  resetTtlMs?: number;
  /** Base URL for links in mails; defaults to APP_BASE_URL or localhost. */
  baseUrl?: string;
}

export interface CurrentSession {
  user: UserRow;
  session: SessionRow;
}

export type AuthService = ReturnType<typeof createAuthService>;

export function createAuthService(config: AuthServiceConfig) {
  const { db, mailer, secret } = config;
  const limits: AuthLimits = { ...DEFAULT_LIMITS, ...config.limits };
  const resetTtlMs = config.resetTtlMs ?? RESET_TOKEN_TTL_MS;
  const baseUrl = config.baseUrl ?? process.env.APP_BASE_URL ?? "http://localhost:3000";

  // Verified against when the email is unknown so both paths cost the same time.
  let dummyHashPromise: Promise<string> | undefined;
  const dummyHash = () => (dummyHashPromise ??= hashPassword("timing-equalizer-passphrase"));

  const subjectFor = (identifier: string) => hashIdentifier(identifier, secret);
  const ipHashFor = (ctx: AuthContext) => (ctx.ip ? hashIdentifier(ctx.ip, secret) : null);

  async function isLimited(
    eventType: string,
    limit: RateLimit,
    key: { subjectHash?: string; ipHash?: string },
  ): Promise<boolean> {
    const since = new Date(Date.now() - limit.windowMs);
    const count = await auditRepo.countRecentEvents(db, { eventType, since, ...key });
    return count >= limit.max;
  }

  async function audit(
    eventType: string,
    ctx: AuthContext,
    extra: { userId?: string | null; subjectHash?: string | null } = {},
  ): Promise<void> {
    await auditRepo.record(db, {
      id: uuidv7(),
      actor: "user",
      eventType,
      userId: extra.userId ?? null,
      subjectHash: extra.subjectHash ?? null,
      ipHash: ipHashFor(ctx),
      userAgent: ctx.userAgent,
    });
  }

  async function startSession(userId: string, ctx: AuthContext): Promise<string> {
    const token = generateToken();
    await sessionsRepo.create(db, {
      id: uuidv7(),
      userId,
      tokenHash: sha256Hex(token),
      expiresAt: new Date(Date.now() + SESSION_IDLE_MS),
      ipHash: ipHashFor(ctx),
      userAgent: ctx.userAgent,
    });
    return token;
  }

  return {
    async signUp(
      input: { email: string; password: string; displayName?: string },
      ctx: AuthContext,
    ): Promise<Result<{ sessionToken: string; userId: string }>> {
      const email = input.email.trim();
      const subjectHash = subjectFor(email);
      const ipHash = ipHashFor(ctx);

      if (ipHash && (await isLimited("auth.sign_up", limits.signUpPerIp, { ipHash }))) {
        return err("rate_limited", RATE_LIMIT_MESSAGE);
      }

      const passwordProblems = validatePasswordPolicy(input.password, email);
      if (passwordProblems.length > 0) {
        return err("invalid_input", "Please choose a stronger password.", {
          password: passwordProblems,
        });
      }

      const existing = await usersRepo.findByEmail(db, email);
      if (existing) {
        await audit("auth.sign_up_failed", ctx, { subjectHash });
        return err("invalid_input", "Please check the form.", {
          email: ["An account with this email already exists. Sign in instead."],
        });
      }

      const userId = uuidv7();
      try {
        await usersRepo.create(db, {
          id: userId,
          email,
          passwordHash: await hashPassword(input.password),
        });
      } catch {
        // Unique-violation race with a concurrent sign-up: same outcome as "exists".
        await audit("auth.sign_up_failed", ctx, { subjectHash });
        return err("invalid_input", "Please check the form.", {
          email: ["An account with this email already exists. Sign in instead."],
        });
      }
      if (input.displayName?.trim()) {
        await usersRepo.updateDisplayName(db, userId, input.displayName.trim());
      }
      await preferencesRepo.createDefaults(db, userId);
      // Every user starts with the default Malaysian category template (Phase 2).
      const { categoriesService } = await import("../services/categories");
      await categoriesService.ensureDefaults(db, userId);
      await audit("auth.sign_up", ctx, { userId, subjectHash });

      const sessionToken = await startSession(userId, ctx);
      return ok({ sessionToken, userId });
    },

    async signIn(
      input: { email: string; password: string },
      ctx: AuthContext,
    ): Promise<Result<{ sessionToken: string; userId: string }>> {
      const email = input.email.trim();
      const subjectHash = subjectFor(email);
      const ipHash = ipHashFor(ctx);

      if (
        (await isLimited("auth.sign_in_failed", limits.signInPerIdentifier, { subjectHash })) ||
        (ipHash && (await isLimited("auth.sign_in_failed", limits.signInPerIp, { ipHash })))
      ) {
        return err("rate_limited", RATE_LIMIT_MESSAGE);
      }

      const user = await usersRepo.findByEmail(db, email);
      const passwordOk = user
        ? await verifyPassword(user.passwordHash, input.password)
        : (await verifyPassword(await dummyHash(), input.password), false);

      if (!user || !passwordOk || user.status !== "active") {
        await audit("auth.sign_in_failed", ctx, { subjectHash, userId: user?.id ?? null });
        return err("unauthorized", GENERIC_CREDENTIALS_MESSAGE);
      }

      await audit("auth.sign_in", ctx, { userId: user.id, subjectHash });
      const sessionToken = await startSession(user.id, ctx);
      return ok({ sessionToken, userId: user.id });
    },

    /** Resolves a raw cookie token to the current user, with sliding expiry. */
    async validateSession(token: string): Promise<CurrentSession | null> {
      if (!token) return null;
      const session = await sessionsRepo.findValidByTokenHash(db, sha256Hex(token));
      if (!session) return null;
      const user = await usersRepo.findById(db, session.userId);
      if (!user || user.status !== "active") return null;

      const now = Date.now();
      const cap = session.createdAt.getTime() + SESSION_ABSOLUTE_MS;
      const slidTo = new Date(Math.min(now + SESSION_IDLE_MS, cap));
      if (now - session.lastSeenAt.getTime() > SESSION_TOUCH_THROTTLE_MS) {
        await sessionsRepo.extend(db, session.id, slidTo);
      }
      return { user, session };
    },

    async signOut(token: string): Promise<void> {
      const session = await sessionsRepo.findValidByTokenHash(db, sha256Hex(token));
      if (!session) return;
      await sessionsRepo.revokeById(db, { userId: session.userId, sessionId: session.id });
      await audit("auth.sign_out", { ip: null, userAgent: null }, { userId: session.userId });
    },

    async revokeSession(userId: string, sessionId: string, ctx: AuthContext): Promise<boolean> {
      const revoked = await sessionsRepo.revokeById(db, { userId, sessionId });
      if (revoked) {
        await audit("auth.session_revoked", ctx, { userId });
      }
      return revoked;
    },

    async revokeOtherSessions(userId: string, currentSessionId: string): Promise<number> {
      const revoked = await sessionsRepo.revokeAllForUser(db, userId, {
        exceptSessionId: currentSessionId,
      });
      await audit("auth.sessions_revoked_all", { ip: null, userAgent: null }, { userId });
      return revoked;
    },

    async listSessions(userId: string) {
      return sessionsRepo.listActiveForUser(db, userId);
    },

    async requestPasswordReset(
      input: { email: string },
      ctx: AuthContext,
    ): Promise<Result<{ requested: true }>> {
      const email = input.email.trim();
      const subjectHash = subjectFor(email);
      const ipHash = ipHashFor(ctx);

      if (
        (await isLimited("auth.reset_requested", limits.resetPerIdentifier, { subjectHash })) ||
        (ipHash && (await isLimited("auth.reset_requested", limits.resetPerIp, { ipHash })))
      ) {
        return err("rate_limited", RATE_LIMIT_MESSAGE);
      }

      // Recorded for unknown emails too: limits apply uniformly, responses stay identical.
      const user = await usersRepo.findByEmail(db, email);
      await audit("auth.reset_requested", ctx, { subjectHash, userId: user?.id ?? null });

      if (user && user.status === "active") {
        const token = generateToken();
        await resetTokensRepo.create(db, {
          id: uuidv7(),
          userId: user.id,
          tokenHash: sha256Hex(token),
          expiresAt: new Date(Date.now() + resetTtlMs),
        });
        await mailer.send({
          to: email,
          subject: "Reset your FinPilot password",
          text:
            `Someone (hopefully you) asked to reset the password for this FinPilot account.\n\n` +
            `Reset it here (link valid for 30 minutes, single use):\n` +
            `${baseUrl}/reset-password?token=${token}\n\n` +
            `If this wasn’t you, you can ignore this message.`,
        });
      }
      return ok({ requested: true });
    },

    async resetPassword(
      input: { token: string; password: string },
      ctx: AuthContext,
    ): Promise<Result<{ reset: true }>> {
      const tokenRow = await resetTokensRepo.findValidByTokenHash(db, sha256Hex(input.token));
      if (!tokenRow) {
        await audit("auth.reset_failed", ctx, {});
        return err("invalid_input", "This reset link is invalid or has expired.");
      }
      const user = await usersRepo.findById(db, tokenRow.userId);
      if (!user) {
        return err("invalid_input", "This reset link is invalid or has expired.");
      }

      const problems = validatePasswordPolicy(input.password, user.email);
      if (problems.length > 0) {
        return err("invalid_input", "Please choose a stronger password.", { password: problems });
      }

      // Single-use: consuming succeeds exactly once even under concurrent replays.
      if (!(await resetTokensRepo.consume(db, tokenRow.id))) {
        return err("invalid_input", "This reset link is invalid or has expired.");
      }
      await usersRepo.updatePasswordHash(db, user.id, await hashPassword(input.password));
      await resetTokensRepo.invalidateAllForUser(db, user.id);
      await sessionsRepo.revokeAllForUser(db, user.id);
      await audit("auth.reset_completed", ctx, { userId: user.id });
      return ok({ reset: true });
    },

    async changePassword(
      userId: string,
      input: { currentPassword: string; newPassword: string },
      ctx: AuthContext & { currentSessionId: string },
    ): Promise<Result<{ changed: true }>> {
      const user = await usersRepo.findById(db, userId);
      if (!user) return err("unauthorized", GENERIC_CREDENTIALS_MESSAGE);

      if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
        await audit("auth.password_change_failed", ctx, { userId });
        return err("invalid_input", "Please check the form.", {
          currentPassword: ["That doesn’t match your current password."],
        });
      }
      const problems = validatePasswordPolicy(input.newPassword, user.email);
      if (problems.length > 0) {
        return err("invalid_input", "Please choose a stronger password.", {
          newPassword: problems,
        });
      }

      await usersRepo.updatePasswordHash(db, userId, await hashPassword(input.newPassword));
      await resetTokensRepo.invalidateAllForUser(db, userId);
      await sessionsRepo.revokeAllForUser(db, userId, {
        exceptSessionId: ctx.currentSessionId,
      });
      await audit("auth.password_changed", ctx, { userId });
      return ok({ changed: true });
    },
  } as const;
}
