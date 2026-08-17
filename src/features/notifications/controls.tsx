"use client";

import { useActionState } from "react";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";

import {
  dismissAction,
  markAllReadAction,
  markReadAction,
  type NotificationFormState,
} from "./actions";

export function MarkAllReadButton() {
  const [state, formAction, pending] = useActionState<NotificationFormState, FormData>(
    markAllReadAction,
    null,
  );
  return (
    <div className="flex flex-col items-end gap-2">
      <form action={formAction}>
        <Button type="submit" variant="secondary" size="sm" disabled={pending}>
          {pending ? "Marking…" : "Mark all read"}
        </Button>
      </form>
      {state?.ok && state.data.message ? (
        <Banner variant="positive">{state.data.message}</Banner>
      ) : null}
    </div>
  );
}

export function NotificationRowActions({
  notificationId,
  isUnread,
}: {
  notificationId: string;
  isUnread: boolean;
}) {
  const [readState, readFormAction, readPending] = useActionState<NotificationFormState, FormData>(
    markReadAction,
    null,
  );
  const [dismissState, dismissFormAction, dismissPending] = useActionState<
    NotificationFormState,
    FormData
  >(dismissAction, null);
  return (
    <div className="flex flex-col gap-1.5">
      {readState && !readState.ok ? (
        <Banner variant="risk">{readState.error.message}</Banner>
      ) : null}
      {dismissState && !dismissState.ok ? (
        <Banner variant="risk">{dismissState.error.message}</Banner>
      ) : null}
      <div className="flex gap-1.5">
        {isUnread ? (
          <form action={readFormAction}>
            <input type="hidden" name="notificationId" value={notificationId} />
            <Button type="submit" variant="ghost" size="sm" disabled={readPending}>
              Mark read
            </Button>
          </form>
        ) : null}
        <form action={dismissFormAction}>
          <input type="hidden" name="notificationId" value={notificationId} />
          <Button type="submit" variant="ghost" size="sm" disabled={dismissPending}>
            Dismiss
          </Button>
        </form>
      </div>
    </div>
  );
}
