import { assert, describe } from "@effect/vitest";

import { createOxlintRuleHarness } from "../test/utils.ts";

const RULE_NAME = "require-static-classes";

const webFile = createOxlintRuleHarness(`t3code/${RULE_NAME}`, {
  filename: "apps/web/src/components/example/Surface.tsx",
});
const uiFile = createOxlintRuleHarness(`t3code/${RULE_NAME}`, {
  filename: "apps/web/src/components/ui/surface.tsx",
});

const runtimeClassName = `
  import { Button } from "~/components/ui/button";

  export const Save = (props: { readonly look: string }) => (
    <Button className={props.look}>Save</Button>
  );
`;

describe("t3code/require-static-classes", () => {
  webFile.valid(
    "allows a static className on a ui export",
    `
      import { Button } from "~/components/ui/button";

      export const save = <Button className="mt-4 w-full">Save</Button>;
    `,
  );

  webFile.valid(
    "leaves elements that are not ui exports alone",
    `export const Save = (props: { readonly look: string }) => <button className={props.look}>Save</button>;`,
  );

  uiFile.valid("does not check the ui components themselves", runtimeClassName);

  webFile.invalid(
    "reports a className built at runtime on a ui export",
    runtimeClassName,
    (output) => {
      assert.match(output, /"ruleName":"require-static-classes"/u);
      assert.include(output, String.raw`"fingerprint":"<Button> in props.look"`);
      assert.match(output, /"ledgered":false/u);
    },
    1,
  );
});
