import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { createTestDatabase, type TestDatabase } from "./harness";

/** Phase 6 recurring schema: patterns, subscriptions, notifications. */

let db: TestDatabase;

const USER_A = "018f0000-0000-7000-8000-0000000000f1";
const USER_B = "018f0000-0000-7000-8000-0000000000f2";
const PATTERN = "018f0000-0000-7000-8000-00000000e001";
const MERCHANT_B = "018f0000-0000-7000-8000-00000000e101";

beforeAll(async () => {
  db = await createTestDatabase();
  for (const [id, email] of [
    [USER_A, "rec-a@example.com"],
    [USER_B, "rec-b@example.com"],
  ]) {
    await db.pool.query(`insert into users (id, email, password_hash) values ($1, $2, 'x')`, [
      id,
      email,
    ]);
  }
  await db.pool.query(
    `insert into merchants (id, user_id, canonical_name, normalized_key)
     values ($1, $2, 'B merchant', 'b-merchant')`,
    [MERCHANT_B, USER_B],
  );
  await db.pool.query(
    `insert into recurring_patterns
       (id, user_id, name, direction, frequency, typical_amount_minor, currency, next_expected_on, inference_key)
     values ($1, $2, 'Netflix', 'outflow', 'monthly', 5490, 'MYR', '2026-09-12', 'merchant:netflix|monthly')`,
    [PATTERN, USER_A],
  );
});

afterAll(async () => {
  await db.drop();
});

describe("recurring pattern constraints", () => {
  test("amounts must be positive, confidence within 0–10000", async () => {
    await expect(
      db.pool.query(
        `insert into recurring_patterns (id, user_id, name, direction, frequency, typical_amount_minor, currency, next_expected_on)
         values ('018f0000-0000-7000-8000-00000000e002', $1, 'Zero', 'outflow', 'monthly', 0, 'MYR', '2026-09-01')`,
        [USER_A],
      ),
    ).rejects.toThrow(/amount_positive/i);
    await expect(
      db.pool.query(
        `insert into recurring_patterns (id, user_id, name, direction, frequency, typical_amount_minor, currency, next_expected_on, confidence_bp)
         values ('018f0000-0000-7000-8000-00000000e003', $1, 'Odd', 'outflow', 'monthly', 100, 'MYR', '2026-09-01', 12000)`,
        [USER_A],
      ),
    ).rejects.toThrow(/confidence_range/i);
  });

  test("installment counters must be consistent", async () => {
    await expect(
      db.pool.query(
        `insert into recurring_patterns (id, user_id, name, direction, frequency, typical_amount_minor, currency, next_expected_on, is_installment, installments_total, installments_observed)
         values ('018f0000-0000-7000-8000-00000000e004', $1, 'BNPL', 'outflow', 'monthly', 29158, 'MYR', '2026-09-06', true, 4, 6)`,
        [USER_A],
      ),
    ).rejects.toThrow(/installments_valid/i);
  });

  test("inference keys are unique per user (detector idempotency)", async () => {
    await expect(
      db.pool.query(
        `insert into recurring_patterns (id, user_id, name, direction, frequency, typical_amount_minor, currency, next_expected_on, inference_key)
         values ('018f0000-0000-7000-8000-00000000e005', $1, 'Netflix again', 'outflow', 'monthly', 5490, 'MYR', '2026-09-12', 'merchant:netflix|monthly')`,
        [USER_A],
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
    // The same key for ANOTHER user is fine.
    await db.pool.query(
      `insert into recurring_patterns (id, user_id, name, direction, frequency, typical_amount_minor, currency, next_expected_on, inference_key)
       values ('018f0000-0000-7000-8000-00000000e006', $1, 'Netflix', 'outflow', 'monthly', 5490, 'MYR', '2026-09-12', 'merchant:netflix|monthly')`,
      [USER_B],
    );
  });

  test("patterns cannot reference another user's merchant (trigger)", async () => {
    await expect(
      db.pool.query(
        `insert into recurring_patterns (id, user_id, name, direction, frequency, typical_amount_minor, currency, next_expected_on, merchant_id)
         values ('018f0000-0000-7000-8000-00000000e007', $1, 'Steal', 'outflow', 'monthly', 100, 'MYR', '2026-09-01', $2)`,
        [USER_A, MERCHANT_B],
      ),
    ).rejects.toThrow(/belongs to another user/i);
  });
});

describe("subscription constraints", () => {
  test("one subscription per pattern; owner must match (trigger); price positive", async () => {
    await db.pool.query(
      `insert into subscriptions (id, recurring_pattern_id, user_id, service_name, current_price_minor)
       values ('018f0000-0000-7000-8000-00000000e201', $1, $2, 'Netflix', 5490)`,
      [PATTERN, USER_A],
    );
    await expect(
      db.pool.query(
        `insert into subscriptions (id, recurring_pattern_id, user_id, service_name, current_price_minor)
         values ('018f0000-0000-7000-8000-00000000e202', $1, $2, 'Netflix dup', 5490)`,
        [PATTERN, USER_A],
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
    await expect(
      db.pool.query(
        `insert into subscriptions (id, recurring_pattern_id, user_id, service_name, current_price_minor)
         values ('018f0000-0000-7000-8000-00000000e203', $1, $2, 'Cross user', 5490)`,
        [PATTERN, USER_B],
      ),
    ).rejects.toThrow(/does not own the recurring pattern/i);
  });
});

describe("notification dedup", () => {
  test("one live notification per (user, dedup key); dismissal frees the key", async () => {
    await db.pool.query(
      `insert into notifications (id, user_id, type, title, body, dedup_key)
       values ('018f0000-0000-7000-8000-00000000e301', $1, 'bill_cluster', 'Bills cluster', '3 bills', 'cluster:2026-09-01')`,
      [USER_A],
    );
    await expect(
      db.pool.query(
        `insert into notifications (id, user_id, type, title, body, dedup_key)
         values ('018f0000-0000-7000-8000-00000000e302', $1, 'bill_cluster', 'Bills cluster', '3 bills', 'cluster:2026-09-01')`,
        [USER_A],
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
    // Same key for another user is independent.
    await db.pool.query(
      `insert into notifications (id, user_id, type, title, body, dedup_key)
       values ('018f0000-0000-7000-8000-00000000e303', $1, 'bill_cluster', 'Bills cluster', '3 bills', 'cluster:2026-09-01')`,
      [USER_B],
    );
    // Dismissing releases the unique slot at the DB level (the service still
    // refuses to re-create dismissed keys).
    await db.pool.query(`update notifications set dismissed_at = now() where id = $1`, [
      "018f0000-0000-7000-8000-00000000e301",
    ]);
    await db.pool.query(
      `insert into notifications (id, user_id, type, title, body, dedup_key)
       values ('018f0000-0000-7000-8000-00000000e304', $1, 'bill_cluster', 'Bills cluster', '3 bills', 'cluster:2026-09-01')`,
      [USER_A],
    );
  });
});
