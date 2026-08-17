import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { uuidv7 } from "@/lib/ids";
import { isErr, isOk, type Result } from "@/lib/result";
import { createDb, type Db } from "@/server/db/client";
import { accountsService, type AccountRow } from "@/server/services/accounts";
import { goalsService } from "@/server/services/goals";
import { transactionsService } from "@/server/services/transactions";

import { createTestDatabase, type TestDatabase } from "./harness";

let testDb: TestDatabase;
let db: Db;
let userA: string;
let userB: string;
let accountA: AccountRow;
let savingsA: AccountRow;

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

beforeAll(async () => {
  testDb = await createTestDatabase();
  db = createDb(testDb.pool);
  userA = await seedUser("goal-a@example.com");
  userB = await seedUser("goal-b@example.com");
  accountA = unwrap(
    await accountsService.create(db, userA, {
      name: "Goal main",
      type: "current",
      openingBalanceMinor: 1000000,
      openingBalanceDate: "2026-01-01",
    }),
    "account",
  );
  savingsA = unwrap(
    await accountsService.create(db, userA, {
      name: "Goal savings",
      type: "savings",
      openingBalanceMinor: 0,
      openingBalanceDate: "2026-01-01",
    }),
    "savings",
  );
});

afterAll(async () => {
  await testDb.drop();
});

let goalId: string;

describe("goal lifecycle", () => {
  test("create with validation; invalid targets and priorities rejected", async () => {
    expect(
      isErr(
        await goalsService.create(db, userA, {
          name: "Bad",
          type: "custom",
          targetAmountMinor: 0,
        }),
      ),
    ).toBe(true);
    expect(
      isErr(
        await goalsService.create(db, userA, {
          name: "Bad prio",
          type: "custom",
          targetAmountMinor: 1000,
          priority: 7,
        }),
      ),
    ).toBe(true);

    const goal = unwrap(
      await goalsService.create(db, userA, {
        name: "Emergency fund",
        type: "emergency",
        targetAmountMinor: 1500000,
        targetDate: "2027-08-31",
        priority: 1,
        linkedAccountId: savingsA.id,
        contributionSchedule: { amountMinor: 48000, frequency: "monthly" },
      }),
      "create goal",
    );
    goalId = goal.id;
    expect(goal.linkedAccountId).toBe(savingsA.id);

    const dup = await goalsService.create(db, userA, {
      name: "emergency FUND",
      type: "custom",
      targetAmountMinor: 1000,
    });
    expect(isErr(dup)).toBe(true);
  });

  test("contributions accumulate; recording one never touches the ledger or balances", async () => {
    const before = await accountsService.netPosition(db, userA);
    unwrap(
      await goalsService.addContribution(db, userA, goalId, {
        amountMinor: 500000,
        contributedOn: "2026-06-25",
      }),
      "c1",
    );
    unwrap(
      await goalsService.addContribution(db, userA, goalId, {
        amountMinor: 430000,
        contributedOn: "2026-07-25",
      }),
      "c2",
    );
    const after = await accountsService.netPosition(db, userA);
    expect(after).toEqual(before); // no real money moved
    const txnCount = await testDb.pool.query(
      `select count(*)::int as n from transactions where user_id = $1`,
      [userA],
    );
    expect(txnCount.rows[0].n).toBe(0); // no bank transaction created

    const detail = unwrap(await goalsService.getDetail(db, userA, goalId, TODAY), "detail");
    expect(detail.goal.savedMinor).toBe(930000);
    expect(detail.goal.outlook.progressBp).toBe(6200);
    // Scheduled 480.00/month, remaining 5,700 → done 2027-08 → on track.
    expect(detail.goal.outlook).toMatchObject({
      requiredMonthlyMinor: 47500,
      estimatedCompletionMonth: "2027-08",
      timeStatus: "on_track",
    });
  });

  test("withdrawals need a note, cannot overdraw, and stay in history", async () => {
    const noNote = await goalsService.addContribution(db, userA, goalId, {
      amountMinor: -10000,
      contributedOn: "2026-08-01",
    });
    expect(isErr(noNote)).toBe(true);

    const overdraw = await goalsService.addContribution(db, userA, goalId, {
      amountMinor: -999999900,
      contributedOn: "2026-08-01",
      note: "way too much",
    });
    expect(isErr(overdraw)).toBe(true);

    unwrap(
      await goalsService.addContribution(db, userA, goalId, {
        amountMinor: -30000,
        contributedOn: "2026-08-01",
        note: "correction: double-entry in July",
      }),
      "withdrawal",
    );
    const detail = unwrap(await goalsService.getDetail(db, userA, goalId, TODAY), "detail");
    expect(detail.goal.savedMinor).toBe(900000);
    expect(detail.contributions.length).toBe(3); // history preserved, not netted
    expect(detail.contributions.some((c) => c.amountMinor === -30000)).toBe(true);
  });

  test("duplicate submissions with the same id are idempotent", async () => {
    const id = uuidv7();
    const first = unwrap(
      await goalsService.addContribution(db, userA, goalId, {
        id,
        amountMinor: 10000,
        contributedOn: "2026-08-15",
      }),
      "first",
    );
    const second = unwrap(
      await goalsService.addContribution(db, userA, goalId, {
        id,
        amountMinor: 10000,
        contributedOn: "2026-08-15",
      }),
      "second",
    );
    expect(second.contributionId).toBe(first.contributionId);
    expect(second.savedMinor).toBe(910000); // recorded exactly once
  });

  test("a contribution can link a real transfer transaction as evidence", async () => {
    const transfer = unwrap(
      await transactionsService.createTransfer(db, userA, {
        fromAccountId: accountA.id,
        toAccountId: savingsA.id,
        amountMinor: 25000,
        txnDate: "2026-08-16",
      }),
      "transfer",
    );
    const linked = unwrap(
      await goalsService.addContribution(db, userA, goalId, {
        amountMinor: 25000,
        contributedOn: "2026-08-16",
        transactionId: transfer.toTransactionId,
      }),
      "linked",
    );
    expect(linked.savedMinor).toBe(935000);
    const detail = unwrap(await goalsService.getDetail(db, userA, goalId, TODAY), "detail");
    const entry = detail.contributions.find((c) => c.transactionId === transfer.toTransactionId);
    expect(entry?.kind).toBe("linked_transfer");
  });

  test("status transitions: pause → resume, complete, archive; invalid moves rejected", async () => {
    unwrap(await goalsService.setStatus(db, userA, goalId, "paused"), "pause");
    unwrap(await goalsService.setStatus(db, userA, goalId, "active"), "resume");
    unwrap(await goalsService.setStatus(db, userA, goalId, "completed"), "complete");
    expect(isErr(await goalsService.setStatus(db, userA, goalId, "paused"))).toBe(true);
    // Archived goals refuse contributions until reactivated.
    unwrap(await goalsService.setStatus(db, userA, goalId, "archived"), "archive");
    expect(
      isErr(
        await goalsService.addContribution(db, userA, goalId, {
          amountMinor: 1000,
          contributedOn: TODAY,
        }),
      ),
    ).toBe(true);
    unwrap(await goalsService.setStatus(db, userA, goalId, "active"), "reactivate");

    const detail = unwrap(await goalsService.getDetail(db, userA, goalId, TODAY), "detail");
    expect(detail.goal.savedMinor).toBe(935000); // history intact through it all
  });

  test("edits to target amount and date recompute the outlook", async () => {
    unwrap(
      await goalsService.update(db, userA, goalId, {
        targetAmountMinor: 1000000,
        targetDate: null,
      }),
      "update",
    );
    const detail = unwrap(await goalsService.getDetail(db, userA, goalId, TODAY), "detail");
    // Saved 9,350 of 10,000 → 93.5%; no date → progress-only status.
    expect(detail.goal.outlook.progressBp).toBe(9350);
    expect(detail.goal.outlook.timeStatus).toBe("no_target_date");
    expect(detail.goal.outlook.requiredMonthlyMinor).toBeNull();
  });

  test("listWithProgress orders by priority and derives saved amounts", async () => {
    unwrap(
      await goalsService.create(db, userA, {
        name: "Japan trip",
        type: "travel",
        targetAmountMinor: 600000,
        priority: 2,
      }),
      "second goal",
    );
    const goals = await goalsService.listWithProgress(db, userA, TODAY);
    expect(goals.map((g) => g.name)).toEqual(["Emergency fund", "Japan trip"]);
    expect(goals[0].savedMinor).toBe(935000);
    expect(goals[1].savedMinor).toBe(0);
    // Zero contributions and no schedule → no fake estimate.
    expect(goals[1].outlook.estimatedCompletionMonth).toBeNull();
  });
});

describe("isolation", () => {
  test("user B cannot read, edit, or contribute to user A's goal", async () => {
    expect(isErr(await goalsService.getDetail(db, userB, goalId, TODAY))).toBe(true);
    expect(isErr(await goalsService.update(db, userB, goalId, { priority: 5 }))).toBe(true);
    expect(isErr(await goalsService.setStatus(db, userB, goalId, "archived"))).toBe(true);
    expect(
      isErr(
        await goalsService.addContribution(db, userB, goalId, {
          amountMinor: 1000,
          contributedOn: TODAY,
        }),
      ),
    ).toBe(true);
    expect(await goalsService.listWithProgress(db, userB, TODAY)).toEqual([]);
  });

  test("user B cannot link user A's account to their goal", async () => {
    expect(
      isErr(
        await goalsService.create(db, userB, {
          name: "Steal link",
          type: "custom",
          targetAmountMinor: 1000,
          linkedAccountId: savingsA.id,
        }),
      ),
    ).toBe(true);
  });

  test("goal events are audited", async () => {
    const events = await testDb.pool.query(
      `select count(*)::int as n from audit_logs where user_id = $1 and event_type like 'goal%'`,
      [userA],
    );
    expect(Number(events.rows[0].n)).toBeGreaterThanOrEqual(10);
  });
});
