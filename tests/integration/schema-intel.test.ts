import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { createTestDatabase, type TestDatabase } from "./harness";

/** Phase 7 intelligence schema: forecasts cache, insights, evidence. */

let db: TestDatabase;

const USER_A = "018f0000-0000-7000-8000-000000000101";
const USER_B = "018f0000-0000-7000-8000-000000000102";
const INSIGHT = "018f0000-0000-7000-8000-00000000f001";

beforeAll(async () => {
  db = await createTestDatabase();
  for (const [id, email] of [
    [USER_A, "intel-a@example.com"],
    [USER_B, "intel-b@example.com"],
  ]) {
    await db.pool.query(`insert into users (id, email, password_hash) values ($1, $2, 'x')`, [
      id,
      email,
    ]);
  }
  await db.pool.query(
    `insert into insights (id, user_id, type, title, body, period_start, period_end, dedup_key)
     values ($1, $2, 'spend_change', 'Food up', 'Food spending increased', '2026-07-01', '2026-07-31', 'spend_change:food:2026-07')`,
    [INSIGHT, USER_A],
  );
});

afterAll(async () => {
  await db.drop();
});

describe("forecast cache constraints", () => {
  test("horizons are limited to 30/60/90; (user, kind, hash) is unique", async () => {
    await expect(
      db.pool.query(
        `insert into forecasts (id, user_id, kind, horizon_days, method, method_version, series, inputs_hash, expires_at)
         values ('018f0000-0000-7000-8000-00000000f101', $1, 'cash_flow', 45, 'recurring+baseline', 'v1', '[]'::jsonb, 'h1', now() + interval '1 day')`,
        [USER_A],
      ),
    ).rejects.toThrow(/horizon_valid/i);
    await db.pool.query(
      `insert into forecasts (id, user_id, kind, horizon_days, method, method_version, series, inputs_hash, expires_at)
       values ('018f0000-0000-7000-8000-00000000f102', $1, 'cash_flow', 30, 'recurring+baseline', 'v1', '[]'::jsonb, 'h1', now() + interval '1 day')`,
      [USER_A],
    );
    await expect(
      db.pool.query(
        `insert into forecasts (id, user_id, kind, horizon_days, method, method_version, series, inputs_hash, expires_at)
         values ('018f0000-0000-7000-8000-00000000f103', $1, 'cash_flow', 60, 'recurring+baseline', 'v1', '[]'::jsonb, 'h1', now() + interval '1 day')`,
        [USER_A],
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });
});

describe("insight constraints", () => {
  test("dedup key is unique per user; period and confidence are checked", async () => {
    await expect(
      db.pool.query(
        `insert into insights (id, user_id, type, title, body, period_start, period_end, dedup_key)
         values ('018f0000-0000-7000-8000-00000000f002', $1, 'spend_change', 'Dup', 'x', '2026-07-01', '2026-07-31', 'spend_change:food:2026-07')`,
        [USER_A],
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
    await expect(
      db.pool.query(
        `insert into insights (id, user_id, type, title, body, period_start, period_end, dedup_key)
         values ('018f0000-0000-7000-8000-00000000f003', $1, 'anomaly', 'Bad period', 'x', '2026-07-31', '2026-07-01', 'k2')`,
        [USER_A],
      ),
    ).rejects.toThrow(/period_valid/i);
    await expect(
      db.pool.query(
        `insert into insights (id, user_id, type, title, body, period_start, period_end, dedup_key, confidence_bp)
         values ('018f0000-0000-7000-8000-00000000f004', $1, 'anomaly', 'Bad conf', 'x', '2026-07-01', '2026-07-31', 'k3', 20000)`,
        [USER_A],
      ),
    ).rejects.toThrow(/confidence_range/i);
  });

  test("evidence must belong to the insight's user (trigger)", async () => {
    await db.pool.query(
      `insert into insight_evidence (id, insight_id, user_id, evidence_type, payload)
       values ('018f0000-0000-7000-8000-00000000f201', $1, $2, 'category_delta', '{"deltaMinor":41000}'::jsonb)`,
      [INSIGHT, USER_A],
    );
    await expect(
      db.pool.query(
        `insert into insight_evidence (id, insight_id, user_id, evidence_type, payload)
         values ('018f0000-0000-7000-8000-00000000f202', $1, $2, 'category_delta', '{}'::jsonb)`,
        [INSIGHT, USER_B],
      ),
    ).rejects.toThrow(/does not own the insight/i);
  });
});
