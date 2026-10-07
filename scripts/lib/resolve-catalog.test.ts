import { assert, describe, it } from "@effect/vitest";

import { resolveCatalogDependencies } from "./resolve-catalog.ts";

const catalog = { effect: "4.0.0-rc.115", "@clerk/backend": "3.18.1", react: "19.2.0" };

describe("resolveCatalogDependencies", () => {
  it("resolves version-qualified overrides without changing their selectors", () => {
    assert.deepStrictEqual(
      resolveCatalogDependencies(
        {
          "undici@^8": "catalog:",
          "ws@^8": "catalog:",
          "@clerk/backend@^3": "catalog:",
          "@scope/parent@^1>undici@^8": "catalog:",
          "parent@^1>@clerk/backend@^3": "catalog:",
        },
        { ...catalog, undici: "8.11.2", ws: "8.21.0" },
        "apps/desktop",
      ),
      {
        "undici@^8": "8.11.2",
        "ws@^8": "8.21.0",
        "@clerk/backend@^3": "3.18.1",
        "@scope/parent@^1>undici@^8": "8.11.2",
        "parent@^1>@clerk/backend@^3": "3.18.1",
      },
    );
  });
});
