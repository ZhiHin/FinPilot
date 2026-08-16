import { uuidv7 } from "@/lib/ids";

import { hashPassword } from "../../auth/password";
import type { Db } from "../client";
import { auditRepo } from "../repositories/audit";
import { preferencesRepo } from "../repositories/preferences";
import { usersRepo } from "../repositories/users";

/**
 * Phase 1 demo identity (spec §7 seeding schedule): the Aisyah profile only —
 * her accounts and transactions arrive with their domains in Phases 2–3.
 * Synthetic data; the password is demo-only and printed by the seed script.
 */
export const DEMO_USER = {
  id: "01900000-0000-7000-8000-000000000d31",
  email: "aisyah.demo@finpilot.test",
  password: "demo-aisyah-2026",
} as const;

export async function seedDemo(db: Db): Promise<{ created: boolean }> {
  const existing = await usersRepo.findByEmail(db, DEMO_USER.email);
  if (existing) {
    return { created: false };
  }

  const passwordHash = await hashPassword(DEMO_USER.password);
  await usersRepo.create(db, {
    id: DEMO_USER.id,
    email: DEMO_USER.email,
    passwordHash,
  });
  await preferencesRepo.createDefaults(db, DEMO_USER.id, {
    safetyBufferMinor: 30000, // RM 300 buffer per the Phase 0 sample profile
    budgetStyle: "flexible",
    onboardingState: { completed: true, demo: true, currentStep: 5 },
  });
  await auditRepo.record(db, {
    id: uuidv7(),
    userId: DEMO_USER.id,
    actor: "system",
    eventType: "seed.demo",
  });
  return { created: true };
}
