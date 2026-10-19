import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LazyWealthDonut } from "./LazyWealthDonut";

vi.mock("./WealthDonut", () => ({ WealthDonut: () => <div data-testid="donut" /> }));

let width = 0;
let resize: (() => void) | undefined;

beforeEach(() => {
  width = 0;
  resize = undefined;
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(() => width);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("LazyWealthDonut", () => {
  it("leaves the chart out while its box is hidden", async () => {
    render(<LazyWealthDonut />);
    await act(async () => {});
    expect(screen.queryByTestId("donut")).toBeNull();
  });

  it("shows the chart when its box has a width", async () => {
    width = 192;
    render(<LazyWealthDonut />);
    expect(await screen.findByTestId("donut")).toBeInTheDocument();
  });

  it("follows the box as it is shown and hidden again", async () => {
    render(<LazyWealthDonut />);
    expect(screen.queryByTestId("donut")).toBeNull();

    width = 192;
    act(() => resize?.());
    expect(await screen.findByTestId("donut")).toBeInTheDocument();

    width = 0;
    act(() => resize?.());
    expect(screen.queryByTestId("donut")).toBeNull();
  });
});
