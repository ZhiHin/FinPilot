import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { uuidv7 } from "@/lib/ids";
import { isErr, isOk, type Result } from "@/lib/result";
import { createDb, type Db } from "@/server/db/client";
import { accountsService, type AccountRow } from "@/server/services/accounts";
import { categoriesService } from "@/server/services/categories";
import { recurringService } from "@/server/services/recurring";
import { transactionsService } from "@/server/services/transactions";

import { createTestDatabase, type TestDatabase } from "./harness";

let testDb: TestDatabase;
let db: Db;
let userA: string;
let userB: string;
let account: AccountRow;
let subsCat: string;
let rentCat: string;

const TODAY = "2026-08-17";

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
  return id;
}

/** Insert monthly charges (magnitudes) ending in the recent past. */
async function seedSeries(
  userId: string,
  accountId: string,
  description: string,
  merchantName: string | null,
  categoryId: string | null,
  amounts: number[], // oldest → newest magnitudes, one per month
  day: number,
): Promise<void> {
  const [y, m] = TODAY.split("-").map(Number);
  const start = y * 12 + (m - 1) - amounts.length; // end last month
  for (const [index, amount] of amounts.entries()) {
    const total = start + index;
    const year = Math.floor(total / 12);
    const month = (total % 12) + 1;
    unwrap(
      await transactionsService.create(db, userId, {
        accountId,
        type: "expense",
        amountMinor: -amount,
        txnDate: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        description,
        merchantName: merchantName ?? undefined,
        categoryId,
      }),
      `series ${description} ${index}`,
    );
  }
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  db = createDb(testDb.pool);
  userA = await seedUser("rec-a@example.com");
  userB = await seedUser("rec-b@example.com");
  account = unwrap(
    await accountsService.create(db, userA, {
      name: "Recurring main",
      type: "current",
      openingBalanceMinor: 1000000,
      openingBalanceDate: "2025-07-01",
    }),
    "account",
  );
  const group = unwrap(
    await categoriesService.createGroup(db, userA, { name: "Bills", kind: "expense" }),
    "group",
  );
  subsCat = unwrap(
    await categoriesService.createCategory(db, userA, {
      groupId: group.id,
      name: "Streaming & subscriptions",
    }),
    "subs cat",
  ).id;
  rentCat = unwrap(
    await categoriesService.createCategory(db, userA, { groupId: group.id, name: "Rent" }),
    "rent cat",
  ).id;

  // Stable monthly rent (no merchant → keyed by description).
  await seedSeries(userA, account.id, "RENT SETIA SKY", null, rentCat, Array(6).fill(160000), 1);
  // Spotify with a sustained price change: 16.90 ×5 → 23.90 ×2.
  await seedSeries(
    userA,
    account.id,
    "SPOTIFY P2E4A8",
    "Spotify",
    subsCat,
    [1690, 1690, 1690, 1690, 1690, 2390, 2390],
    15,
  );
  // BNPL installment (keyword-flagged), 4 payments so far.
  await seedSeries(
    userA,
    account.id,
    "SPAYLATER INSTALMENT 4821",
    "SPayLater",
    null,
    Array(4).fill(29158),
    6,
  );
  // Noise: two irregular one-off charges — must NOT become a pattern.
  unwrap(
    await transactionsService.create(db, userA, {
      accountId: account.id,
      type: "expense",
      amountMinor: -8400,
      txnDate: "2026-05-03",
      description: "RANDOM SHOP A",
    }),
    "noise 1",
  );
  unwrap(
    await transactionsService.create(db, userA, {
      accountId: account.id,
      type: "expense",
      amountMinor: -12100,
      txnDate: "2026-07-29",
      description: "RANDOM SHOP A",
    }),
    "noise 2",
  );
});

afterAll(async () => {
  await testDb.drop();
});

describe("deterministic detection on fixtures", () => {
  test("scan finds the three seeded series and nothing else", async () => {
    const summary = unwrap(await recurringService.scan(db, userA, TODAY), "scan");
    expect(summary.created).toBe(3);

    const patterns = await recurringService.list(db, userA);
    expect(patterns.length).toBe(3);
    const rent = patterns.find((p) => p.name.includes("Rent Setia"));
    expect(rent).toMatchObject({
      frequency: "monthly",
      typicalAmountMinor: 160000,
      direction: "outflow",
      source: "inferred",
      annualizedMinor: 1920000,
    });
    expect(rent?.confidenceBp).toBeGreaterThanOrEqual(7000);
    expect(rent?.confidenceBp).toBeLessThanOrEqual(9500);
    // Next expected = last seen + 1 month (1st of this month → 1st of next).
    expect(rent?.nextExpectedOn).toBe("2026-09-01");
  });

  test("subscription with evidence-backed price change", async () => {
    const patterns = await recurringService.list(db, userA);
    const spotify = patterns.find((p) => p.name === "Spotify");
    expect(spotify?.subscription).toBeTruthy();
    expect(spotify?.subscription).toMatchObject({
      currentPriceMinor: 2390,
      previousPriceMinor: 1690,
      priceEvidence: { previousCount: 5, currentCount: 2 },
    });
    expect(spotify?.typicalAmountMinor).toBe(2390);
  });

  test("BNPL keyword series is an installment ESTIMATE with observed count", async () => {
    const patterns = await recurringService.list(db, userA);
    const bnpl = patterns.find((p) => p.name.toLowerCase().includes("spaylater"));
    expect(bnpl).toMatchObject({
      isInstallment: true,
      installmentsObserved: 4,
      installmentsTotal: null, // unknown until the user confirms
    });
  });

  test("rescan is idempotent — nothing duplicates, nothing changes", async () => {
    const summary = unwrap(await recurringService.scan(db, userA, TODAY), "rescan");
    expect(summary.created).toBe(0);
    expect(summary.updated).toBe(3);
    expect((await recurringService.list(db, userA)).length).toBe(3);
  });
});

describe("user control", () => {
  test("confirm raises confidence to certainty and survives rescans", async () => {
    const patterns = await recurringService.list(db, userA);
    const rent = patterns.find((p) => p.name.includes("Rent Setia"))!;
    unwrap(await recurringService.confirm(db, userA, rent.id), "confirm");

    // Rename + set a user amount; a rescan must not clobber user-owned fields.
    unwrap(
      await recurringService.update(db, userA, rent.id, {
        name: "Apartment rent",
        typicalAmountMinor: 165000,
      }),
      "update",
    );
    unwrap(await recurringService.scan(db, userA, TODAY), "rescan");
    const after = (await recurringService.list(db, userA)).find((p) => p.id === rent.id);
    expect(after).toMatchObject({
      name: "Apartment rent",
      typicalAmountMinor: 165000,
      source: "user_confirmed",
      confidenceBp: 10000,
    });
  });

  test("BNPL total set by the user yields remaining payments; too-low totals rejected", async () => {
    const bnpl = (await recurringService.list(db, userA)).find((p) =>
      p.name.toLowerCase().includes("spaylater"),
    )!;
    expect(isErr(await recurringService.update(db, userA, bnpl.id, { installmentsTotal: 2 }))).toBe(
      true,
    );
    unwrap(await recurringService.update(db, userA, bnpl.id, { installmentsTotal: 6 }), "total");
    const after = (await recurringService.list(db, userA)).find((p) => p.id === bnpl.id);
    expect(after?.installmentsTotal).toBe(6);
    expect((after?.installmentsTotal ?? 0) - (after?.installmentsObserved ?? 0)).toBe(2);
  });

  test('"not recurring" ends a pattern and scans never resurrect it', async () => {
    const spotify = (await recurringService.list(db, userA)).find((p) => p.name === "Spotify")!;
    unwrap(await recurringService.setStatus(db, userA, spotify.id, "ended"), "end");
    unwrap(await recurringService.scan(db, userA, TODAY), "rescan");
    const after = (await recurringService.list(db, userA)).find((p) => p.id === spotify.id);
    expect(after?.status).toBe("ended");
    expect((await recurringService.list(db, userA)).length).toBe(3); // no duplicate created
  });

  test("mark / unmark subscription and usage check-in", async () => {
    const bnpl = (await recurringService.list(db, userA)).find((p) =>
      p.name.toLowerCase().includes("spaylater"),
    )!;
    unwrap(await recurringService.setSubscription(db, userA, bnpl.id, true), "mark");
    let after = (await recurringService.list(db, userA)).find((p) => p.id === bnpl.id);
    expect(after?.subscription).toBeTruthy();
    unwrap(await recurringService.confirmUsage(db, userA, after!.subscription!.id), "usage");
    after = (await recurringService.list(db, userA)).find((p) => p.id === bnpl.id);
    expect(after?.subscription?.usageConfirmedAt).toBeTruthy();
    unwrap(await recurringService.setSubscription(db, userA, bnpl.id, false), "unmark");
    after = (await recurringService.list(db, userA)).find((p) => p.id === bnpl.id);
    expect(after?.subscription).toBeNull();
  });
});

describe("upcoming and clusters", () => {
  test("upcoming lists active dues in the window; ended patterns excluded", async () => {
    const { due } = await recurringService.upcoming(db, userA, { from: TODAY, days: 30 });
    // Rent (Sep 1) and BNPL (Sep 6) are active; Spotify was ended above.
    expect(due.map((d) => d.name).sort()).toEqual(["Apartment rent", "Spaylater"]);
  });
});

describe("isolation", () => {
  test("scans and reads are user-scoped; foreign ids fail closed", async () => {
    expect(await recurringService.list(db, userB)).toEqual([]);
    const summary = unwrap(await recurringService.scan(db, userB, TODAY), "b scan");
    expect(summary.created).toBe(0);
    const rent = (await recurringService.list(db, userA))[0];
    expect(isErr(await recurringService.confirm(db, userB, rent.id))).toBe(true);
    expect(isErr(await recurringService.update(db, userB, rent.id, { name: "steal" }))).toBe(true);
    expect(isErr(await recurringService.setStatus(db, userB, rent.id, "ended"))).toBe(true);
  });

  test("scan and user actions are audited", async () => {
    const events = await testDb.pool.query(
      `select count(*)::int as n from audit_logs
       where user_id = $1 and (event_type like 'recurring%' or event_type like 'subscription%')`,
      [userA],
    );
    expect(Number(events.rows[0].n)).toBeGreaterThanOrEqual(8);
  });
});
