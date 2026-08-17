"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { ok, type Result } from "@/lib/result";
import { zodToErr } from "@/lib/zod";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";
import { importsService } from "@/server/services/imports";

export type ImportFormState = Result<{ message?: string }> | null;

function refresh(jobId: string) {
  revalidatePath(`/imports/${jobId}`);
  revalidatePath("/imports");
}

export async function applyMappingAction(
  _prev: ImportFormState,
  formData: FormData,
): Promise<ImportFormState> {
  const { user } = await requireUser();
  const meta = z
    .object({
      jobId: z.string().uuid(),
      amountMode: z.enum(["single", "debitcredit"]),
      headerRows: z.coerce.number().int().min(0).max(3),
      dateFormat: z.enum(["auto", "yyyy-mm-dd", "dd/mm/yyyy", "mm/dd/yyyy", "dd mmm yyyy"]),
      dateColumn: z.coerce.number().int().min(0),
      descriptionColumn: z.coerce.number().int().min(0),
      amountColumn: z.coerce.number().int().min(0).optional(),
      debitColumn: z.coerce.number().int().min(0).optional(),
      creditColumn: z.coerce.number().int().min(0).optional(),
      saveProfileName: z.string().trim().max(60).optional().or(z.literal("")),
      profileId: z.string().uuid().optional().or(z.literal("")),
    })
    .safeParse({
      jobId: formData.get("jobId"),
      amountMode: formData.get("amountMode"),
      headerRows: formData.get("headerRows"),
      dateFormat: formData.get("dateFormat"),
      dateColumn: formData.get("dateColumn"),
      descriptionColumn: formData.get("descriptionColumn"),
      amountColumn: formData.get("amountColumn") ?? undefined,
      debitColumn: formData.get("debitColumn") ?? undefined,
      creditColumn: formData.get("creditColumn") ?? undefined,
      saveProfileName: (formData.get("saveProfileName") as string) ?? "",
      profileId: (formData.get("profileId") as string) ?? "",
    });
  if (!meta.success) return zodToErr(meta.error);
  const d = meta.data;

  const result = await importsService.applyMapping(getDb(), user.id, d.jobId, {
    mapping: {
      headerRows: d.headerRows,
      dateFormat: d.dateFormat,
      dateColumn: d.dateColumn,
      descriptionColumn: d.descriptionColumn,
      ...(d.amountMode === "single"
        ? { amountColumn: d.amountColumn }
        : { debitColumn: d.debitColumn, creditColumn: d.creditColumn }),
    },
    saveProfileName: d.saveProfileName || undefined,
    profileId: d.profileId || undefined,
  });
  if (!result.ok) return result;
  refresh(d.jobId);
  return ok({ message: "Checking your rows…" });
}

export async function toggleRowAction(
  _prev: ImportFormState,
  formData: FormData,
): Promise<ImportFormState> {
  const { user } = await requireUser();
  const parsed = z
    .object({
      jobId: z.string().uuid(),
      rowId: z.string().uuid(),
      included: z.enum(["true", "false"]),
    })
    .safeParse({
      jobId: formData.get("jobId"),
      rowId: formData.get("rowId"),
      included: formData.get("included"),
    });
  if (!parsed.success) return zodToErr(parsed.error);
  const result = await importsService.setRowInclusion(
    getDb(),
    user.id,
    parsed.data.jobId,
    parsed.data.rowId,
    parsed.data.included === "true",
  );
  if (!result.ok) return result;
  refresh(parsed.data.jobId);
  return ok({});
}

export async function confirmImportAction(
  _prev: ImportFormState,
  formData: FormData,
): Promise<ImportFormState> {
  const { user } = await requireUser();
  const parsed = z.object({ jobId: z.string().uuid() }).safeParse({ jobId: formData.get("jobId") });
  if (!parsed.success) return zodToErr(parsed.error);
  const result = await importsService.confirm(getDb(), user.id, parsed.data.jobId);
  if (!result.ok) return result;
  refresh(parsed.data.jobId);
  return ok({ message: "Importing…" });
}

export async function cancelImportAction(formData: FormData): Promise<void> {
  const { user } = await requireUser();
  const jobId = z.string().uuid().safeParse(formData.get("jobId"));
  if (jobId.success) {
    await importsService.cancel(getDb(), user.id, jobId.data);
    revalidatePath("/imports");
  }
  redirect("/imports");
}

export async function undoImportAction(
  _prev: ImportFormState,
  formData: FormData,
): Promise<ImportFormState> {
  const { user } = await requireUser();
  const parsed = z.object({ jobId: z.string().uuid() }).safeParse({ jobId: formData.get("jobId") });
  if (!parsed.success) return zodToErr(parsed.error);
  const result = await importsService.undo(getDb(), user.id, parsed.data.jobId);
  if (!result.ok) return result;
  refresh(parsed.data.jobId);
  revalidatePath("/transactions");
  revalidatePath("/accounts");
  revalidatePath("/overview");
  const kept = result.data.keptModifiedCount;
  return ok({
    message:
      `Undid ${result.data.undoneCount} transaction(s); restorable from the Deleted view.` +
      (kept > 0 ? ` ${kept} transaction(s) you edited since importing were kept.` : ""),
  });
}
