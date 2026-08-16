import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { PrivacyProvider } from "@/components/providers/privacy-provider";
import { AmountText } from "@/components/ui/amount-text";

describe("AmountText", () => {
  test("renders formatted MYR with tabular numerals", () => {
    render(
      <PrivacyProvider>
        <AmountText amountMinor={852000} currency="MYR" />
      </PrivacyProvider>,
    );
    // The DOM contains NBSP after "RM"; RTL text queries normalize it to a space.
    const el = screen.getByText("RM 8,520.00");
    expect(el).toHaveClass("num");
  });

  test("masks the amount when privacy mode hides balances", () => {
    render(
      <PrivacyProvider defaultHidden>
        <AmountText amountMinor={852000} currency="MYR" />
      </PrivacyProvider>,
    );
    expect(screen.queryByText("RM 8,520.00")).toBeNull();
    expect(screen.getByText(/RM •••••/)).toBeInTheDocument();
  });
});
