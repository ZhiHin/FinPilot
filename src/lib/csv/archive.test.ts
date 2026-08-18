import { describe, expect, it } from "vitest";

import { buildEntityCsv, raw } from "./archive";

function lines(csv: string): string[] {
  expect(csv.startsWith("\uFEFF")).toBe(true);
  expect(csv.endsWith("\r\n")).toBe(true);
  return csv.slice(1, -2).split("\r\n");
}

describe("buildEntityCsv", () => {
  it("renders headers, plain values, booleans, and nulls", () => {
    const csv = buildEntityCsv(
      ["Id", "Name", "Active", "Count", "Note"],
      [[raw("abc-123"), "Groceries", true, 4, null]],
    );
    expect(lines(csv)).toEqual(["Id,Name,Active,Count,Note", "abc-123,Groceries,yes,4,"]);
  });

  it("formula-escapes user-influenced strings for every dangerous leader", () => {
    for (const leader of ["=", "+", "-", "@", "\t", "\r"]) {
      const csv = buildEntityCsv(["Name"], [[`${leader}HYPERLINK("http://evil")`]]);
      const [, row] = lines(csv);
      expect(row.replaceAll('"', "")).toContain(`'${leader}HYPERLINK`);
    }
  });

  it("does not formula-escape raw() app-generated values", () => {
    const csv = buildEntityCsv(["Amount", "Date"], [[raw("-1600.00"), raw("2026-08-01")]]);
    expect(lines(csv)[1]).toBe("-1600.00,2026-08-01");
  });

  it("RFC 4180-quotes cells with commas, quotes, and newlines (raw included)", () => {
    const csv = buildEntityCsv(
      ["Note", "Json"],
      [['He said "hi", twice\nnew line', raw('{"a":1,"b":2}')]],
    );
    expect(lines(csv)[1]).toBe('"He said ""hi"", twice\nnew line","{""a"":1,""b"":2}"');
  });

  it("quotes headers containing commas", () => {
    const csv = buildEntityCsv(["Amount, major"], [[1]]);
    expect(lines(csv)[0]).toBe('"Amount, major"');
  });

  it("escapes then quotes: a leading = with a comma gets both protections", () => {
    const csv = buildEntityCsv(["Name"], [["=cmd,arg"]]);
    expect(lines(csv)[1]).toBe('"\'=cmd,arg"');
  });
});
