import { expect, it } from "vite-plus/test";

import { hqSocketNameForLoad } from "./hq/socketName.ts";

// witness: packages/client-runtime/src/zerops/hq/socketName.ts | ): string => (navigation === "reload" && stored !== null && stored !== "" ? stored : fresh); → ): string => (stored !== null && stored !== "" ? stored : fresh);
it("ZV153: A tab's HQ socket name is kept across a reload and is fresh on any other load, a duplicated tab's included; breaks: a reload drops a press held before it, or a duplicated tab shares its source's held presses", () => {
  expect(hqSocketNameForLoad("reload", "kept-name", "fresh-name")).toBe("kept-name");
  // A duplicated tab copies its source's stored name and loads as a navigation, never a reload.
  expect(hqSocketNameForLoad("navigate", "kept-name", "fresh-name")).toBe("fresh-name");
  expect(hqSocketNameForLoad("reload", null, "fresh-name")).toBe("fresh-name");
});
