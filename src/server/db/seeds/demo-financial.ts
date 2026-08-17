import { localDateInTz } from "@/lib/dates";
import { uuidv7 } from "@/lib/ids";
import { isOk } from "@/lib/result";

import type { Db } from "../client";
import { auditRepo } from "../repositories/audit";
import { transactions } from "../schema";
import { accountsService, type AccountRow } from "../../services/accounts";
import { budgetsService } from "../../services/budgets";
import { categoriesService } from "../../services/categories";
import { goalsService } from "../../services/goals";
import { merchantsService } from "../../services/merchants";
import { transactionsService } from "../../services/transactions";
import { DEMO_USER, seedDemo } from "./demo";

/**
 * The Aisyah demo financial dataset (spec §7): eight full months of synthetic
 * Malaysian activity ending last month, with the documented edge cases baked in.
 * Deterministic (seeded RNG, fixed reference date in tests), idempotent
 * (skipped when the demo user already has accounts), and fast (special cases go
 * through the services; plain spending is bulk-inserted — database constraints
 * and triggers still apply to every row).
 */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface MonthRef {
  year: number;
  month: number; // 1-12
  days: number;
  key: string; // YYYY-MM
}

function monthOf(dateIso: string, offsetMonths: number): MonthRef {
  const [y, m] = dateIso.split("-").map(Number);
  const total = y * 12 + (m - 1) + offsetMonths;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { year, month, days, key: `${year}-${String(month).padStart(2, "0")}` };
}

function day(ref: MonthRef, d: number): string {
  return `${ref.key}-${String(Math.min(d, ref.days)).padStart(2, "0")}`;
}

/** Salary lands on the 25th, moved before a weekend (spec: weekend-adjusted). */
function paydayOf(ref: MonthRef): string {
  const date = new Date(Date.UTC(ref.year, ref.month - 1, 25));
  const dow = date.getUTCDay();
  const dayNum = dow === 6 ? 24 : dow === 0 ? 23 : 25;
  return day(ref, dayNum);
}

interface PoolMerchant {
  name: string;
  category: string;
  min: number; // sen
  max: number;
  account: "current" | "tng" | "grabpay" | "card";
  weight: number;
}

const MERCHANT_POOL: PoolMerchant[] = [
  {
    name: "GrabFood",
    category: "Food delivery",
    min: 1500,
    max: 4500,
    account: "grabpay",
    weight: 8,
  },
  {
    name: "foodpanda",
    category: "Food delivery",
    min: 1600,
    max: 4800,
    account: "card",
    weight: 5,
  },
  { name: "Mamak Corner", category: "Eating out", min: 800, max: 2500, account: "tng", weight: 10 },
  { name: "Kopitiam 88", category: "Eating out", min: 900, max: 3200, account: "tng", weight: 6 },
  {
    name: "ZUS Coffee",
    category: "Coffee & snacks",
    min: 900,
    max: 1900,
    account: "tng",
    weight: 7,
  },
  {
    name: "Village Grocer",
    category: "Groceries",
    min: 3500,
    max: 18000,
    account: "card",
    weight: 5,
  },
  { name: "99 Speedmart", category: "Groceries", min: 800, max: 6000, account: "tng", weight: 6 },
  { name: "Grab", category: "E-hailing", min: 700, max: 3500, account: "grabpay", weight: 7 },
  { name: "Setel", category: "Petrol", min: 4000, max: 9000, account: "card", weight: 4 },
  {
    name: "Touch n Go Toll",
    category: "Parking & tolls",
    min: 250,
    max: 1400,
    account: "tng",
    weight: 5,
  },
  {
    name: "Shopee",
    category: "Online shopping",
    min: 1500,
    max: 22000,
    account: "card",
    weight: 5,
  },
  {
    name: "Lazada",
    category: "Online shopping",
    min: 1800,
    max: 18000,
    account: "card",
    weight: 3,
  },
  { name: "Guardian", category: "Pharmacy", min: 1000, max: 6000, account: "card", weight: 2 },
  {
    name: "GSC Cinemas",
    category: "Movies & events",
    min: 1800,
    max: 5200,
    account: "card",
    weight: 2,
  },
  { name: "Mr DIY", category: "Home & furniture", min: 500, max: 4000, account: "tng", weight: 2 },
];

interface RecurringSpec {
  description: string;
  merchant: string | null;
  category: string;
  amount: number; // sen, positive magnitude
  day: number;
  account: "current" | "card";
  type?: "expense" | "debt_payment";
}

const RECURRING: RecurringSpec[] = [
  {
    description: "RENT SETIA SKY",
    merchant: null,
    category: "Rent",
    amount: 160000,
    day: 1,
    account: "current",
  },
  {
    description: "UNIFI HOME",
    merchant: "Unifi",
    category: "Internet & phone",
    amount: 12900,
    day: 5,
    account: "current",
  },
  {
    description: "HOTLINK POSTPAID",
    merchant: "Hotlink",
    category: "Internet & phone",
    amount: 6000,
    day: 8,
    account: "current",
  },
  {
    description: "NETFLIX.COM",
    merchant: "Netflix",
    category: "Streaming & subscriptions",
    amount: 5490,
    day: 12,
    account: "card",
  },
  {
    description: "APPLE.COM/BILL ICLOUD",
    merchant: "Apple iCloud",
    category: "Streaming & subscriptions",
    amount: 1190,
    day: 18,
    account: "card",
  },
  {
    description: "FITNESS FIRST",
    merchant: "Fitness First",
    category: "Fitness",
    amount: 12900,
    day: 3,
    account: "card",
  },
  {
    description: "PTPTN LOAN",
    merchant: null,
    category: "Loan payment",
    amount: 20000,
    day: 27,
    account: "current",
    type: "debt_payment",
  },
];

export async function seedDemoFinancial(
  db: Db,
  opts: { today?: string } = {},
): Promise<{ created: boolean; transactionCount: number; months: string[] }> {
  await seedDemo(db);
  const userId = DEMO_USER.id;

  const existing = await accountsService.list(db, userId, { includeArchived: true });
  if (existing.length > 0) {
    return { created: false, transactionCount: 0, months: [] };
  }

  const today = opts.today ?? localDateInTz(new Date(), "Asia/Kuala_Lumpur");
  const rng = mulberry32(20260816);
  const randInt = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1));
  const pickWeighted = <T extends { weight: number }>(pool: T[]): T => {
    const total = pool.reduce((a, p) => a + p.weight, 0);
    let roll = rng() * total;
    for (const item of pool) {
      roll -= item.weight;
      if (roll <= 0) return item;
    }
    return pool[pool.length - 1];
  };

  // Eight full months ending last month; the current month holds only the pending edge cases.
  const months = Array.from({ length: 8 }, (_, i) => monthOf(today, -8 + i));
  const firstDay = day(months[0], 1);

  /* ------------------------------- accounts ------------------------------- */
  const mk = async (input: Parameters<typeof accountsService.create>[2]): Promise<AccountRow> => {
    const result = await accountsService.create(db, userId, input);
    if (!isOk(result)) throw new Error(`demo account failed: ${JSON.stringify(result.error)}`);
    return result.data;
  };
  const current = await mk({
    name: "Maybank current",
    type: "current",
    openingBalanceMinor: 485000,
    openingBalanceDate: firstDay,
  });
  await mk({
    name: "Maybank savings",
    type: "savings",
    openingBalanceMinor: 1200000,
    openingBalanceDate: firstDay,
  });
  const tng = await mk({
    name: "TnG eWallet",
    type: "ewallet",
    openingBalanceMinor: 18000,
    openingBalanceDate: firstDay,
  });
  const grabpay = await mk({
    name: "GrabPay",
    type: "ewallet",
    openingBalanceMinor: 4500,
    openingBalanceDate: firstDay,
  });
  const card = await mk({
    name: "Visa credit card",
    type: "credit_card",
    openingBalanceMinor: -68000,
    openingBalanceDate: firstDay,
    creditLimitMinor: 800000,
  });
  await mk({
    name: "ASB investment",
    type: "investment",
    openingBalanceMinor: 1500000,
    openingBalanceDate: firstDay,
    includeInNetWorth: true,
  });
  await mk({
    name: "PTPTN loan",
    type: "loan",
    openingBalanceMinor: -1840000,
    openingBalanceDate: firstDay,
  });

  const accountByKey = { current, tng, grabpay, card } as const;

  /* ------------------------- categories & merchants ------------------------ */
  await categoriesService.ensureDefaults(db, userId);
  const groups = await categoriesService.listGroups(db, userId);
  const categoryByName = new Map<string, string>();
  for (const group of groups) {
    for (const category of group.categories) categoryByName.set(category.name, category.id);
  }
  const cat = (name: string): string => {
    const id = categoryByName.get(name);
    if (!id) throw new Error(`demo seed: missing default category "${name}"`);
    return id;
  };

  const merchantIdByName = new Map<string, string>();
  for (const pm of MERCHANT_POOL) {
    const merchant = await merchantsService.findOrCreate(db, userId, pm.name);
    if (merchant) {
      await merchantsService.update(db, userId, merchant.id, {
        defaultCategoryId: cat(pm.category),
      });
      merchantIdByName.set(pm.name, merchant.id);
    }
  }
  for (const spec of RECURRING) {
    if (spec.merchant && !merchantIdByName.has(spec.merchant)) {
      const merchant = await merchantsService.findOrCreate(db, userId, spec.merchant);
      if (merchant) merchantIdByName.set(spec.merchant, merchant.id);
    }
  }
  const spotify = await merchantsService.findOrCreate(db, userId, "Spotify");
  const spayLater = await merchantsService.findOrCreate(db, userId, "SPayLater");

  /* ------------------------------ bulk rows -------------------------------- */
  type BulkRow = typeof transactions.$inferInsert;
  const rows: BulkRow[] = [];
  const bulk = (row: Omit<BulkRow, "id" | "userId" | "currency">) => {
    rows.push({ id: uuidv7(), userId, currency: "MYR", ...row });
  };

  const lastFullMonth = months[months.length - 1];
  for (const [index, month] of months.entries()) {
    // Salary + recurring commitments.
    bulk({
      accountId: current.id,
      type: "income",
      status: "posted",
      amountMinor: 520000,
      txnDate: paydayOf(month),
      descriptionOriginal: "SALARY CREDIT ADV DESIGN SDN BHD",
      categoryId: cat("Salary"),
      categorizationSource: "default",
    });
    for (const spec of RECURRING) {
      bulk({
        accountId: accountByKey[spec.account].id,
        type: spec.type ?? "expense",
        status: "posted",
        amountMinor: -spec.amount,
        txnDate: day(month, spec.day),
        descriptionOriginal: spec.description,
        merchantId: spec.merchant ? (merchantIdByName.get(spec.merchant) ?? null) : null,
        categoryId: cat(spec.category),
        categorizationSource: "default",
      });
    }
    // Spotify with a mid-series price increase (RM16.90 → RM23.90 from month index 5).
    bulk({
      accountId: card.id,
      type: "expense",
      status: "posted",
      amountMinor: index >= 5 ? -2390 : -1690,
      txnDate: day(month, 15),
      descriptionOriginal: "SPOTIFY P2E4A8",
      merchantId: spotify?.id ?? null,
      categoryId: cat("Streaming & subscriptions"),
      categorizationSource: "default",
    });
    // BNPL phone installment ×6 from month 2 (spec: 4 observed by end of data, 2 remaining).
    if (index >= 2 && index < 8 && index - 2 < 6) {
      bulk({
        accountId: card.id,
        type: "expense",
        status: "posted",
        amountMinor: -29158,
        txnDate: day(month, 6),
        descriptionOriginal: "SPAYLATER INSTALMENT 4821",
        merchantId: spayLater?.id ?? null,
        categoryId: cat("Electronics"),
        categorizationSource: "default",
      });
    }
    // Annual car insurance, once.
    if (index === 3) {
      bulk({
        accountId: current.id,
        type: "expense",
        status: "posted",
        amountMinor: -138000,
        txnDate: day(month, 20),
        descriptionOriginal: "ETIQA MOTOR TAKAFUL",
        categoryId: cat("Insurance"),
        categorizationSource: "default",
      });
    }
    // Freelance payment, once.
    if (index === 4) {
      bulk({
        accountId: current.id,
        type: "income",
        status: "posted",
        amountMinor: 130000,
        txnDate: day(month, 11),
        descriptionOriginal: "DUITNOW CR FREELANCE LOGO",
        categoryId: cat("Freelance & side income"),
        categorizationSource: "default",
      });
    }
    // Travel cluster month (spec: an annotated one-off month; annotation itself is Phase 9).
    if (index === 4) {
      bulk({
        accountId: card.id,
        type: "expense",
        status: "posted",
        amountMinor: -89000,
        txnDate: day(month, 8),
        descriptionOriginal: "AIRASIA BER8821",
        categoryId: cat("Travel"),
        categorizationSource: "default",
      });
      bulk({
        accountId: card.id,
        type: "expense",
        status: "posted",
        amountMinor: -56000,
        txnDate: day(month, 9),
        descriptionOriginal: "AGODA HOTEL PENANG",
        categoryId: cat("Travel"),
        categorizationSource: "default",
      });
      bulk({
        accountId: card.id,
        type: "expense",
        status: "posted",
        amountMinor: -12500,
        txnDate: day(month, 10),
        descriptionOriginal: "KLOOK ACTIVITIES",
        categoryId: cat("Travel"),
        categorizationSource: "default",
      });
    }

    // Variable daily spending.
    const variableCount = randInt(88, 108);
    for (let i = 0; i < variableCount; i += 1) {
      const pm = pickWeighted(MERCHANT_POOL);
      bulk({
        accountId: accountByKey[pm.account].id,
        type: "expense",
        status: "posted",
        amountMinor: -randInt(pm.min, pm.max),
        txnDate: day(month, randInt(1, month.days)),
        descriptionOriginal: `${pm.name.toUpperCase()}*${randInt(100, 999)}`,
        merchantId: merchantIdByName.get(pm.name) ?? null,
        categoryId: cat(pm.category),
        categorizationSource: "default",
      });
    }
    // Final full month: food delivery steps up (the canonical +23% insight).
    if (month === lastFullMonth) {
      for (let i = 0; i < 11; i += 1) {
        bulk({
          accountId: grabpay.id,
          type: "expense",
          status: "posted",
          amountMinor: -randInt(2600, 4600),
          txnDate: day(month, randInt(2, month.days)),
          descriptionOriginal: "GRABFOOD*STEPUP",
          merchantId: merchantIdByName.get("GrabFood") ?? null,
          categoryId: cat("Food delivery"),
          categorizationSource: "default",
        });
      }
    }
  }

  // Edge case: the exact-duplicate pair (possible duplicate for the review flow).
  const dupMonth = months[6];
  for (let i = 0; i < 2; i += 1) {
    bulk({
      accountId: tng.id,
      type: "expense",
      status: "posted",
      amountMinor: -1290,
      txnDate: day(dupMonth, 14),
      descriptionOriginal: "ZUS COFFEE*DUP",
      merchantId: merchantIdByName.get("ZUS Coffee") ?? null,
      categoryId: cat("Coffee & snacks"),
      categorizationSource: "default",
    });
  }
  // Edge case: uncategorized rows waiting in Needs review.
  const reviewMonth = months[7];
  for (const [i, desc] of [
    "POS XFR 88123",
    "DUITNOW QR 5511",
    "IBG PYMT 7719",
    "POS RETAIL 1044",
  ].entries()) {
    bulk({
      accountId: current.id,
      type: "expense",
      status: "posted",
      amountMinor: -randInt(1500, 9500),
      txnDate: day(reviewMonth, 3 + i * 5),
      descriptionOriginal: desc,
      needsReview: true,
      categorizationSource: "user",
    });
  }

  const CHUNK = 250;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.insert(transactions).values(rows.slice(i, i + CHUNK));
  }

  /* -------------------- service-created edge cases ------------------------- */
  let serviceCount = 0;
  const must = <T>(r: { ok: true; data: T } | { ok: false; error: unknown }, label: string): T => {
    if (!r.ok) throw new Error(`demo seed ${label} failed: ${JSON.stringify(r.error)}`);
    return r.data;
  };

  // Monthly e-wallet top-up + credit card payment as real linked transfers.
  for (const month of months) {
    must(
      await transactionsService.createTransfer(db, userId, {
        fromAccountId: current.id,
        toAccountId: tng.id,
        amountMinor: 10000,
        txnDate: day(month, 2),
      }),
      "tng top-up",
    );
    must(
      await transactionsService.createTransfer(db, userId, {
        fromAccountId: current.id,
        toAccountId: card.id,
        amountMinor: 80000,
        txnDate: day(month, 28),
      }),
      "card payment",
    );
    serviceCount += 4;
  }

  // Refund pair (Shopee return), linked.
  const purchase = must(
    await transactionsService.create(db, userId, {
      accountId: card.id,
      type: "expense",
      amountMinor: -45000,
      txnDate: day(months[5], 9),
      description: "SHOPEE *ORDER 55021",
      merchantName: "Shopee",
      categoryId: cat("Online shopping"),
    }),
    "refund purchase",
  );
  const refund = must(
    await transactionsService.create(db, userId, {
      accountId: card.id,
      type: "refund",
      amountMinor: 45000,
      txnDate: day(months[5], 14),
      description: "SHOPEE REFUND 55021",
      merchantName: "Shopee",
      categoryId: cat("Online shopping"),
    }),
    "refund credit",
  );
  must(
    await transactionsService.linkRefund(db, userId, {
      refundTransactionId: refund.transaction.id,
      purchaseTransactionId: purchase.transaction.id,
    }),
    "refund link",
  );
  serviceCount += 2;

  // Split Shopee order, partly reimbursable.
  must(
    await transactionsService.create(db, userId, {
      accountId: card.id,
      type: "expense",
      amountMinor: -12900,
      txnDate: day(months[6], 21),
      description: "SHOPEE *ORDER 61103",
      merchantName: "Shopee",
      splits: [
        { categoryId: cat("Groceries"), amountMinor: -9900 },
        { categoryId: cat("Electronics"), amountMinor: -3000, isReimbursable: true },
      ],
    }),
    "split",
  );
  serviceCount += 1;

  // Cash-style adjustment on the e-wallet.
  must(
    await transactionsService.create(db, userId, {
      accountId: tng.id,
      type: "adjustment",
      amountMinor: -230,
      txnDate: day(months[7], 25),
      description: "Balance correction after top-up mismatch",
    }),
    "adjustment",
  );
  serviceCount += 1;

  // Three pending transactions in the current (partial) month — never food delivery,
  // so the delivery step-up stays a clean month-over-month comparison.
  const [ty, tm, td] = today.split("-").map(Number);
  const currentMonth = {
    year: ty,
    month: tm,
    days: new Date(Date.UTC(ty, tm, 0)).getUTCDate(),
    key: `${ty}-${String(tm).padStart(2, "0")}`,
  };
  const pendingDay = Math.max(1, td - 1);
  const pendingSpecs = [
    {
      accountId: card.id,
      description: "VILLAGE GROCER 003",
      merchant: "Village Grocer",
      category: "Groceries",
      amount: -8420,
    },
    {
      accountId: card.id,
      description: "SETEL FUEL 2210",
      merchant: "Setel",
      category: "Petrol",
      amount: -6000,
    },
    {
      accountId: tng.id,
      description: "MAMAK CORNER",
      merchant: "Mamak Corner",
      category: "Eating out",
      amount: -1850,
    },
  ];
  for (const spec of pendingSpecs) {
    must(
      await transactionsService.create(db, userId, {
        accountId: spec.accountId,
        type: "expense",
        amountMinor: spec.amount,
        txnDate: day(currentMonth, pendingDay),
        description: spec.description,
        merchantName: spec.merchant,
        categoryId: cat(spec.category),
        status: "pending",
      }),
      "pending",
    );
    serviceCount += 1;
  }

  /* --------------------------- planning (Phase 5) --------------------------- */
  // Payday budget matching the persona (25th, weekend-adjusted, flexible mode).
  const budget = must(
    await budgetsService.create(db, userId, {
      name: "Monthly essentials",
      mode: "flexible",
      cycleType: "payday",
      cycleAnchor: { day: 25, weekendAdjust: true },
    }),
    "demo budget",
  );
  const currentCycle = must(
    await budgetsService.periodReport(db, userId, { budgetId: budget.id, today }),
    "demo budget report",
  );
  const previousCycle = must(
    await budgetsService.periodReport(db, userId, {
      budgetId: budget.id,
      periodStart: currentCycle.nav.prevStart,
      today,
    }),
    "demo previous cycle",
  );
  const allocationPlan: Array<{ category: string; planned: number; rollover?: boolean }> = [
    { category: "Groceries", planned: 70000 },
    { category: "Eating out", planned: 45000 },
    { category: "Food delivery", planned: 25000 },
    { category: "Petrol", planned: 35000, rollover: true },
    { category: "Coffee & snacks", planned: 12000 },
  ];
  for (const periodId of [previousCycle.period.id, currentCycle.period.id]) {
    for (const item of allocationPlan) {
      must(
        await budgetsService.setAllocation(db, userId, {
          periodId,
          categoryId: cat(item.category),
          plannedMinor: item.planned,
          rolloverEnabled: item.rollover ?? false,
        }),
        `demo allocation ${item.category}`,
      );
    }
  }

  // Savings goals: on-track emergency fund, behind travel goal, dateless purchase.
  const targetIn = (monthsAhead: number): string => {
    const [y, m] = today.split("-").map(Number);
    const index = y * 12 + (m - 1) + monthsAhead;
    const daysIn = new Date(Date.UTC(Math.floor(index / 12), (index % 12) + 1, 0)).getUTCDate();
    return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-${String(daysIn).padStart(2, "0")}`;
  };
  const emergency = must(
    await goalsService.create(db, userId, {
      name: "Emergency fund",
      type: "emergency",
      targetAmountMinor: 1500000,
      targetDate: targetIn(13),
      priority: 1,
      contributionSchedule: { amountMinor: 55000, frequency: "monthly" },
    }),
    "demo emergency goal",
  );
  must(
    await goalsService.addContribution(db, userId, emergency.id, {
      amountMinor: 500000,
      contributedOn: day(months[1], 2),
      note: "Starting balance moved from savings",
    }),
    "emergency seed contribution",
  );
  for (let i = 2; i < 8; i++) {
    must(
      await goalsService.addContribution(db, userId, emergency.id, {
        amountMinor: 55000,
        contributedOn: day(months[i], 26),
      }),
      "emergency monthly contribution",
    );
  }
  const travel = must(
    await goalsService.create(db, userId, {
      name: "Japan trip",
      type: "travel",
      targetAmountMinor: 600000,
      targetDate: targetIn(9),
      priority: 2,
      contributionSchedule: { amountMinor: 30000, frequency: "monthly" },
    }),
    "demo travel goal",
  );
  for (let i = 5; i < 8; i++) {
    must(
      await goalsService.addContribution(db, userId, travel.id, {
        amountMinor: 40000,
        contributedOn: day(months[i], 27),
      }),
      "travel contribution",
    );
  }
  const laptop = must(
    await goalsService.create(db, userId, {
      name: "New laptop",
      type: "purchase",
      targetAmountMinor: 280000,
      priority: 3,
    }),
    "demo laptop goal",
  );
  for (const [index, amount] of [80000, 80000, 40000].entries()) {
    must(
      await goalsService.addContribution(db, userId, laptop.id, {
        amountMinor: amount,
        contributedOn: day(months[5 + index], 12),
      }),
      "laptop contribution",
    );
  }

  await auditRepo.record(db, {
    id: uuidv7(),
    userId,
    actor: "system",
    eventType: "seed.demo_financial",
    diff: { rows: rows.length, serviceCreated: serviceCount, months: months.map((m) => m.key) },
  });

  return {
    created: true,
    transactionCount: rows.length + serviceCount,
    months: months.map((m) => m.key),
  };
}
