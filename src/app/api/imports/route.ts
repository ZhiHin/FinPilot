import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";
import { auditRepo } from "@/server/db/repositories/audit";
import { importsService, MAX_FILE_BYTES } from "@/server/services/imports";

const ALLOWED_EXTENSIONS = [".csv", ".txt"];
const UPLOADS_PER_HOUR = 30;

/** 303 so the browser GETs the target after this form POST. */
function seeOther(request: Request, path: string): Response {
  return Response.redirect(new URL(path, request.url), 303);
}

function fail(request: Request, message: string): Response {
  return seeOther(request, `/imports/new?error=${encodeURIComponent(message)}`);
}

/** Multipart CSV upload → staged import job. The file itself is never stored. */
export async function POST(request: Request): Promise<Response> {
  const { user } = await requireUser();
  const db = getDb();

  // Light per-user rate limit on uploads (audit-backed, like the auth limits).
  const recent = await auditRepo.countRecentEvents(db, {
    eventType: "import.uploaded",
    since: new Date(Date.now() - 60 * 60_000),
    userId: user.id,
  });
  if (recent >= UPLOADS_PER_HOUR) {
    return fail(request, "Too many uploads in the last hour. Please wait a while and try again.");
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return fail(request, "The upload didn’t arrive as a valid form submission.");
  }
  const file = formData.get("file");
  const accountId = formData.get("accountId");
  if (!(file instanceof File) || typeof accountId !== "string") {
    return fail(request, "Choose an account and a CSV file.");
  }
  if (file.size > MAX_FILE_BYTES) {
    return fail(request, "Files are limited to 5 MB.");
  }
  const lowerName = file.name.toLowerCase();
  if (!ALLOWED_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) {
    return fail(request, "Only .csv (or .txt) statement exports are supported.");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await importsService.createJobFromUpload(db, user.id, {
    accountId,
    filename: file.name,
    buffer,
  });
  if (!result.ok) {
    return fail(request, result.error.message);
  }
  return seeOther(request, `/imports/${result.data.jobId}`);
}
