import { test, expect } from "@playwright/test";
const photo = {
  name: "monitor.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7WQAAAAASUVORK5CYII=",
    "base64",
  ),
};
const upload = (page: import("@playwright/test").Page) =>
  page.getByLabel("Upload product images").setInputFiles(photo);
test("confirmed demo completes the dashboard and resets", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Take a photo/ }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/landing-desktop.png",
    fullPage: true,
  });
  await upload(page);
  await expect(page.getByAltText(/Your product photo 1/)).toBeVisible();
  await page.getByRole("button", { name: "Identify this product" }).click();
  await expect(
    page.getByRole("heading", { name: "UltraGear 27GP850-B" }),
  ).toBeVisible();
  await expect(
    page.getByText("Illustrative offers", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Example purchasing perspective")).toBeVisible();
  await expect(page.getByText(/Synthetic demo — identity/)).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "test-results/dashboard-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Start over" }).click();
  await expect(
    page.getByRole("heading", { name: /Take a photo/ }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("follow-up requires another image before fetching offers", async ({
  page,
}) => {
  let priceRequests = 0;
  page.on("request", (req) => {
    if (req.url().includes("/api/prices")) priceRequests++;
  });
  await page.goto("/");
  await page.getByLabel("Demo scenario").selectOption("follow-up");
  await upload(page);
  await page.getByRole("button", { name: "Identify this product" }).click();
  await expect(
    page.getByRole("heading", { name: "Help us confirm it." }),
  ).toBeVisible();
  expect(priceRequests).toBe(0);
  await upload(page);
  await page.getByRole("button", { name: "Analyze all images" }).click();
  await expect(page.getByText("Example purchasing perspective")).toBeVisible();
  expect(priceRequests).toBe(1);
});
test("candidate selection explicitly confirms the demo", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Demo scenario").selectOption("follow-up");
  await upload(page);
  await page.getByRole("button", { name: "Identify this product" }).click();
  await page.getByRole("button", { name: "Select candidate" }).click();
  await expect(page.getByText("Example purchasing perspective")).toBeVisible();
  await expect(
    page.getByText(/You selected this synthetic candidate/),
  ).toBeVisible();
});
test("mobile layout, invalid input, photo removal and appearance toggle", async ({
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
  await upload(page);
  await page.getByRole("button", { name: "Remove photo 1" }).click();
  await expect(
    page.getByRole("button", { name: "Identify this product" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Toggle light or dark appearance" })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByText("A photo is all it takes.")).toHaveCSS(
    "color",
    "rgb(230, 237, 232)",
  );
  await page.screenshot({
    path: "test-results/landing-mobile-dark.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
  await upload(page);
  await page.getByRole("button", { name: "Identify this product" }).click();
  await expect(page.getByText("Example purchasing perspective")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  ).toBe(false);
  await page.screenshot({
    path: "test-results/dashboard-mobile-dark.png",
    fullPage: true,
  });
});
test("a review failure stays visible while offers load and retry recovers", async ({
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
  await page.getByRole("button", { name: "Identify this product" }).click();
  await expect(page.getByText("Offers couldn’t load")).toHaveCount(0);
  await expect(
    page.getByText("Illustrative offers", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Reviews couldn’t load" }),
  ).toBeVisible();
  await expect(page.getByText("Example purchasing perspective")).toHaveCount(0);
  await page.unroute("**/api/reviews?**");
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByText("Example purchasing perspective")).toBeVisible();
});
