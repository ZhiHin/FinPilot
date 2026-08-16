import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { uuidv7 } from "@/lib/ids";
import { isErr, isOk } from "@/lib/result";
import { createDb, type Db } from "@/server/db/client";
import { accountsService } from "@/server/services/accounts";
import { categoriesService } from "@/server/services/categories";
import { merchantsService } from "@/server/services/merchants";
import { tagsService } from "@/server/services/tags";

import { createTestDatabase, type TestDatabase } from "./harness";

let testDb: TestDatabase;
let db: Db;
let userA: string;
let userB: string;

async function seedUser(email: string): Promise<string> {
  const id = uuidv7();
  await testDb.pool.query(`insert into users (id, email, password_hash) values ($1, $2, 'x')`, [
    id,
    email,
  ]);
  return id;
}

async function insertTxn(opts: {
  userId: string;
  accountId: string;
  type?: string;
  status?: string;
  amount: number;
  currency?: string;
  excluded?: boolean;
  deleted?: boolean;
  date?: string;
}): Promise<string> {
  const id = uuidv7();
  await testDb.pool.query(
    `insert into transactions (id, user_id, account_id, type, status, amount_minor, currency, txn_date, description_original, is_excluded, deleted_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, 'refdata test', $9, $10)`,
    [
      id,
      opts.userId,
      opts.accountId,
      opts.type ?? (opts.amount < 0 ? "expense" : "income"),
      opts.status ?? "posted",
      opts.amount,
      opts.currency ?? "MYR",
      opts.date ?? "2026-08-01",
      opts.excluded ?? false,
      opts.deleted ? new Date() : null,
    ],
  );
  return id;
}

async function createAccount(
  userId: string,
  name: string,
  overrides: Record<string, unknown> = {},
) {
  const result = await accountsService.create(db, userId, {
    name,
    type: "current",
    openingBalanceMinor: 0,
    openingBalanceDate: "2026-01-01",
    ...overrides,
  } as Parameters<typeof accountsService.create>[2]);
  if (!isOk(result)) throw new Error(`account setup failed: ${JSON.stringify(result.error)}`);
  return result.data;
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  db = createDb(testDb.pool);
  userA = await seedUser("ref-a@example.com");
  userB = await seedUser("ref-b@example.com");
});

afterAll(async () => {
  await testDb.drop();
});

describe("accountsService", () => {
  test("create derives liquidity from type and audits the creation", async () => {
    const account = await createAccount(userA, "Main current");
    expect(account.isLiquid).toBe(true);
    expect(account.currency.trim()).toBe("MYR");

    const loan = await createAccount(userA, "PTPTN", { type: "loan" });
    expect(loan.isLiquid).toBe(false);

    const audit = await testDb.pool.query(
      `select 1 from audit_logs where event_type = 'account.created' and entity_id = $1`,
      [account.id],
    );
    expect(audit.rowCount).toBe(1);
  });

  test("duplicate names are rejected case-insensitively", async () => {
    await createAccount(userA, "Duplicated");
    const dup = await accountsService.create(db, userA, {
      name: "DUPLICATED",
      type: "savings",
      openingBalanceMinor: 0,
      openingBalanceDate: "2026-01-01",
    });
    expect(isErr(dup)).toBe(true);
    if (isErr(dup)) expect(dup.error.code).toBe("conflict");
  });

  test("balances follow the documented reporting rules (invariant 5)", async () => {
    const account = await createAccount(userA, "Balance rules", {
      openingBalanceMinor: 100000,
    });
    await insertTxn({ userId: userA, accountId: account.id, amount: -3000 });
    await insertTxn({ userId: userA, accountId: account.id, amount: 5000 });
    await insertTxn({ userId: userA, accountId: account.id, amount: -2000, status: "pending" });
    await insertTxn({ userId: userA, accountId: account.id, amount: -1000, excluded: true });
    await insertTxn({ userId: userA, accountId: account.id, amount: -500, deleted: true });

    const fetched = await accountsService.get(db, userA, account.id);
    // Posted (incl. excluded) counts toward the balance; pending and deleted don't.
    expect(fetched?.balanceMinor).toBe(100000 - 3000 + 5000 - 1000);
    expect(fetched?.pendingMinor).toBe(-2000);
  });

  test("optimistic versioning: stale updates conflict, fresh ones increment", async () => {
    const account = await createAccount(userA, "Versioned");
    const stale = await accountsService.update(db, userA, account.id, { name: "Renamed" }, 99);
    expect(isErr(stale)).toBe(true);
    if (isErr(stale)) expect(stale.error.code).toBe("conflict");

    const fresh = await accountsService.update(
      db,
      userA,
      account.id,
      { name: "Renamed" },
      account.version,
    );
    expect(isOk(fresh)).toBe(true);
    if (isOk(fresh)) expect(fresh.data.version).toBe(account.version + 1);
  });

  test("archiving preserves history (invariant 6)", async () => {
    const account = await createAccount(userA, "To archive");
    const txnId = await insertTxn({ userId: userA, accountId: account.id, amount: -700 });

    const archived = await accountsService.setArchived(db, userA, account.id, true);
    expect(isOk(archived)).toBe(true);

    const stillThere = await testDb.pool.query(
      `select 1 from transactions where id = $1 and deleted_at is null`,
      [txnId],
    );
    expect(stillThere.rowCount).toBe(1);

    const activeList = await accountsService.list(db, userA);
    expect(activeList.some((a) => a.id === account.id)).toBe(false);
    const fullList = await accountsService.list(db, userA, { includeArchived: true });
    expect(fullList.some((a) => a.id === account.id)).toBe(true);
  });

  test("accounts with transactions cannot be deleted; empty ones can", async () => {
    const withTxns = await createAccount(userA, "Has txns");
    await insertTxn({ userId: userA, accountId: withTxns.id, amount: -100 });
    const blocked = await accountsService.softDelete(db, userA, withTxns.id);
    expect(isErr(blocked)).toBe(true);

    const empty = await createAccount(userA, "Empty account");
    const deleted = await accountsService.softDelete(db, userA, empty.id);
    expect(isOk(deleted)).toBe(true);
    const list = await accountsService.list(db, userA, { includeArchived: true });
    expect(list.some((a) => a.id === empty.id)).toBe(false);
  });

  test("net position groups strictly by currency (invariant 8)", async () => {
    const npUser = await seedUser("networth@example.com");
    await createAccount(npUser, "MYR bank", { openingBalanceMinor: 500000 });
    await createAccount(npUser, "Card", {
      type: "credit_card",
      openingBalanceMinor: -120000,
      creditLimitMinor: 800000,
    });
    await createAccount(npUser, "SGD wallet", {
      type: "ewallet",
      currency: "SGD",
      openingBalanceMinor: 30000,
    });

    const position = await accountsService.netPosition(db, npUser);
    expect(position.MYR).toMatchObject({
      assetsMinor: 500000,
      liabilitiesMinor: -120000,
      netMinor: 380000,
    });
    expect(position.SGD).toMatchObject({ assetsMinor: 30000, netMinor: 30000 });
    // No combined total exists anywhere in the shape.
    expect(Object.keys(position).sort()).toEqual(["MYR", "SGD"]);
  });

  test("reconciliation records a snapshot and optional adjustment atomically (invariant 9)", async () => {
    const account = await createAccount(userA, "Reconcile me", { openingBalanceMinor: 10000 });
    await insertTxn({ userId: userA, accountId: account.id, amount: -2000 });

    const preview = await accountsService.previewReconciliation(db, userA, {
      accountId: account.id,
      asOf: "2026-08-31",
      statementBalanceMinor: 7500,
    });
    expect(isOk(preview)).toBe(true);
    if (isOk(preview)) {
      expect(preview.data.computedMinor).toBe(8000);
      expect(preview.data.discrepancyMinor).toBe(-500);
    }

    const recorded = await accountsService.recordReconciliation(db, userA, {
      accountId: account.id,
      asOf: "2026-08-31",
      statementBalanceMinor: 7500,
      createAdjustment: true,
    });
    expect(isOk(recorded)).toBe(true);

    const after = await accountsService.get(db, userA, account.id);
    expect(after?.balanceMinor).toBe(7500);

    // Same account+date+source again: unique snapshot violation must roll back
    // the adjustment too — balance stays reconciled, no extra adjustment row.
    const replay = await accountsService.recordReconciliation(db, userA, {
      accountId: account.id,
      asOf: "2026-08-31",
      statementBalanceMinor: 9999,
      createAdjustment: true,
    });
    expect(isErr(replay)).toBe(true);
    const balanceAfterReplay = await accountsService.get(db, userA, account.id);
    expect(balanceAfterReplay?.balanceMinor).toBe(7500);
    const adjustments = await testDb.pool.query(
      `select count(*)::int as n from transactions where account_id = $1 and type = 'adjustment'`,
      [account.id],
    );
    expect(adjustments.rows[0].n).toBe(1);
  });
});

describe("categoriesService", () => {
  test("ensureDefaults seeds the Malaysian template exactly once", async () => {
    const first = await categoriesService.ensureDefaults(db, userA);
    const second = await categoriesService.ensureDefaults(db, userA);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);

    const groups = await categoriesService.listGroups(db, userA);
    expect(groups.length).toBeGreaterThanOrEqual(8);
    const food = groups.find((g) => g.name === "Food & drink");
    expect(food).toBeDefined();
    expect(food!.categories.some((c) => c.name === "Food delivery")).toBe(true);
    expect(groups.some((g) => g.kind === "income")).toBe(true);
  });

  test("category names are unique per group, not globally", async () => {
    const groups = await categoriesService.listGroups(db, userA);
    const g1 = groups[0];
    const g2 = groups[1];
    const created = await categoriesService.createCategory(db, userA, {
      groupId: g1.id,
      name: "Unique test",
    });
    expect(isOk(created)).toBe(true);
    const dupSameGroup = await categoriesService.createCategory(db, userA, {
      groupId: g1.id,
      name: "UNIQUE TEST",
    });
    expect(isErr(dupSameGroup)).toBe(true);
    const sameNameOtherGroup = await categoriesService.createCategory(db, userA, {
      groupId: g2.id,
      name: "Unique test",
    });
    expect(isOk(sameNameOtherGroup)).toBe(true);
  });

  test("ISOLATION: creating a category under another user's group is rejected", async () => {
    await categoriesService.ensureDefaults(db, userB);
    const bGroups = await categoriesService.listGroups(db, userB);
    const attempt = await categoriesService.createCategory(db, userA, {
      groupId: bGroups[0].id,
      name: "Sneaky",
    });
    expect(isErr(attempt)).toBe(true);
    if (isErr(attempt)) expect(attempt.error.code).toBe("not_found");
  });

  test("archiving a group archives its categories, preserving references", async () => {
    const created = await categoriesService.createGroup(db, userA, {
      name: "Seasonal",
      kind: "expense",
    });
    if (!isOk(created)) throw new Error("setup failed");
    const cat = await categoriesService.createCategory(db, userA, {
      groupId: created.data.id,
      name: "Festival",
    });
    if (!isOk(cat)) throw new Error("setup failed");

    const archived = await categoriesService.archiveGroup(db, userA, created.data.id);
    expect(isOk(archived)).toBe(true);

    const visible = await categoriesService.listGroups(db, userA);
    expect(visible.some((g) => g.id === created.data.id)).toBe(false);
    const all = await categoriesService.listGroups(db, userA, { includeArchived: true });
    const seasonal = all.find((g) => g.id === created.data.id);
    expect(seasonal?.archivedAt).not.toBeNull();
    expect(seasonal?.categories[0]?.archivedAt).not.toBeNull();
  });
});

describe("tagsService", () => {
  test("create, duplicate rejection, soft delete", async () => {
    const created = await tagsService.create(db, userA, { name: "travel" });
    expect(isOk(created)).toBe(true);
    const dup = await tagsService.create(db, userA, { name: "Travel" });
    expect(isErr(dup)).toBe(true);

    if (!isOk(created)) return;
    await tagsService.softDelete(db, userA, created.data.id);
    const list = await tagsService.list(db, userA);
    expect(list.some((t) => t.id === created.data.id)).toBe(false);
  });
});

describe("merchantsService", () => {
  test("findOrCreate normalizes and reuses merchants, collecting aliases", async () => {
    const first = await merchantsService.findOrCreate(db, userA, "GRABFOOD*KL 1234");
    const second = await merchantsService.findOrCreate(db, userA, "GrabFood* PJ 99");
    expect(first).not.toBeNull();
    expect(second?.id).toBe(first!.id);
    expect(second?.canonicalName).toBe("Grabfood");
    expect(second?.aliases).toEqual(
      expect.arrayContaining(["GRABFOOD*KL 1234", "GrabFood* PJ 99"]),
    );
  });

  test("junk-only names produce no merchant", async () => {
    expect(await merchantsService.findOrCreate(db, userA, "  1234 ")).toBeNull();
  });

  test("ISOLATION: default category must belong to the same user", async () => {
    const merchant = await merchantsService.findOrCreate(db, userA, "Zus Coffee");
    const bGroups = await categoriesService.listGroups(db, userB);
    const bCategory = bGroups[0].categories[0];
    const attempt = await merchantsService.update(db, userA, merchant!.id, {
      defaultCategoryId: bCategory.id,
    });
    expect(isErr(attempt)).toBe(true);
  });
});

describe("cross-user isolation for reference data", () => {
  test("A cannot read, update, archive, or delete B's account", async () => {
    const bAccount = await createAccount(userB, "B's account");
    expect(await accountsService.get(db, userA, bAccount.id)).toBeNull();

    const update = await accountsService.update(db, userA, bAccount.id, { name: "Hijack" }, 1);
    expect(isErr(update)).toBe(true);
    const archive = await accountsService.setArchived(db, userA, bAccount.id, true);
    expect(isErr(archive)).toBe(true);
    const del = await accountsService.softDelete(db, userA, bAccount.id);
    expect(isErr(del)).toBe(true);

    const untouched = await accountsService.get(db, userB, bAccount.id);
    expect(untouched?.name).toBe("B's account");
    expect(untouched?.status).toBe("active");
  });

  test("lists never leak across users", async () => {
    const aAccounts = await accountsService.list(db, userA, { includeArchived: true });
    expect(aAccounts.every((a) => a.userId === userA)).toBe(true);
    const aGroups = await categoriesService.listGroups(db, userA, { includeArchived: true });
    expect(aGroups.every((g) => g.userId === userA)).toBe(true);
    const aMerchants = await merchantsService.list(db, userA);
    expect(aMerchants.every((m) => m.userId === userA)).toBe(true);
  });
});
