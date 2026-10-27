import { expect, it, inject } from "vite-plus/test";
import puppeteer from "puppeteer-core";
import { sampleImageLayout } from "./imageLayout.ts";

it.each([
  {
    title: "a settled table discards resize deliveries from its initial placement",
    oscillates: false,
  },
  {
    title: "a table still resizing in the final frames fails the stability witness",
    oscillates: true,
  },
])("$title", async ({ oscillates }) => {
  const browser = await puppeteer.connect({ browserWSEndpoint: inject("scenarioBrowserEndpoint") });
  const context = await browser.createBrowserContext();
  try {
    const page = await context.newPage();
    await page.setContent(
      '<div class="timeline-legend-list"><table style="height:100px;width:100px"><tbody><tr><td>Picture</td></tr></tbody></table></div>',
    );
    await page.evaluate((oscillates) => {
      const NativeResizeObserver = ResizeObserver;
      // Make the first native delivery precede the resize, independently of CDP/host timing.
      window.ResizeObserver = class extends NativeResizeObserver {
        constructor(callback: ResizeObserverCallback) {
          let resized = false;
          super((entries, observer) => {
            callback(entries, observer);
            if (!entries.some((entry) => entry.target.tagName === "TABLE")) return;
            if (resized && !oscillates) return;
            resized = true;
            requestAnimationFrame(() => {
              const table = document.querySelector("table")!;
              table.style.height = table.style.height === "100px" ? "200px" : "100px";
            });
          });
        }
      };
    }, oscillates);
    const { readings, deliveries } = await page.evaluate(sampleImageLayout);
    const frameSizes = new Set(readings.map((reading) => JSON.stringify(reading)));
    const resizeSizes = new Set(deliveries.map((reading) => JSON.stringify(reading)));
    if (oscillates) {
      expect(frameSizes.size).toBeGreaterThan(1);
      expect(resizeSizes.size).toBeGreaterThan(1);
    } else {
      expect(frameSizes.size).toBe(1);
      expect(resizeSizes.size).toBeLessThanOrEqual(1);
    }
  } finally {
    await context.close();
    await browser.disconnect();
  }
});
