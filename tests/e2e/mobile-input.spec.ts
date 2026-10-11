import { expect, test, devices, type Page } from "@playwright/test";

test.use({
  userAgent: devices["iPhone 13"].userAgent,
  viewport: devices["iPhone 13"].viewport,
  isMobile: true,
  hasTouch: true,
});

const photo = {
  name: "product.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7WQAAAAASUVORK5CYII=",
    "base64",
  ),
};

async function openPicker(page: Page, button: string) {
  const trigger = page.getByRole("button", { name: button });
  await expect(trigger).toBeEnabled();
  // Hit testing verifies that an overlay cannot intercept a real finger tap.
  expect(
    await trigger.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return element.contains(
        document.elementFromPoint(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2,
        ),
      );
    }),
  ).toBe(true);
  const chooser = page.waitForEvent("filechooser");
  await trigger.tap();
  return chooser;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // Match the missing secure-context API on an HTTP LAN origin.
    Object.defineProperty(crypto, "randomUUID", { value: undefined });
    // Even with camera permission, iOS must use native file capture.
    Object.defineProperty(navigator, "permissions", {
      value: { query: async () => ({ state: "granted" }) },
    });
    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getUserMedia: async () => {
          throw new Error("iOS must not request a live camera stream");
        },
      },
    });
  });
});

test("iPhone gallery and camera taps open native pickers and preserve additional images on HTTP", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByLabel("Demo scenario").selectOption("follow-up");

  const gallery = await openPicker(page, "Choose from gallery");
  expect(gallery.isMultiple()).toBe(true);
  expect(await gallery.element().getAttribute("accept")).toBe("image/*");
  expect(await gallery.element().getAttribute("capture")).toBeNull();
  // Cancel, then choose the same file later without leaving the screen.
  await gallery.setFiles([]);
  await expect(page.getByRole("status")).toHaveCount(0);
  await (await openPicker(page, "Choose from gallery")).setFiles(photo);
  await expect(
    page.getByRole("heading", { name: "Almost there" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Add photo" }).tap();
  await expect(page.getByAltText(/Your product photo 1/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Turn on camera" }),
  ).toHaveCount(0);
  const camera = await openPicker(page, "Scan with another photo");
  expect(camera.isMultiple()).toBe(false);
  expect(await camera.element().getAttribute("accept")).toBe("image/*");
  expect(await camera.element().getAttribute("capture")).toBe("environment");
  await camera.setFiles(photo);
  await expect(page.getByText("Example verdict")).toBeVisible();
  expect(errors).toEqual([]);
});

test("iPhone gallery keeps multiple selection and existing image validation", async ({
  page,
}) => {
  await page.goto("/");
  await (
    await openPicker(page, "Choose from gallery")
  ).setFiles({
    name: "unsupported.gif",
    mimeType: "image/gif",
    buffer: Buffer.from("GIF89a"),
  });
  await expect(
    page.getByRole("alert").filter({ hasText: "Use JPEG, PNG, or WebP" }),
  ).toBeVisible();
  await page.getByLabel("Demo scenario").selectOption("follow-up");
  await (
    await openPicker(page, "Choose from gallery")
  ).setFiles([photo, { ...photo, name: "second-angle.png" }]);
  await expect(page.getByText("Example verdict")).toBeVisible();
});
