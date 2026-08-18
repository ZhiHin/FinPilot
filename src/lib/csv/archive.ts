import { escapeCsvText } from "./export";

/**
 * Generic entity CSV builder for the full-account export archive (Phase 10).
 *
 * Contract (documented, stable — tests pin it):
 * - Encoding: UTF-8 with BOM; CRLF row endings (RFC 4180), matching the
 *   Phase 4 transactions CSV.
 * - Cell model: plain JS strings are treated as USER-INFLUENCED text and get
 *   formula-injection protection (leading = + - @ TAB CR prefixed with a
 *   single quote). App-generated fixed-grammar values (dates, decimal
 *   amounts, enums, uuids, JSON) must be wrapped in raw() at the call site —
 *   they skip the formula prefix but are still RFC 4180 quoted. Numbers,
 *   booleans, and null render plainly ("yes"/"no", empty for null).
 * - The archive includes row ids and reference ids on purpose: it is a data-
 *   portability export, and relations between files are part of the data.
 *   It must NEVER include password hashes, session or reset tokens, or
 *   ip/subject hashes — those are not the user's exportable data.
 */

export interface RawCell {
  readonly raw: string;
}

export type ArchiveCell = string | number | boolean | null | RawCell;

/** Marks an app-generated, fixed-grammar value as exempt from formula escaping. */
export function raw(value: string | null): RawCell | null {
  return value === null ? null : { raw: value };
}

/** RFC 4180 quoting: wrap when the cell contains a quote, comma, or newline. */
function quoteCsvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

function renderCell(cell: ArchiveCell): string {
  if (cell === null) return "";
  if (typeof cell === "boolean") return cell ? "yes" : "no";
  if (typeof cell === "number") return String(cell);
  if (typeof cell === "string") return quoteCsvCell(escapeCsvText(cell));
  return quoteCsvCell(cell.raw);
}

export function buildEntityCsv(headers: readonly string[], rows: ArchiveCell[][]): string {
  const lines = [headers.map((h) => quoteCsvCell(h)).join(",")];
  for (const row of rows) {
    lines.push(row.map(renderCell).join(","));
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}
