import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { uuidv7 } from "@/lib/ids";
import { isErr, isOk, type Result } from "@/lib/result";
import { createDb, type Db } from "@/server/db/client";
import { preferencesRepo } from "@/server/db/repositories/preferences";
import { accountsService, type AccountRow } from "@/server/services/accounts";
import { notificationsService } from "@/server/services/notifications";
import { recurringService } from "@/server/services/recurring";
import { transactionsService } from "@/server/services/transactions";

import { createTestDatabase, type TestDatabase } from "./harness";

let testDb: TestDatabase;
let db: Db;
let userA: string;
let userB: string;
let account: AccountRow;

const TODAY = "2026-08-17";
// 12:00 UTC = 20:00 Asia/Kuala_Lumpur — outside default (unset) quiet hours.
const NOON_UTC = new Date("2026-08-17T12:00:00Z");

function unwrap<T>(result: Result<T>, label: string): T {
  if (!isOk(result)) throw new Error(`${label} failed: ${JSON.stringify(result.error)}`);
  return result.data;
}

async function seedUser(email: string): Promise<string> {
  const id = uuidv7();
  await testDb.pool.query(`insert into users (id, email, password_hash) values ($1, $2, 'x')`, [
    id,
    email,
  ]);
  await testDb.pool.query(`insert into user_preferences (user_id) values ($1)`, [id]);
  return id;
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  db = createDb(testDb.pool);
  userA = await seedUser("notif-a@example.com");
  userB = await seedUser("notif-b@example.com");
  account = unwrap(
    await accountsService.create(db, userA, {
      name: "Notif main",
      type: "current",
      openingBalanceMinor: 1000000,
      openingBalanceDate: "2025-07-01",
    }),
    "account",
  );

  // Three monthly bills landing within 5 days of each other, due Aug 20–24 —
  // inside the next-14-days window; one is large enough for an individual
  // heads-up (≥ RM 500).
  const series = [
    { description: "RENT BIG", amount: 160000, day: 20 },
    { description: "GYM FEE", amount: 15900, day: 22 },
    { description: "INTERNET FEE", amount: 12900, day: 24 },
  ];
  const [y, m] = TODAY.split("-").map(Number);
  for (const spec of series) {
    for (let back = 6; back >= 1; back--) {
      const total = y * 12 + (m - 1) - back;
      unwrap(
        await transactionsService.create(db, userA, {
          accountId: account.id,
          type: "expense",
          amountMinor: -spec.amount,
          txnDate: `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}-${String(spec.day).padStart(2, "0")}`,
          description: spec.description,
        }),
        `${spec.description} ${back}`,
      );
    }
  }
  unwrap(await recurringService.scan(db, userA, TODAY), "scan");
});

afterAll(async () => {
  await testDb.drop();
});

describe("deterministic producers with dedup", () => {
  test("bill cluster and large-bill notifications are created once, ever", async () => {
    const first = unwrap(
      await notificationsService.generate(db, userA, { today: TODAY, now: NOON_UTC }),
      "generate",
    );
    expect(first.suppressedByQuietHours).toBe(false);
    expect(first.created).toBeGreaterThanOrEqual(2); // cluster + rent heads-up

    const list = await notificationsService.list(db, userA);
    const cluster = list.find((n) => n.type === "bill_cluster");
    expect(cluster).toBeTruthy();
    expect(cluster?.title).toMatch(/3 bills cluster/);
    expect(cluster?.href).toBe("/recurring");
    const big = list.find((n) => n.type === "upcoming_bill");
    expect(big?.title).toMatch(/Rent Big/);

    // Re-running creates nothing (dedup).
    const second = unwrap(
      await notificationsService.generate(db, userA, { today: TODAY, now: NOON_UTC }),
      "regenerate",
    );
    expect(second.created).toBe(0);
  });

  test("dismissed notifications are never re-created for the same key", async () => {
    const list = await notificationsService.list(db, userA);
    const cluster = list.find((n) => n.type === "bill_cluster")!;
    unwrap(await notificationsService.dismiss(db, userA, cluster.id), "dismiss");
    const regen = unwrap(
      await notificationsService.generate(db, userA, { today: TODAY, now: NOON_UTC }),
      "regen",
    );
    expect(regen.created).toBe(0);
    expect(
      (await notificationsService.list(db, userA)).find((n) => n.type === "bill_cluster"),
    ).toBeUndefined();
  });

  test("quiet hours suppress creation entirely", async () => {
    await preferencesRepo.update(db, userA, {
      notificationPrefs: { quietHoursStart: "19:00", quietHoursEnd: "21:00" },
    });
    // 20:00 local falls inside the window.
    const result = unwrap(
      await notificationsService.generate(db, userA, { today: TODAY, now: NOON_UTC }),
      "quiet",
    );
    expect(result).toEqual({ created: 0, suppressedByQuietHours: true });
    await preferencesRepo.update(db, userA, { notificationPrefs: {} });
  });

  test("per-type switches and the large-bill threshold are honored", async () => {
    await preferencesRepo.update(db, userA, {
      notificationPrefs: { types: { upcoming_bill: false } },
    });
    // Clear the rent heads-up then regenerate: the disabled type stays absent.
    const rent = (await notificationsService.list(db, userA)).find(
      (n) => n.type === "upcoming_bill",
    )!;
    unwrap(await notificationsService.dismiss(db, userA, rent.id), "dismiss rent");
    const regen = unwrap(
      await notificationsService.generate(db, userA, { today: TODAY, now: NOON_UTC }),
      "regen",
    );
    expect(regen.created).toBe(0);
    await preferencesRepo.update(db, userA, { notificationPrefs: {} });
  });
});

describe("reading, dismissing, isolation", () => {
  test("unread count, mark read, mark all read", async () => {
    const before = await notificationsService.unreadCount(db, userA);
    expect(before).toBeGreaterThanOrEqual(0);
    const { marked } = await notificationsService.markAllRead(db, userA);
    expect(marked).toBe(before);
    expect(await notificationsService.unreadCount(db, userA)).toBe(0);
  });

  test("user B sees nothing of user A's and cannot touch it", async () => {
    expect(await notificationsService.list(db, userB)).toEqual([]);
    expect(await notificationsService.unreadCount(db, userB)).toBe(0);
    const anyA = (await notificationsService.list(db, userA))[0];
    if (anyA) {
      expect(isErr(await notificationsService.markRead(db, userB, anyA.id))).toBe(true);
      expect(isErr(await notificationsService.dismiss(db, userB, anyA.id))).toBe(true);
    }
  });

  test("unsafe deep links render as no link", async () => {
    await testDb.pool.query(
      `insert into notifications (id, user_id, type, title, body, dedup_key, data)
       values ($1, $2, 'test', 'Evil link', 'body', 'evil:1', '{"href":"https://evil.test/phish"}'::jsonb)`,
      [uuidv7(), userA],
    );
    const list = await notificationsService.list(db, userA);
    const evil = list.find((n) => n.title === "Evil link");
    expect(evil?.href).toBeNull();
  });
});
