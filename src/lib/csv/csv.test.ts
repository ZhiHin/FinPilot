import { describe, expect, test } from "vitest";

import {
  buildContentHashes,
  decodeStatementBuffer,
  detectDelimiter,
  parseCsv,
  parseImportAmountToMinor,
  parseImportDate,
  suggestMapping,
} from "./index";

describe("parseCsv", () => {
  test("parses simple rows with the given delimiter", () => {
    expect(parseCsv("a,b,c\n1,2,3", ",")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  test("handles quoted fields with commas, escaped quotes, and newlines", () => {
    const text = `date,description,amount\n"01/08/2026","GRAB ""PREMIUM"", KL\nRide home","-23.50"`;
    expect(parseCsv(text, ",")).toEqual([
      ["date", "description", "amount"],
      ["01/08/2026", 'GRAB "PREMIUM", KL\nRide home', "-23.50"],
    ]);
  });

  test("handles CRLF endings and trailing junk lines", () => {
    expect(parseCsv("a,b\r\n1,2\r\n\r\n", ",")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  test("supports semicolon and tab delimiters", () => {
    expect(parseCsv("a;b\n1;2", ";")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(parseCsv("a\tb\n1\t2", "\t")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  test("tolerates an unclosed quote by consuming to the end", () => {
    expect(parseCsv('a,b\n"open,2', ",")).toEqual([["a", "b"], ["open,2"]]);
  });

  test("enforces row and column caps", () => {
    const wide = Array.from({ length: 50 }, (_, i) => `c${i}`).join(",");
    expect(() => parseCsv(wide, ",", { maxColumns: 40 })).toThrow(/columns/i);
    const tall = Array.from({ length: 30 }, () => "a,b").join("\n");
    expect(() => parseCsv(tall, ",", { maxRows: 20 })).toThrow(/rows/i);
  });
});

describe("detectDelimiter", () => {
  test("prefers the delimiter that dominates the sample", () => {
    expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",");
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
  });
});

describe("decodeStatementBuffer", () => {
  test("decodes UTF-8 with BOM, dropping the BOM", () => {
    const buffer = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from("date,amount", "utf8"),
    ]);
    const decoded = decodeStatementBuffer(buffer);
    expect(decoded.encoding).toBe("utf-8");
    expect(decoded.text.startsWith("date")).toBe(true);
  });

  test("decodes UTF-16LE via BOM", () => {
    const buffer = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("a,b", "utf16le")]);
    const decoded = decodeStatementBuffer(buffer);
    expect(decoded.encoding).toBe("utf-16le");
    expect(decoded.text).toBe("a,b");
  });

  test("falls back to windows-1252 when bytes are not valid UTF-8", () => {
    // 0xE9 alone is invalid UTF-8 but é in windows-1252 ("café").
    const buffer = Buffer.from([0x63, 0x61, 0x66, 0xe9]);
    const decoded = decodeStatementBuffer(buffer);
    expect(decoded.encoding).toBe("windows-1252");
    expect(decoded.text).toBe("café");
  });
});

describe("parseImportAmountToMinor", () => {
  test("signed amounts with grouping and RM prefixes", () => {
    expect(parseImportAmountToMinor("-1,234.56")).toBe(-123456);
    expect(parseImportAmountToMinor("RM 32.50")).toBe(3250);
    expect(parseImportAmountToMinor("-RM 32.50")).toBe(-3250);
  });

  test("parentheses mean negative", () => {
    expect(parseImportAmountToMinor("(123.45)")).toBe(-12345);
    expect(parseImportAmountToMinor("(RM 1,000.00)")).toBe(-100000);
  });

  test("trailing DR is outflow, CR is inflow", () => {
    expect(parseImportAmountToMinor("123.45 DR")).toBe(-12345);
    expect(parseImportAmountToMinor("123.45CR")).toBe(12345);
  });

  test("garbage and empty are null", () => {
    expect(parseImportAmountToMinor("")).toBeNull();
    expect(parseImportAmountToMinor("N/A")).toBeNull();
  });
});

describe("parseImportDate", () => {
  test("dd/mm/yyyy (Malaysian statement default)", () => {
    expect(parseImportDate("05/08/2026", "dd/mm/yyyy")).toBe("2026-08-05");
    expect(parseImportDate("5/8/2026", "dd/mm/yyyy")).toBe("2026-08-05");
    expect(parseImportDate("05-08-2026", "dd/mm/yyyy")).toBe("2026-08-05");
  });

  test("ISO and dd MMM yyyy", () => {
    expect(parseImportDate("2026-08-05", "yyyy-mm-dd")).toBe("2026-08-05");
    expect(parseImportDate("5 Aug 2026", "dd mmm yyyy")).toBe("2026-08-05");
    expect(parseImportDate("05 August 2026", "dd mmm yyyy")).toBe("2026-08-05");
  });

  test("auto tries ISO, then dd/mm/yyyy, then dd MMM yyyy", () => {
    expect(parseImportDate("2026-08-05", "auto")).toBe("2026-08-05");
    expect(parseImportDate("05/08/2026", "auto")).toBe("2026-08-05");
    expect(parseImportDate("5 Aug 2026", "auto")).toBe("2026-08-05");
  });

  test("impossible dates are null", () => {
    expect(parseImportDate("32/01/2026", "dd/mm/yyyy")).toBeNull();
    expect(parseImportDate("2026-02-30", "yyyy-mm-dd")).toBeNull();
    expect(parseImportDate("not a date", "auto")).toBeNull();
  });
});

describe("suggestMapping", () => {
  test("maps Malaysian statement headers to fields", () => {
    const suggestion = suggestMapping(["Date", "Description", "Amount (RM)", "Balance"]);
    expect(suggestion).toMatchObject({ dateColumn: 0, descriptionColumn: 1, amountColumn: 2 });
    expect(suggestion.debitColumn).toBeUndefined();
  });

  test("detects debit/credit column pairs", () => {
    const suggestion = suggestMapping(["Txn Date", "Details", "Debit", "Credit"]);
    expect(suggestion).toMatchObject({
      dateColumn: 0,
      descriptionColumn: 1,
      debitColumn: 2,
      creditColumn: 3,
    });
    expect(suggestion.amountColumn).toBeUndefined();
  });
});

describe("buildContentHashes", () => {
  test("identical in-file rows get distinct occurrence-indexed hashes", () => {
    const rows = [
      { dateIso: "2026-08-05", amountMinor: -1290, description: "ZUS COFFEE" },
      { dateIso: "2026-08-05", amountMinor: -1290, description: "ZUS COFFEE" },
      { dateIso: "2026-08-05", amountMinor: -900, description: "OTHER" },
    ];
    const hashes = buildContentHashes("account-1", rows, () => 0);
    expect(hashes[0]).not.toBe(hashes[1]);
    expect(hashes[0].split(":")[0]).toBe(hashes[1].split(":")[0]);
    expect(hashes[0].endsWith(":0")).toBe(true);
    expect(hashes[1].endsWith(":1")).toBe(true);
  });

  test("existing-ledger occurrences shift the index (duplicate detection hook)", () => {
    const rows = [{ dateIso: "2026-08-05", amountMinor: -1290, description: "ZUS COFFEE" }];
    const hashes = buildContentHashes("account-1", rows, () => 2);
    expect(hashes[0].endsWith(":2")).toBe(true);
  });

  test("hashes are account-scoped and description-normalized", () => {
    const row = { dateIso: "2026-08-05", amountMinor: -1290, description: "  Zus   Coffee " };
    const a = buildContentHashes("account-1", [row], () => 0)[0];
    const b = buildContentHashes("account-2", [row], () => 0)[0];
    const c = buildContentHashes("account-1", [{ ...row, description: "zus coffee" }], () => 0)[0];
    expect(a).not.toBe(b);
    expect(a).toBe(c);
  });
});
