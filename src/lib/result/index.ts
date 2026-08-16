/**
 * Standard success/error envelope for server actions and route handlers
 * (architecture doc §3). Error messages are always user-safe — provider and
 * database details never cross this boundary.
 */

export type AppErrorCode =
  | "invalid_input"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "conflict"
  | "internal";

export interface AppError {
  code: AppErrorCode;
  message: string;
  fieldErrors?: Record<string, string[]>;
}

export interface Ok<T> {
  ok: true;
  data: T;
}

export interface Err {
  ok: false;
  error: AppError;
}

export type Result<T> = Ok<T> | Err;

export function ok<T>(data: T): Ok<T> {
  return { ok: true, data };
}

export function err(
  code: AppErrorCode,
  message: string,
  fieldErrors?: Record<string, string[]>,
): Err {
  return { ok: false, error: fieldErrors ? { code, message, fieldErrors } : { code, message } };
}

export function isOk<T>(result: Result<T>): result is Ok<T> {
  return result.ok;
}

export function isErr<T>(result: Result<T>): result is Err {
  return !result.ok;
}
