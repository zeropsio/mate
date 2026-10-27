import { assert, describe } from "@effect/vitest";

import { createOxlintRuleBatch } from "../test/utils.ts";

const RULE_NAME = "no-unknown-classes";

const batch = createOxlintRuleBatch(`t3code/${RULE_NAME}`);

const webFile = batch.createHarness({
  filename: "apps/web/src/components/example/Surface.tsx",
});
const uiFile = batch.createHarness({
  filename: "apps/web/src/components/ui/surface.tsx",
});
const mobileFile = batch.createHarness({
  filename: "apps/mobile/src/features/example/Surface.tsx",
});

describe("t3code/no-unknown-classes", () => {
  webFile.valid(
    "allows classes Tailwind generates",
    `export const row = <div className="flex items-center gap-2 text-sm">Row</div>;`,
  );

  mobileFile.valid(
    "does not check code outside the web app",
    `export const row = <div className="a-hook-class">Row</div>;`,
  );

  webFile.invalid(
    "reports a class nothing declares",
    `export const row = <div className="flex a-hook-class">Row</div>;`,
    (output) => {
      assert.match(output, /a-hook-class/u);
      assert.match(output, /"ruleName":"no-unknown-classes"/u);
      assert.include(output, String.raw`"fingerprint":"<> a-hook-class in \"flex a-hook-class\""`);
      assert.match(output, /"ledgered":false/u);
    },
    1,
  );

  uiFile.invalid(
    "holds the ui components to it too",
    `export const Surface = () => <div className="flx">Row</div>;`,
  );
});
