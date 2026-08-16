import { enMY, type MessageKey } from "./messages/en-MY";

export type { MessageKey };

/**
 * Translates a message key with optional {placeholder} interpolation.
 * Unknown keys fall back to the key itself (and are type errors at compile time).
 */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const template: string | undefined = (enMY as Record<string, string>)[key];
  if (template === undefined) return key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}
