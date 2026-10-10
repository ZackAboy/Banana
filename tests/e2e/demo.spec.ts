import { test, expect, type Page } from "@playwright/test";
const photo = {
  name: "monitor.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7WQAAAAASUVORK5CYII=",
    "base64",
  ),
};
const upload = (page: Page) =>
  page.getByLabel("Upload product images").setInputFiles(photo);
const noOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

test("confirmed demo: camera, scanning, results and new scan", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Scan a product" }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/camera-desktop.png" });
  await upload(page);
  await expect(page.getByRole("status")).toContainText(/Looking closely/);
  await expect(
    page.getByRole("heading", { name: "UltraGear 27GP850-B" }),
  ).toBeVisible();
  await expect(page.getByText("Demo data", { exact: true })).toBeVisible();
  await expect(page.getByText("Sample retailer A")).toBeVisible();
  await expect(page.getByText("Example verdict")).toBeVisible();
  await page.getByRole("tab", { name: "Reviews" }).click();
  await expect(page.getByText("Loved")).toBeVisible();
  await page.getByRole("tab", { name: "Details" }).click();
  await expect(page.getByText("Text found")).toBeVisible();
  await page.screenshot({ path: "test-results/results-desktop.png" });
  await page.getByRole("button", { name: "New scan" }).click();
  await expect(
    page.getByRole("button", { name: "Scan a product" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("follow-up asks for another photo before fetching offers", async ({
  page,
}) => {
  let priceRequests = 0;
  page.on("request", (req) => {
    if (req.url().includes("/api/prices")) priceRequests++;
  });
  await page.goto("/");
  await page.getByLabel("Demo scenario").selectOption("follow-up");
  await upload(page);
  await expect(
    page.getByRole("heading", { name: "Almost there" }),
  ).toBeVisible();
  expect(priceRequests).toBe(0);
  await page.getByRole("button", { name: "Add photo" }).click();
  await expect(page.getByAltText(/Your product photo 1/)).toBeVisible();
  await upload(page);
  await expect(page.getByText("Example verdict")).toBeVisible();
  expect(priceRequests).toBe(1);
});

test("candidate selection explicitly confirms the demo", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Demo scenario").selectOption("follow-up");
  await upload(page);
  await page.getByRole("button", { name: "That’s it" }).click();
  await expect(page.getByText("Example verdict")).toBeVisible();
  await page.getByRole("tab", { name: "Details" }).click();
  await expect(
    page.getByText(/You selected this synthetic candidate/),
  ).toBeVisible();
});

test("mobile: invalid input, photo removal, theme and no overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByLabel("Upload product images").setInputFiles({
    name: "fake.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from("<svg/>"),
  });
  await expect(
    page.getByRole("alert").filter({ hasText: "Use JPEG, PNG, or WebP" }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/camera-mobile.png" });
  await page
    .getByRole("button", { name: "Toggle light or dark appearance" })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await noOverflow(page)).toBe(false);

  await page.getByLabel("Demo scenario").selectOption("follow-up");
  await upload(page);
  await expect(page.getByRole("status")).toBeVisible();
  await page.screenshot({ path: "test-results/scanning-mobile.png" });
  await expect(
    page.getByRole("heading", { name: "Almost there" }),
  ).toBeVisible();
  await page.screenshot({ path: "test-results/follow-up-mobile-dark.png" });
  await page.getByRole("button", { name: "Add photo" }).click();
  await page.getByRole("button", { name: "Remove photo 1" }).click();
  await expect(page.getByAltText(/Your product photo 1/)).toHaveCount(0);

  await page.getByLabel("Demo scenario").selectOption("confirmed");
  await upload(page);
  await expect(page.getByText("Example verdict")).toBeVisible();
  await page.waitForTimeout(800);
  await page.screenshot({ path: "test-results/results-mobile-dark.png" });
  await page
    .getByRole("button", { name: "Toggle light or dark appearance" })
    .click();
  await page.screenshot({ path: "test-results/results-mobile-light.png" });
  await page.getByRole("tab", { name: "Reviews" }).click();
  await page.waitForTimeout(800);
  await page.screenshot({
    path: "test-results/reviews-mobile-light.png",
    fullPage: true,
  });
  expect(await noOverflow(page)).toBe(false);
});

test("a review failure stays contained and retry recovers", async ({
  page,
}) => {
  await page.route("**/api/reviews?**", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "PROVIDER_UNAVAILABLE",
          message: "Review provider unavailable.",
        },
      }),
    }),
  );
  await page.goto("/");
  await upload(page);
  await expect(page.getByText("Sample retailer A")).toBeVisible();
  await expect(page.getByText("Offers couldn’t load")).toHaveCount(0);
  await expect(page.getByText("Example verdict")).toHaveCount(0);
  await page.getByRole("tab", { name: "Reviews" }).click();
  await expect(
    page.getByRole("heading", { name: "Reviews couldn’t load" }),
  ).toBeVisible();
  await page.unroute("**/api/reviews?**");
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("Example verdict")).toBeVisible();
});
