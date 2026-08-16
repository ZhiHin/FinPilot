# FinPilot — Design Direction & Token Proposal (Phase 0)

Brand mood: **clear, reassuring, intelligent, private, quietly premium.** A calm, trustworthy modern
finance experience — explicitly *not* a crypto trading dashboard and *not* a generic admin template.

All brand-identifying values (name, logo, primary hue) live in the token layer and one
`brand.ts`/`brand.css` pair so they can be replaced without touching components.

---

## 1. Design principles → visual decisions

| Principle | Visual consequence |
|---|---|
| Calm and trustworthy | Warm-grey canvas, generous whitespace, hairline borders, minimal shadows; red appears only for genuine risk/error |
| Quietly premium | One excellent variable font, disciplined type scale, 12–16px radii, no gradients-for-decoration, no 3D |
| Numbers are the product | Tabular numerals everywhere money appears; consistent right-alignment in tables; amounts never wrap |
| Explainability | Confidence chips, provenance labels, and "▸ why" affordances are first-class components, not afterthoughts |
| Never color alone | Every positive/negative/risk signal pairs color with an icon and a label |
| Accessible by default | WCAG 2.2 AA targets; visible focus ring token; reduced-motion variants; 44px minimum touch targets on mobile |

## 2. Token architecture

Three layers, exposed as CSS custom properties and mapped into Tailwind (v4 `@theme`):

1. **Primitives** — raw scales (`--grey-100…900`, `--navy-…`, `--emerald-…`, spacing, radii). Never
   used directly by components.
2. **Semantic tokens** — role-named (`--surface-card`, `--text-primary`, `--status-positive-text`).
   Components consume only these. Light/dark themes redefine this layer only.
3. **Component tokens** — only where a component needs local overrides (`--button-primary-bg`).

Dark theme is a **selected** palette (its own steps), not an automatic inversion. Theme switching:
`data-theme` attribute on `<html>` with `prefers-color-scheme` default, per the platform standard.

## 3. Color tokens (proposal)

Values are the Phase 0 proposal; Phase 1 verifies every text/background pair with automated contrast
checks before freezing. Targets: body text ≥ 4.5:1, large text/UI glyphs ≥ 3:1.

### Canvas & surfaces

| Token | Light | Dark | Use |
|---|---|---|---|
| `--surface-page` | `#F7F6F3` (soft warm grey) | `#0F1219` (deep navy-charcoal, not black) | App background |
| `--surface-card` | `#FDFDFC` | `#1A1E29` | Cards, panels, charts render here |
| `--surface-raised` | `#FFFFFF` | `#232838` | Drawers, dialogs, popovers |
| `--surface-sunken` | `#F1F0EC` | `#0B0E14` | Wells, input backgrounds, code |
| `--border-hairline` | `rgba(23,33,53,0.10)` | `rgba(255,255,255,0.10)` | Card & row separators |
| `--border-strong` | `rgba(23,33,53,0.22)` | `rgba(255,255,255,0.22)` | Inputs, focused rows |

### Text

| Token | Light | Dark |
|---|---|---|
| `--text-primary` | `#172135` (deep navy) | `#F2F4F8` |
| `--text-secondary` | `#4A5468` | `#B7BECD` |
| `--text-muted` | `#626C82` | `#8A92A4` |
| `--text-on-accent` | `#FFFFFF` | `#0F1219` (dark ink — white on the light-blue dark accent is ~2.5:1) |

### Brand & interaction

| Token | Light | Dark | Use |
|---|---|---|---|
| `--accent-primary` | `#2E4E85` (navy) | `#7FA3E0` | Primary buttons, links, active nav |
| `--accent-primary-hover` | `#263F6C` | `#94B3E8` | |
| `--accent-primary-soft` | `#E9EEF7` | `#243350` | Selected rows, active-tab wash |
| `--focus-ring` | `#2E4E85` 2px outline + 2px offset | `#7FA3E0` | Every focusable element |

### Semantic status (always icon + label + color, never color alone)

| Role | Light text-grade | Light soft bg | Dark text-grade | Use |
|---|---|---|---|---|
| `--status-positive` | `#0E7A4D` (restrained emerald) | `#E7F4EE` | `#4CC38A` | On-track, income, goal ahead |
| `--status-attention` | `#9A6208` (amber, text-grade) | `#FBF1DE` | `#E8B34B` | Pace warnings, needs review |
| `--status-risk` | `#B93438` (red — real risk/error only) | `#F9E9E9` | `#E5787B` | Low balance, over budget, errors |
| `--status-info` | `#2E4E85` | `#E9EEF7` | `#7FA3E0` | Neutral notices, demo banners |

Amount coloring rule: expenses render in `--text-primary` (not red — spending is normal, not an
error); income may use positive; risk color is reserved for genuinely risky states.

## 4. Chart palette (validated)

Charts follow the dataviz method: form first, color by job, fixed slot order, legend + table
alternative always. The categorical palette below was **run through the palette validator against
FinPilot's actual surfaces** (`#FDFDFC` light / `#1A1E29` dark) on 2026-08-16: all hard gates pass in
both modes (worst adjacent CVD ΔE 9.1 light / 8.4 dark; normal-vision floor 19.6 / 19.3).

| Slot | Hue | Light | Dark |
|---|---|---|---|
| 1 | blue | `#2A78D6` | `#3987E5` |
| 2 | orange | `#EB6834` | `#D95926` |
| 3 | aqua | `#1BAF7A` | `#199E70` |
| 4 | yellow | `#EDA100` | `#C98500` |
| 5 | magenta | `#E87BA4` | `#D55181` |
| 6 | green | `#008300` | `#008300` |
| 7 | violet | `#4A3AA7` | `#9085E9` |
| 8 | red | `#E34948` | `#E66767` |

Binding rules recorded from validation:

- **Relief rule (light mode):** slots 3, 4, 5 sit below 3:1 on the light surface — legal only with
  visible direct labels or the table view. FinPilot mandates table alternatives on every chart, and
  series ≥2 always get legends; keep direct labels on when these slots appear.
- **Series cap for all-pairs forms** (scatter, small multiples, choropleth): only the first three
  slots validate all-pairs; beyond three, fold to "Other" or facet.
- Categorical hues are assigned in fixed order per entity and never repainted when filters change.
- **Sequential** (heatmaps, cash-flow calendar intensity): single blue ramp `#CDE2FB → #0D366B`
  (ordinal starts no lighter than `#86B6EF` light / no darker than `#184F95` dark).
- **Diverging** (over/under budget variance, net cash flow): blue ↔ red with neutral grey midpoint
  (`#F0EFEC` light / `#383835` dark). Never a hue at the midpoint.
- **Chart status colors** (good `#0CA30C`, warning `#FAB219`, serious `#EC835A`, critical `#D03B3B`)
  are reserved for state, never reused as series colors, and always ship with icon + label.
- **One axis per chart.** No dual-axis charts anywhere in the product.
- Forecast bands: expected = solid line slot-1 blue; optimistic/conservative = translucent fill of
  the same hue; scenario overlays = dashed stroke, so "simulated" is visually distinct from "real."
- Texture fills (45°/135° lines) are available behind the accessibility setting and in print/
  forced-colors — never decorative.

## 5. Typography

- **One variable sans-serif for everything: Inter (variable)**, self-hosted via `next/font` (no
  external font CDN). Swappable brand parameter.
- Financial figures always set `font-variant-numeric: tabular-nums lining-nums` via the `.num`
  utility / `AmountText` component; column-aligned, never letter-spaced.
- Line length target 60–75ch for prose; UI text never justified.

| Token | Size / line height | Weight | Use |
|---|---|---|---|
| `--type-display` | 32 / 38 | 650 | Hero numbers (safe-to-spend, balances) |
| `--type-h1` | 24 / 30 | 600 | Page titles |
| `--type-h2` | 19 / 26 | 600 | Section/card titles |
| `--type-body` | 15 / 22 | 400 | Default text |
| `--type-body-strong` | 15 / 22 | 550 | Emphasized body |
| `--type-small` | 13 / 18 | 400 | Secondary detail, table meta |
| `--type-micro` | 11.5 / 16 | 500, +0.01em | Chips, overlines, axis labels |

## 6. Spacing, radii, elevation, motion

- **Spacing:** 8px base grid; scale `4, 8, 12, 16, 24, 32, 48, 64` (`--space-1…8`). 4px only for
  intra-component gaps.
- **Containers:** page max-width 1200px centered; content gutters 16px (mobile) / 24px (≥768) /
  32px (≥1024). Breakpoints: 360 / 768 / 1024 / 1440.
- **Radii:** `--radius-card: 14px`, `--radius-control: 10px`, `--radius-chip: 999px`,
  `--radius-drawer: 16px 0 0 16px`.
- **Elevation:** borders over shadows. `--shadow-card: none` (hairline border instead);
  `--shadow-raised: 0 8px 24px rgba(15,18,25,0.10)` for drawers/dialogs/popovers only.
- **Motion:** 150ms ease-out for micro-interactions, 220ms for drawers; everything honors
  `prefers-reduced-motion` (opacity-only fallbacks). No looping or attention-seeking animation.
- **Icons:** Lucide, single library, 16/20/24px grid, 1.5px stroke. **No emoji as UI icons.**
- **Focus:** always-visible 2px ring token with offset; never removed, never color-only.

## 7. Recurring UI behaviors (tokenized patterns)

- **Loading:** skeletons matching final layout (no spinners for primary content).
- **Empty states:** explain what the screen will show + one primary action; demo-mode banner uses
  `--status-info`.
- **Errors:** friendly message + retry; never raw provider/database text.
- **Optimistic UI** only where rollback is safe (categorize, tag, exclude — all soft operations with
  undo toast); imports and deletions are pessimistic with explicit confirmation.
- **Toasts:** sparse, single-stack, auto-dismiss, always paired with inline state change.
- **Privacy toggle:** `RM •••••` masking via `AmountText`, persisted per device; layout must not
  shift when toggled (mask preserves width).

## 8. Component inventory

### Base primitives (Phase 1 — built on shadcn/ui + Radix)

Button (primary/secondary/ghost/destructive) · IconButton · Input · CurrencyInput (minor-units,
locale formatting, never `type=number` float) · Select · Combobox · DatePicker / DateRangePicker ·
Checkbox · RadioGroup · Switch · Slider · FormField (label + help + error wiring) · Dialog ·
Drawer/Sheet (right on desktop, full-screen on mobile) · Popover · Tooltip · Tabs · Accordion ·
Badge/Chip · Banner/Callout · Toast · Progress (bar + pace variant) · Skeleton · EmptyState ·
ErrorState · Card · DataTable (sortable, cursor-paginated, row-selection, sticky header, mobile
card-group variant) · CommandPalette (⌘K) · AppShell (sidebar + topbar + mobile bottom nav) ·
PageHeader · StatTile · AmountText (tabular nums, sign/label pairing, privacy masking) ·
ConfidenceChip (High/Medium/Low + source: user/rule/model/AI) · VisuallyHidden · SkipLink

### Domain components (built in their feature phases, from primitives)

SafeToSpendMeter (+ reservation breakdown drawer) · ForecastChart (3 bands + scenario overlay +
table alt) · InsightCard (conclusion/period/contributors/Δ/confidence/warnings/calculation drawer/
actions) · EvidenceDrawer ("How this was calculated") · TransactionRow + TransactionDrawer ·
SplitEditor · CategoryChip · AccountBadge · RuleBuilder (condition rows + preview) · BudgetRow
(pace-aware progress) · SuggestionCard (approve/edit/dismiss/snooze + reason) · GoalCard +
WhatIfControls · RecurringRow (+ evidence expander) · BillCalendar · ImportStepper + MappingTable +
IssueList · ScenarioEventEditor · ComparePanel · JournalAnnotation · NotificationItem ·
AIAnswerCard (conclusion/evidence/filters-used/assumptions/notice/actions) · PrivacyModeBanner

Rule: build the primitive the first time a pattern would otherwise be repeated; no copy-paste
variants of the same UI.
