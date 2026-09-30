import { csvCell, toCsv } from "./exporters";

describe("CSV export", () => {
  it("quotes commas, quotes and new lines", () => {
    expect(csvCell('Rent, "May"')).toBe('"Rent, ""May"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  it("neutralizes spreadsheet formulas in text", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("+123")).toBe("'+123");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
  });

  it("keeps negative numbers as numbers", () => {
    expect(csvCell(-50)).toBe("-50");
    expect(toCsv([["a", 1], [null, "b"]])).toBe("a,1\r\n,b");
  });
});
