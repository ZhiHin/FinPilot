"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { isValidIsoDate } from "@/lib/dates";
import { parseAmountToMinor } from "@/lib/money";
import { err, ok, type Result } from "@/lib/result";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";
import { scenariosService, type ScenarioEventInput } from "@/server/services/scenarios";

export type ScenarioFormState = Result<{ message?: string }> | null;

/** Creates a draft and lands the user in the editor (save stays explicit). */
export async function createScenarioAction(): Promise<void> {
  const { user } = await requireUser();
  const created = await scenariosService.createDraft(getDb(), user.id);
  if (!created.ok) redirect("/scenarios");
  redirect(`/scenarios/${created.data.id}`);
}

const EVENT_TYPES = new Set([
  "one_time_expense",
  "emergency_expense",
  "income_change",
  "rent_change",
  "cancel_recurring",
  "add_installment",
  "savings_change",
]);

export async function addEventAction(
  _prev: ScenarioFormState,
  formData: FormData,
): Promise<ScenarioFormState> {
  const { user } = await requireUser();
  const scenarioId = String(formData.get("scenarioId") ?? "");
  const eventType = String(formData.get("eventType") ?? "");
  const effectiveOn = String(formData.get("effectiveOn") ?? "");
  if (!z.string().uuid().safeParse(scenarioId).success || !EVENT_TYPES.has(eventType)) {
    return err("invalid_input", "Invalid event.");
  }
  if (!isValidIsoDate(effectiveOn)) return err("invalid_input", "Pick a valid date.");

  const readAmount = (field: string): number | null => {
    const raw = String(formData.get(field) ?? "").trim();
    return raw === "" ? null : parseAmountToMinor(raw);
  };
  const readRef = (field: string): string | undefined => {
    const raw = String(formData.get(field) ?? "").trim();
    return z.string().uuid().safeParse(raw).success ? raw : undefined;
  };

  let input: ScenarioEventInput;
  switch (eventType) {
    case "one_time_expense":
    case "emergency_expense": {
      const amount = readAmount("amount");
      if (amount === null || amount <= 0) return err("invalid_input", "Enter a positive amount.");
      input = {
        eventType,
        effectiveOn,
        amountMinor: amount,
        categoryId: readRef("categoryId") ?? null,
      };
      break;
    }
    case "income_change":
    case "savings_change": {
      const amount = readAmount("amount");
      if (amount === null || amount === 0) {
        return err("invalid_input", "Enter a non-zero monthly change (negative to reduce).");
      }
      input =
        eventType === "income_change"
          ? { eventType, effectiveOn, amountMinor: amount, patternId: readRef("patternId") ?? null }
          : { eventType, effectiveOn, amountMinor: amount, goalId: readRef("goalId") ?? null };
      break;
    }
    case "rent_change": {
      const amount = readAmount("amount");
      const patternId = readRef("patternId");
      if (amount === null || amount < 0) return err("invalid_input", "Enter the new amount.");
      if (!patternId) return err("invalid_input", "Pick the recurring item that changes.");
      input = { eventType, effectiveOn, newAmountMinor: amount, patternId };
      break;
    }
    case "cancel_recurring": {
      const patternId = readRef("patternId");
      if (!patternId) return err("invalid_input", "Pick the recurring item to cancel.");
      input = { eventType, effectiveOn, patternId };
      break;
    }
    default: {
      const amount = readAmount("amount");
      const months = Number(formData.get("months") ?? 0);
      if (amount === null || amount <= 0) return err("invalid_input", "Enter a positive amount.");
      if (!Number.isInteger(months) || months < 1 || months > 60) {
        return err("invalid_input", "Instalments run 1–60 months.");
      }
      input = { eventType: "add_installment", effectiveOn, amountMinor: amount, months };
    }
  }

  const added = await scenariosService.addEvent(getDb(), user.id, scenarioId, input);
  if (!added.ok) return added;
  revalidatePath(`/scenarios/${scenarioId}`);
  return ok({});
}

export async function removeEventAction(
  _prev: ScenarioFormState,
  formData: FormData,
): Promise<ScenarioFormState> {
  const { user } = await requireUser();
  const parsed = z
    .object({ scenarioId: z.string().uuid(), eventId: z.string().uuid() })
    .safeParse({ scenarioId: formData.get("scenarioId"), eventId: formData.get("eventId") });
  if (!parsed.success) return err("invalid_input", "Invalid event.");
  const removed = await scenariosService.removeEvent(
    getDb(),
    user.id,
    parsed.data.scenarioId,
    parsed.data.eventId,
  );
  if (!removed.ok) return removed;
  revalidatePath(`/scenarios/${parsed.data.scenarioId}`);
  return ok({});
}

export async function saveScenarioAction(
  _prev: ScenarioFormState,
  formData: FormData,
): Promise<ScenarioFormState> {
  const { user } = await requireUser();
  const scenarioId = String(formData.get("scenarioId") ?? "");
  if (!z.string().uuid().safeParse(scenarioId).success) {
    return err("invalid_input", "Invalid scenario.");
  }
  const saved = await scenariosService.save(getDb(), user.id, scenarioId, {
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? ""),
  });
  if (!saved.ok) return saved;
  revalidatePath(`/scenarios/${scenarioId}`);
  revalidatePath("/scenarios");
  return ok({ message: "Scenario saved." });
}

export async function deleteScenarioAction(
  _prev: ScenarioFormState,
  formData: FormData,
): Promise<ScenarioFormState> {
  const { user } = await requireUser();
  const scenarioId = String(formData.get("scenarioId") ?? "");
  if (!z.string().uuid().safeParse(scenarioId).success) {
    return err("invalid_input", "Invalid scenario.");
  }
  const deleted = await scenariosService.softDelete(getDb(), user.id, scenarioId);
  if (!deleted.ok) return deleted;
  revalidatePath("/scenarios");
  redirect("/scenarios");
}
