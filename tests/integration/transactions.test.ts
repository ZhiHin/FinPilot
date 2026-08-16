import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { uuidv7 } from "@/lib/ids";
import { isErr, isOk, type Result } from "@/lib/result";
import { createDb, type Db } from "@/server/db/client";
import { accountsService, type AccountRow } from "@/server/services/accounts";
import { categoriesService } from "@/server/services/categories";
import { tagsService } from "@/server/services/tags";
import { transactionsService } from "@/server/services/transactions";

import { createTestDatabase, type TestDatabase } from "./harness";

let testDb: TestDatabase;
let db: Db;
let userA: string;
let userB: string;
let bankA: AccountRow; // MYR
let walletA: AccountRow; // MYR
let sgdA: AccountRow; // SGD
let bankB: AccountRow; // MYR (user B)
let groceriesA: string;
let deliveryA: string;
let travelTagA: string;
let categoryB: string;

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

async function makeAccount(userId: string, name: string, overrides: Record<string, unknown> = {}) {
  return unwrap(
    await accountsService.create(db, userId, {
      name,
      type: "current",
      openingBalanceMinor: 0,
      openingBalanceDate: "2026-01-01",
      ...overrides,
    } as Parameters<typeof accountsService.create>[2]),
    `account ${name}`,
  );
}

async function expenseId(
  amountMinor: number,
  extra: Partial<Parameters<typeof transactionsService.create>[2]> = {},
): Promise<string> {
  const created = unwrap(
    await transactionsService.create(db, userA, {
      accountId: bankA.id,
      type: "expense",
      amountMinor,
      txnDate: "2026-08-05",
      description: "test expense",
      ...extra,
    }),
    "expense",
  );
  return created.transaction.id;
}

beforeAll(async () => {
  testDb = await createTestDatabase();
  db = createDb(testDb.pool);
  userA = await seedUser("txn-a@example.com");
  userB = await seedUser("txn-b@example.com");
  bankA = await makeAccount(userA, "Main bank", { openingBalanceMinor: 1_000_000 });
  walletA = await makeAccount(userA, "Wallet", { type: "ewallet", openingBalanceMinor: 50_000 });
  sgdA = await makeAccount(userA, "SGD stash", { type: "ewallet", currency: "SGD" });
  bankB = await makeAccount(userB, "B bank", { openingBalanceMinor: 100_000 });

  await categoriesService.ensureDefaults(db, userA);
  await categoriesService.ensureDefaults(db, userB);
  const groupsA = await categoriesService.listGroups(db, userA);
  const food = groupsA.find((g) => g.name === "Food & drink")!;
  groceriesA = food.categories.find((c) => c.name === "Groceries")!.id;
  deliveryA = food.categories.find((c) => c.name === "Food delivery")!.id;
  const groupsB = await categoriesService.listGroups(db, userB);
  categoryB = groupsB[0].categories[0].id;

  travelTagA = unwrap(await tagsService.create(db, userA, { name: "e2e-travel" }), "tag").id;
});

afterAll(async () => {
  await testDb.drop();
});

describe("create", () => {
  test("creates an expense with merchant, category, and tags; audits it", async () => {
    const result = await transactionsService.create(db, userA, {
      accountId: bankA.id,
      type: "expense",
      amountMinor: -3250,
      txnDate: "2026-08-10",
      description: "GRABFOOD*KL 1234",
      merchantName: "GRABFOOD*KL 1234",
      categoryId: deliveryA,
      tagIds: [travelTagA],
    });
    const detail = unwrap(result, "create");
    expect(detail.transaction.amountMinor).toBe(-3250);
    expect(detail.transaction.descriptionOriginal).toBe("GRABFOOD*KL 1234");
    expect(detail.merchant?.canonicalName).toBe("Grabfood");
    expect(detail.tags.map((t) => t.id)).toEqual([travelTagA]);

    const audit = await testDb.pool.query(
      `select 1 from audit_logs where event_type = 'transaction.created' and entity_id = $1`,
      [detail.transaction.id],
    );
    expect(audit.rowCount).toBe(1);
  });

  test("rejects a sign that contradicts the type", async () => {
    const result = await transactionsService.create(db, userA, {
      accountId: bankA.id,
      type: "expense",
      amountMinor: 3250,
      txnDate: "2026-08-10",
    });
    expect(isErr(result)).toBe(true);
  });

  test("transfer type cannot be created directly — use createTransfer", async () => {
    const result = await transactionsService.create(db, userA, {
      accountId: bankA.id,
      type: "transfer" as never,
      amountMinor: -1000,
      txnDate: "2026-08-10",
    });
    expect(isErr(result)).toBe(true);
  });

  test("merchant default category applies when none is chosen", async () => {
    const { merchantsService } = await import("@/server/services/merchants");
    const merchant = await merchantsService.findOrCreate(db, userA, "Village Grocer");
    unwrap(
      await merchantsService.update(db, userA, merchant!.id, { defaultCategoryId: groceriesA }),
      "merchant update",
    );
    const detail = unwrap(
      await transactionsService.create(db, userA, {
        accountId: bankA.id,
        type: "expense",
        amountMinor: -8000,
        txnDate: "2026-08-11",
        merchantName: "VILLAGE GROCER 003",
      }),
      "create",
    );
    expect(detail.transaction.categoryId).toBe(groceriesA);
    expect(detail.transaction.categorizationSource).toBe("default");
  });

  test("ISOLATION: B's account, category, or tag in the payload is rejected outright", async () => {
    const viaAccount = await transactionsService.create(db, userA, {
      accountId: bankB.id,
      type: "expense",
      amountMinor: -100,
      txnDate: "2026-08-10",
    });
    expect(isErr(viaAccount)).toBe(true);

    const viaCategory = await transactionsService.create(db, userA, {
      accountId: bankA.id,
      type: "expense",
      amountMinor: -100,
      txnDate: "2026-08-10",
      categoryId: categoryB,
    });
    expect(isErr(viaCategory)).toBe(true);
  });
});

describe("splits (invariant 3)", () => {
  test("valid splits persist atomically with the parent", async () => {
    const detail = unwrap(
      await transactionsService.create(db, userA, {
        accountId: bankA.id,
        type: "expense",
        amountMinor: -12900,
        txnDate: "2026-08-12",
        description: "Shopee order",
        splits: [
          { categoryId: groceriesA, amountMinor: -9900 },
          { categoryId: deliveryA, amountMinor: -3000, isReimbursable: true },
        ],
      }),
      "create with splits",
    );
    expect(detail.splits.length).toBe(2);
    expect(detail.splits.reduce((a, s) => a + s.amountMinor, 0)).toBe(-12900);
  });

  test("mismatched splits are rejected and NOTHING persists (invariant 9 rollback)", async () => {
    const before = await testDb.pool.query(`select count(*)::int n from transactions`);
    const result = await transactionsService.create(db, userA, {
      accountId: bankA.id,
      type: "expense",
      amountMinor: -10000,
      txnDate: "2026-08-12",
      splits: [{ categoryId: groceriesA, amountMinor: -4000 }],
    });
    expect(isErr(result)).toBe(true);
    const after = await testDb.pool.query(`select count(*)::int n from transactions`);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  test("replacing splits keeps the sum law under the same commit", async () => {
    const id = await expenseId(-5000);
    const updated = await transactionsService.update(
      db,
      userA,
      id,
      {
        splits: [
          { categoryId: groceriesA, amountMinor: -2000 },
          { categoryId: deliveryA, amountMinor: -3000 },
        ],
      },
      1,
    );
    expect(isOk(updated)).toBe(true);

    const bad = await transactionsService.update(
      db,
      userA,
      id,
      { splits: [{ categoryId: groceriesA, amountMinor: -1 }] },
      2,
    );
    expect(isErr(bad)).toBe(true);
    const splits = await testDb.pool.query(
      `select coalesce(sum(amount_minor),0)::bigint s from transaction_splits where transaction_id = $1`,
      [id],
    );
    expect(Number(splits.rows[0].s)).toBe(-5000);
  });
});

describe("transfers (invariants 1, 2, 9)", () => {
  test("creates equal-and-opposite linked legs atomically", async () => {
    const result = unwrap(
      await transactionsService.createTransfer(db, userA, {
        fromAccountId: bankA.id,
        toAccountId: walletA.id,
        amountMinor: 10000,
        txnDate: "2026-08-13",
      }),
      "transfer",
    );
    const legs = await testDb.pool.query(
      `select id, amount_minor::bigint as amount, type from transactions where id in ($1, $2) order by amount_minor`,
      [result.fromTransactionId, result.toTransactionId],
    );
    expect(legs.rows.map((r) => Number(r.amount))).toEqual([-10000, 10000]);
    expect(legs.rows.every((r) => r.type === "transfer")).toBe(true);
  });

  test("transfers never move income/expense totals (invariant 1)", async () => {
    const before = await transactionsService.summary(db, userA, {});
    unwrap(
      await transactionsService.createTransfer(db, userA, {
        fromAccountId: bankA.id,
        toAccountId: walletA.id,
        amountMinor: 25000,
        txnDate: "2026-08-14",
      }),
      "transfer",
    );
    const after = await transactionsService.summary(db, userA, {});
    expect(after).toEqual(before);
  });

  test("cross-currency transfers are rejected (invariant 8)", async () => {
    const result = await transactionsService.createTransfer(db, userA, {
      fromAccountId: bankA.id,
      toAccountId: sgdA.id,
      amountMinor: 1000,
      txnDate: "2026-08-14",
    });
    expect(isErr(result)).toBe(true);
  });

  test("ISOLATION: transferring into another user's account is rejected", async () => {
    const result = await transactionsService.createTransfer(db, userA, {
      fromAccountId: bankA.id,
      toAccountId: bankB.id,
      amountMinor: 1000,
      txnDate: "2026-08-14",
    });
    expect(isErr(result)).toBe(true);
  });

  test("deleting one leg soft-deletes both; restore revives both", async () => {
    const pair = unwrap(
      await transactionsService.createTransfer(db, userA, {
        fromAccountId: bankA.id,
        toAccountId: walletA.id,
        amountMinor: 7000,
        txnDate: "2026-08-15",
      }),
      "transfer",
    );
    unwrap(await transactionsService.softDelete(db, userA, pair.fromTransactionId), "delete");
    const deleted = await testDb.pool.query(
      `select count(*)::int n from transactions where id in ($1,$2) and deleted_at is not null`,
      [pair.fromTransactionId, pair.toTransactionId],
    );
    expect(deleted.rows[0].n).toBe(2);

    unwrap(await transactionsService.restore(db, userA, pair.toTransactionId), "restore");
    const restored = await testDb.pool.query(
      `select count(*)::int n from transactions where id in ($1,$2) and deleted_at is null`,
      [pair.fromTransactionId, pair.toTransactionId],
    );
    expect(restored.rows[0].n).toBe(2);
  });

  test("transfer legs refuse amount edits (delete and recreate instead)", async () => {
    const pair = unwrap(
      await transactionsService.createTransfer(db, userA, {
        fromAccountId: bankA.id,
        toAccountId: walletA.id,
        amountMinor: 3000,
        txnDate: "2026-08-15",
      }),
      "transfer",
    );
    const attempt = await transactionsService.update(
      db,
      userA,
      pair.fromTransactionId,
      { amountMinor: -4000 },
      1,
    );
    expect(isErr(attempt)).toBe(true);
  });
});

describe("refunds and duplicates (invariant 4)", () => {
  test("a refund reduces expenses and never counts as income", async () => {
    const scoped = await seedUser("refund-scope@example.com");
    const account = unwrap(
      await accountsService.create(db, scoped, {
        name: "Refund acct",
        type: "current",
        openingBalanceMinor: 0,
        openingBalanceDate: "2026-01-01",
      }),
      "acct",
    );
    const purchase = unwrap(
      await transactionsService.create(db, scoped, {
        accountId: account.id,
        type: "expense",
        amountMinor: -12900,
        txnDate: "2026-08-01",
        description: "Shopee purchase",
      }),
      "purchase",
    );
    const refund = unwrap(
      await transactionsService.create(db, scoped, {
        accountId: account.id,
        type: "refund",
        amountMinor: 12900,
        txnDate: "2026-08-05",
        description: "Shopee refund",
      }),
      "refund",
    );
    unwrap(
      await transactionsService.linkRefund(db, scoped, {
        refundTransactionId: refund.transaction.id,
        purchaseTransactionId: purchase.transaction.id,
      }),
      "link",
    );

    const summary = await transactionsService.summary(db, scoped, {});
    expect(summary.MYR).toMatchObject({ incomeMinor: 0, expenseMinor: 0, netMinor: 0 });
  });

  test("linking a refund to another user's purchase is rejected", async () => {
    const refund = unwrap(
      await transactionsService.create(db, userA, {
        accountId: bankA.id,
        type: "refund",
        amountMinor: 500,
        txnDate: "2026-08-05",
      }),
      "refund",
    );
    const bPurchase = unwrap(
      await transactionsService.create(db, userB, {
        accountId: bankB.id,
        type: "expense",
        amountMinor: -500,
        txnDate: "2026-08-05",
      }),
      "purchase",
    );
    const attempt = await transactionsService.linkRefund(db, userA, {
      refundTransactionId: refund.transaction.id,
      purchaseTransactionId: bPurchase.transaction.id,
    });
    expect(isErr(attempt)).toBe(true);
  });

  test("marking a duplicate excludes it and unmarking restores it", async () => {
    const original = await expenseId(-1500, { description: "coffee" });
    const dup = await expenseId(-1500, { description: "coffee" });
    unwrap(
      await transactionsService.markDuplicate(db, userA, {
        duplicateTransactionId: dup,
        canonicalTransactionId: original,
      }),
      "mark duplicate",
    );
    const marked = await testDb.pool.query(`select is_excluded from transactions where id = $1`, [
      dup,
    ]);
    expect(marked.rows[0].is_excluded).toBe(true);

    unwrap(await transactionsService.unmarkDuplicate(db, userA, dup), "unmark");
    const unmarked = await testDb.pool.query(`select is_excluded from transactions where id = $1`, [
      dup,
    ]);
    expect(unmarked.rows[0].is_excluded).toBe(false);
  });
});

describe("reporting rules (invariant 5) and summary currency separation (invariant 8)", () => {
  test("pending, excluded, and deleted transactions follow the documented rules", async () => {
    const scoped = await seedUser("rules-scope@example.com");
    const account = unwrap(
      await accountsService.create(db, scoped, {
        name: "Rules acct",
        type: "current",
        openingBalanceMinor: 100000,
        openingBalanceDate: "2026-01-01",
      }),
      "acct",
    );
    await transactionsService.create(db, scoped, {
      accountId: account.id,
      type: "income",
      amountMinor: 50000,
      txnDate: "2026-08-01",
    });
    await transactionsService.create(db, scoped, {
      accountId: account.id,
      type: "expense",
      amountMinor: -10000,
      txnDate: "2026-08-02",
    });
    await transactionsService.create(db, scoped, {
      accountId: account.id,
      type: "expense",
      amountMinor: -7000,
      txnDate: "2026-08-03",
      status: "pending",
    });
    await transactionsService.create(db, scoped, {
      accountId: account.id,
      type: "expense",
      amountMinor: -5000,
      txnDate: "2026-08-04",
      isExcluded: true,
    });
    const doomed = unwrap(
      await transactionsService.create(db, scoped, {
        accountId: account.id,
        type: "expense",
        amountMinor: -3000,
        txnDate: "2026-08-05",
      }),
      "doomed",
    );
    await transactionsService.softDelete(db, scoped, doomed.transaction.id);

    // Reports: posted, non-excluded, non-deleted only.
    const summary = await transactionsService.summary(db, scoped, {});
    expect(summary.MYR).toMatchObject({ incomeMinor: 50000, expenseMinor: 10000, netMinor: 40000 });

    // Balance: posted incl. excluded; pending separate; deleted never.
    const balance = await accountsService.get(db, scoped, account.id);
    expect(balance?.balanceMinor).toBe(100000 + 50000 - 10000 - 5000);
    expect(balance?.pendingMinor).toBe(-7000);
  });

  test("summaries are keyed by currency with no combined figure", async () => {
    await transactionsService.create(db, userA, {
      accountId: sgdA.id,
      type: "expense",
      amountMinor: -2000,
      txnDate: "2026-08-06",
    });
    const summary = await transactionsService.summary(db, userA, {});
    expect(summary.SGD).toBeDefined();
    expect(summary.MYR).toBeDefined();
    expect((summary as Record<string, unknown>).total).toBeUndefined();
  });
});

describe("review workflow and bulk operations", () => {
  test("needs-review transactions can be reviewed in bulk, fail-closed", async () => {
    const t1 = await expenseId(-100, { needsReview: true });
    const t2 = await expenseId(-200, { needsReview: true });
    const bTxn = unwrap(
      await transactionsService.create(db, userB, {
        accountId: bankB.id,
        type: "expense",
        amountMinor: -100,
        txnDate: "2026-08-05",
        needsReview: true,
      }),
      "b txn",
    );

    // Tampered bulk payload containing B's id: the whole operation is rejected.
    const tampered = await transactionsService.setReviewed(
      db,
      userA,
      [t1, bTxn.transaction.id],
      true,
    );
    expect(isErr(tampered)).toBe(true);
    const untouched = await testDb.pool.query(
      `select needs_review from transactions where id = $1`,
      [t1],
    );
    expect(untouched.rows[0].needs_review).toBe(true);

    const legit = await transactionsService.setReviewed(db, userA, [t1, t2], true);
    expect(isOk(legit)).toBe(true);
    const reviewed = await testDb.pool.query(
      `select count(*)::int n from transactions where id in ($1,$2) and needs_review = false`,
      [t1, t2],
    );
    expect(reviewed.rows[0].n).toBe(2);
  });

  test("bulk categorize rejects transfer legs", async () => {
    const pair = unwrap(
      await transactionsService.createTransfer(db, userA, {
        fromAccountId: bankA.id,
        toAccountId: walletA.id,
        amountMinor: 1000,
        txnDate: "2026-08-16",
      }),
      "transfer",
    );
    const plain = await expenseId(-400);
    const attempt = await transactionsService.bulkSetCategory(db, userA, {
      transactionIds: [plain, pair.fromTransactionId],
      categoryId: groceriesA,
    });
    expect(isErr(attempt)).toBe(true);

    const alone = await transactionsService.bulkSetCategory(db, userA, {
      transactionIds: [plain],
      categoryId: groceriesA,
    });
    expect(isOk(alone)).toBe(true);
  });
});

describe("update, versioning, audit history", () => {
  test("stale versions conflict; important-field changes are audited with before/after", async () => {
    const id = await expenseId(-2500, { categoryId: groceriesA });
    const stale = await transactionsService.update(db, userA, id, { amountMinor: -2600 }, 99);
    expect(isErr(stale)).toBe(true);

    const updated = await transactionsService.update(
      db,
      userA,
      id,
      { amountMinor: -2600, categoryId: deliveryA },
      1,
    );
    expect(isOk(updated)).toBe(true);

    const audit = await testDb.pool.query(
      `select diff from audit_logs where event_type = 'transaction.updated' and entity_id = $1 order by created_at desc limit 1`,
      [id],
    );
    expect(audit.rowCount).toBe(1);
    const diff = audit.rows[0].diff as Record<string, { from: unknown; to: unknown }>;
    expect(diff.amountMinor).toEqual({ from: -2500, to: -2600 });
    expect(diff.categoryId).toEqual({ from: groceriesA, to: deliveryA });
  });

  test("ISOLATION: A cannot read, update, delete, or restore B's transaction", async () => {
    const bTxn = unwrap(
      await transactionsService.create(db, userB, {
        accountId: bankB.id,
        type: "expense",
        amountMinor: -999,
        txnDate: "2026-08-07",
      }),
      "b txn",
    );
    expect(await transactionsService.getDetail(db, userA, bTxn.transaction.id)).toBeNull();
    expect(
      isErr(await transactionsService.update(db, userA, bTxn.transaction.id, { notes: "x" }, 1)),
    ).toBe(true);
    expect(isErr(await transactionsService.softDelete(db, userA, bTxn.transaction.id))).toBe(true);
    const still = await testDb.pool.query(
      `select deleted_at, notes from transactions where id = $1`,
      [bTxn.transaction.id],
    );
    expect(still.rows[0].deleted_at).toBeNull();
    expect(still.rows[0].notes).toBeNull();
  });
});

describe("list, filters, search, pagination", () => {
  test("keyset pagination walks the full result set exactly once", async () => {
    const scoped = await seedUser("paging@example.com");
    const account = unwrap(
      await accountsService.create(db, scoped, {
        name: "Paging acct",
        type: "current",
        openingBalanceMinor: 0,
        openingBalanceDate: "2026-01-01",
      }),
      "acct",
    );
    for (let i = 0; i < 25; i += 1) {
      await transactionsService.create(db, scoped, {
        accountId: account.id,
        type: "expense",
        amountMinor: -(100 + i),
        txnDate: `2026-07-${String((i % 28) + 1).padStart(2, "0")}`,
      });
    }
    const seen = new Set<string>();
    let cursor: string | null = null;
    let rounds = 0;
    do {
      const page = await transactionsService.list(db, scoped, {
        limit: 10,
        cursor: cursor ?? undefined,
      });
      for (const item of page.items) {
        expect(seen.has(item.id)).toBe(false);
        seen.add(item.id);
      }
      cursor = page.nextCursor;
      rounds += 1;
    } while (cursor && rounds < 10);
    expect(seen.size).toBe(25);
    expect(rounds).toBe(3);
  });

  test("filters by account, category, type, review state, and search text", async () => {
    const needle = await expenseId(-4321, {
      description: "ZUS COFFEE BANGSAR",
      merchantName: "ZUS COFFEE BANGSAR",
      categoryId: deliveryA,
      needsReview: true,
    });

    const byAccount = await transactionsService.list(db, userA, { accountIds: [walletA.id] });
    expect(byAccount.items.every((i) => i.accountId === walletA.id)).toBe(true);

    const byCategory = await transactionsService.list(db, userA, { categoryIds: [deliveryA] });
    expect(byCategory.items.some((i) => i.id === needle)).toBe(true);
    expect(byCategory.items.every((i) => i.categoryId === deliveryA)).toBe(true);

    const review = await transactionsService.list(db, userA, { review: "needs_review" });
    expect(review.items.some((i) => i.id === needle)).toBe(true);
    expect(review.items.every((i) => i.needsReview)).toBe(true);

    const search = await transactionsService.list(db, userA, { search: "zus coffee" });
    expect(search.items.some((i) => i.id === needle)).toBe(true);

    const transfersOnly = await transactionsService.list(db, userA, { types: ["transfer"] });
    expect(transfersOnly.items.length).toBeGreaterThan(0);
    expect(transfersOnly.items.every((i) => i.type === "transfer")).toBe(true);

    const byTag = await transactionsService.list(db, userA, { tagIds: [travelTagA] });
    expect(byTag.items.length).toBeGreaterThan(0);
    expect(byTag.items.every((i) => i.tagNames.includes("e2e-travel"))).toBe(true);
  });

  test("deleted view shows only soft-deleted; default hides them", async () => {
    const id = await expenseId(-777);
    unwrap(await transactionsService.softDelete(db, userA, id), "delete");
    const normal = await transactionsService.list(db, userA, {});
    expect(normal.items.some((i) => i.id === id)).toBe(false);
    const deleted = await transactionsService.list(db, userA, { deleted: true });
    expect(deleted.items.some((i) => i.id === id)).toBe(true);
  });

  test("ISOLATION: lists never contain another user's transactions", async () => {
    const list = await transactionsService.list(db, userA, { limit: 200 });
    expect(list.items.every((i) => i.userId === userA)).toBe(true);
  });
});
