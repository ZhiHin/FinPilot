"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { ok, type Result } from "@/lib/result";
import { zodToErr } from "@/lib/zod";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";
import { notificationsService } from "@/server/services/notifications";

export type NotificationFormState = Result<{ message?: string }> | null;

export async function markReadAction(
  _prev: NotificationFormState,
  formData: FormData,
): Promise<NotificationFormState> {
  const { user } = await requireUser();
  const parsed = z
    .object({ notificationId: z.string().uuid() })
    .safeParse({ notificationId: formData.get("notificationId") });
  if (!parsed.success) return zodToErr(parsed.error);
  const result = await notificationsService.markRead(getDb(), user.id, parsed.data.notificationId);
  if (!result.ok) return result;
  revalidatePath("/notifications");
  return ok({});
}

export async function markAllReadAction(
  _prev: NotificationFormState,
  _formData: FormData,
): Promise<NotificationFormState> {
  void _prev;
  void _formData;
  const { user } = await requireUser();
  const { marked } = await notificationsService.markAllRead(getDb(), user.id);
  revalidatePath("/notifications");
  return ok({ message: marked > 0 ? `Marked ${marked} notification(s) read.` : undefined });
}

export async function dismissAction(
  _prev: NotificationFormState,
  formData: FormData,
): Promise<NotificationFormState> {
  const { user } = await requireUser();
  const parsed = z
    .object({ notificationId: z.string().uuid() })
    .safeParse({ notificationId: formData.get("notificationId") });
  if (!parsed.success) return zodToErr(parsed.error);
  const result = await notificationsService.dismiss(getDb(), user.id, parsed.data.notificationId);
  if (!result.ok) return result;
  revalidatePath("/notifications");
  return ok({ message: "Dismissed — this alert won’t come back." });
}
