import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";

describe("FormField", () => {
  test("associates label, help text, and input", () => {
    render(
      <FormField label="Email address" help="We never share this.">
        <Input name="email" type="email" />
      </FormField>,
    );
    const input = screen.getByLabelText("Email address");
    expect(input).toHaveAccessibleDescription("We never share this.");
    expect(input).not.toHaveAttribute("aria-invalid", "true");
  });

  test("wires errors with aria-invalid and aria-describedby", () => {
    render(
      <FormField label="Email address" errors={["Enter a valid email address."]}>
        <Input name="email" type="email" />
      </FormField>,
    );
    const input = screen.getByLabelText("Email address");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Enter a valid email address.");
    expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();
  });
});
