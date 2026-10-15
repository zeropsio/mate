import { assert, describe } from "@effect/vitest";

import { createOxlintRuleBatch } from "../test/utils.ts";

const batch = createOxlintRuleBatch("t3code/no-unguarded-storage-write");

const app = batch.createHarness({ filename: "apps/web/src/feature.ts" });
const guard = batch.createHarness({ filename: "apps/web/src/lib/storage.ts" });
const appTest = batch.createHarness({ filename: "apps/web/src/feature.test.ts" });

describe("t3code/no-unguarded-storage-write", () => {
  app.valid(
    "allows a write through the guard",
    `writeBrowserStorage(window.localStorage, "key", "value");`,
  );

  app.valid("allows a tab's sessionStorage", `window.sessionStorage.setItem("key", "value");`);

  app.valid("allows a store's own setItem", `accountLocalStorage.setItem("key", "value");`);

  guard.valid(
    "allows the guard itself",
    `storage.setItem(key, value); localStorage.setItem(k, v);`,
  );

  appTest.valid("allows tests to seed storage", `window.localStorage.setItem("key", "value");`);

  app.invalid(
    "reports a direct write to window.localStorage",
    `window.localStorage.setItem("key", "value");`,
    (output) => {
      assert.match(output, /writeBrowserStorage/);
    },
  );

  app.invalid("reports a direct write to the global", `localStorage.setItem("key", "value");`);

  app.invalid(
    "reports a write to an injected browser's localStorage",
    `browser.localStorage.setItem("key", "value");`,
  );

  app.invalid(
    "reports a write to a storage chosen between localStorage and another",
    `(session ? window.localStorage : accountLocalStorage).setItem("key", "value");`,
  );
});
