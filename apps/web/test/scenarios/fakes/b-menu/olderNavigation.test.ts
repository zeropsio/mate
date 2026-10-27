import { expect, it } from "vite-plus/test";
import { olderNavigation } from "./olderNavigation.ts";

it("omits only the newer app offer and Core declaration", () => {
  expect(
    JSON.parse(
      olderNavigation(
        JSON.stringify({
          type: "scope-reset",
          scope: { kind: "navigation" },
          incarnation: "i",
          revision: 1,
          values: [
            { key: "app:shop", value: { name: "Shop", releaseOffer: null, projectIds: ["ada"] } },
            { key: "project:ada", value: { appId: "shop" } },
          ],
          removals: [],
        }),
      ),
    ),
  ).toEqual({
    type: "scope-reset",
    scope: { kind: "navigation" },
    incarnation: "i",
    revision: 1,
    removals: [],
    values: [
      { key: "app:shop", value: { name: "Shop", projectIds: ["ada"] } },
      { key: "project:ada", value: { appId: "shop" } },
    ],
  });
  expect(
    olderNavigation(
      JSON.stringify({
        type: "scope-ready",
        scope: { kind: "navigation" },
        incarnation: "i",
        revision: 1,
        core: { protocol: 1, build: "build" },
      }),
    ),
  ).not.toContain("core");
  expect(olderNavigation("binary-or-other-frame")).toBe("binary-or-other-frame");
});
