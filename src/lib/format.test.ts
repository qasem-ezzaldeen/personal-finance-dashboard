import { describe, expect, it } from "vitest";
import { formatAmount, formatMoney, formatUnitTotal } from "./format";

describe("formatMoney", () => {
  it("shows two decimals below 100,000", () => {
    expect(formatMoney(99_999.5, "USD")).toBe("$99,999.50");
    expect(formatMoney(1234, "EGP").replace(/\s/g, " ")).toBe("EGP 1,234.00");
  });

  it("drops the decimals from 100,000 up, in either direction", () => {
    expect(formatMoney(100_000, "USD")).toBe("$100,000");
    expect(formatMoney(1_234_567.89, "USD")).toBe("$1,234,568");
    expect(formatMoney(-250_000.4, "USD", { signed: true })).toBe("-$250,000");
  });

  it("leaves compact amounts alone", () => {
    expect(formatMoney(1_250_000, "USD", { compact: true, decimals: 2 })).toBe("$1.25M");
  });
});

describe("formatUnitTotal", () => {
  it("shows gold as grams of its karat and money in its own currency", () => {
    expect(formatUnitTotal({ unit: "gold", karat: 21, grams: 20 })).toBe("21k 20 g");
    expect(formatUnitTotal({ unit: "gold", karat: 24, grams: 45.5 })).toBe("24k 45.5 g");
    expect(formatUnitTotal({ unit: "money", currency: "USD", amount: 342 })).toBe("$342.00");
  });
});

describe("formatAmount", () => {
  it("shows grams of gold, with a sign only when it isn't zero", () => {
    expect(formatAmount(1.256, "GOLD_24K_G", { signed: true })).toBe("+1.26 g");
    expect(formatAmount(-0.5, "GOLD_24K_G", { signed: true })).toBe("-0.5 g");
    expect(formatAmount(0.001, "GOLD_24K_G", { signed: true })).toBe("0 g");
    expect(formatAmount(-0.001, "GOLD_24K_G", { signed: true })).toBe("0 g");
    expect(formatAmount(342, "USD")).toBe("$342.00");
  });
});
