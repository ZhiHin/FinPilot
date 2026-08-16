import type { Metadata } from "next";

import {
  CategoriesCatalog,
  type CatalogGroup,
  type CatalogMerchant,
  type CatalogTag,
} from "@/features/categories/catalog";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db/client";
import { categoriesService } from "@/server/services/categories";
import { merchantsService } from "@/server/services/merchants";
import { tagsService } from "@/server/services/tags";

export const metadata: Metadata = { title: "Categories & tags" };

export default async function CategoriesSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; mq?: string }>;
}) {
  const { user } = await requireUser();
  const params = await searchParams;
  const merchantSearch = params.mq?.trim() ?? "";
  const db = getDb();
  await categoriesService.ensureDefaults(db, user.id);
  const [groups, tags, merchants] = await Promise.all([
    categoriesService.listGroups(db, user.id, { includeArchived: true }),
    tagsService.list(db, user.id),
    merchantsService.list(db, user.id, merchantSearch || undefined),
  ]);

  const catalogGroups: CatalogGroup[] = groups.map((group) => ({
    id: group.id,
    name: group.name,
    kind: group.kind,
    archivedAt: group.archivedAt?.toISOString() ?? null,
    categories: group.categories.map((category) => ({
      id: category.id,
      name: category.name,
      isSystem: category.isSystem,
      archivedAt: category.archivedAt?.toISOString() ?? null,
    })),
  }));
  const catalogTags: CatalogTag[] = tags.map((tag) => ({ id: tag.id, name: tag.name }));
  const catalogMerchants: CatalogMerchant[] = merchants.slice(0, 100).map((merchant) => ({
    id: merchant.id,
    canonicalName: merchant.canonicalName,
    defaultCategoryId: merchant.defaultCategoryId,
    aliasCount: Array.isArray(merchant.aliases) ? merchant.aliases.length : 0,
  }));

  return (
    <CategoriesCatalog
      groups={catalogGroups}
      tags={catalogTags}
      merchants={catalogMerchants}
      merchantTotal={merchants.length}
      merchantSearch={merchantSearch}
      defaultTab={
        ["categories", "tags", "merchants"].includes(params.tab ?? "") ? params.tab! : "categories"
      }
    />
  );
}
