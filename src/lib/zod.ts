import type { ZodError } from "zod";

import { err, type Err } from "./result";

/** Groups Zod issues into { field: [messages] } — version-agnostic (no .flatten()). */
export function zodFieldErrors(error: ZodError): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? String(issue.path[0]) : "_form";
    (fields[key] ??= []).push(issue.message);
  }
  return fields;
}

export function zodToErr(error: ZodError): Err {
  return err("invalid_input", "Please check the form.", zodFieldErrors(error));
}
