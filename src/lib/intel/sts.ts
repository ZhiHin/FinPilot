/**
 * Safe-to-Spend engine — the binding deterministic definition (architecture
 * doc §6):
 *
 *   STS_until_payday = liquid_balance + expected_income_by_payday
 *                      − confirmed_bills − predicted_bills
 *                      − budget_committals − goal_contributions_due
 *                      − safety_buffer
 *
 * computed per band, displayed as a range when the bands diverge (spec B1);
 * STS_today = band ÷ days_to_payday with bills front-loaded (subtracted in
 * full before dividing). Every term is itemized for the "why" drawer, and the
 * itemization must sum exactly to the expected band (unit-tested).
 *
 * Band rules (documented):
 * - Income: conservative counts only user-confirmed inflows; expected counts
 *   all at their typical amount; optimistic adds each inflow's tolerance.
 * - Bills: conservative pads every bill by its tolerance; expected uses
 *   typical amounts; optimistic trims inferred bills by their tolerance
 *   (never below zero) — confirmed bills stay exact in every band.
 * - Budget committals, goal contributions due, and the safety buffer are
 *   constant across bands.
 * Ordering conservative ≤ expected ≤ optimistic holds by construction (B2).
 */

export interface StsLineItem {
  name: string;
  /** Positive magnitude, minor units. */
  amountMinor: number;
  toleranceMinor: number;
  confirmed: boolean;
}

export interface StsInputs {
  liquidMinor: number;
  today: string;
  /** The next payday; the spending window is [today, payday − 1 day]. */
  payday: string;
  expectedIncome: StsLineItem[];
  bills: StsLineItem[];
  budgetCommittalMinor: number;
  goalContributionsDueMinor: number;
  safetyBufferMinor: number;
}

export interface StsBand {
  untilPaydayMinor: number;
  todayMinor: number;
}

export interface StsBreakdown {
  liquidMinor: number;
  incomeExpectedMinor: number;
  confirmedBillsMinor: number;
  predictedBillsMinor: number;
  budgetCommittalMinor: number;
  goalContributionsDueMinor: number;
  safetyBufferMinor: number;
}

export interface StsResult {
  daysToPayday: number;
  conservative: StsBand;
  expected: StsBand;
  optimistic: StsBand;
  /** True when uncertainty makes the bands diverge — render a range (B1). */
  isRange: boolean;
  /** Expected-band itemization; sums exactly to expected.untilPaydayMinor. */
  breakdown: StsBreakdown;
}

function dayNumber(isoDate: string): number {
  const [year, month, day] = isoDate.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

function sum(values: number[]): number {
  return values.reduce((total, v) => total + v, 0);
}

export function computeSafeToSpend(inputs: StsInputs): StsResult {
  const daysToPayday = Math.max(1, dayNumber(inputs.payday) - dayNumber(inputs.today));

  const incomeConservative = sum(
    inputs.expectedIncome.filter((i) => i.confirmed).map((i) => i.amountMinor),
  );
  const incomeExpected = sum(inputs.expectedIncome.map((i) => i.amountMinor));
  const incomeOptimistic = sum(inputs.expectedIncome.map((i) => i.amountMinor + i.toleranceMinor));

  const billsConservative = sum(inputs.bills.map((b) => b.amountMinor + b.toleranceMinor));
  const billsExpected = sum(inputs.bills.map((b) => b.amountMinor));
  const billsOptimistic = sum(
    inputs.bills.map((b) =>
      b.confirmed ? b.amountMinor : Math.max(b.amountMinor - b.toleranceMinor, 0),
    ),
  );

  const fixed =
    inputs.liquidMinor -
    inputs.budgetCommittalMinor -
    inputs.goalContributionsDueMinor -
    inputs.safetyBufferMinor;

  const band = (incomeMinor: number, billsMinor: number): StsBand => {
    const untilPaydayMinor = fixed + incomeMinor - billsMinor;
    return { untilPaydayMinor, todayMinor: Math.floor(untilPaydayMinor / daysToPayday) };
  };

  const conservative = band(incomeConservative, billsConservative);
  const expected = band(incomeExpected, billsExpected);
  const optimistic = band(incomeOptimistic, billsOptimistic);

  return {
    daysToPayday,
    conservative,
    expected,
    optimistic,
    isRange: conservative.untilPaydayMinor !== optimistic.untilPaydayMinor,
    breakdown: {
      liquidMinor: inputs.liquidMinor,
      incomeExpectedMinor: incomeExpected,
      confirmedBillsMinor: sum(inputs.bills.filter((b) => b.confirmed).map((b) => b.amountMinor)),
      predictedBillsMinor: sum(inputs.bills.filter((b) => !b.confirmed).map((b) => b.amountMinor)),
      budgetCommittalMinor: inputs.budgetCommittalMinor,
      goalContributionsDueMinor: inputs.goalContributionsDueMinor,
      safetyBufferMinor: inputs.safetyBufferMinor,
    },
  };
}
