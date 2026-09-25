import { assert, describe } from "@effect/vitest";

import { createOxlintRuleHarness } from "../test/utils.ts";

const RULE_NAME = "no-arbitrary-values";

const webFile = createOxlintRuleHarness(`t3code/${RULE_NAME}`, {
  filename: "apps/web/src/components/example/Surface.tsx",
});
const uiFile = createOxlintRuleHarness(`t3code/${RULE_NAME}`, {
  filename: "apps/web/src/components/ui/surface.tsx",
});

describe("t3code/no-arbitrary-values", () => {
  webFile.valid(
    "allows theme tokens and scale steps",
    `export const row = <div className="text-2xs p-4 text-muted-foreground">Row</div>;`,
  );

  webFile.valid(
    "leaves layout values free",
    `export const row = <div className="w-[240px] max-w-[48%] grid-cols-[1fr_auto]">Row</div>;`,
  );

  webFile.valid(
    "allows the values no scale can hold",
    `export const chip = <span className="gap-[0.33em] px-[0.5em] text-[0.86em] bg-[Highlight]">@file</span>;`,
  );

  uiFile.valid(
    "does not check the ui components themselves",
    `export const Surface = () => <div className="text-[11px]">Row</div>;`,
  );

  webFile.invalid(
    "reports an arbitrary appearance value",
    `export const row = <div className="flex text-[11px]">Row</div>;`,
    (output) => {
      assert.match(output, /"ruleName":"no-arbitrary-values"/u);
      assert.include(output, String.raw`"fingerprint":"<> text-[11px] in \"flex text-[11px]\""`);
      assert.match(output, /"ledgered":false/u);
    },
    1,
  );
});
