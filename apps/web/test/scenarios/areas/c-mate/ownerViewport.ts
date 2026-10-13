import type { Page } from "puppeteer-core";

/** The reported conversation viewport and menu width, set through the real resize control. */
export async function ownerViewport(page: Page) {
  await page.setViewport({ width: 1786, height: 1000 });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
  const rail = (await page.$('[data-sidebar="rail"]'))!;
  const box = (await rail.boundingBox())!;
  const width = await page.$eval(
    '[data-sidebar="sidebar"]',
    (node) => node.getBoundingClientRect().width,
  );
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 435 - width, box.y + box.height / 2);
  await page.mouse.up();
  await page.waitForFunction(
    () => document.querySelector('[data-sidebar="sidebar"]')!.getBoundingClientRect().width === 435,
  );
}
