"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { ok, type Result } from "@/lib/result";
import { zodToErr } from "@/lib/zod";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";
import { categoriesService } from "@/server/services/categories";
import { merchantsService } from "@/server/services/merchants";
import { tagsService } from "@/server/services/tags";

export type CatalogFormState = Result<{ message?: string }> | null;

const name = z.string().trim().min(1, "Enter a name.").max(60, "Keep it under 60 characters.");

function done(message: string): CatalogFormState {
  revalidatePath("/settings/categories");
  revalidatePath("/transactions");
  return ok({ message });
}

export async function createGroupAction(
  _prev: CatalogFormState,
  formData: FormData,
): Promise<CatalogFormState> {
  const { user } = await requireUser();
  const parsed = z
    .object({ name, kind: z.enum(["income", "expense"]) })
    .safeParse({ name: formData.get("name"), kind: formData.get("kind") });
  if (!parsed.success) return zodToErr(parsed.error);
  const result = await categoriesService.createGroup(getDb(), user.id, parsed.data);
  return result.ok ? done("Group created.") : result;
}

export async function createCategoryAction(
  _prev: CatalogFormState,
  formData: FormData,
): Promise<CatalogFormState> {
  const { user } = await requireUser();
  const parsed = z
    .object({ groupId: z.string().uuid(), name })
    .safeParse({ groupId: formData.get("groupId"), name: formData.get("name") });
  if (!parsed.success) return zodToErr(parsed.error);
  const result = await categoriesService.createCategory(getDb(), user.id, parsed.data);
  return result.ok ? done("Category created.") : result;
}

export async function renameCategoryAction(
  _prev: CatalogFormState,
  formData: FormData,
): Promise<CatalogFormState> {
  const { user } = await requireUser();
  const parsed = z
    .object({ categoryId: z.string().uuid(), name })
    .safeParse({ categoryId: formData.get("categoryId"), name: formData.get("name") });
  if (!parsed.success) return zodToErr(parsed.error);
  const result = await categoriesService.updateCategory(getDb(), user.id, parsed.data.categoryId, {
    name: parsed.data.name,
  });
  return result.ok ? done("Category renamed.") : result;
}

export async function setCategoryArchivedAction(
  _prev: CatalogFormState,
  formData: FormData,
): Promise<CatalogFormState> {
  const { user } = await requireUser();
  const parsed = z
    .object({ categoryId: z.string().uuid(), archived: z.enum(["true", "false"]) })
    .safeParse({ categoryId: formData.get("categoryId"), archived: formData.get("archived") });
  if (!parsed.success) return zodToErr(parsed.error);
  const result = await categoriesService.setCategoryArchived(
    getDb(),
    user.id,
    parsed.data.categoryId,
    parsed.data.archived === "true",
  );
  return result.ok
    ? done(
        parsed.data.archived === "true"
          ? "Category archived — history is preserved."
          : "Category restored.",
      )
    : result;
}

export async function archiveGroupAction(
  _prev: CatalogFormState,
  formData: FormData,
): Promise<CatalogFormState> {
  const { user } = await requireUser();
  const parsed = z
    .object({ groupId: z.string().uuid() })
    .safeParse({ groupId: formData.get("groupId") });
  if (!parsed.success) return zodToErr(parsed.error);
  const result = await categoriesService.archiveGroup(getDb(), user.id, parsed.data.groupId);
  return result.ok ? done("Group archived with its categories — history is preserved.") : result;
}

export async function createTagAction(
  _prev: CatalogFormState,
  formData: FormData,
): Promise<CatalogFormState> {
  const { user } = await requireUser();
  const parsed = z.object({ name }).safeParse({ name: formData.get("name") });
  if (!parsed.success) return zodToErr(parsed.error);
  const result = await tagsService.create(getDb(), user.id, parsed.data);
  return result.ok ? done("Tag created.") : result;
}

export async function deleteTagAction(
  _prev: CatalogFormState,
  formData: FormData,
): Promise<CatalogFormState> {
  const { user } = await requireUser();
  const parsed = z.object({ tagId: z.string().uuid() }).safeParse({ tagId: formData.get("tagId") });
  if (!parsed.success) return zodToErr(parsed.error);
  const result = await tagsService.softDelete(getDb(), user.id, parsed.data.tagId);
  return result.ok ? done("Tag deleted.") : result;
}

export async function updateMerchantAction(
  _prev: CatalogFormState,
  formData: FormData,
): Promise<CatalogFormState> {
  const { user } = await requireUser();
  const parsed = z
    .object({
      merchantId: z.string().uuid(),
      canonicalName: name,
      defaultCategoryId: z.string().uuid().optional().or(z.literal("")),
    })
    .safeParse({
      merchantId: formData.get("merchantId"),
      canonicalName: formData.get("canonicalName"),
      defaultCategoryId: (formData.get("defaultCategoryId") as string) ?? "",
    });
  if (!parsed.success) return zodToErr(parsed.error);
  const result = await merchantsService.update(getDb(), user.id, parsed.data.merchantId, {
    canonicalName: parsed.data.canonicalName,
    defaultCategoryId: parsed.data.defaultCategoryId || null,
  });
  return result.ok ? done("Merchant saved.") : result;
}
