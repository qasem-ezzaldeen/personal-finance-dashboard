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

test("goals", async ({ page }) => {
  await mockBackend(page);
  await page.goto("goals");
  await expect(page.getByRole("heading", { name: /Emergency fund/ })).toBeVisible();
  // Zakat isn't a goal anymore
  await expect(page.getByText("Zakat threshold")).toHaveCount(0);
  // Emergency fund reserves its money: it's marked, and the others don't count it again
  await expect(page.getByRole("heading", { name: /Emergency fund/ })).toContainText("Reserved");
  await expectNoHorizontalScroll(page);
  await snap(page, "goals");
});

test("the Zakat card on the dashboard opens all Zakat settings", async ({ page }) => {
  await mockBackend(page);
  await page.goto("");
  await page.getByRole("link", { name: "Zakat settings" }).click();
  await expect(page).toHaveURL(/settings\?tab=zakat/);
  await expect(page.getByRole("heading", { name: "Nisab & Hawl" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Gold price used for the Nisab" })).toBeVisible();
  await expect(page.getByText(/Day 212 of 354/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Zakat payments" })).toBeVisible();
  await page.getByRole("button", { name: "Edit Hawl" }).click();
  await expect(page.getByRole("dialog", { name: "Edit your Hawl" })).toBeVisible();
  await page.getByRole("button", { name: "Full Hawl" }).click();
  await expect(page.getByText("A full Hawl: Zakat is due now.")).toBeVisible();
  await snap(page, "hawl");
  await page.keyboard.press("Escape");
  await expectNoHorizontalScroll(page);
  await snap(page, "settings-zakat");
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

test("settings tabs", async ({ page }) => {
  const errors = collectErrors(page);
  await mockBackend(page);
  await page.goto("settings?tab=accounts");
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  const sections = page.getByRole("tablist", { name: "Settings sections" });
  const TABS = [
    ["Vault", "vault"], ["Appearance", "appearance"], ["Accounts", "accounts"], ["Automations", "automations"],
    ["Market & pricing", "market"], ["Zakat", "zakat"], ["Data", "data"],
  ];
  for (const [tab, id] of TABS) {
    await sections.getByRole("tab", { name: tab }).click();
    await expect(page).toHaveURL(new RegExp(`tab=${id}`));
    await expectNoHorizontalScroll(page);
    if (["Vault", "Automations", "Market & pricing", "Data"].includes(tab)) await snap(page, `settings-${tab.split(" ")[0].toLowerCase()}`);
  }
  await sections.getByRole("tab", { name: "Automations" }).click();
  await expect(page.getByText("Payday sweep")).toBeVisible();
  await expect(page.getByText("On the 24th of every month")).toBeVisible();
  // The time zone lives with the vault settings now
  await sections.getByRole("tab", { name: "Vault" }).click();
  await expect(page.getByLabel("Time zone")).toHaveValue("Africa/Cairo");
  expect(errors).toEqual([]);
});

test("the sidebar opens Settings and the avatar opens the profile", async ({ page }) => {
  await mockBackend(page);
  await page.goto("");
  await expect(page.getByRole("link", { name: "Profile" })).toHaveCount(0);
  await page.getByRole("link", { name: "Settings" }).first().click();
  await expect(page).toHaveURL(/\/settings/);
  await page.getByRole("button", { name: "Account menu" }).filter({ visible: true }).click();
  await page.getByRole("menuitem", { name: "Profile" }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.getByRole("heading", { name: "Profile", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Change password" })).toBeVisible();
  await expect(page.getByLabel("Display name")).toHaveValue("qasem");
  for (const gone of [/Full name/, /Phone/, /Country/, /Time zone/]) await expect(page.getByLabel(gone)).toHaveCount(0);
  await expectNoHorizontalScroll(page);
  await snap(page, "profile");
});

test("old profile links open the matching settings", async ({ page }) => {
  await mockBackend(page);
  await page.goto("profile?tab=market");
  await expect(page).toHaveURL(/settings\?tab=market/);
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
  await page.goto("settings?tab=appearance");
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
  await page.goto("settings?tab=zakat");
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
  await page.goto("settings?tab=appearance");
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
  await page.goto("settings?tab=zakat");
  await page.getByRole("button", { name: "Edit Hawl" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit your Hawl" });
  await dialog.getByLabel("This is my first year above the Nisab").check();
  // 85 g × (2,901.10 / 31.1034768 × 50.4413), no local premium ≈ EGP 399,907 (no decimals from 100,000)
  await expect(dialog).toContainText(/Nisab value: EGP\s?399,907(?![\d.])/);
  await expect(dialog).toContainText(/Zakat when due: EGP\s?9,997\.\d\d/);
  await expect(dialog.getByLabel(/^Wealth on/)).toHaveCount(0);
  await snap(page, "first-hawl");
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect
    .poll(() => writes.find((w) => w.path.startsWith("zakat_hawl"))?.body)
    .toMatchObject({ is_first_hawl: true, start_wealth_currency: "EGP" });
  const saved = writes.find((w) => w.path.startsWith("zakat_hawl"))!.body as { start_wealth: number };
  expect(Math.abs(saved.start_wealth - 399906.96)).toBeLessThan(2);
});

// ---------------------------------------------------------------------------
// Round 4: buying via Add asset, selling, palettes, restore, chart size, whole numbers
// ---------------------------------------------------------------------------

test("buy more shares of a stock you have, paid from a cash account, with Add asset", async ({ page }) => {
  const writes: Array<{ path: string; body: unknown }> = [];
  await mockBackend(page, { onWrite: (w) => writes.push(w) });
  await page.goto("assets");
  await expect(page.getByRole("button", { name: /^Buy/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Add asset" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add an asset" });
  await dialog.getByRole("button", { name: /Stock \/ ETF/ }).click();
  // Typing a ticker you already hold adds to that asset instead of making a second one
  await dialog.getByLabel("Ticker symbol").fill("spus");
  await expect(dialog.getByText(/This adds to\s+SPUS ETF/)).toBeVisible();
  await expect(dialog.getByLabel("Name")).toHaveCount(0);
  await dialog.getByLabel("Paid from").selectOption({ label: "nsave · $1,500.50" });
  await dialog.getByLabel("Shares").fill("3");
  await dialog.getByRole("button", { name: "Use market price" }).click();
  // nsave before → after is shown
  await expect(dialog).toContainText(/nsave\s*\$1,500\.50/);
  await snap(page, "add-to-existing");
  await dialog.getByRole("button", { name: "Add to SPUS ETF" }).click();
  await expect
    .poll(() => writes.find((w) => w.path === "rpc/buy_asset")?.body)
    .toMatchObject({ p_asset: "spus", p_from: "nsave", p_quantity: 3, p_amount: 177.27 });
  expect(writes.find((w) => w.path === "assets")).toBeUndefined();
});

test("paying more than an account holds is refused before anything is saved", async ({ page }) => {
  const writes: Array<{ path: string; body: unknown }> = [];
  await mockBackend(page, { onWrite: (w) => writes.push(w) });
  await page.goto("assets");
  await page.getByRole("button", { name: "Add asset" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add an asset" });
  await dialog.getByRole("button", { name: /Gold/ }).click();
  await dialog.getByLabel("Add to").selectOption("new");
  await dialog.getByLabel("Paid from").selectOption({ label: "nsave · $1,500.50" });
  await dialog.getByLabel("Grams").fill("10");
  await dialog.getByLabel(/Total paid/).fill("5000");
  await dialog.getByRole("button", { name: "Add asset" }).click();
  await expect(dialog.getByText(/There's only \$1,500\.50 in nsave/)).toBeVisible();
  expect(writes.filter((w) => ["assets", "asset_purchases", "rpc/buy_asset"].includes(w.path))).toEqual([]);
});

test("new gold is named Ingots (24k) or Scrap Gold (21k) unless you type a name", async ({ page }) => {
  await mockBackend(page);
  await page.goto("assets");
  await page.getByRole("button", { name: "Add asset" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add an asset" });
  await dialog.getByRole("button", { name: /Gold/ }).click();
  // You already have 24k gold, so it's added there unless you ask for a new asset
  await expect(dialog.getByText(/This adds to\s+Gold ingots/)).toBeVisible();
  await dialog.getByLabel("Add to").selectOption("new");
  await expect(dialog.getByLabel("Name")).toHaveValue("Ingots");
  await dialog.getByRole("tab", { name: /21k/ }).click();
  await expect(dialog.getByLabel("Name")).toHaveValue("Scrap Gold");
  await dialog.getByLabel("Name").fill("Grandma's ring");
  await dialog.getByRole("tab", { name: /24k/ }).click();
  await expect(dialog.getByLabel("Name")).toHaveValue("Grandma's ring");
});

test("gold you already own can be added without paying from cash", async ({ page }) => {
  const writes: Array<{ path: string; body: unknown }> = [];
  await mockBackend(page, { onWrite: (w) => writes.push(w) });
  await page.goto("assets");
  await page.getByRole("button", { name: "Add asset" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Add an asset" });
  await dialog.getByRole("button", { name: /Gold/ }).click();
  await expect(dialog.getByLabel("Paid from")).toHaveValue("none");
  await dialog.getByLabel("Grams").fill("2");
  await dialog.getByRole("button", { name: "Add to Gold ingots" }).click();
  await expect.poll(() => writes.find((w) => w.path === "asset_purchases")?.body).toMatchObject({ asset_id: "ingots", quantity: 2 });
  expect(writes.find((w) => w.path === "rpc/buy_asset")).toBeUndefined();
});

test("each asset you hold has a Sell button without expanding it", async ({ page }) => {
  await mockBackend(page);
  await page.goto("assets");
  for (const name of ["Gold ingots", "SPUS ETF", "Apple"]) await expect(page.getByRole("button", { name: `Sell ${name}` })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sell QNB Bebasata" })).toHaveCount(0);
  await snap(page, "assets-sell-buttons");
});

test("sell shares into a cash account, and sales show in the asset's history", async ({ page }) => {
  const writes: Array<{ path: string; body: unknown }> = [];
  await mockBackend(page, { onWrite: (w) => writes.push(w) });
  await page.goto("assets");
  // 12 bought − 2 sold
  await page.getByRole("button", { name: /^SPUS ETF 10 shares/ }).click();
  await expect(page.getByText(/received \$118\.00 in nsave/)).toBeVisible();
  await page.getByRole("button", { name: "Sell SPUS ETF" }).click();
  const dialog = page.getByRole("dialog", { name: "Sell · SPUS ETF" });
  await dialog.getByRole("button", { name: "Sell all" }).click();
  await dialog.getByLabel(/Total received/).fill("700");
  await expect(dialog).toContainText("Gain vs. what you paid");
  await snap(page, "sell");
  await dialog.getByRole("button", { name: "Sell", exact: true }).click();
  await expect.poll(() => writes.find((w) => w.path === "rpc/sell_asset")?.body).toMatchObject({ p_asset: "spus", p_quantity: 10, p_amount: 700 });
});

test("deleting a purchase paid from cash says the money goes back", async ({ page }) => {
  await mockBackend(page);
  await page.goto("assets");
  await page.getByRole("button", { name: /^Apple/ }).click();
  await page.getByRole("button", { name: /paid \$690\.00/ }).click();
  const dialog = page.getByRole("dialog", { name: "Edit purchase" });
  await expect(dialog).toContainText("Paid $690.00 from QNB Bebasata");
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("dialog", { name: "Delete this purchase?" })).toContainText("$690.00 goes back to QNB Bebasata");
});

test("quick actions still only move money between accounts", async ({ page }) => {
  test.skip(test.info().project.name === "phone", "Quick actions are a dashboard card on larger screens");
  await mockBackend(page);
  await page.goto("");
  await page.getByRole("tab", { name: "Transfer" }).first().click();
  const to = page.locator("main").getByLabel("To");
  await expect(to.locator("option", { hasText: "Gold ingots" })).toHaveCount(0);
});

test("OLED is pure black and always dark", async ({ page }) => {
  const writes: Array<{ path: string; body: unknown }> = [];
  await mockBackend(page, { onWrite: (w) => writes.push(w) });
  await page.goto("settings?tab=appearance");
  await page.getByRole("radiogroup", { name: "Color palette" }).getByRole("radio", { name: /OLED/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-palette", "oled");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(0, 0, 0)");
  await expect(page.getByText("The OLED palette is always dark.")).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Theme" })).toHaveCount(0);
  await expect.poll(() => writes.find((w) => w.path.startsWith("profiles"))?.body).toMatchObject({ color_palette: "oled" });
  await snap(page, "oled");
});

test("the hero color can be changed and reset", async ({ page }) => {
  const writes: Array<{ path: string; body: unknown }> = [];
  await mockBackend(page, { onWrite: (w) => writes.push(w) });
  await page.goto("settings?tab=appearance");
  const brand = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--color-brand-strong").trim());
  const before = await brand();
  await page.getByRole("button", { name: "Hero color 3" }).click();
  await expect.poll(brand).not.toBe(before);
  await expect
    .poll(() => (writes.find((w) => w.path.startsWith("profiles") && JSON.stringify(w.body).includes("palette_accents"))?.body as { palette_accents?: object })?.palette_accents)
    .toHaveProperty("pastel");
  await snap(page, "hero-color");
  await page.getByRole("button", { name: /Use Pastel's own/ }).click();
  await expect.poll(brand).toBe(before);
});

test("the dashboard KPIs have colored icons", async ({ page }) => {
  await mockBackend(page);
  await page.goto("");
  const zakat = page.getByRole("link", { name: "Zakat settings" });
  await expect(zakat.locator("svg").first()).toBeVisible();
  await expect(zakat).not.toContainText("🕌");
});

test("color palettes can be chosen in Appearance", async ({ page }) => {
  const writes: Array<{ path: string; body: unknown }> = [];
  const errors = collectErrors(page);
  await mockBackend(page, { onWrite: (w) => writes.push(w) });
  await page.goto("settings?tab=appearance");
  const palettes = page.getByRole("radiogroup", { name: "Color palette" });
  await expect(palettes.getByRole("radio")).toHaveCount(6);
  await expect(palettes.getByRole("radio", { name: /Pastel/ })).toHaveAttribute("aria-checked", "true");
  await expect(palettes.getByRole("radio", { name: /OLED/ })).toBeVisible();
  const before = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--color-brand-strong").trim());
  await palettes.getByRole("radio", { name: /Sea & Beach/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-palette", "sea");
  await expect.poll(() => writes.find((w) => w.path.startsWith("profiles"))?.body).toMatchObject({ color_palette: "sea" });
  const after = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--color-brand-strong").trim());
  expect(after).not.toBe(before);
  await snap(page, "palettes");
  await page.getByRole("link", { name: /Home|Dashboard/ }).first().click();
  await expect(page.getByText("Net worth").first()).toBeVisible();
  await snap(page, "palette-sea-dashboard");
  expect(await page.evaluate(() => localStorage.getItem("aura.palette"))).toBe("sea");
  expect(errors).toEqual([]);
});

test("a saved palette is used from the first screen, in dark mode too", async ({ page }) => {
  await mockBackend(page, { profile: { color_palette: "autumn", theme: "dark" } });
  await page.goto("");
  await expect(page.locator("html")).toHaveAttribute("data-palette", "autumn");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByText("Net worth").first()).toBeVisible();
  await snap(page, "palette-autumn-dark");
});

test("a JSON backup can be checked and restored", async ({ page }) => {
  const writes: Array<{ path: string; body: unknown }> = [];
  await mockBackend(page, { onWrite: (w) => writes.push(w) });
  await page.goto("settings?tab=data");
  const backup = {
    format: "aurafinance-backup", version: 2, app: "AuraFinance", exported_at: new Date().toISOString(),
    profile: { vault_name: "Old vault", base_currency: "EGP" },
    assets: [{ id: "a1", kind: "cash", name: "Bank", currency: "EGP", balance: 100 }],
    purchases: [], sales: [], goals: [{ id: "g1", name: "House", is_system: false }], rules: [], transactions: [], transaction_changes: [],
  };
  await page.getByLabel("Backup file").setInputFiles({ name: "backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(backup)) });
  await expect(page.getByText("Old vault")).toBeVisible();
  await expect(page.getByText("1 assets and accounts")).toBeVisible();
  await snap(page, "restore");
  await page.getByRole("button", { name: "Restore this backup" }).click();
  await page.getByRole("dialog", { name: "Replace this vault with the backup?" }).getByRole("button", { name: "Restore" }).click();
  await expect.poll(() => writes.find((w) => w.path === "rpc/restore_vault")?.body).toMatchObject({ p: { profile: { vault_name: "Old vault" } } });
});

test("files that aren't backups are refused", async ({ page }) => {
  await mockBackend(page);
  await page.goto("settings?tab=data");
  await page.getByLabel("Backup file").setInputFiles({ name: "notes.json", mimeType: "application/json", buffer: Buffer.from('{"hello":1}') });
  await expect(page.getByText(/isn't an AuraFinance backup/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Restore this backup" })).toHaveCount(0);
});

test("the wealth chart fits its section, up to 12rem", async ({ page }) => {
  test.skip(test.info().project.name === "phone", "The chart is shown on larger screens");
  await mockBackend(page);
  await page.goto("");
  const chart = page.locator(".recharts-responsive-container").first();
  await expect(chart).toBeVisible();
  const box = (await chart.boundingBox())!;
  expect(box.width).toBeGreaterThan(120);
  expect(box.width).toBeLessThanOrEqual(193);
  expect(Math.abs(box.width - box.height)).toBeLessThan(2);
});

test("money of 100,000 or more has no decimals", async ({ page }) => {
  await mockBackend(page);
  await page.goto("");
  // Net worth is well above 100,000 EGP
  const netWorth = page.locator("main").getByText(/^EGP\s?[\d,]{7,}$/).first();
  await expect(netWorth).toBeVisible();
  await expect(netWorth).not.toContainText(".");
});

test("groups add up holdings in their own unit: grams per karat, money per currency", async ({ page }) => {
  await mockBackend(page);
  for (const path of ["", "assets"]) {
    await page.goto(path);
    const group = (kind: string) => page.locator(`button[aria-controls="group-panel-${kind}"]`);
    // 24k: 2 + 10 + 2 g; 21k: 40 g
    await expect(group("gold")).toContainText("24k 14 g");
    await expect(group("gold")).toContainText("21k 40 g");
    // 10 SPUS x $59.09 + 3 AAPL x $224.23, all in USD: it repeats the USD line under the total,
    // which phones don't show, so only phones get the subtotal
    const stocksInUsd = group("stock").getByText("$1,263.59", { exact: true });
    if (test.info().project.name === "phone") await expect(stocksInUsd).toBeVisible();
    else await expect(stocksInUsd).toBeHidden();
    // USD accounts and the EGP account are added up separately
    await expect(group("cash")).toContainText("$4,700.50");
    await expect(group("cash")).toContainText(/EGP\s?45,000\.00/);
    await expectNoHorizontalScroll(page);
  }
  await snap(page, "unit-totals");
});

test("hovering the wealth chart shows a group's grams", async ({ page }) => {
  test.skip(test.info().project.name !== "desktop", "Hovering needs a mouse");
  await mockBackend(page);
  await page.goto("assets");
  await expect(page.locator('.recharts-sector[name="Gold"]')).toBeVisible();
  await page.waitForTimeout(1000); // let the chart finish drawing
  // A point just inside the slice's outer edge, nudged toward the middle of the chart
  const point = await page.evaluate(() => {
    const path = document.querySelector<SVGPathElement>('.recharts-sector[name="Gold"]')!;
    const svg = path.closest("svg")!.getBoundingClientRect();
    const local = path.getPointAtLength(path.getTotalLength() * 0.2);
    const onEdge = new DOMPoint(local.x, local.y).matrixTransform(path.getScreenCTM()!);
    const cx = svg.left + svg.width / 2;
    const cy = svg.top + svg.height / 2;
    const d = Math.hypot(onEdge.x - cx, onEdge.y - cy);
    return { x: onEdge.x + ((cx - onEdge.x) / d) * 6, y: onEdge.y + ((cy - onEdge.y) / d) * 6 };
  });
  await page.mouse.move(point.x, point.y);
  const tooltip = page.locator(".recharts-tooltip-wrapper");
  await expect(tooltip).toContainText("Gold · 24k 14 g · 21k 40 g");
  await expect(tooltip).toContainText(/EGP\s?[\d,]+ · [\d.]+%/);
});
