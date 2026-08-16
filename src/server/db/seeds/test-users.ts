import { uuidv7 } from "@/lib/ids";

import { hashPassword } from "../../auth/password";
import type { Db } from "../client";
import { auditRepo } from "../repositories/audit";
import { preferencesRepo } from "../repositories/preferences";
import { usersRepo } from "../repositories/users";

/** Deterministic identities for integration/e2e tests. Never seed in production. */
export const TEST_USERS = [
  {
    id: "01900000-0000-7000-8000-00000000e2ea",
    email: "e2e-a@finpilot.test",
    password: "e2e-password-alpha",
  },
  {
    id: "01900000-0000-7000-8000-00000000e2eb",
    email: "e2e-b@finpilot.test",
    password: "e2e-password-bravo",
  },
] as const;

export async function seedTestUsers(db: Db): Promise<void> {
  for (const fixture of TEST_USERS) {
    const existing = await usersRepo.findByEmail(db, fixture.email);
    if (existing) continue;
    await usersRepo.create(db, {
      id: fixture.id,
      email: fixture.email,
      passwordHash: await hashPassword(fixture.password),
    });
    await preferencesRepo.createDefaults(db, fixture.id, {
      onboardingState: { completed: true, currentStep: 5 },
    });
    const { categoriesService } = await import("../../services/categories");
    await categoriesService.ensureDefaults(db, fixture.id);
    await auditRepo.record(db, {
      id: uuidv7(),
      userId: fixture.id,
      actor: "system",
      eventType: "seed.test_users",
    });
  }
}
