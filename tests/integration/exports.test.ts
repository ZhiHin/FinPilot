import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { uuidv7 } from "@/lib/ids";
import { isOk, type Result } from "@/lib/result";
import { createDb, type Db } from "@/server/db/client";
import { auditRepo } from "@/server/db/repositories/audit";
import { accountsService, type AccountRow } from "@/server/services/accounts";
import { EXPORTS_PER_HOUR, exportsService } from "@/server/services/exports";
import { transactionsService } from "@/server/services/transactions";

import { createTestDatabase, type TestDatabase } from "./harness";

let testDb: TestDatabase;
let db: Db;
let userA: string;
let userB: string;
let accountA: AccountRow;
let accountB: AccountRow;

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
  userA = await seedUser("export-a@example.com");
  userB = await seedUser("export-b@example.com");
  accountA = unwrap(
    await accountsService.create(db, userA, {
      name: "Export main",
      type: "current",
      openingBalanceMinor: 0,
      openingBalanceDate: "2026-01-01",
    }),
    "account A",
  );
  accountB = unwrap(
    await accountsService.create(db, userB, {
      name: "B account",
      type: "current",
      openingBalanceMinor: 0,
      openingBalanceDate: "2026-01-01",
    }),
    "account B",
  );

  unwrap(
    await transactionsService.create(db, userA, {
      accountId: accountA.id,
      type: "expense",
      amountMinor: -1290,
      txnDate: "2026-06-03",
      description: "ZUS Coffee",
      merchantName: "ZUS Coffee",
    }),
    "txn 1",
  );
  // Hostile description: must arrive escaped, never as a live formula.
  unwrap(
    await transactionsService.create(db, userA, {
      accountId: accountA.id,
      type: "expense",
      amountMinor: -5000,
      txnDate: "2026-06-04",
      description: '=HYPERLINK("http://evil.test")',
      notes: "@steal, data",
    }),
    "txn 2",
  );
  unwrap(
    await transactionsService.create(db, userB, {
      accountId: accountB.id,
      type: "income",
      amountMinor: 999900,
      txnDate: "2026-06-05",
      description: "B secret salary",
    }),
    "txn B",
  );
});

afterAll(async () => {
  await testDb.drop();
});

describe("exportsService.exportTransactionsCsv", () => {
  test("exports only the caller's rows, formula-escaped, without internal ids", async () => {
    const out = unwrap(await exportsService.exportTransactionsCsv(db, userA, {}), "export");
    expect(out.rowCount).toBe(2);
    expect(out.truncated).toBe(false);
    expect(out.csv).toContain("ZUS Coffee");
    // Injection neutralized with a leading apostrophe inside the quoted cell.
    expect(out.csv).toContain("'=HYPERLINK");
    expect(out.csv).toContain("'@steal");
    // Never another user's data, never uuids/hashes.
    expect(out.csv).not.toContain("B secret salary");
    expect(out.csv).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);
  });

  test("filters are applied and foreign filter ids fail closed", async () => {
    const filtered = unwrap(
      await exportsService.exportTransactionsCsv(db, userA, { dateTo: "2026-06-03" }),
      "filtered",
    );
    expect(filtered.rowCount).toBe(1);

    const foreign = await exportsService.exportTransactionsCsv(db, userA, {
      accountIds: [accountB.id],
    });
    expect(foreign.ok).toBe(false);
  });

  test("audits each export and rate limits per user", async () => {
    // The two successful exports above are already audited.
    const events = await auditRepo.countRecentEvents(db, {
      eventType: "export.transactions",
      since: new Date(Date.now() - 60_000),
      userId: userA,
    });
    expect(events).toBeGreaterThanOrEqual(2);

    // Exhaust the limit; the next call must refuse.
    for (let i = events; i < EXPORTS_PER_HOUR; i++) {
      unwrap(await exportsService.exportTransactionsCsv(db, userA, {}), `fill ${i}`);
    }
    const blocked = await exportsService.exportTransactionsCsv(db, userA, {});
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.code).toBe("rate_limited");

    // Another user is unaffected (per-user limit).
    expect(isOk(await exportsService.exportTransactionsCsv(db, userB, {}))).toBe(true);
  });
});
