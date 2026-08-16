import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AmountText } from "@/components/ui/amount-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { AccountFormDialog } from "@/features/accounts/account-form-dialog";
import { setAccountArchivedAction } from "@/features/accounts/actions";
import { ReconcileForm } from "@/features/accounts/reconcile-form";
import { ACCOUNT_TYPE_LABELS } from "@/features/accounts/schemas";
import { formatIsoDate, localDateInTz } from "@/lib/dates";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";
import { preferencesRepo } from "@/server/db/repositories/preferences";
import { accountsService } from "@/server/services/accounts";
import { transactionsService } from "@/server/services/transactions";

export const metadata: Metadata = { title: "Account" };

export default async function AccountDetailPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { user } = await requireUser();
  const { accountId } = await params;
  const db = getDb();
  const account = await accountsService.get(db, user.id, accountId);
  if (!account) notFound();

  const prefs = await preferencesRepo.get(db, user.id);
  const today = localDateInTz(new Date(), prefs?.timezone ?? "Asia/Kuala_Lumpur");
  const currency = account.currency.trim();
  const recent = await transactionsService.list(db, user.id, {
    accountIds: [account.id],
    limit: 10,
  });

  return (
    <>
      <PageHeader
        title={account.name}
        description={`${ACCOUNT_TYPE_LABELS[account.type]} · ${currency} · opened ${formatIsoDate(account.openingBalanceDate, "en-MY")}`}
        actions={
          <>
            <AccountFormDialog
              mode="edit"
              today={today}
              initial={{
                accountId: account.id,
                version: account.version,
                name: account.name,
                type: account.type,
                currency,
                openingBalance: (account.openingBalanceMinor / 100).toString(),
                openingBalanceDate: account.openingBalanceDate,
                creditLimit: account.creditLimitMinor
                  ? (account.creditLimitMinor / 100).toString()
                  : "",
                includeInNetWorth: account.includeInNetWorth,
              }}
            />
            <form action={setAccountArchivedAction}>
              <input type="hidden" name="accountId" value={account.id} />
              <input
                type="hidden"
                name="archived"
                value={account.status === "active" ? "true" : "false"}
              />
              <Button type="submit" variant="ghost">
                {account.status === "active" ? "Archive" : "Unarchive"}
              </Button>
            </form>
          </>
        }
      />

      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-end gap-6 rounded-card border border-hairline bg-card p-6">
          <div>
            <div className="text-[13px] text-ink-secondary">Balance</div>
            <AmountText
              amountMinor={account.balanceMinor}
              currency={currency}
              className="text-[32px] font-semibold leading-[38px]"
            />
          </div>
          {account.pendingMinor !== 0 ? (
            <div>
              <div className="text-[13px] text-ink-secondary">Pending</div>
              <AmountText
                amountMinor={account.pendingMinor}
                currency={currency}
                className="text-[19px]"
              />
            </div>
          ) : null}
          {account.creditLimitMinor ? (
            <div>
              <div className="text-[13px] text-ink-secondary">Credit limit</div>
              <AmountText
                amountMinor={account.creditLimitMinor}
                currency={currency}
                className="text-[19px]"
              />
            </div>
          ) : null}
          {account.status === "archived" ? <Badge>Archived — history preserved</Badge> : null}
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Reconcile against a statement</CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <p className="mb-4 text-[13px] text-ink-secondary">
                Enter the balance your bank statement shows. FinPilot compares it with the ledger
                and can record the discrepancy as an adjustment.
              </p>
              <ReconcileForm accountId={account.id} today={today} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent transactions</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1 pt-4">
              {recent.items.length === 0 ? (
                <p className="text-[13px] text-ink-muted">No transactions in this account yet.</p>
              ) : (
                recent.items.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 border-b border-hairline py-2 last:border-0"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[13px] text-ink">
                        {item.merchantName ?? item.descriptionOriginal ?? "—"}
                      </div>
                      <div className="text-[11.5px] text-ink-muted">
                        {formatIsoDate(item.txnDate, "en-MY")}
                        {item.status === "pending" ? " · pending" : ""}
                      </div>
                    </div>
                    <AmountText
                      amountMinor={item.amountMinor}
                      currency={item.currency}
                      className="text-[13px]"
                    />
                  </div>
                ))
              )}
              <Link
                href={`/transactions?accounts=${account.id}`}
                className="mt-2 text-[13px] font-medium text-accent underline underline-offset-2 hover:no-underline"
              >
                View all in Transactions
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
