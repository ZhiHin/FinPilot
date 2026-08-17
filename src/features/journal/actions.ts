"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { parseAmountToMinor } from "@/lib/money";
import { err, ok, type Result } from "@/lib/result";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";
import { journalService, type JournalEntryInput } from "@/server/services/journal";

export type JournalFormState = Result<{ message?: string }> | null;

function entryInputFrom(formData: FormData): Result<JournalEntryInput> {
  const kind = String(formData.get("kind") ?? "");
  if (!["life_event", "decision", "note"].includes(kind)) {
    return err("invalid_input", "Pick an entry kind.");
  }
  const endsOnRaw = String(formData.get("endsOn") ?? "").trim();
  const reviewOnRaw = String(formData.get("reviewOn") ?? "").trim();
  const expectedRaw = String(formData.get("expectedSaving") ?? "").trim();
  const expectedSavingMinor = expectedRaw === "" ? null : parseAmountToMinor(expectedRaw);
  if (expectedRaw !== "" && expectedSavingMinor === null) {
    return err("invalid_input", "Enter the expected monthly saving as an amount.");
  }
  const scenarioRaw = String(formData.get("scenarioId") ?? "").trim();
  return ok({
    kind: kind as JournalEntryInput["kind"],
    title: String(formData.get("title") ?? ""),
    body: String(formData.get("body") ?? ""),
    startsOn: String(formData.get("startsOn") ?? ""),
    endsOn: endsOnRaw === "" ? null : endsOnRaw,
    excludeFromBaselines: formData.get("excludeFromBaselines") === "on",
    expectedSavingMinor,
    reviewOn: reviewOnRaw === "" ? null : reviewOnRaw,
    scenarioId: z.string().uuid().safeParse(scenarioRaw).success ? scenarioRaw : null,
  });
}

export async function createEntryAction(
  _prev: JournalFormState,
  formData: FormData,
): Promise<JournalFormState> {
  const { user } = await requireUser();
  const input = entryInputFrom(formData);
  if (!input.ok) return input;
  const created = await journalService.create(getDb(), user.id, input.data);
  if (!created.ok) return created;
  revalidatePath("/journal");
  revalidatePath("/insights");
  revalidatePath("/overview");
  return ok({ message: "Journal entry saved." });
}

export async function updateEntryAction(
  _prev: JournalFormState,
  formData: FormData,
): Promise<JournalFormState> {
  const { user } = await requireUser();
  const entryId = String(formData.get("entryId") ?? "");
  if (!z.string().uuid().safeParse(entryId).success) return err("invalid_input", "Invalid entry.");
  const input = entryInputFrom(formData);
  if (!input.ok) return input;
  const updated = await journalService.update(getDb(), user.id, entryId, input.data);
  if (!updated.ok) return updated;
  revalidatePath("/journal");
  revalidatePath("/insights");
  revalidatePath("/overview");
  return ok({ message: "Journal entry updated." });
}

export async function deleteEntryAction(
  _prev: JournalFormState,
  formData: FormData,
): Promise<JournalFormState> {
  const { user } = await requireUser();
  const entryId = String(formData.get("entryId") ?? "");
  if (!z.string().uuid().safeParse(entryId).success) return err("invalid_input", "Invalid entry.");
  const deleted = await journalService.softDelete(getDb(), user.id, entryId);
  if (!deleted.ok) return deleted;
  revalidatePath("/journal");
  revalidatePath("/insights");
  return ok({ message: "Entry deleted." });
}

export async function recordOutcomeAction(
  _prev: JournalFormState,
  formData: FormData,
): Promise<JournalFormState> {
  const { user } = await requireUser();
  const parsed = z
    .object({
      entryId: z.string().uuid(),
      verdict: z.enum(["happened", "partly", "no"]),
      note: z.string().max(500).optional(),
    })
    .safeParse({
      entryId: formData.get("entryId"),
      verdict: formData.get("verdict"),
      note: String(formData.get("note") ?? ""),
    });
  if (!parsed.success) return err("invalid_input", "Pick a verdict.");
  const recorded = await journalService.recordOutcome(getDb(), user.id, parsed.data.entryId, {
    verdict: parsed.data.verdict,
    note: parsed.data.note,
  });
  if (!recorded.ok) return recorded;
  revalidatePath("/journal");
  return ok({ message: "Outcome recorded." });
}
