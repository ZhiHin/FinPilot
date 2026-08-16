"use client";

import { useState } from "react";

import { PrivacyToggle } from "@/components/shell/privacy-toggle";
import { AmountText } from "@/components/ui/amount-text";
import { Badge } from "@/components/ui/badge";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
  DrawerContent,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { PasswordInput } from "@/components/ui/password-input";
import { Progress } from "@/components/ui/progress";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { StatTile } from "@/components/ui/stat-tile";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <h2 className="text-[19px] font-semibold text-ink">{title}</h2>
      <div className="flex flex-wrap items-start gap-3">{children}</div>
    </section>
  );
}

export function ComponentGallery() {
  const { toast } = useToast();
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-10 px-6 py-10">
      <PageHeader
        title="Component gallery"
        description="Dev-only. Every base component with its states — light/dark via your theme."
        actions={<PrivacyToggle hideLabel="Hide amounts" showLabel="Show amounts" />}
      />

      <Section title="Buttons">
        <Button>Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="destructive">Destructive</Button>
        <Button disabled>Disabled</Button>
        <Button size="sm">Small</Button>
      </Section>

      <Section title="Amounts (privacy-aware, tabular numerals)">
        <AmountText amountMinor={852000} currency="MYR" className="text-[24px] font-semibold" />
        <AmountText amountMinor={-3250} currency="MYR" />
        <AmountText amountMinor={0} currency="MYR" />
      </Section>

      <Section title="Form controls">
        <div className="flex w-full max-w-sm flex-col gap-4">
          <FormField label="Email address" help="We never share this.">
            <Input type="email" placeholder="you@example.com" />
          </FormField>
          <FormField label="Password" errors={["Use at least 12 characters."]}>
            <PasswordInput />
          </FormField>
          <FormField label="Timezone">
            <Select defaultValue="Asia/Kuala_Lumpur">
              <option>Asia/Kuala_Lumpur</option>
              <option>Asia/Singapore</option>
            </Select>
          </FormField>
          <div className="flex items-center gap-3">
            <Switch id="demo-switch" defaultChecked aria-label="Demo switch" />
            <label htmlFor="demo-switch" className="text-[13px] text-ink-secondary">
              Switch
            </label>
          </div>
        </div>
      </Section>

      <Section title="Badges & banners">
        <Badge>Neutral</Badge>
        <Badge variant="info">Info</Badge>
        <Badge variant="positive">On track</Badge>
        <Badge variant="attention">Watch</Badge>
        <Badge variant="risk">Over</Badge>
        <div className="flex w-full flex-col gap-2">
          <Banner variant="info">Neutral information notice.</Banner>
          <Banner variant="positive">Something good happened.</Banner>
          <Banner variant="attention">Worth a look, no panic.</Banner>
          <Banner variant="risk">Something needs fixing.</Banner>
        </div>
      </Section>

      <Section title="Cards, tiles & progress">
        <StatTile label="Safe until payday" detail="Range: RM 980 – RM 1,310">
          <AmountText amountMinor={118000} currency="MYR" />
        </StatTile>
        <Card className="w-64">
          <CardHeader>
            <CardTitle>Card title</CardTitle>
          </CardHeader>
          <CardContent className="text-[13px] text-ink-secondary">Card content.</CardContent>
        </Card>
        <div className="w-64">
          <Progress value={67} label="Budget used" />
        </div>
      </Section>

      <Section title="Loading, empty & error states">
        <div className="flex w-56 flex-col gap-2">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-24 w-full" />
        </div>
        <EmptyState
          className="w-72"
          title="No transactions yet"
          description="Import a statement or add one manually."
          action={<Button variant="secondary">Import</Button>}
        />
        <ErrorState className="w-72" />
      </Section>

      <Section title="Overlays & feedback">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="secondary">Open dialog</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogTitle className="text-[15px] font-semibold text-ink">A dialog</DialogTitle>
            <p className="mt-2 text-[13px] text-ink-secondary">Escape or the ✕ closes it.</p>
          </DialogContent>
        </Dialog>
        <Dialog open={drawerOpen} onOpenChange={setDrawerOpen}>
          <Button variant="secondary" onClick={() => setDrawerOpen(true)}>
            Open drawer
          </Button>
          <DrawerContent>
            <DialogTitle className="text-[15px] font-semibold text-ink">A drawer</DialogTitle>
            <p className="mt-2 text-[13px] text-ink-secondary">
              Edits happen here without losing list context.
            </p>
          </DrawerContent>
        </Dialog>
        <Button variant="secondary" onClick={() => toast("Saved.", "positive")}>
          Show toast
        </Button>
      </Section>

      <Section title="Tabs">
        <Tabs defaultValue="one" className="w-full">
          <TabsList>
            <TabsTrigger value="one">Insights</TabsTrigger>
            <TabsTrigger value="two">Assistant</TabsTrigger>
            <TabsTrigger value="three">Queue</TabsTrigger>
          </TabsList>
          <TabsContent value="one" className="text-[13px] text-ink-secondary">
            Tab one content.
          </TabsContent>
          <TabsContent value="two" className="text-[13px] text-ink-secondary">
            Tab two content.
          </TabsContent>
          <TabsContent value="three" className="text-[13px] text-ink-secondary">
            Tab three content.
          </TabsContent>
        </Tabs>
      </Section>
    </div>
  );
}
