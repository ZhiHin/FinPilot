import { describe, expect, test } from "vitest";

import { canonicalMerchantName, normalizeMerchantKey } from "./index";

describe("normalizeMerchantKey", () => {
  test("drops star-suffixed location/reference segments", () => {
    expect(normalizeMerchantKey("GRABFOOD*KL 1234")).toBe("grabfood");
    expect(normalizeMerchantKey("SHOPEE *ORDER 2408")).toBe("shopee");
  });

  test("drops known payment-channel segments", () => {
    expect(normalizeMerchantKey("TNG-EWALLET*SEVEN ELEVEN")).toBe("seven eleven");
    expect(normalizeMerchantKey("POS MYDIN MERU RAYA")).toBe("mydin meru raya");
    expect(normalizeMerchantKey("DUITNOW ZUS COFFEE")).toBe("zus coffee");
  });

  test("strips trailing tokens containing digits (refs, branch codes)", () => {
    expect(normalizeMerchantKey("MCDONALD'S SS2 1002")).toBe("mcdonald's");
    expect(normalizeMerchantKey("99 SPEEDMART 1234")).toBe("99 speedmart");
  });

  test("collapses separators and whitespace", () => {
    expect(normalizeMerchantKey("  ZUS_COFFEE//BANGSAR  ")).toBe("zus coffee bangsar");
  });

  test("same merchant, different statement noise, same key", () => {
    expect(normalizeMerchantKey("GRABFOOD*KL 1234")).toBe(normalizeMerchantKey("GrabFood* PJ 99"));
  });

  test("empty and junk-only input yields an empty key", () => {
    expect(normalizeMerchantKey("")).toBe("");
    expect(normalizeMerchantKey("   ")).toBe("");
    expect(normalizeMerchantKey("123456")).toBe("");
  });
});

describe("canonicalMerchantName", () => {
  test("title-cases words, keeping short all-caps tokens", () => {
    expect(canonicalMerchantName("GRABFOOD*KL 1234")).toBe("Grabfood");
    expect(canonicalMerchantName("TNG-EWALLET*SEVEN ELEVEN")).toBe("Seven Eleven");
    expect(canonicalMerchantName("KFC DAMANSARA 044")).toBe("KFC Damansara");
  });

  test("preserves apostrophes", () => {
    expect(canonicalMerchantName("MCDONALD'S SS2 1002")).toBe("Mcdonald's");
  });
});
