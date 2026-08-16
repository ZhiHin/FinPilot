import { pgEnum } from "drizzle-orm/pg-core";

export const userStatusEnum = pgEnum("user_status", ["active", "deactivated", "pending_purge"]);

export const themePreferenceEnum = pgEnum("theme_preference", ["system", "light", "dark"]);

export const budgetStyleEnum = pgEnum("budget_style", [
  "fixed",
  "flexible",
  "rollover",
  "zero_based",
]);

export const auditActorEnum = pgEnum("audit_actor", ["user", "system", "ai"]);
