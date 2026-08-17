import { localDateInTz } from "@/lib/dates";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";
import { preferencesRepo } from "@/server/db/repositories/preferences";
import { exportsService } from "@/server/services/exports";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidList(raw: string | null): string[] | undefined {
  const ids = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => UUID.test(s));
  return ids.length > 0 ? ids : undefined;
}

/**
 * CSV download of the caller's transactions with the active filters.
 * User identity always comes from the session; filter ids are
 * ownership-validated in the service and fail closed. Rate-limited and
 * audited there too. The filename is app-generated (never user input).
 */
export async function GET(request: Request): Promise<Response> {
  const { user } = await requireUser();
  const db = getDb();
  const params = new URL(request.url).searchParams;

  const result = await exportsService.exportTransactionsCsv(db, user.id, {
    accountIds: uuidList(params.get("accounts")),
    categoryIds: uuidList(params.get("categories")),
    tagIds: uuidList(params.get("tags")),
    types: params.get("type") ? [params.get("type") as string] : undefined,
    dateFrom: params.get("from") ?? undefined,
    dateTo: params.get("to") ?? undefined,
    search: params.get("q") ?? undefined,
  });

  if (!result.ok) {
    const status = result.error.code === "rate_limited" ? 429 : 400;
    return new Response(result.error.message, {
      status,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const prefs = await preferencesRepo.get(db, user.id);
  const today = localDateInTz(new Date(), prefs?.timezone ?? "Asia/Kuala_Lumpur");
  return new Response(result.data.csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="finpilot-transactions-${today}.csv"`,
      "cache-control": "no-store",
    },
  });
}
