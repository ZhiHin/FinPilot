"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { localDateInTz } from "@/lib/dates";
import { parseAmountToMinor } from "@/lib/money";
import { err, ok, type Result } from "@/lib/result";
import { zodToErr } from "@/lib/zod";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";
import { preferencesRepo } from "@/server/db/repositories/preferences";
import { notificationsService } from "@/server/services/notifications";
import { recurringService } from "@/server/services/recurring";

export type RecurringFormState = Result<{ message?: string }> | null;

function refresh(): void {
  revalidatePath("/recurring");
  revalidatePath("/notifications");
  revalidatePath("/overview");
}

async function todayFor(userId: string): Promise<string> {
  const prefs = await preferencesRepo.get(getDb(), userId);
  return localDateInTz(new Date(), prefs?.timezone ?? "Asia/Kuala_Lumpur");
}

export async function rescanAction(
  _prev: RecurringFormState,
  _formData: FormData,
): Promise<RecurringFormState> {
  void _prev;
  void _formData;
  const { user } = await requireUser();
  const db = getDb();
  const today = await todayFor(user.id);
  const result = await recurringService.scan(db, user.id, today);
  if (!result.ok) return result;
  await notificationsService.generate(db, user.id, { today });
  refresh();
  const { created, updated, ended } = result.data;
  return ok({
    message: `Scan complete — ${created} new pattern(s), ${updated} refreshed, ${ended} ended.`,
  });
}

export async function confirmPatternAction(
  _prev: RecurringFormState,
  formData: FormData,
): Promise<RecurringFormState> {
  const { user } = await requireUser();
  const parsed = z
    .object({ patternId: z.string().uuid() })
    .safeParse({ patternId: formData.get("patternId") });
  if (!parsed.success) return zodToErr(parsed.error);
  const result = await recurringService.confirm(getDb(), user.id, parsed.data.patternId);
  if (!result.ok) return result;
  refresh();
  return ok({ message: "Confirmed — this pattern is now yours, not a guess." });
}

export async function setPatternStatusAction(
  _prev: RecurringFormState,
  formData: FormData,
): Promise<RecurringFormState> {
  const { user } = await requireUser();
  const parsed = z
    .object({
      patternId: z.string().uuid(),
      status: z.enum(["active", "paused", "ended"]),
    })
    .safeParse({ patternId: formData.get("patternId"), status: formData.get("status") });
  if (!parsed.success) return zodToErr(parsed.error);
  const result = await recurringService.setStatus(
    getDb(),
    user.id,
    parsed.data.patternId,
    parsed.data.status,
  );
  if (!result.ok) return result;
  refresh();
  const messages: Record<string, string> = {
    active: "Pattern resumed.",
    paused: "Pattern paused — it stays out of upcoming bills until resumed.",
    ended: "Marked not recurring — it won’t come back, even after rescans.",
  };
  return ok({ message: messages[parsed.data.status] });
}

export async function updatePatternAction(
  _prev: RecurringFormState,
  formData: FormData,
): Promise<RecurringFormState> {
  const { user } = await requireUser();
  const parsed = z
    .object({
      patternId: z.string().uuid(),
      name: z.string().trim().min(1).max(80),
      amount: z.string().min(1),
      tolerance: z.string().optional(),
      nextExpectedOn: z.string().min(1),
      installmentsTotal: z.string().optional(),
    })
    .safeParse({
      patternId: formData.get("patternId"),
      name: formData.get("name"),
      amount: formData.get("amount"),
      tolerance: (formData.get("tolerance") as string) ?? undefined,
      nextExpectedOn: formData.get("nextExpectedOn"),
      installmentsTotal: (formData.get("installmentsTotal") as string) ?? undefined,
    });
  if (!parsed.success) return zodToErr(parsed.error);

  const amount = parseAmountToMinor(parsed.data.amount);
  if (amount === null || amount <= 0) {
    return err("invalid_input", "Please check the form.", {
      amount: ["Enter an amount above zero."],
    });
  }
  let tolerance: number | undefined;
  if (parsed.data.tolerance && parsed.data.tolerance.trim() !== "") {
    const parsedTolerance = parseAmountToMinor(parsed.data.tolerance);
    if (parsedTolerance === null || parsedTolerance < 0) {
      return err("invalid_input", "Please check the form.", {
        tolerance: ["Enter zero or a positive amount."],
      });
    }
    tolerance = parsedTolerance;
  }
  let installmentsTotal: number | null | undefined;
  if (parsed.data.installmentsTotal !== undefined) {
    const raw = parsed.data.installmentsTotal.trim();
    if (raw === "") installmentsTotal = null;
    else {
      const n = Number(raw);
      if (!Number.isInteger(n) || n <= 0) {
        return err("invalid_input", "Please check the form.", {
          installmentsTotal: ["Enter a whole number of payments."],
        });
      }
      installmentsTotal = n;
    }
  }

  const result = await recurringService.update(getDb(), user.id, parsed.data.patternId, {
    name: parsed.data.name,
    typicalAmountMinor: amount,
    ...(tolerance !== undefined ? { amountToleranceMinor: tolerance } : {}),
    nextExpectedOn: parsed.data.nextExpectedOn,
    ...(installmentsTotal !== undefined ? { installmentsTotal } : {}),
  });
  if (!result.ok) return result;
  refresh();
  return ok({ message: "Pattern updated (and confirmed, since you set it yourself)." });
}

export async function setSubscriptionAction(
  _prev: RecurringFormState,
  formData: FormData,
): Promise<RecurringFormState> {
  const { user } = await requireUser();
  const parsed = z
    .object({
      patternId: z.string().uuid(),
      isSubscription: z.enum(["true", "false"]),
    })
    .safeParse({
      patternId: formData.get("patternId"),
      isSubscription: formData.get("isSubscription"),
    });
  if (!parsed.success) return zodToErr(parsed.error);
  const result = await recurringService.setSubscription(
    getDb(),
    user.id,
    parsed.data.patternId,
    parsed.data.isSubscription === "true",
  );
  if (!result.ok) return result;
  refresh();
  return ok({
    message:
      parsed.data.isSubscription === "true"
        ? "Marked as a subscription."
        : "No longer tracked as a subscription.",
  });
}

export async function acknowledgePriceChangeAction(
  _prev: RecurringFormState,
  formData: FormData,
): Promise<RecurringFormState> {
  const { user } = await requireUser();
  const parsed = z
    .object({ subscriptionId: z.string().uuid() })
    .safeParse({ subscriptionId: formData.get("subscriptionId") });
  if (!parsed.success) return zodToErr(parsed.error);
  const result = await recurringService.acknowledgePriceChange(
    getDb(),
    user.id,
    parsed.data.subscriptionId,
  );
  if (!result.ok) return result;
  refresh();
  return ok({ message: "Price change acknowledged." });
}

export async function confirmUsageAction(
  _prev: RecurringFormState,
  formData: FormData,
): Promise<RecurringFormState> {
  const { user } = await requireUser();
  const parsed = z
    .object({ subscriptionId: z.string().uuid() })
    .safeParse({ subscriptionId: formData.get("subscriptionId") });
  if (!parsed.success) return zodToErr(parsed.error);
  const result = await recurringService.confirmUsage(getDb(), user.id, parsed.data.subscriptionId);
  if (!result.ok) return result;
  refresh();
  return ok({ message: "Noted — you still use this service (your statement, not ours)." });
}
