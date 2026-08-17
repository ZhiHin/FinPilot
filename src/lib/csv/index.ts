import { createHash } from "node:crypto";

import { isValidIsoDate } from "@/lib/dates";
import { parseAmountToMinor } from "@/lib/money";

/**
 * CSV statement tooling for the import pipeline (Phase 3).
 * Deterministic, dependency-free, and defensive: parsing never evaluates
 * content, and every limit is enforced while reading.
 */

export interface ParseCsvOptions {
  maxRows?: number;
  maxColumns?: number;
}

/** RFC-4180-ish parser: quotes, escaped quotes, embedded newlines, CRLF. */
export function parseCsv(
  text: string,
  delimiter: string,
  options: ParseCsvOptions = {},
): string[][] {
  const maxRows = options.maxRows ?? 20_000;
  const maxColumns = options.maxColumns ?? 40;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = "";
    if (row.length > maxColumns) {
      throw new Error(`Too many columns (limit ${maxColumns}).`);
    }
  };
  const pushRow = () => {
    pushField();
    // Drop rows that are entirely empty (trailing junk lines).
    if (row.some((cell) => cell.trim() !== "")) {
      rows.push(row);
      if (rows.length > maxRows) {
        throw new Error(`Too many rows (limit ${maxRows}).`);
      }
    }
    row = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field === "") {
      inQuotes = true;
    } else if (char === delimiter) {
      pushField();
    } else if (char === "\n") {
      pushRow();
    } else if (char === "\r") {
      // swallowed; \n handles the row break
    } else {
      field += char;
    }
  }
  // Unclosed quotes fall through here with the remainder as one field.
  if (field !== "" || row.length > 0) {
    pushRow();
  }
  return rows;
}

const CANDIDATE_DELIMITERS = [",", ";", "\t", "|"] as const;

export function detectDelimiter(sample: string): string {
  const head = sample.split(/\r?\n/, 5).join("\n");
  let best: string = ",";
  let bestCount = -1;
  for (const candidate of CANDIDATE_DELIMITERS) {
    const count = head.split(candidate).length - 1;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

export interface DecodedStatement {
  text: string;
  encoding: "utf-8" | "utf-16le" | "utf-16be" | "windows-1252";
}

/** BOM-aware decode with a windows-1252 fallback for legacy bank exports. */
export function decodeStatementBuffer(buffer: Buffer): DecodedStatement {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { text: buffer.subarray(3).toString("utf8"), encoding: "utf-8" };
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { text: buffer.subarray(2).toString("utf16le"), encoding: "utf-16le" };
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.from(buffer.subarray(2));
    swapped.swap16();
    return { text: swapped.toString("utf16le"), encoding: "utf-16be" };
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return { text, encoding: "utf-8" };
  } catch {
    const text = new TextDecoder("windows-1252").decode(buffer);
    return { text, encoding: "windows-1252" };
  }
}

/**
 * Statement amount forms: signed, grouped, RM-prefixed (via lib/money), plus
 * bank conventions — parentheses negatives and trailing DR (outflow) / CR (inflow).
 */
export function parseImportAmountToMinor(raw: string): number | null {
  let s = raw.trim();
  if (s === "") return null;

  let forcedSign: -1 | 1 | null = null;
  const parens = s.match(/^\((.*)\)$/);
  if (parens) {
    forcedSign = -1;
    s = parens[1].trim();
  }
  const suffix = s.match(/^(.*?)\s*(DR|CR)$/i);
  if (suffix) {
    forcedSign = suffix[2].toUpperCase() === "DR" ? -1 : 1;
    s = suffix[1].trim();
  }

  const parsed = parseAmountToMinor(s);
  if (parsed === null) return null;
  if (forcedSign !== null) {
    return forcedSign * Math.abs(parsed);
  }
  return parsed;
}

export type ImportDateFormat = "auto" | "yyyy-mm-dd" | "dd/mm/yyyy" | "mm/dd/yyyy" | "dd mmm yyyy";

const MONTHS: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

function toIso(year: string, month: string, day: string): string | null {
  const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  return isValidIsoDate(iso) ? iso : null;
}

function tryFormat(raw: string, format: Exclude<ImportDateFormat, "auto">): string | null {
  const s = raw.trim();
  switch (format) {
    case "yyyy-mm-dd": {
      const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      return m ? toIso(m[1], m[2], m[3]) : null;
    }
    case "dd/mm/yyyy": {
      const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
      return m ? toIso(m[3], m[2], m[1]) : null;
    }
    case "mm/dd/yyyy": {
      const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
      return m ? toIso(m[3], m[1], m[2]) : null;
    }
    case "dd mmm yyyy": {
      const m = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
      if (!m) return null;
      const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
      return month ? toIso(m[3], month, m[1]) : null;
    }
  }
}

export function parseImportDate(raw: string, format: ImportDateFormat): string | null {
  if (format !== "auto") return tryFormat(raw, format);
  // Malaysian statements default to day-first; ISO wins when unambiguous.
  return (
    tryFormat(raw, "yyyy-mm-dd") ?? tryFormat(raw, "dd/mm/yyyy") ?? tryFormat(raw, "dd mmm yyyy")
  );
}

export interface MappingSuggestion {
  dateColumn?: number;
  descriptionColumn?: number;
  amountColumn?: number;
  debitColumn?: number;
  creditColumn?: number;
}

export function suggestMapping(headers: string[]): MappingSuggestion {
  const lower = headers.map((h) => h.trim().toLowerCase());
  const findBy = (...needles: string[]): number | undefined => {
    for (const needle of needles) {
      const index = lower.findIndex((h) => h.includes(needle));
      if (index >= 0) return index;
    }
    return undefined;
  };

  const suggestion: MappingSuggestion = {
    dateColumn: findBy("date", "tarikh"),
    descriptionColumn: findBy("desc", "detail", "particular", "narration"),
  };
  const debitColumn = findBy("debit");
  const creditColumn = findBy("credit");
  if (debitColumn !== undefined && creditColumn !== undefined) {
    suggestion.debitColumn = debitColumn;
    suggestion.creditColumn = creditColumn;
  } else {
    const amountColumn = findBy("amount", "amt");
    if (amountColumn !== undefined) suggestion.amountColumn = amountColumn;
  }
  return suggestion;
}

export interface HashableRow {
  dateIso: string;
  amountMinor: number;
  description: string;
}

function baseHash(accountId: string, row: HashableRow): string {
  const normalizedDescription = row.description.trim().toLowerCase().replace(/\s+/g, " ");
  return createHash("sha256")
    .update(`${accountId}|${row.dateIso}|${row.amountMinor}|${normalizedDescription}`)
    .digest("hex");
}

/**
 * Occurrence-indexed content hashes: two identical rows in one file stay two
 * transactions (`base:0`, `base:1`), while rows whose base already exists in
 * the ledger shift up (`existingCount`) — the unique index on
 * (account_id, import_content_hash) then makes commits and retries idempotent.
 */
export function buildContentHashes(
  accountId: string,
  rows: HashableRow[],
  existingCount: (base: string) => number,
): string[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const base = baseHash(accountId, row);
    const withinFile = seen.get(base) ?? 0;
    seen.set(base, withinFile + 1);
    return `${base}:${existingCount(base) + withinFile}`;
  });
}
