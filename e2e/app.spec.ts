import { expect, test, type Page } from "@playwright/test";
import { mockBackend } from "./mockBackend";

// Screenshots land in test-results/screens (not committed) for visual review.
async function snap(page: Page, name: string) {
  await page.waitForTimeout(250);
  await page.screenshot({ path: `test-results/screens/${test.info().project.name}-${name}.png`, fullPage: true });
}

async function expectNoHorizontalScroll(page: Page) {
  // Phones widen the layout viewport to fit oversized content, so compare with the real screen width too
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - Math.min(window.innerWidth, screen.width || window.innerWidth),
  );
  expect(overflow, "page must not be wider than the screen").toBeLessThanOrEqual(1);
}

function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/realtime|websocket|Failed to load resource|fonts\.g/i.test(m.text())) errors.push(m.text());
  });
  return errors;
}

test("sign-in page", async ({ page }) => {
  await mockBackend(page, { signedIn: false });
  await page.goto("login");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Enter your email address")).toBeVisible();
  await expectNoHorizontalScroll(page);
  await snap(page, "login");
});

test("dashboard", async ({ page }) => {
  const errors = collectErrors(page);
  await mockBackend(page);
  await page.goto("");
  await expect(page.getByText("Net worth").first()).toBeVisible();
  await expect(page.getByText("Stocks & ETFs").first()).toBeVisible();
  await expect(page.getByRole("list", { name: "Live rates" })).toContainText("USD/EGP");
  await expectNoHorizontalScroll(page);
  await snap(page, "dashboard");
  expect(errors).toEqual([]);
});

test("assets with purchases and growth", async ({ page }) => {
  const errors = collectErrors(page);
  await mockBackend(page);
  await page.goto("assets");
  await page.getByRole("button", { name: /^Gold ingots 14 g/ }).click();
  // 2 g bought 2 days ago for 11,200 EGP is shown with its growth
  await expect(page.getByText(/paid EGP\s?11,200\.00/)).toBeVisible();
  await expect(page.getByLabel(/since purchase/).filter({ visible: true }).first()).toBeVisible();
  await expectNoHorizontalScroll(page);
  await snap(page, "assets");
  expect(errors).toEqual([]);
});

test("activity and revert preview", async ({ page }) => {
  await mockBackend(page);
  await page.goto("activity");
  await expect(page.getByText("Client project")).toBeVisible();
  await expect(page.locator("main").getByText("Imported", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: /Hourly: 5 h/ }).click();
  await expect(page.getByRole("dialog", { name: "Revert to this point?" })).toBeVisible();
  await expect(page.getByRole("dialog")).toContainText("Upcoming Income");
  await snap(page, "revert");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expectNoHorizontalScroll(page);
});

test("goals and Zakat", async ({ page }) => {
  await mockBackend(page);
  await page.goto("goals");
  await expect(page.getByRole("heading", { name: "Zakat threshold" })).toBeVisible();
  await expect(page.getByText(/Day 212 of 354/)).toBeVisible();
  await page.getByRole("button", { name: "Edit Hawl" }).click();
  await expect(page.getByRole("dialog", { name: "Edit your Hawl" })).toBeVisible();
  await page.getByRole("button", { name: "Full Hawl" }).click();
  await expect(page.getByText("A full Hawl: Zakat is due now.")).toBeVisible();
  await snap(page, "hawl");
  await page.keyboard.press("Escape");
  await expectNoHorizontalScroll(page);
  await snap(page, "goals");
});

test("log income sends the right amount", async ({ page }) => {
  const writes: Array<{ path: string; body: unknown }> = [];
  await mockBackend(page, { onWrite: (w) => writes.push(w) });
  await page.goto("");
  const project = test.info().project.name;
  if (project === "phone") {
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await page.getByRole("button", { name: /Hourly project/ }).click();
  } else {
    await page.getByRole("tab", { name: "Hourly" }).first().click();
  }
  const dialogOrPage = project === "phone" ? page.getByRole("dialog") : page.locator("main");
  await dialogOrPage.getByLabel("Hours").fill("2");
  await dialogOrPage.getByLabel("Minutes").fill("30");
  await dialogOrPage.getByLabel(/Hourly rate/).fill("40");
  await snap(page, "hourly");
  await dialogOrPage.getByRole("button", { name: "Add income" }).click();
  await expect.poll(() => writes.find((w) => w.path === "rpc/log_income")?.body).toMatchObject({ p_amount: 100 });
});

test("add a stock with a checked ticker", async ({ page }) => {
  const writes: Array<{ path: string; body: unknown }> = [];
  await mockBackend(page, { onWrite: (w) => writes.push(w) });
  await page.goto("assets");
  await page.getByRole("button", { name: "Add asset" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add an asset" });
  await dialog.getByRole("button", { name: /Stock \/ ETF/ }).click();
  await dialog.getByLabel("Name").fill("Microsoft");
  await dialog.getByLabel("Ticker symbol").fill("microsoft");
  await expect(dialog.getByText("Microsoft Corporation")).toBeVisible();
  await snap(page, "add-stock");
  await dialog.getByRole("button", { name: "Add asset" }).click();
  await expect.poll(() => writes.find((w) => w.path === "assets")?.body).toMatchObject({ kind: "stock", ticker: "MSFT" });
});

test("profile tabs", async ({ page }) => {
  const errors = collectErrors(page);
  await mockBackend(page);
  await page.goto("profile?tab=personal");
  await expect(page.getByRole("heading", { name: "Profile & settings" })).toBeVisible();
  const sections = page.getByRole("tablist", { name: "Settings sections" });
  const TABS = [
    ["Personal", "personal"], ["Vault", "vault"], ["Appearance", "appearance"], ["Accounts", "accounts"], ["Automations", "automations"],
    ["Market & pricing", "market"], ["Zakat", "zakat"], ["Security", "security"], ["Data", "data"],
  ];
  for (const [tab, id] of TABS) {
    await sections.getByRole("tab", { name: tab }).click();
    await expect(page).toHaveURL(new RegExp(`tab=${id}`));
    await expectNoHorizontalScroll(page);
    if (["Vault", "Automations", "Market & pricing"].includes(tab)) await snap(page, `profile-${tab.split(" ")[0].toLowerCase()}`);
  }
  await sections.getByRole("tab", { name: "Automations" }).click();
  await expect(page.getByText("Payday sweep")).toBeVisible();
  await expect(page.getByText("On the 24th of every month")).toBeVisible();
  expect(errors).toEqual([]);
});

// ---------------------------------------------------------------------------
// Round 2 feedback
// ---------------------------------------------------------------------------

test("the sidebar has no separate add-money button", async ({ page }) => {
  await mockBackend(page);
  await page.goto("");
  await expect(page.getByText("Net worth").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Add money/ })).toHaveCount(0);
});

test("rates that don't fit scroll as a carousel, with Follow fixed beside it", async ({ page }) => {
  await mockBackend(page);
  await page.goto("");
  const carousel = page.locator('[data-carousel="scrolling"]');
  await expect(carousel).toBeVisible();
  // The Follow button sits outside the moving strip
  const follow = page.getByRole("button", { name: "Follow a stock or ETF" });
  await expect(follow).toBeVisible();
  expect(await carousel.locator('button[aria-label="Follow a stock or ETF"]').count()).toBe(0);
  // The strip is moving
  const track = carousel.locator("> div");
  const before = await track.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41);
  await page.waitForTimeout(700);
  const after = await track.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41);
  expect(after).toBeLessThan(before);
  await expectNoHorizontalScroll(page);
});

test("with animations off, the rates bar is a normal swipeable strip", async ({ page }) => {
  await mockBackend(page, { profile: { animation_speed: "off" } });
  await page.goto("");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "off");
  await expect(page.locator('[data-carousel="static"]')).toBeVisible();
});

test("animation speed can be changed in Appearance", async ({ page }) => {
  const writes: Array<{ path: string; body: unknown }> = [];
  await mockBackend(page, { onWrite: (w) => writes.push(w) });
  await page.goto("profile?tab=appearance");
  await expect(page.getByRole("heading", { name: "Animations" })).toBeVisible();
  await page.getByRole("tab", { name: "Slow" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-motion", "slow");
  await expect.poll(() => writes.find((w) => w.path.startsWith("profiles"))?.body).toMatchObject({ animation_speed: "slow" });
  await page.getByRole("tab", { name: "Off" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-motion", "off");
  await snap(page, "appearance");
});

test("estimated purchase prices are marked", async ({ page }) => {
  await mockBackend(page);
  await page.goto("assets");
  await page.getByRole("button", { name: /^Gold ingots 14 g/ }).click();
  const estimated = page.getByRole("button", { name: /≈ paid EGP\s?52,000\.00/ });
  await expect(estimated).toBeVisible();
  await expect(estimated).toContainText("est.");
  // The opening balance with no price is being looked up
  await page.getByRole("button", { name: /^Gold jewelry/ }).click();
  await expect(page.getByText(/looking up the price on that date/)).toBeVisible();
  await snap(page, "estimates");
});

test("the Hawl editor records the start-of-Hawl wealth", async ({ page }) => {
  await mockBackend(page);
  await page.goto("goals");
  await page.getByRole("button", { name: "Edit Hawl" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit your Hawl" });
  await expect(dialog.getByLabel(/^Wealth on/)).toHaveValue("450000");
  await expect(dialog).toContainText(/Zakat when due: EGP\s?11,250\.00/);
  await snap(page, "hawl-start-wealth");
});

// ---------------------------------------------------------------------------
// Round 3 feedback
// ---------------------------------------------------------------------------

test("dark mode can be switched on in Appearance", async ({ page }) => {
  const writes: Array<{ path: string; body: unknown }> = [];
  const errors = collectErrors(page);
  await mockBackend(page, { onWrite: (w) => writes.push(w) });
  await page.goto("profile?tab=appearance");
  await expect(page.getByRole("heading", { name: "Theme" })).toBeVisible();
  const lightBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  await page.getByRole("tablist", { name: "Theme" }).getByRole("tab", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect.poll(() => writes.find((w) => w.path.startsWith("profiles"))?.body).toMatchObject({ theme: "dark" });
  const darkBackground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(darkBackground).not.toBe(lightBackground);
  await snap(page, "dark-appearance");

  // The whole app follows, and it's remembered on this device for the next visit
  await page.getByRole("link", { name: /Home|Dashboard/ }).first().click();
  await expect(page.getByText("Net worth").first()).toBeVisible();
  await snap(page, "dark-dashboard");
  expect(await page.evaluate(() => localStorage.getItem("aura.theme"))).toBe("dark");
  expect(errors).toEqual([]);
});

test("a saved dark theme is used from the first screen", async ({ page }) => {
  await mockBackend(page, { profile: { theme: "dark" } });
  await page.goto("assets");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: /^Gold ingots 14 g/ }).click();
  await snap(page, "dark-assets");
});

test("first-year Zakat uses the Nisab value on the start date", async ({ page }) => {
  const writes: Array<{ path: string; body: unknown }> = [];
  await mockBackend(page, { onWrite: (w) => writes.push(w) });
  await page.goto("goals");
  await page.getByRole("button", { name: "Edit Hawl" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit your Hawl" });
  await dialog.getByLabel("This is my first year above the Nisab").check();
  // 85 g × (2,901.10 / 31.1034768 × 50.4413 × 1.025) ≈ EGP 409,905
  await expect(dialog).toContainText(/Nisab value: EGP\s?409,90\d\.\d\d/);
  await expect(dialog).toContainText(/Zakat when due: EGP\s?10,247\.\d\d/);
  await expect(dialog.getByLabel(/^Wealth on/)).toHaveCount(0);
  await snap(page, "first-hawl");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect
    .poll(() => writes.find((w) => w.path.startsWith("zakat_hawl"))?.body)
    .toMatchObject({ is_first_hawl: true, start_wealth_currency: "EGP" });
  const saved = writes.find((w) => w.path.startsWith("zakat_hawl"))!.body as { start_wealth: number };
  expect(Math.abs(saved.start_wealth - 409904.5)).toBeLessThan(2);
});
