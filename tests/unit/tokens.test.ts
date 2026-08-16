import { describe, expect, test } from "vitest";

import { generateToken, hashIdentifier, sha256Hex } from "@/server/auth/tokens";

describe("generateToken", () => {
  test("produces url-safe tokens with at least 256 bits of entropy", () => {
    const token = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43,}$/);
  });

  test("never repeats", () => {
    const tokens = new Set(Array.from({ length: 500 }, () => generateToken()));
    expect(tokens.size).toBe(500);
  });
});

describe("sha256Hex", () => {
  test("is deterministic and hex-encoded", () => {
    const h = sha256Hex("session-token");
    expect(h).toBe(sha256Hex("session-token"));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  test("differs for different inputs", () => {
    expect(sha256Hex("a")).not.toBe(sha256Hex("b"));
  });
});

describe("hashIdentifier", () => {
  test("is keyed: same input, different secrets, different hashes", () => {
    expect(hashIdentifier("aisyah@example.com", "secret-1")).not.toBe(
      hashIdentifier("aisyah@example.com", "secret-2"),
    );
  });

  test("normalizes case and whitespace so rate limits cannot be dodged", () => {
    expect(hashIdentifier(" Aisyah@Example.com ", "s")).toBe(
      hashIdentifier("aisyah@example.com", "s"),
    );
  });
});
