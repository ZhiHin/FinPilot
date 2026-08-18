"use client";

import { Download, Trash2 } from "lucide-react";
import { useActionState, useState } from "react";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { requestAccountDeletionAction, type AuthFormState } from "@/features/auth/actions";

/**
 * Full-account export: fetch so rate-limit errors render as a banner instead
 * of a bare text page, then hand the ZIP to the browser as a download.
 */
export function ExportCard() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function download() {
    setBusy(true);
    setError(null);
    setDone(false);
    try {
      const response = await fetch("/api/exports/account");
      if (!response.ok) {
        setError(await response.text());
        return;
      }
      const disposition = response.headers.get("content-disposition") ?? "";
      const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "finpilot-export.zip";
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
      setDone(true);
    } catch {
      setError("The export could not be prepared. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error ? <Banner variant="risk">{error}</Banner> : null}
      {done ? (
        <Banner variant="positive">
          Your export is downloading. The ZIP holds one CSV per record type plus a manifest.
        </Banner>
      ) : null}
      <Button onClick={download} disabled={busy} className="self-start">
        <Download aria-hidden className="mr-2 h-4 w-4" />
        {busy ? "Preparing export..." : "Download my data (ZIP)"}
      </Button>
    </div>
  );
}

export function DeleteAccountCard() {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(
    requestAccountDeletionAction,
    null,
  );
  const errors = state && !state.ok ? (state.error.fieldErrors ?? {}) : {};

  return (
    <>
      <Button variant="destructive" onClick={() => setOpen(true)} className="self-start">
        <Trash2 aria-hidden className="mr-2 h-4 w-4" />
        Delete my account
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogTitle>Delete this account?</DialogTitle>
          <form action={formAction} className="mt-4 flex flex-col gap-4" noValidate>
            {state && !state.ok && !state.error.fieldErrors ? (
              <Banner variant="risk">{state.error.message}</Banner>
            ) : null}
            <ul className="list-disc pl-5 text-[13px] leading-6 text-ink-secondary">
              <li>You are signed out everywhere immediately.</li>
              <li>
                Your account is deactivated for <strong>30 days</strong> — sign back in during that
                window to restore everything.
              </li>
              <li>
                After 30 days, all your data — accounts, transactions, budgets, goals, scenarios,
                journal — is permanently erased. This cannot be undone.
              </li>
            </ul>
            <FormField label="Confirm with your password" errors={errors.password}>
              <Input name="password" type="password" autoComplete="current-password" required />
            </FormField>
            <div className="flex gap-2">
              <Button type="submit" variant="destructive" disabled={pending}>
                {pending ? "Scheduling deletion..." : "Delete my account"}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
