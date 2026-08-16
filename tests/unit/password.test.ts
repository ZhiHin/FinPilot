import { describe, expect, test } from "vitest";

import { hashPassword, validatePasswordPolicy, verifyPassword } from "@/server/auth/password";

describe("hashPassword / verifyPassword", () => {
  test("verifies the original password against its hash", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword(hash, "correct horse battery staple")).toBe(true);
  });

  test("rejects a wrong password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword(hash, "wrong horse battery staple")).toBe(false);
  });

  test("produces argon2id hashes with unique salts", async () => {
    const a = await hashPassword("correct horse battery staple");
    const b = await hashPassword("correct horse battery staple");
    expect(a).toContain("$argon2id$");
    expect(a).not.toBe(b);
  });
});

describe("validatePasswordPolicy", () => {
  test("accepts a strong passphrase", () => {
    expect(validatePasswordPolicy("correct horse battery staple", "a@b.com")).toEqual([]);
  });

  test("rejects passwords under 12 characters", () => {
    expect(validatePasswordPolicy("short1!", "a@b.com")).not.toEqual([]);
  });

  test("rejects passwords over 128 characters", () => {
    expect(validatePasswordPolicy("x".repeat(129), "a@b.com")).not.toEqual([]);
  });

  test("rejects passwords containing the email local part", () => {
    expect(validatePasswordPolicy("aisyah.demo.password", "aisyah.demo@finpilot.test")).not.toEqual(
      [],
    );
  });

  test("rejects well-known weak passwords regardless of length", () => {
    expect(validatePasswordPolicy("password12345", "a@b.com")).not.toEqual([]);
  });
});
