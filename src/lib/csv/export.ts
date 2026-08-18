import { minorToAmountInput } from "@/lib/money";

/**
 * Transaction CSV export (Phase 4).
 *
 * Contract (documented, stable — tests pin it):
 * - Columns, in order: Date, Description, Merchant, Category, Account, Type,
 *   Status, Excluded, Tags, Amount, Currency, Notes. Never internal ids,
 *   content hashes, user ids, or session data.
 * - Encoding: UTF-8 with BOM (Excel-friendly); CRLF row endings (RFC 4180).
 * - Amount: signed decimal major units ("−1000.00" as "-1000.00"), converted
 *   from stored minor units; no grouping separators.
 * - Formula-injection protection: free-text fields (Description, Merchant,
 *   Category, Account, Tags, Notes) beginning with = + - @ TAB or CR are
 *   prefixed with a single quote so spreadsheets render them as text.
 *   App-generated fixed-grammar columns (Date, Type, Status, Excluded,
 *   Amount, Currency) are exempt — they cannot carry attacker-controlled
 *   text, and escaping Amount would corrupt legitimate negative numbers.
 */

export const EXPORT_COLUMNS = [
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
] as const;

export interface ExportTransactionRow {
  txnDate: string;
  description: string;
  merchant: string | null;
  category: string | null;
  account: string;
  type: string;
  status: string;
  isExcluded: boolean;
  tags: string[];
  amountMinor: number;
  currency: string;
  notes: string | null;
}

const FORMULA_LEADERS = new Set(["=", "+", "-", "@", "\t", "\r"]);

/** Neutralize spreadsheet formula interpretation of user-controlled text. */
export function escapeCsvText(value: string): string {
  if (value.length > 0 && FORMULA_LEADERS.has(value[0])) return `'${value}`;
  return value;
}

/** RFC 4180 quoting: wrap when the cell contains a quote, comma, or newline. */
function quoteCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

function textCell(value: string | null): string {
  return quoteCsvCell(escapeCsvText(value ?? ""));
}

/** Signed decimal major units ("-1600.00") from stored minor units. */
export function signedDecimal(amountMinor: number, currency: string): string {
  const magnitude = minorToAmountInput(Math.abs(amountMinor), currency);
  return amountMinor < 0 ? `-${magnitude}` : magnitude;
}

export function buildTransactionsCsv(rows: ExportTransactionRow[]): string {
  const lines = [EXPORT_COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.txnDate,
        textCell(row.description),
        textCell(row.merchant),
        textCell(row.category),
        textCell(row.account),
        row.type,
        row.status,
        row.isExcluded ? "yes" : "no",
        textCell(row.tags.join("; ")),
        signedDecimal(row.amountMinor, row.currency),
        row.currency.trim(),
        textCell(row.notes),
      ].join(","),
    );
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
