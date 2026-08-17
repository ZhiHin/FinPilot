import { createHash } from "node:crypto";

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import {
  buildContentHashes,
  decodeStatementBuffer,
  detectDelimiter,
  parseCsv,
  parseImportAmountToMinor,
  parseImportDate,
  suggestMapping,
  type MappingSuggestion,
} from "@/lib/csv";
import { uuidv7 } from "@/lib/ids";
import { err, ok, type Result } from "@/lib/result";

import type { Db } from "../db/client";
import { auditRepo } from "../db/repositories/audit";
import { accounts, importJobs, importProfiles, importRows, transactions } from "../db/schema";
import type { EnqueueFn } from "../jobs/queue";
import { merchantsService } from "./merchants";
import { pgErrorCode, UNIQUE_VIOLATION } from "./shared";

/**
 * CSV import pipeline (Phase 3). Retention rule: the uploaded file is parsed
 * in memory and DISCARDED — only job metadata and per-row cell data are stored
 * (what auditing, review, and undo require). Executors are idempotent so
 * pg-boss retries and user re-clicks are always safe.
 */

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 20_000;
export const MAX_COLUMNS = 40;

const HEADER_REASON = "header";

const mappingSchema = z
  .object({
    headerRows: z.number().int().min(0).max(3),
    dateFormat: z.enum(["auto", "yyyy-mm-dd", "dd/mm/yyyy", "mm/dd/yyyy", "dd mmm yyyy"]),
    dateColumn: z
      .number()
      .int()
      .min(0)
      .max(MAX_COLUMNS - 1),
    descriptionColumn: z
      .number()
      .int()
      .min(0)
      .max(MAX_COLUMNS - 1),
    amountColumn: z
      .number()
      .int()
      .min(0)
      .max(MAX_COLUMNS - 1)
      .optional(),
    debitColumn: z
      .number()
      .int()
      .min(0)
      .max(MAX_COLUMNS - 1)
      .optional(),
    creditColumn: z
      .number()
      .int()
      .min(0)
      .max(MAX_COLUMNS - 1)
      .optional(),
  })
  .refine(
    (m) =>
      (m.amountColumn !== undefined &&
        m.debitColumn === undefined &&
        m.creditColumn === undefined) ||
      (m.amountColumn === undefined && m.debitColumn !== undefined && m.creditColumn !== undefined),
    { message: "Map either one amount column or both debit and credit columns." },
  );

export type ImportMapping = z.infer<typeof mappingSchema>;

export type ImportJobRow = typeof importJobs.$inferSelect;
export type ImportRowRow = typeof importRows.$inferSelect;
export type ImportProfileRow = typeof importProfiles.$inferSelect;

export interface ImportJobView extends ImportJobRow {
  accountName: string;
  accountCurrency: string;
}

export interface ImportStats {
  valid?: number;
  invalid?: number;
  duplicate?: number;
  skipped?: number;
  added?: number;
  duplicates?: number;
  failed?: number;
  needsReview?: number;
  ambiguousDates?: boolean;
}

/** Built-in mapping templates for common Malaysian statement layouts (synthetic formats). */
export const BUILTIN_PROFILES: Array<{ key: string; name: string; mapping: ImportMapping }> = [
  {
    key: "maybank",
    name: "Maybank2u-style (Date, Description, Amount)",
    mapping: {
      headerRows: 1,
      dateFormat: "dd/mm/yyyy",
      dateColumn: 0,
      descriptionColumn: 1,
      amountColumn: 2,
    },
  },
  {
    key: "tng",
    name: "TnG eWallet-style (Date, …, Description, Amount RM)",
    mapping: {
      headerRows: 1,
      dateFormat: "dd/mm/yyyy",
      dateColumn: 0,
      descriptionColumn: 3,
      amountColumn: 4,
    },
  },
  {
    key: "debitcredit",
    name: "Generic debit/credit columns",
    mapping: {
      headerRows: 1,
      dateFormat: "auto",
      dateColumn: 0,
      descriptionColumn: 1,
      debitColumn: 2,
      creditColumn: 3,
    },
  },
];

function sanitizeFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "statement.csv";
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 120);
  return cleaned || "statement.csv";
}

/** text[] literal so node-postgres can bind large IN sets as one parameter. */
function textArrayLiteral(values: string[]): string {
  return `{${values.map((v) => `"${v.replace(/[\\"]/g, "")}"`).join(",")}}`;
}

const defaultEnqueue: EnqueueFn = async (name, payload) => {
  const { getJobQueue } = await import("../jobs/pgboss");
  await getJobQueue().send(name, payload);
};

async function getOwnedJob(db: Db, userId: string, jobId: string): Promise<ImportJobRow | null> {
  const [row] = await db
    .select()
    .from(importJobs)
    .where(and(eq(importJobs.id, jobId), eq(importJobs.userId, userId)))
    .limit(1);
  return row ?? null;
}

export const importsService = {
  /**
   * Parses the upload in memory, stages rows, and discards the file.
   * Nothing is ever committed to the ledger from this step.
   */
  async createJobFromUpload(
    db: Db,
    userId: string,
    input: { accountId: string; filename: string; buffer: Buffer },
  ): Promise<
    Result<{
      jobId: string;
      rowCount: number;
      encoding: string;
      delimiter: string;
      preview: string[][];
      suggested: MappingSuggestion;
    }>
  > {
    if (input.buffer.length === 0) {
      return err("invalid_input", "That file is empty.");
    }
    if (input.buffer.length > MAX_FILE_BYTES) {
      return err("invalid_input", "Files are limited to 5 MB.");
    }
    const [account] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.id, input.accountId), eq(accounts.userId, userId)))
      .limit(1);
    if (!account) return err("not_found", "That account doesn’t exist.");

    const decoded = decodeStatementBuffer(input.buffer);
    if (decoded.text.includes("\u0000")) {
      return err("invalid_input", "That doesn’t look like a CSV statement.");
    }
    const delimiter = detectDelimiter(decoded.text);
    let rows: string[][];
    try {
      rows = parseCsv(decoded.text, delimiter, { maxRows: MAX_ROWS, maxColumns: MAX_COLUMNS });
    } catch (error) {
      return err(
        "invalid_input",
        error instanceof Error ? error.message : "The file could not be parsed as CSV.",
      );
    }
    if (rows.length < 2) {
      return err("invalid_input", "The file needs a header row and at least one data row.");
    }

    const jobId = uuidv7();
    const filename = sanitizeFilename(input.filename);
    const fileSha256 = createHash("sha256").update(input.buffer).digest("hex");
    await db.transaction(async (tx) => {
      await tx.insert(importJobs).values({
        id: jobId,
        userId,
        accountId: input.accountId,
        filename,
        fileSha256,
        encoding: decoded.encoding,
        delimiter,
        idempotencyKey: uuidv7(),
        status: "mapping",
        rowCount: rows.length,
      });
      const CHUNK = 500;
      for (let start = 0; start < rows.length; start += CHUNK) {
        await tx.insert(importRows).values(
          rows.slice(start, start + CHUNK).map((cells, offset) => ({
            id: uuidv7(),
            importJobId: jobId,
            userId,
            rowNumber: start + offset + 1,
            raw: cells,
          })),
        );
      }
      await auditRepo.record(tx as unknown as Db, {
        id: uuidv7(),
        userId,
        actor: "user",
        eventType: "import.uploaded",
        entityType: "import_job",
        entityId: jobId,
        diff: { filename, rowCount: rows.length },
      });
    });

    return ok({
      jobId,
      rowCount: rows.length,
      encoding: decoded.encoding,
      delimiter,
      preview: rows.slice(0, 6),
      suggested: suggestMapping(rows[0]),
    });
  },

  async getJob(db: Db, userId: string, jobId: string): Promise<ImportJobView | null> {
    const [row] = await db
      .select({
        job: importJobs,
        accountName: accounts.name,
        accountCurrency: accounts.currency,
      })
      .from(importJobs)
      .innerJoin(accounts, eq(accounts.id, importJobs.accountId))
      .where(and(eq(importJobs.id, jobId), eq(importJobs.userId, userId)))
      .limit(1);
    if (!row) return null;
    return {
      ...row.job,
      accountName: row.accountName,
      accountCurrency: row.accountCurrency.trim(),
    };
  },

  async listJobs(db: Db, userId: string, limit = 50): Promise<ImportJobView[]> {
    const rows = await db
      .select({ job: importJobs, accountName: accounts.name, accountCurrency: accounts.currency })
      .from(importJobs)
      .innerJoin(accounts, eq(accounts.id, importJobs.accountId))
      .where(eq(importJobs.userId, userId))
      .orderBy(desc(importJobs.createdAt))
      .limit(limit);
    return rows.map((row) => ({
      ...row.job,
      accountName: row.accountName,
      accountCurrency: row.accountCurrency.trim(),
    }));
  },

  async listRows(
    db: Db,
    userId: string,
    jobId: string,
    opts: { statuses?: ImportRowRow["status"][]; limit?: number; offset?: number } = {},
  ): Promise<ImportRowRow[]> {
    const conditions = [eq(importRows.importJobId, jobId), eq(importRows.userId, userId)];
    if (opts.statuses?.length) conditions.push(inArray(importRows.status, opts.statuses));
    return db
      .select()
      .from(importRows)
      .where(and(...conditions))
      .orderBy(asc(importRows.rowNumber))
      .limit(Math.min(opts.limit ?? 1000, 5000))
      .offset(Math.max(opts.offset ?? 0, 0));
  },

  /** Accurate whole-import counts per status (header rows excluded). */
  async countRowsByStatus(db: Db, userId: string, jobId: string): Promise<Record<string, number>> {
    const rows = await db.execute<{ status: string; n: number }>(sql`
      select status, count(*)::int as n from import_rows
      where import_job_id = ${jobId} and user_id = ${userId}
        and error_reason is distinct from ${HEADER_REASON}
      group by status
    `);
    const counts: Record<string, number> = {};
    for (const row of rows.rows) counts[row.status] = Number(row.n);
    return counts;
  },

  async applyMapping(
    db: Db,
    userId: string,
    jobId: string,
    input: {
      mapping?: ImportMapping;
      profileId?: string;
      saveProfileName?: string;
      enqueue?: EnqueueFn;
    },
  ): Promise<Result<{ validating: true }>> {
    const job = await getOwnedJob(db, userId, jobId);
    if (!job) return err("not_found", "That import doesn’t exist.");
    if (job.status !== "mapping" && job.status !== "review") {
      return err("conflict", "This import can’t be re-mapped in its current state.");
    }

    let mappingInput = input.mapping;
    let profileId: string | null = null;
    if (input.profileId) {
      const [profile] = await db
        .select()
        .from(importProfiles)
        .where(and(eq(importProfiles.id, input.profileId), eq(importProfiles.userId, userId)))
        .limit(1);
      if (!profile) return err("not_found", "That import profile doesn’t exist.");
      profileId = profile.id;
      mappingInput = mappingInput ?? (profile.mapping as ImportMapping);
      await db
        .update(importProfiles)
        .set({ lastUsedAt: sql`now()` })
        .where(eq(importProfiles.id, profile.id));
    }
    const parsed = mappingSchema.safeParse(mappingInput);
    if (!parsed.success) {
      return err("invalid_input", parsed.error.issues[0]?.message ?? "Check the column mapping.");
    }
    const mapping = parsed.data;

    if (input.saveProfileName?.trim()) {
      const name = input.saveProfileName.trim().slice(0, 60);
      try {
        const [created] = await db
          .insert(importProfiles)
          .values({ id: uuidv7(), userId, name, mapping })
          .returning();
        profileId = created.id;
      } catch (error) {
        if (pgErrorCode(error) === UNIQUE_VIOLATION) {
          const [existing] = await db
            .update(importProfiles)
            .set({ mapping, updatedAt: sql`now()` })
            .where(
              and(
                eq(importProfiles.userId, userId),
                sql`lower(${importProfiles.name}) = ${name.toLowerCase()}`,
              ),
            )
            .returning();
          profileId = existing?.id ?? null;
        } else {
          throw error;
        }
      }
    }

    await db.transaction(async (tx) => {
      await tx
        .update(importRows)
        .set({
          status: "pending",
          parsed: null,
          errorReason: null,
          contentHash: null,
          updatedAt: sql`now()`,
        })
        .where(eq(importRows.importJobId, jobId));
      await tx
        .update(importJobs)
        .set({
          mapping,
          importProfileId: profileId,
          status: "validating",
          stats: {},
          error: null,
          updatedAt: sql`now()`,
        })
        .where(eq(importJobs.id, jobId));
    });

    try {
      await (input.enqueue ?? defaultEnqueue)("import.validate", { jobId });
    } catch {
      await db
        .update(importJobs)
        .set({
          status: "failed",
          error: "Background processing is unavailable. Try again shortly.",
        })
        .where(eq(importJobs.id, jobId));
      return err("internal", "Background processing is unavailable. Try again shortly.");
    }
    return ok({ validating: true as const });
  },

  async setRowInclusion(
    db: Db,
    userId: string,
    jobId: string,
    rowId: string,
    included: boolean,
  ): Promise<Result<{ status: string }>> {
    const job = await getOwnedJob(db, userId, jobId);
    if (!job) return err("not_found", "That import doesn’t exist.");
    if (job.status !== "review") {
      return err("conflict", "Rows can only be included or skipped while reviewing.");
    }
    const [row] = await db
      .update(importRows)
      .set({ status: included ? "valid" : "skipped", updatedAt: sql`now()` })
      .where(
        and(
          eq(importRows.id, rowId),
          eq(importRows.importJobId, jobId),
          eq(importRows.userId, userId),
          inArray(importRows.status, ["valid", "duplicate", "skipped"]),
          sql`${importRows.errorReason} is distinct from ${HEADER_REASON}`,
        ),
      )
      .returning({ status: importRows.status });
    if (!row) return err("not_found", "That row can’t be toggled.");
    return ok({ status: row.status });
  },

  /** Confirm gate: the ONLY path to committing; nothing is written before this. */
  async confirm(
    db: Db,
    userId: string,
    jobId: string,
    opts: { enqueue?: EnqueueFn } = {},
  ): Promise<Result<{ committing: true }>> {
    const job = await getOwnedJob(db, userId, jobId);
    if (!job) return err("not_found", "That import doesn’t exist.");
    if (job.status !== "review" && job.status !== "failed") {
      return err("conflict", "This import isn’t ready to be committed.");
    }
    await db
      .update(importJobs)
      .set({ status: "committing", error: null, updatedAt: sql`now()` })
      .where(eq(importJobs.id, jobId));
    try {
      await (opts.enqueue ?? defaultEnqueue)("import.commit", { jobId });
    } catch {
      await db
        .update(importJobs)
        .set({
          status: "failed",
          error: "Background processing is unavailable. Try again shortly.",
        })
        .where(eq(importJobs.id, jobId));
      return err("internal", "Background processing is unavailable. Try again shortly.");
    }
    return ok({ committing: true as const });
  },

  async cancel(db: Db, userId: string, jobId: string): Promise<Result<{ canceled: true }>> {
    const [row] = await db
      .update(importJobs)
      .set({ status: "canceled", updatedAt: sql`now()` })
      .where(
        and(
          eq(importJobs.id, jobId),
          eq(importJobs.userId, userId),
          inArray(importJobs.status, ["mapping", "validating", "review", "failed"]),
        ),
      )
      .returning({ id: importJobs.id });
    if (!row) return err("not_found", "That import can’t be canceled.");
    return ok({ canceled: true as const });
  },

  /**
   * Safe undo: soft-deletes the imported transactions (restorable from the
   * Deleted view) and clears their import hashes so the statement can be
   * re-imported cleanly.
   */
  async undo(
    db: Db,
    userId: string,
    jobId: string,
  ): Promise<Result<{ undoneCount: number; keptModifiedCount: number }>> {
    const job = await getOwnedJob(db, userId, jobId);
    if (!job || job.status !== "completed") {
      return err("not_found", "That import can’t be undone.");
    }
    let undoneCount = 0;
    let keptModifiedCount = 0;
    await db.transaction(async (tx) => {
      const linked = sql`${transactions.id} in (select transaction_id from import_rows where import_job_id = ${jobId} and transaction_id is not null)`;
      // Safe conflict handling: transactions the user changed after the import
      // (version > 1 — every edit, bulk action, or review bump increments it)
      // are KEPT; only untouched imports are removed.
      const result = await tx
        .update(transactions)
        .set({ deletedAt: sql`now()`, importContentHash: null, updatedAt: sql`now()` })
        .where(
          and(
            eq(transactions.userId, userId),
            linked,
            sql`${transactions.deletedAt} is null`,
            eq(transactions.version, 1),
          ),
        )
        .returning({ id: transactions.id });
      undoneCount = result.length;
      const [kept] = (
        await tx.execute<{ n: number }>(sql`
          select count(*)::int as n from transactions
          where ${transactions.userId} = ${userId} and ${linked}
            and ${transactions.deletedAt} is null and ${transactions.version} > 1
        `)
      ).rows;
      keptModifiedCount = Number(kept?.n ?? 0);
      await tx
        .update(importJobs)
        .set({ status: "undone", updatedAt: sql`now()` })
        .where(eq(importJobs.id, jobId));
      await auditRepo.record(tx as unknown as Db, {
        id: uuidv7(),
        userId,
        actor: "user",
        eventType: "import.undone",
        entityType: "import_job",
        entityId: jobId,
        diff: { undoneCount, keptModifiedCount },
      });
    });
    return ok({ undoneCount, keptModifiedCount });
  },

  async listProfiles(db: Db, userId: string): Promise<ImportProfileRow[]> {
    return db
      .select()
      .from(importProfiles)
      .where(eq(importProfiles.userId, userId))
      .orderBy(asc(importProfiles.name));
  },
} as const;

/* ------------------------------ executors ---------------------------------- */

interface ParsedRow {
  rowId: string;
  dateIso: string;
  amountMinor: number;
  description: string;
}

interface RowUpdate {
  id: string;
  status: ImportRowRow["status"];
  parsed: { dateIso: string; amountMinor: number; description: string } | null;
  error_reason: string | null;
  content_hash: string | null;
  transaction_id?: string | null;
}

async function bulkUpdateRows(db: Db, updates: RowUpdate[]): Promise<void> {
  if (updates.length === 0) return;
  const CHUNK = 1000;
  for (let start = 0; start < updates.length; start += CHUNK) {
    const chunk = updates.slice(start, start + CHUNK);
    await db.execute(sql`
      update import_rows as r
      set status = v.status::import_row_status,
          parsed = v.parsed,
          error_reason = v.error_reason,
          content_hash = v.content_hash,
          transaction_id = coalesce(v.transaction_id, r.transaction_id),
          updated_at = now()
      from jsonb_to_recordset(${JSON.stringify(chunk)}::jsonb)
        as v(id uuid, status text, parsed jsonb, error_reason text, content_hash text, transaction_id uuid)
      where r.id = v.id
    `);
  }
}

/** Idempotent: only runs while the job is 'validating'. Deterministic, so failures mark the job failed. */
export async function runValidation(db: Db, jobId: string): Promise<void> {
  const [job] = await db.select().from(importJobs).where(eq(importJobs.id, jobId)).limit(1);
  if (!job || job.status !== "validating") return;

  try {
    const mapping = mappingSchema.parse(job.mapping);
    const rows = await db
      .select()
      .from(importRows)
      .where(eq(importRows.importJobId, jobId))
      .orderBy(asc(importRows.rowNumber));

    const updates: RowUpdate[] = [];
    const parsedRows: ParsedRow[] = [];
    let numericDateRows = 0;
    let ambiguousDateRows = 0;

    for (const row of rows) {
      if (row.rowNumber <= mapping.headerRows) {
        updates.push({
          id: row.id,
          status: "skipped",
          parsed: null,
          error_reason: HEADER_REASON,
          content_hash: null,
        });
        continue;
      }
      const cells = row.raw as string[];
      const needed = [
        mapping.dateColumn,
        mapping.descriptionColumn,
        ...(mapping.amountColumn !== undefined ? [mapping.amountColumn] : []),
        ...(mapping.debitColumn !== undefined ? [mapping.debitColumn, mapping.creditColumn!] : []),
      ];
      if (needed.some((column) => column >= cells.length)) {
        updates.push({
          id: row.id,
          status: "invalid",
          parsed: null,
          error_reason: "Row is missing mapped columns.",
          content_hash: null,
        });
        continue;
      }
      const rawDate = cells[mapping.dateColumn] ?? "";
      const dateIso = parseImportDate(rawDate, mapping.dateFormat);
      if (!dateIso) {
        updates.push({
          id: row.id,
          status: "invalid",
          parsed: null,
          error_reason: `Unrecognised date “${rawDate}”.`,
          content_hash: null,
        });
        continue;
      }
      // Day/month ambiguity: a numeric date reads the same under day-first and
      // month-first when both parts are ≤ 12 and differ.
      const numericDate = rawDate.trim().match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.]\d{4}$/);
      if (numericDate) {
        numericDateRows += 1;
        const [, a, b] = numericDate;
        if (Number(a) <= 12 && Number(b) <= 12 && a !== b) ambiguousDateRows += 1;
      }
      let amountMinor: number | null = null;
      if (mapping.amountColumn !== undefined) {
        amountMinor = parseImportAmountToMinor(cells[mapping.amountColumn] ?? "");
      } else {
        const debitRaw = (cells[mapping.debitColumn!] ?? "").trim();
        const creditRaw = (cells[mapping.creditColumn!] ?? "").trim();
        if (debitRaw !== "" && creditRaw !== "") {
          updates.push({
            id: row.id,
            status: "invalid",
            parsed: null,
            error_reason: "Both debit and credit are filled — ambiguous row.",
            content_hash: null,
          });
          continue;
        }
        if (debitRaw !== "") {
          const debit = parseImportAmountToMinor(debitRaw);
          amountMinor = debit === null ? null : -Math.abs(debit);
        } else if (creditRaw !== "") {
          const credit = parseImportAmountToMinor(creditRaw);
          amountMinor = credit === null ? null : Math.abs(credit);
        }
      }
      if (amountMinor === null) {
        updates.push({
          id: row.id,
          status: "invalid",
          parsed: null,
          error_reason: `Unrecognised amount “${cells[mapping.amountColumn ?? mapping.debitColumn ?? 0]}”.`,
          content_hash: null,
        });
        continue;
      }
      if (amountMinor === 0) {
        updates.push({
          id: row.id,
          status: "invalid",
          parsed: null,
          error_reason: "Zero amounts can’t be imported.",
          content_hash: null,
        });
        continue;
      }
      parsedRows.push({
        rowId: row.id,
        dateIso,
        amountMinor,
        description: (cells[mapping.descriptionColumn] ?? "").trim(),
      });
    }

    // Occurrence-aware hashes + duplicate detection against the existing ledger.
    const seen = new Map<string, number>();
    const probe = buildContentHashes(job.accountId, parsedRows, () => 0);
    const bases = [...new Set(probe.map((hash) => hash.split(":")[0]))];
    const existingCounts = new Map<string, number>();
    if (bases.length > 0) {
      const counted = await db.execute<{ base: string; n: number }>(sql`
        select split_part(import_content_hash, ':', 1) as base, count(*)::int as n
        from transactions
        where account_id = ${job.accountId}
          and import_content_hash is not null
          and split_part(import_content_hash, ':', 1) = any(${textArrayLiteral(bases)}::text[])
        group by 1
      `);
      for (const row of counted.rows) existingCounts.set(row.base, Number(row.n));
    }
    const finalHashes = buildContentHashes(
      job.accountId,
      parsedRows,
      (base) => existingCounts.get(base) ?? 0,
    );

    let valid = 0;
    let duplicate = 0;
    parsedRows.forEach((parsed, index) => {
      const hash = finalHashes[index];
      const base = hash.split(":")[0];
      const withinFile = seen.get(base) ?? 0;
      seen.set(base, withinFile + 1);
      const existing = existingCounts.get(base) ?? 0;
      const isDuplicate = existing > withinFile;
      if (isDuplicate) duplicate += 1;
      else valid += 1;
      updates.push({
        id: parsed.rowId,
        status: isDuplicate ? "duplicate" : "valid",
        parsed: {
          dateIso: parsed.dateIso,
          amountMinor: parsed.amountMinor,
          description: parsed.description,
        },
        error_reason: null,
        content_hash: hash,
      });
    });

    const invalid = updates.filter((u) => u.status === "invalid").length;
    await bulkUpdateRows(db, updates);
    await db
      .update(importJobs)
      .set({
        status: "review",
        stats: {
          valid,
          invalid,
          duplicate,
          // Every numeric date could be read day-first OR month-first: flag it
          // so the review step asks the user to double-check the format.
          ambiguousDates: numericDateRows > 0 && ambiguousDateRows === numericDateRows,
        },
        updatedAt: sql`now()`,
      })
      .where(eq(importJobs.id, jobId));
  } catch (error) {
    await db
      .update(importJobs)
      .set({
        status: "failed",
        error:
          "The file couldn’t be validated with this mapping. Adjust the mapping and try again.",
        updatedAt: sql`now()`,
      })
      .where(eq(importJobs.id, jobId));
    console.error("[imports] validation failed:", error instanceof Error ? error.message : error);
  }
}

/**
 * Idempotent commit: single database transaction; conflict-ignoring inserts on
 * the (account, import_content_hash) unique index make retries safe (spec §6 C5).
 */
export async function runCommit(db: Db, jobId: string): Promise<void> {
  const [job] = await db.select().from(importJobs).where(eq(importJobs.id, jobId)).limit(1);
  if (!job || job.status !== "committing") return;

  try {
    const rows = await db
      .select()
      .from(importRows)
      .where(and(eq(importRows.importJobId, jobId), eq(importRows.status, "valid")))
      .orderBy(asc(importRows.rowNumber));
    const [account] = await db
      .select()
      .from(accounts)
      .where(eq(accounts.id, job.accountId))
      .limit(1);
    if (!account) throw new Error("import account missing");

    // Resolve merchants once per distinct description (outside the ledger tx is
    // fine — findOrCreate is idempotent and merchants are reference data).
    const merchantByDescription = new Map<
      string,
      { merchantId: string | null; categoryId: string | null }
    >();
    for (const row of rows) {
      const parsed = row.parsed as { description: string };
      const key = parsed.description;
      if (!merchantByDescription.has(key)) {
        const merchant = key ? await merchantsService.findOrCreate(db, job.userId, key) : null;
        merchantByDescription.set(key, {
          merchantId: merchant?.id ?? null,
          categoryId: merchant?.defaultCategoryId ?? null,
        });
      }
    }

    let added = 0;
    let needsReview = 0;
    await db.transaction(async (tx) => {
      const CHUNK = 250;
      const insertedHashes = new Set<string>();
      for (let start = 0; start < rows.length; start += CHUNK) {
        const chunk = rows.slice(start, start + CHUNK);
        if (chunk.length === 0) continue;
        const values = chunk.map((row) => {
          const parsed = row.parsed as {
            dateIso: string;
            amountMinor: number;
            description: string;
          };
          const resolved = merchantByDescription.get(parsed.description)!;
          return {
            id: uuidv7(),
            userId: job.userId,
            accountId: job.accountId,
            type: (parsed.amountMinor > 0 ? "income" : "expense") as "income" | "expense",
            status: "posted" as const,
            amountMinor: parsed.amountMinor,
            currency: account.currency,
            txnDate: parsed.dateIso,
            postedAt: sql`now()`,
            descriptionOriginal: parsed.description,
            merchantId: resolved.merchantId,
            categoryId: resolved.categoryId,
            categorizationSource: (resolved.categoryId ? "default" : "import") as
              "default" | "import",
            needsReview: !resolved.categoryId,
            importContentHash: row.contentHash,
          };
        });
        const inserted = await tx
          .insert(transactions)
          .values(values)
          .onConflictDoNothing()
          .returning({
            importContentHash: transactions.importContentHash,
            categoryId: transactions.categoryId,
          });
        added += inserted.length;
        needsReview += inserted.filter((r) => !r.categoryId).length;
        for (const r of inserted) if (r.importContentHash) insertedHashes.add(r.importContentHash);
      }

      // Link every valid row to its transaction (including rows inserted by a
      // previous, interrupted attempt — this is the retry-heal path).
      const hashes = rows.map((r) => r.contentHash).filter((h): h is string => Boolean(h));
      const txnByHash = new Map<string, string>();
      if (hashes.length > 0) {
        const existing = await tx.execute<{ id: string; hash: string }>(sql`
          select id, import_content_hash as hash from transactions
          where account_id = ${job.accountId}
            and import_content_hash = any(${textArrayLiteral(hashes)}::text[])
        `);
        for (const row of existing.rows) txnByHash.set(row.hash, row.id);
      }
      await bulkUpdateRows(
        tx as unknown as Db,
        rows.map((row) => {
          const parsed = row.parsed as RowUpdate["parsed"];
          return {
            id: row.id,
            status: "committed" as const,
            parsed,
            error_reason: null,
            content_hash: row.contentHash,
            transaction_id: row.contentHash ? (txnByHash.get(row.contentHash) ?? null) : null,
          };
        }),
      );

      const [counts] = (
        await tx.execute<{ duplicates: number; skipped: number; invalid: number }>(sql`
          select
            count(*) filter (where status = 'duplicate')::int as duplicates,
            count(*) filter (where status = 'skipped' and error_reason is distinct from ${HEADER_REASON})::int as skipped,
            count(*) filter (where status = 'invalid')::int as invalid
          from import_rows where import_job_id = ${jobId}
        `)
      ).rows;

      await tx
        .update(importJobs)
        .set({
          status: "completed",
          committedAt: sql`now()`,
          stats: {
            added,
            duplicates: Number(counts?.duplicates ?? 0),
            skipped: Number(counts?.skipped ?? 0),
            failed: Number(counts?.invalid ?? 0),
            needsReview,
          },
          updatedAt: sql`now()`,
        })
        .where(eq(importJobs.id, jobId));

      await auditRepo.record(tx as unknown as Db, {
        id: uuidv7(),
        userId: job.userId,
        actor: "user",
        eventType: "import.committed",
        entityType: "import_job",
        entityId: jobId,
        diff: { added },
      });
    });
  } catch (error) {
    await db
      .update(importJobs)
      .set({
        status: "failed",
        error: "Committing this import failed. Nothing was partially written — you can retry.",
        updatedAt: sql`now()`,
      })
      .where(eq(importJobs.id, jobId));
    console.error("[imports] commit failed:", error instanceof Error ? error.message : error);
  }
}
