"use client";

import { useActionState } from "react";

import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import {
  archiveGroupAction,
  createCategoryAction,
  createGroupAction,
  createTagAction,
  deleteTagAction,
  renameCategoryAction,
  setCategoryArchivedAction,
  updateMerchantAction,
  type CatalogFormState,
} from "./actions";

export interface CatalogGroup {
  id: string;
  name: string;
  kind: "income" | "expense";
  archivedAt: string | null;
  categories: Array<{ id: string; name: string; isSystem: boolean; archivedAt: string | null }>;
}

export interface CatalogTag {
  id: string;
  name: string;
}

export interface CatalogMerchant {
  id: string;
  canonicalName: string;
  defaultCategoryId: string | null;
  aliasCount: number;
}

function useCatalogState() {
  return useActionState<CatalogFormState, FormData>(async (prev, formData) => {
    // Dispatch on the hidden `op` field so one state banner serves each panel.
    const op = formData.get("op");
    switch (op) {
      case "create-group":
        return createGroupAction(prev, formData);
      case "create-category":
        return createCategoryAction(prev, formData);
      case "rename-category":
        return renameCategoryAction(prev, formData);
      case "archive-category":
        return setCategoryArchivedAction(prev, formData);
      case "archive-group":
        return archiveGroupAction(prev, formData);
      case "create-tag":
        return createTagAction(prev, formData);
      case "delete-tag":
        return deleteTagAction(prev, formData);
      case "update-merchant":
        return updateMerchantAction(prev, formData);
      default:
        return prev;
    }
  }, null);
}

function StateBanner({ state }: { state: CatalogFormState }) {
  if (!state) return null;
  if (state.ok) return <Banner variant="positive">{state.data.message}</Banner>;
  return <Banner variant="risk">{state.error.message}</Banner>;
}

export function CategoriesCatalog({
  groups,
  tags,
  merchants,
  merchantTotal,
  merchantSearch,
  defaultTab,
}: {
  groups: CatalogGroup[];
  tags: CatalogTag[];
  merchants: CatalogMerchant[];
  merchantTotal: number;
  merchantSearch: string;
  defaultTab: string;
}) {
  const [state, action, pending] = useCatalogState();
  const activeCategories = groups
    .filter((g) => !g.archivedAt)
    .flatMap((g) =>
      g.categories.filter((c) => !c.archivedAt).map((c) => ({ ...c, groupName: g.name })),
    );

  return (
    <Tabs defaultValue={defaultTab}>
      <TabsList>
        <TabsTrigger value="categories">Categories</TabsTrigger>
        <TabsTrigger value="tags">Tags</TabsTrigger>
        <TabsTrigger value="merchants">Merchants</TabsTrigger>
      </TabsList>

      <div className="mt-3">
        <StateBanner state={state} />
      </div>

      <TabsContent value="categories" className="flex flex-col gap-5">
        <form action={action} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="op" value="create-group" />
          <label className="flex flex-col gap-1 text-[11.5px] font-medium text-ink-muted">
            New group
            <Input name="name" placeholder="e.g. Side projects" maxLength={60} required />
          </label>
          <label className="flex flex-col gap-1 text-[11.5px] font-medium text-ink-muted">
            Kind
            <Select name="kind" defaultValue="expense">
              <option value="expense">Expense</option>
              <option value="income">Income</option>
            </Select>
          </label>
          <Button type="submit" variant="secondary" disabled={pending}>
            Add group
          </Button>
        </form>

        {groups.map((group) => (
          <section
            key={group.id}
            aria-label={group.name}
            className="rounded-card border border-hairline bg-card p-4"
          >
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h3 className="text-[15px] font-semibold text-ink">{group.name}</h3>
              <Badge variant={group.kind === "income" ? "positive" : "neutral"}>{group.kind}</Badge>
              {group.archivedAt ? <Badge>Archived</Badge> : null}
              {!group.archivedAt ? (
                <form action={action} className="ml-auto">
                  <input type="hidden" name="op" value="archive-group" />
                  <input type="hidden" name="groupId" value={group.id} />
                  <Button type="submit" variant="ghost" size="sm" disabled={pending}>
                    Archive group
                  </Button>
                </form>
              ) : null}
            </div>
            <ul className="flex flex-col gap-2">
              {group.categories.map((category) => (
                <li key={category.id} className="flex flex-wrap items-center gap-2">
                  <form action={action} className="flex flex-1 items-center gap-2">
                    <input type="hidden" name="op" value="rename-category" />
                    <input type="hidden" name="categoryId" value={category.id} />
                    <Input
                      name="name"
                      defaultValue={category.name}
                      aria-label={`Rename ${category.name}`}
                      maxLength={60}
                      className="max-w-64"
                      disabled={Boolean(category.archivedAt)}
                    />
                    {!category.archivedAt ? (
                      <Button type="submit" variant="ghost" size="sm" disabled={pending}>
                        Rename
                      </Button>
                    ) : (
                      <Badge>Archived</Badge>
                    )}
                  </form>
                  <form action={action}>
                    <input type="hidden" name="op" value="archive-category" />
                    <input type="hidden" name="categoryId" value={category.id} />
                    <input
                      type="hidden"
                      name="archived"
                      value={category.archivedAt ? "false" : "true"}
                    />
                    <Button type="submit" variant="ghost" size="sm" disabled={pending}>
                      {category.archivedAt ? "Restore" : "Archive"}
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
            {!group.archivedAt ? (
              <form action={action} className="mt-3 flex items-center gap-2">
                <input type="hidden" name="op" value="create-category" />
                <input type="hidden" name="groupId" value={group.id} />
                <Input
                  name="name"
                  placeholder="Add category…"
                  aria-label={`Add category to ${group.name}`}
                  maxLength={60}
                  className="max-w-64"
                  required
                />
                <Button type="submit" variant="secondary" size="sm" disabled={pending}>
                  Add
                </Button>
              </form>
            ) : null}
          </section>
        ))}
        <p className="text-[13px] text-ink-muted">
          Archiving never touches history — archived categories keep every transaction they’re on.
        </p>
      </TabsContent>

      <TabsContent value="tags" className="flex flex-col gap-4">
        <form action={action} className="flex items-end gap-2">
          <input type="hidden" name="op" value="create-tag" />
          <label className="flex flex-col gap-1 text-[11.5px] font-medium text-ink-muted">
            New tag
            <Input name="name" placeholder="e.g. travel" maxLength={60} required />
          </label>
          <Button type="submit" variant="secondary" disabled={pending}>
            Add tag
          </Button>
        </form>
        <ul className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <li
              key={tag.id}
              className="flex items-center gap-1 rounded-chip bg-sunken px-3 py-1.5 text-[13px] text-ink"
            >
              #{tag.name}
              <form action={action}>
                <input type="hidden" name="op" value="delete-tag" />
                <input type="hidden" name="tagId" value={tag.id} />
                <button
                  type="submit"
                  aria-label={`Delete tag ${tag.name}`}
                  className="ml-1 text-ink-muted hover:text-risk"
                  disabled={pending}
                >
                  ×
                </button>
              </form>
            </li>
          ))}
          {tags.length === 0 ? <p className="text-[13px] text-ink-muted">No tags yet.</p> : null}
        </ul>
      </TabsContent>

      <TabsContent value="merchants" className="flex flex-col gap-3">
        <p className="text-[13px] text-ink-secondary">
          Merchants are normalized from statement descriptions — the original text always stays on
          the transaction. A default category applies automatically when you don’t pick one.
        </p>
        <form method="get" action="/settings/categories" className="flex items-end gap-2">
          <input type="hidden" name="tab" value="merchants" />
          <label className="flex flex-1 flex-col gap-1 text-[11.5px] font-medium text-ink-muted">
            Search merchants
            <Input name="mq" defaultValue={merchantSearch} placeholder="e.g. Grab" />
          </label>
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
        {merchantTotal > merchants.length ? (
          <p className="text-[13px] text-ink-muted">
            Showing the first {merchants.length} of {merchantTotal} matches — refine the search to
            find the rest.
          </p>
        ) : null}
        {merchants.map((merchant) => (
          <form
            key={merchant.id}
            action={action}
            className="flex flex-wrap items-end gap-2 rounded-card border border-hairline bg-card p-3"
          >
            <input type="hidden" name="op" value="update-merchant" />
            <input type="hidden" name="merchantId" value={merchant.id} />
            <label className="flex flex-col gap-1 text-[11.5px] font-medium text-ink-muted">
              Name
              <Input
                name="canonicalName"
                defaultValue={merchant.canonicalName}
                maxLength={60}
                className="w-56"
              />
            </label>
            <label className="flex flex-col gap-1 text-[11.5px] font-medium text-ink-muted">
              Default category
              <Select name="defaultCategoryId" defaultValue={merchant.defaultCategoryId ?? ""}>
                <option value="">None</option>
                {activeCategories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.groupName} · {category.name}
                  </option>
                ))}
              </Select>
            </label>
            <span className="pb-2 text-[11.5px] text-ink-muted">
              {merchant.aliasCount} statement variant(s)
            </span>
            <Button type="submit" variant="secondary" size="sm" disabled={pending}>
              Save
            </Button>
          </form>
        ))}
        {merchants.length === 0 ? (
          <p className="text-[13px] text-ink-muted">Merchants appear as you add transactions.</p>
        ) : null}
      </TabsContent>
    </Tabs>
  );
}
