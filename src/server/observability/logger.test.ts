import { describe, expect, it } from "vitest";

import { scrubForLogging } from "./logger";

describe("scrubForLogging (G6 log scrubber)", () => {
  it("redacts secrets and credentials by key", () => {
    const scrubbed = scrubForLogging({
      password: "hunter2",
      sessionToken: "abc",
      apiKey: "sk-123",
      authorization: "Bearer x",
      cookie: "session=1",
      clientSecret: "s",
    }) as Record<string, unknown>;
    for (const value of Object.values(scrubbed)) {
      expect(value).toBe("[redacted]");
    }
  });

  it("redacts raw financial detail by key, keeping safe operational fields", () => {
    const scrubbed = scrubForLogging({
      amountMinor: -160000,
      amount_minor: 5000,
      openingBalanceMinor: 485000,
      typical_amount_minor: 12900,
      description: "LON EATERY KL",
      descriptionOriginal: "MAYBANK2U TRSF",
      notes: "rent for august",
      title: "Unusual spending",
      body: "You spent RM 1,600 more",
      merchantName: "ZUS Coffee",
      email: "user@example.com",
      diff: { before: 1, after: 2 },
      userId: "0198c5cc-1111-7000-8000-000000000001",
      rowCount: 42,
      durationMs: 87,
      status: "committed",
    }) as Record<string, unknown>;

    expect(scrubbed.amountMinor).toBe("[redacted]");
    expect(scrubbed.amount_minor).toBe("[redacted]");
    expect(scrubbed.openingBalanceMinor).toBe("[redacted]");
    expect(scrubbed.typical_amount_minor).toBe("[redacted]");
    expect(scrubbed.description).toBe("[redacted]");
    expect(scrubbed.descriptionOriginal).toBe("[redacted]");
    expect(scrubbed.notes).toBe("[redacted]");
    expect(scrubbed.title).toBe("[redacted]");
    expect(scrubbed.body).toBe("[redacted]");
    expect(scrubbed.merchantName).toBe("[redacted]");
    expect(scrubbed.email).toBe("[redacted]");
    expect(scrubbed.diff).toBe("[redacted]");

    expect(scrubbed.userId).toBe("0198c5cc-1111-7000-8000-000000000001");
    expect(scrubbed.rowCount).toBe(42);
    expect(scrubbed.durationMs).toBe(87);
    expect(scrubbed.status).toBe("committed");
  });

  it("scrubs nested objects and arrays", () => {
    const scrubbed = scrubForLogging({
      job: { payload: { password: "x", jobId: "j1" } },
      rows: [{ amountMinor: 100, id: "a" }],
    }) as {
      job: { payload: Record<string, unknown> };
      rows: Array<Record<string, unknown>>;
    };
    expect(scrubbed.job.payload.password).toBe("[redacted]");
    expect(scrubbed.job.payload.jobId).toBe("j1");
    expect(scrubbed.rows[0].amountMinor).toBe("[redacted]");
    expect(scrubbed.rows[0].id).toBe("a");
  });

  it("serializes Errors to name + message and caps long strings", () => {
    const scrubbed = scrubForLogging(new Error("boom")) as Record<string, unknown>;
    expect(scrubbed).toEqual({ error: "Error", message: "boom" });

    const long = scrubForLogging("x".repeat(500));
    expect(String(long).length).toBeLessThan(400);
    expect(String(long).endsWith("...")).toBe(true);
  });

  it("stops at depth instead of recursing forever", () => {
    type Deep = { child?: Deep };
    const root: Deep = {};
    let cursor = root;
    for (let i = 0; i < 12; i += 1) {
      cursor.child = {};
      cursor = cursor.child;
    }
    expect(JSON.stringify(scrubForLogging(root))).toContain("[redacted]");
  });
});
