import JSZip from "jszip";

import { localDateInTz } from "@/lib/dates";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";
import { preferencesRepo } from "@/server/db/repositories/preferences";
import { exportsService } from "@/server/services/exports";

/**
 * Full-account export download (Phase 10, spec V4). Identity comes from the
 * session only; the service rate-limits and audits. The ZIP contains one
 * formula-injection-safe CSV per owned entity plus profile.json and
 * manifest.json. Filename is app-generated (never user input).
 */
export async function GET(): Promise<Response> {
  const { user } = await requireUser();
  const db = getDb();

  const result = await exportsService.exportAccountArchive(db, user.id);
  if (!result.ok) {
    const status = result.error.code === "rate_limited" ? 429 : 400;
    return new Response(result.error.message, {
      status,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const zip = new JSZip();
  for (const file of result.data.files) {
    zip.file(file.name, file.content);
  }
  const archive = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });

  const prefs = await preferencesRepo.get(db, user.id);
  const today = localDateInTz(new Date(), prefs?.timezone ?? "Asia/Kuala_Lumpur");
  return new Response(new Uint8Array(archive), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="finpilot-export-${today}.zip"`,
      "cache-control": "no-store",
    },
  });
}
