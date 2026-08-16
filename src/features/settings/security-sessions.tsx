"use client";

import { useActionState } from "react";

import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import {
  revokeOtherSessionsAction,
  revokeSessionAction,
  type AuthFormState,
} from "@/features/auth/actions";

export interface SessionView {
  id: string;
  createdAtIso: string;
  lastSeenAtIso: string;
  userAgent: string | null;
  isCurrent: boolean;
}

function formatInstant(iso: string): string {
  return new Intl.DateTimeFormat("en-MY", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(iso),
  );
}

function describeAgent(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";
  if (/mobile|android|iphone/i.test(userAgent)) return "Mobile browser";
  if (/firefox/i.test(userAgent)) return "Firefox";
  if (/edg/i.test(userAgent)) return "Edge";
  if (/chrome/i.test(userAgent)) return "Chrome";
  if (/safari/i.test(userAgent)) return "Safari";
  return "Browser";
}

export function SecuritySessions({ sessions }: { sessions: SessionView[] }) {
  const [revokeState, revokeAction] = useActionState(revokeSessionAction, null);
  const [othersState, othersFormAction, othersPending] = useActionState<AuthFormState>(
    () => revokeOtherSessionsAction(),
    null,
  );

  return (
    <div className="flex flex-col gap-4">
      {revokeState && !revokeState.ok ? (
        <Banner variant="risk">{revokeState.error.message}</Banner>
      ) : null}
      {othersState?.ok && othersState.data.message ? (
        <Banner variant="positive">{othersState.data.message}</Banner>
      ) : null}

      <ul className="flex flex-col gap-2">
        {sessions.map((session) => (
          <li
            key={session.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-hairline bg-card p-4"
          >
            <div>
              <div className="flex items-center gap-2 text-[15px] font-medium text-ink">
                {describeAgent(session.userAgent)}
                {session.isCurrent ? <Badge variant="info">This device</Badge> : null}
              </div>
              <div className="mt-0.5 text-[13px] text-ink-muted">
                Signed in {formatInstant(session.createdAtIso)} · last active{" "}
                {formatInstant(session.lastSeenAtIso)}
              </div>
            </div>
            {!session.isCurrent ? (
              <form action={revokeAction}>
                <input type="hidden" name="sessionId" value={session.id} />
                <Button type="submit" variant="secondary" size="sm">
                  Sign out
                </Button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>

      <form action={othersFormAction}>
        <Button type="submit" variant="secondary" disabled={othersPending}>
          Sign out all other devices
        </Button>
      </form>
    </div>
  );
}
