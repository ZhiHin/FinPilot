import type { Metadata } from "next";
import Link from "next/link";

import { AmountText } from "@/components/ui/amount-text";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat-tile";
import { AccountFormDialog } from "@/features/accounts/account-form-dialog";
import { ACCOUNT_TYPE_LABELS } from "@/features/accounts/schemas";
import { localDateInTz } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";
import { preferencesRepo } from "@/server/db/repositories/preferences";
import { accountsService, type AccountWithBalance } from "@/server/services/accounts";

export const metadata: Metadata = { title: t("nav.accounts") };

function AccountRowCard({ account }: { account: AccountWithBalance }) {
  return (
    <Link
      href={`/accounts/${account.id}`}
      className="flex items-center justify-between gap-3 rounded-card border border-hairline bg-card px-4 py-3 hover:border-strongline"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-[15px] font-medium text-ink">{account.name}</span>
          {account.status === "archived" ? <Badge>Archived</Badge> : null}
          {!account.includeInNetWorth ? <Badge>Not in net worth</Badge> : null}
        </div>
        <div className="text-[13px] text-ink-muted">
          {ACCOUNT_TYPE_LABELS[account.type]} · {account.currency.trim()}
          {account.txnCount > 0 ? ` · ${account.txnCount} transactions` : ""}
        </div>
      </div>
      <div className="text-right">
        <AmountText
          amountMinor={account.balanceMinor}
          currency={account.currency.trim()}
          className="text-[15px] font-semibold"
        />
        {account.pendingMinor !== 0 ? (
          <div className="text-[11.5px] text-ink-muted">
            pending{" "}
            <AmountText amountMinor={account.pendingMinor} currency={account.currency.trim()} />
          </div>
        ) : null}
      </div>
    </Link>
  );
}

export default async function AccountsPage() {
  const { user } = await requireUser();
  const db = getDb();
  const prefs = await preferencesRepo.get(db, user.id);
  const today = localDateInTz(new Date(), prefs?.timezone ?? "Asia/Kuala_Lumpur");
  const [allAccounts, netPosition] = await Promise.all([
    accountsService.list(db, user.id, { includeArchived: true }),
    accountsService.netPosition(db, user.id),
  ]);
  const active = allAccounts.filter((a) => a.status === "active");
  const archived = allAccounts.filter((a) => a.status === "archived");
  const currencies = Object.keys(netPosition).sort((a, b) =>
    a === "MYR" ? -1 : b === "MYR" ? 1 : a.localeCompare(b),
  );

  return (
    <>
      <PageHeader
        title={t("nav.accounts")}
        description="Your accounts, balances, and net position. Currencies are shown separately — nothing is converted."
        actions={<AccountFormDialog mode="create" today={today} />}
      />

      {allAccounts.length === 0 ? (
        <EmptyState
          title="No accounts yet"
          description="Add your bank accounts, e-wallets, cards, and loans to see your real position."
        />
      ) : (
        <div className="flex flex-col gap-6">
          {currencies.map((currency) => {
            const position = netPosition[currency];
            return (
              <section key={currency} aria-label={`${currency} position`}>
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                  <StatTile label={`Net worth (${currency})`}>
                    <AmountText amountMinor={position.netMinor} currency={currency} />
                  </StatTile>
                  <StatTile label="Assets">
                    <AmountText amountMinor={position.assetsMinor} currency={currency} />
                  </StatTile>
                  <StatTile label="Liabilities">
                    <AmountText amountMinor={position.liabilitiesMinor} currency={currency} />
                  </StatTile>
                  <StatTile label="Liquid" detail="Cash, bank & e-wallet balances">
                    <AmountText amountMinor={position.liquidMinor} currency={currency} />
                  </StatTile>
                </div>
              </section>
            );
          })}

          <section aria-label="Active accounts" className="flex flex-col gap-2">
            {active.map((account) => (
              <AccountRowCard key={account.id} account={account} />
            ))}
          </section>

          {archived.length > 0 ? (
            <Card>
              <CardContent className="flex flex-col gap-2">
                <h2 className="text-[15px] font-semibold text-ink">Archived</h2>
                <p className="text-[13px] text-ink-muted">
                  Archived accounts keep their full transaction history.
                </p>
                {archived.map((account) => (
                  <AccountRowCard key={account.id} account={account} />
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}
    </>
  );
}
