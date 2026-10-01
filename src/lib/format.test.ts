import { describe, expect, it } from "vitest";
import { formatMoney } from "./format";

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
