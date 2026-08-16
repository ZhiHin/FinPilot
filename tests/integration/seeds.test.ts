import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { hashPassword, verifyPassword } from "@/server/auth/password";
import { createDb, type Db } from "@/server/db/client";
import { preferencesRepo } from "@/server/db/repositories/preferences";
import { usersRepo } from "@/server/db/repositories/users";
import { DEMO_USER, seedDemo } from "@/server/db/seeds/demo";
import { seedTestUsers, TEST_USERS } from "@/server/db/seeds/test-users";

import { createTestDatabase, type TestDatabase } from "./harness";

let testDb: TestDatabase;
let db: Db;

beforeAll(async () => {
  testDb = await createTestDatabase();
  db = createDb(testDb.pool);
});

afterAll(async () => {
  await testDb.drop();
});

describe("seedDemo", () => {
  test("creates the demo identity once and is idempotent", async () => {
    const first = await seedDemo(db);
    const second = await seedDemo(db);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);

    const { rows } = await testDb.pool.query(`select count(*)::int as n from users`);
    expect(rows[0].n).toBeGreaterThanOrEqual(1);

    const user = await usersRepo.findByEmail(db, DEMO_USER.email);
    expect(user?.id).toBe(DEMO_USER.id);
  });

  test("demo preferences match the Phase 0 sample profile", async () => {
    await seedDemo(db);
    const prefs = await preferencesRepo.get(db, DEMO_USER.id);
    expect(prefs).toMatchObject({
      locale: "en-MY",
      currency: "MYR",
      timezone: "Asia/Kuala_Lumpur",
      safetyBufferMinor: 30000,
      budgetStyle: "flexible",
    });
    expect(prefs?.onboardingState).toMatchObject({ completed: true, demo: true });
  });

  test("demo password verifies against the stored hash", async () => {
    await seedDemo(db);
    const user = await usersRepo.findByEmail(db, DEMO_USER.email);
    expect(user).not.toBeNull();
    expect(await verifyPassword(user!.passwordHash, DEMO_USER.password)).toBe(true);
  });
});

describe("seedTestUsers", () => {
  test("creates both e2e users idempotently", async () => {
    await seedTestUsers(db);
    await seedTestUsers(db);
    for (const fixture of TEST_USERS) {
      const user = await usersRepo.findByEmail(db, fixture.email);
      expect(user).not.toBeNull();
      expect(await verifyPassword(user!.passwordHash, fixture.password)).toBe(true);
    }
  });
});

describe("hashPassword sanity in DB roundtrip", () => {
  test("hash stored and retrieved intact", async () => {
    const hash = await hashPassword("roundtrip-password-1");
    const user = await usersRepo.create(db, {
      id: "01900000-0000-7000-8000-0000000000aa",
      email: "roundtrip@example.com",
      passwordHash: hash,
    });
    const fetched = await usersRepo.findById(db, user.id);
    expect(fetched?.passwordHash).toBe(hash);
  });
});
