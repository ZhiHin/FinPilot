import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { uuidv7 } from "@/lib/ids";

import { createTestDatabase, type TestDatabase } from "./harness";

/**
 * Phase 9 schema constraints: the database itself enforces the simulation and
 * journal invariants even if the service layer is bypassed.
 */

let db: TestDatabase;
let userA: string;
let userB: string;

async function seedUser(email: string): Promise<string> {
  const id = uuidv7();
  await db.pool.query(`insert into users (id, email, password_hash) values ($1, $2, 'x')`, [
    id,
    email,
  ]);
  return id;
}

async function insertScenario(userId: string, name = "Test", status = "draft"): Promise<string> {
  const id = uuidv7();
  await db.pool.query(`insert into scenarios (id, user_id, name, status) values ($1, $2, $3, $4)`, [
    id,
    userId,
    name,
    status,
  ]);
  return id;
}

async function insertEntry(userId: string, title = "Entry"): Promise<string> {
  const id = uuidv7();
  await db.pool.query(
    `insert into journal_entries (id, user_id, kind, title, starts_on)
     values ($1, $2, 'note', $3, '2026-06-01')`,
    [id, userId, title],
  );
  return id;
}

beforeAll(async () => {
  db = await createTestDatabase();
  userA = await seedUser("sim-a@example.com");
  userB = await seedUser("sim-b@example.com");
});

afterAll(async () => {
  await db.drop();
});

describe("scenarios constraints", () => {
  test("status and name are constrained", async () => {
    await expect(
      db.pool.query(
        `insert into scenarios (id, user_id, name, status) values ($1, $2, 'X', 'imaginary')`,
        [uuidv7(), userA],
      ),
    ).rejects.toThrow(/invalid input value for enum scenario_status/);
    await expect(
      db.pool.query(`insert into scenarios (id, user_id, name) values ($1, $2, '   ')`, [
        uuidv7(),
        userA,
      ]),
    ).rejects.toThrow(/scenarios_name_not_empty/);
  });

  test("saved names are unique per user among live scenarios only", async () => {
    await insertScenario(userA, "Laptop - Sept", "saved");
    // Same name as a DRAFT is fine; promoting a duplicate to saved is not.
    const draft = await insertScenario(userA, "laptop - sept", "draft");
    await expect(
      db.pool.query(`update scenarios set status = 'saved' where id = $1`, [draft]),
    ).rejects.toThrow(/scenarios_user_saved_name_unique/);
    // Another user may reuse the name; soft-deleting frees it.
    await insertScenario(userB, "Laptop - Sept", "saved");
    await db.pool.query(`update scenarios set deleted_at = now() where id != $1`, [draft]);
    await db.pool.query(`update scenarios set status = 'saved' where id = $1`, [draft]);
  });

  test("event types are constrained and events must belong to the scenario owner", async () => {
    const scenario = await insertScenario(userA, "Events");
    await expect(
      db.pool.query(
        `insert into scenario_events (id, scenario_id, user_id, event_type, effective_on)
         values ($1, $2, $3, 'buy_lottery', '2026-09-01')`,
        [uuidv7(), scenario, userA],
      ),
    ).rejects.toThrow(/invalid input value for enum scenario_event_type/);
    // Trigger: user B cannot attach an event to A's scenario.
    await expect(
      db.pool.query(
        `insert into scenario_events (id, scenario_id, user_id, event_type, effective_on)
         values ($1, $2, $3, 'one_time_expense', '2026-09-01')`,
        [uuidv7(), scenario, userB],
      ),
    ).rejects.toThrow(/belongs to another user/);
  });
});

describe("journal constraints", () => {
  test("kind, title, and period are constrained", async () => {
    await expect(
      db.pool.query(
        `insert into journal_entries (id, user_id, kind, title, starts_on)
         values ($1, $2, 'gossip', 'X', '2026-06-01')`,
        [uuidv7(), userA],
      ),
    ).rejects.toThrow(/invalid input value for enum journal_kind/);
    await expect(
      db.pool.query(
        `insert into journal_entries (id, user_id, kind, title, starts_on)
         values ($1, $2, 'note', '  ', '2026-06-01')`,
        [uuidv7(), userA],
      ),
    ).rejects.toThrow(/journal_entries_title_not_empty/);
    await expect(
      db.pool.query(
        `insert into journal_entries (id, user_id, kind, title, starts_on, ends_on)
         values ($1, $2, 'note', 'X', '2026-06-10', '2026-06-01')`,
        [uuidv7(), userA],
      ),
    ).rejects.toThrow(/journal_entries_period_valid/);
  });

  test("links are unique per entity, type-constrained, and owner-guarded", async () => {
    const entry = await insertEntry(userA, "Linked");
    const scenario = await insertScenario(userA, "Link target");
    await db.pool.query(
      `insert into journal_links (id, journal_entry_id, user_id, entity_type, entity_id)
       values ($1, $2, $3, 'scenario', $4)`,
      [uuidv7(), entry, userA, scenario],
    );
    await expect(
      db.pool.query(
        `insert into journal_links (id, journal_entry_id, user_id, entity_type, entity_id)
         values ($1, $2, $3, 'scenario', $4)`,
        [uuidv7(), entry, userA, scenario],
      ),
    ).rejects.toThrow(/journal_links_entry_entity_unique/);
    await expect(
      db.pool.query(
        `insert into journal_links (id, journal_entry_id, user_id, entity_type, entity_id)
         values ($1, $2, $3, 'spaceship', $4)`,
        [uuidv7(), entry, userA, uuidv7()],
      ),
    ).rejects.toThrow(/journal_links_entity_type_valid/);
    // Trigger: user B cannot attach a link to A's entry.
    await expect(
      db.pool.query(
        `insert into journal_links (id, journal_entry_id, user_id, entity_type, entity_id)
         values ($1, $2, $3, 'scenario', $4)`,
        [uuidv7(), entry, userB, scenario],
      ),
    ).rejects.toThrow(/belongs to another user/);
  });
});
