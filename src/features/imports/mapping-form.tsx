"use client";

import { useActionState, useState } from "react";

import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

import { applyMappingAction, type ImportFormState } from "./actions";
import { BUILTIN_PROFILE_TEMPLATES, type ImportMappingInput } from "./builtin-profiles";

export interface SavedProfileOption {
  id: string;
  name: string;
  mapping: ImportMappingInput;
}

const DATE_FORMATS = [
  { value: "auto", label: "Detect automatically" },
  { value: "dd/mm/yyyy", label: "31/12/2026 (day first)" },
  { value: "yyyy-mm-dd", label: "2026-12-31 (ISO)" },
  { value: "mm/dd/yyyy", label: "12/31/2026 (month first)" },
  { value: "dd mmm yyyy", label: "31 Dec 2026" },
] as const;

export function MappingForm({
  jobId,
  preview,
  suggested,
  profiles,
}: {
  jobId: string;
  preview: string[][];
  suggested: ImportMappingInput;
  profiles: SavedProfileOption[];
}) {
  const [state, formAction, pending] = useActionState<ImportFormState, FormData>(
    applyMappingAction,
    null,
  );
  const columnCount = Math.max(...preview.map((row) => row.length), 1);
  const columns = Array.from({ length: columnCount }, (_, i) => i);
  const columnLabel = (index: number) =>
    preview[0]?.[index] ? `${index + 1} — ${preview[0][index]}` : `Column ${index + 1}`;

  const [mapping, setMapping] = useState<ImportMappingInput>({
    headerRows: 1,
    dateFormat: suggested.dateFormat ?? "auto",
    dateColumn: suggested.dateColumn ?? 0,
    descriptionColumn: suggested.descriptionColumn ?? 1,
    amountColumn: suggested.amountColumn,
    debitColumn: suggested.debitColumn,
    creditColumn: suggested.creditColumn,
  });
  const amountMode: "single" | "debitcredit" =
    mapping.debitColumn !== undefined ? "debitcredit" : "single";
  const [profileId, setProfileId] = useState("");

  const applyTemplate = (template: ImportMappingInput, savedProfileId = "") => {
    setMapping(template);
    setProfileId(savedProfileId);
  };

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
      {state && !state.ok ? <Banner variant="risk">{state.error.message}</Banner> : null}
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="amountMode" value={amountMode} />
      <input type="hidden" name="profileId" value={profileId} />

      {/* Preview */}
      <div className="overflow-x-auto rounded-card border border-hairline bg-card">
        <table className="w-full text-[11.5px]">
          <tbody>
            {preview.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-b border-hairline last:border-0">
                <td className="bg-sunken px-2 py-1 text-ink-muted">{rowIndex + 1}</td>
                {columns.map((col) => (
                  <td key={col} className="max-w-40 truncate px-2 py-1 text-ink-secondary">
                    {row[col] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <FormField label="Start from a template or saved profile">
        <Select
          value={profileId || ""}
          onChange={(e) => {
            const value = e.target.value;
            const saved = profiles.find((p) => p.id === value);
            if (saved) applyTemplate(saved.mapping, saved.id);
            else {
              const template = BUILTIN_PROFILE_TEMPLATES.find((t) => t.key === value);
              if (template) applyTemplate(template.mapping);
            }
          }}
        >
          <option value="">Manual mapping</option>
          {profiles.length > 0 ? (
            <optgroup label="Your saved profiles">
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </optgroup>
          ) : null}
          <optgroup label="Templates (synthetic formats)">
            {BUILTIN_PROFILE_TEMPLATES.map((template) => (
              <option key={template.key} value={template.key}>
                {template.name}
              </option>
            ))}
          </optgroup>
        </Select>
      </FormField>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <FormField label="Date column">
          <Select
            name="dateColumn"
            value={String(mapping.dateColumn)}
            onChange={(e) => setMapping({ ...mapping, dateColumn: Number(e.target.value) })}
          >
            {columns.map((col) => (
              <option key={col} value={col}>
                {columnLabel(col)}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Description column">
          <Select
            name="descriptionColumn"
            value={String(mapping.descriptionColumn)}
            onChange={(e) => setMapping({ ...mapping, descriptionColumn: Number(e.target.value) })}
          >
            {columns.map((col) => (
              <option key={col} value={col}>
                {columnLabel(col)}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Date format">
          <Select
            name="dateFormat"
            value={mapping.dateFormat}
            onChange={(e) =>
              setMapping({
                ...mapping,
                dateFormat: e.target.value as ImportMappingInput["dateFormat"],
              })
            }
          >
            {DATE_FORMATS.map((format) => (
              <option key={format.value} value={format.value}>
                {format.label}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Header rows to skip">
          <Select
            name="headerRows"
            value={String(mapping.headerRows)}
            onChange={(e) => setMapping({ ...mapping, headerRows: Number(e.target.value) })}
          >
            {[0, 1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </FormField>
      </div>

      <fieldset className="flex flex-col gap-3 rounded-card border border-hairline p-3">
        <legend className="px-1 text-[13px] font-medium text-ink-secondary">Amounts</legend>
        <div className="flex gap-4 text-[13px] text-ink-secondary">
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              checked={amountMode === "single"}
              onChange={() =>
                setMapping({
                  ...mapping,
                  amountColumn: mapping.amountColumn ?? 2,
                  debitColumn: undefined,
                  creditColumn: undefined,
                })
              }
              className="accent-[var(--accent-primary)]"
            />
            One signed amount column
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="radio"
              checked={amountMode === "debitcredit"}
              onChange={() =>
                setMapping({
                  ...mapping,
                  amountColumn: undefined,
                  debitColumn: mapping.debitColumn ?? 2,
                  creditColumn: mapping.creditColumn ?? 3,
                })
              }
              className="accent-[var(--accent-primary)]"
            />
            Separate debit / credit columns
          </label>
        </div>
        {amountMode === "single" ? (
          <FormField label="Amount column">
            <Select
              name="amountColumn"
              value={String(mapping.amountColumn ?? 2)}
              onChange={(e) => setMapping({ ...mapping, amountColumn: Number(e.target.value) })}
            >
              {columns.map((col) => (
                <option key={col} value={col}>
                  {columnLabel(col)}
                </option>
              ))}
            </Select>
          </FormField>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Debit column (money out)">
              <Select
                name="debitColumn"
                value={String(mapping.debitColumn ?? 2)}
                onChange={(e) => setMapping({ ...mapping, debitColumn: Number(e.target.value) })}
              >
                {columns.map((col) => (
                  <option key={col} value={col}>
                    {columnLabel(col)}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Credit column (money in)">
              <Select
                name="creditColumn"
                value={String(mapping.creditColumn ?? 3)}
                onChange={(e) => setMapping({ ...mapping, creditColumn: Number(e.target.value) })}
              >
                {columns.map((col) => (
                  <option key={col} value={col}>
                    {columnLabel(col)}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
        )}
      </fieldset>

      <FormField
        label="Save this mapping as a profile (optional)"
        help="Reusable next time you import this statement format."
      >
        <Input name="saveProfileName" placeholder="e.g. Maybank current" maxLength={60} />
      </FormField>

      <Button type="submit" disabled={pending} className="self-start">
        {pending ? "Checking…" : "Check rows"}
      </Button>
    </form>
  );
}
