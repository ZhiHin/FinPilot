import { describe, expect, test } from "vitest";

import {
  buildTransactionsCsv,
  escapeCsvText,
  EXPORT_COLUMNS,
  type ExportTransactionRow,
} from "./export";

const BASE: ExportTransactionRow = {
  txnDate: "2026-06-05",
  description: "Groceries",
  merchant: "Tesco",
  category: "Food",
  account: "Main",
  type: "expense",
  status: "posted",
  isExcluded: false,
  tags: [],
  amountMinor: -100000,
  currency: "MYR",
  notes: null,
};

describe("escapeCsvText — formula-injection protection for user text", () => {
  test.each(["=SUM(A1:A2)", "+60123", "-cmd", "@import", "\tleading tab", "\rleading cr"])(
    "prefixes %j with a quote so spreadsheets treat it as text",
    (value) => {
      expect(escapeCsvText(value).startsWith("'")).toBe(true);
    },
  );

  test("ordinary text is untouched", () => {
    expect(escapeCsvText("ZUS Coffee")).toBe("ZUS Coffee");
  });

  test("quoting still applies after escaping", () => {
    const csv = buildTransactionsCsv([{ ...BASE, description: '=HYPERLINK("evil"), pwned' }]);
    const dataLine = csv.split("\r\n")[1];
    // Quoted (contains comma+quote), inner quotes doubled, and '-prefixed.
    expect(dataLine).toContain('"\'=HYPERLINK(""evil""), pwned"');
  });
});

describe("buildTransactionsCsv", () => {
  test("emits the documented stable column order with a UTF-8 BOM", () => {
    const csv = buildTransactionsCsv([BASE]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1).split("\r\n")[0]).toBe(EXPORT_COLUMNS.join(","));
    expect(EXPORT_COLUMNS).toEqual([
      "Date",
      "Description",
      "Merchant",
      "Category",
      "Account",
      "Type",
      "Status",
      "Excluded",
      "Tags",
      "Amount",
      "Currency",
      "Notes",
    ]);
  });

  test("amounts convert from minor units to signed decimal major units", () => {
    const csv = buildTransactionsCsv([
      BASE,
      { ...BASE, amountMinor: 520000, type: "income", description: "Salary" },
    ]);
    const lines = csv.split("\r\n");
    expect(lines[1]).toContain("-1000.00");
    expect(lines[2]).toContain("5200.00");
  });

  test("tags join with '; ' and user text fields never leak newlines unquoted", () => {
    const csv = buildTransactionsCsv([
      { ...BASE, tags: ["trip", "shared"], notes: "line one\nline two" },
    ]);
    const body = csv.split("\r\n").slice(1).join("\r\n");
    expect(body).toContain("trip; shared");
    expect(body).toContain('"line one\nline two"');
  });

  test("no internal ids, hashes, or user ids appear anywhere", () => {
    const csv = buildTransactionsCsv([BASE]);
    expect(csv).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i); // no uuids
    expect(csv.split("\r\n")[0]).not.toMatch(/id|hash|user/i);
  });
});
