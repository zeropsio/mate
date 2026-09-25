import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { type ExceptionEntry } from "../exceptions.ts";
import { createOxlintRuleHarness } from "../test/utils.ts";

const RULE_NAME = "no-restyle";
const LEDGER_DIRECTORY_ENV = "T3CODE_NO_RESTYLE_LEDGER_DIRECTORY";
const encodeUnknownJson = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

const webFile = createOxlintRuleHarness(`t3code/${RULE_NAME}`, {
  filename: "apps/web/src/components/example/Surface.tsx",
});
const zeropsFile = createOxlintRuleHarness(`t3code/${RULE_NAME}`, {
  filename: "apps/web/src/components/zerops/Surface.tsx",
});
const uiFile = createOxlintRuleHarness(`t3code/${RULE_NAME}`, {
  filename: "apps/web/src/components/ui/surface.tsx",
});
const mobileFile = createOxlintRuleHarness(`t3code/${RULE_NAME}`, {
  filename: "apps/mobile/src/features/example/Surface.tsx",
});

const withFixtureLedger = <A, E, R>(
  entries: ReadonlyArray<ExceptionEntry>,
  effect: Effect.Effect<A, E, R>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "restyle-ledger-" });
      yield* fs.writeFileString(
        path.join(directory, `${RULE_NAME}.json`),
        `${encodeUnknownJson(entries)}\n`,
      );

      const environment = globalThis.process.env;
      const previous = environment[LEDGER_DIRECTORY_ENV];
      environment[LEDGER_DIRECTORY_ENV] = directory;

      return yield* effect.pipe(
        Effect.ensuring(
          Effect.sync(() => {
            if (previous === undefined) delete environment[LEDGER_DIRECTORY_ENV];
            else environment[LEDGER_DIRECTORY_ENV] = previous;
          }),
        ),
      );
    }),
  );

const restyledButton = `
  import { Button } from "~/components/ui/button";

  export const save = <Button className="bg-red-500">Save</Button>;
`;

describe("t3code/no-restyle", () => {
  webFile.valid(
    "allows layout classes on a ui export",
    `
      import { Button } from "~/components/ui/button";

      export const save = <Button className="mt-4 w-full">Save</Button>;
    `,
  );

  webFile.valid(
    "lets a CollapsibleTrigger take its look from className",
    `
      import { CollapsibleTrigger } from "~/components/ui/collapsible";

      export const row = (
        <CollapsibleTrigger className="flex items-center gap-2 px-2 text-sm text-muted-foreground">
          Details
        </CollapsibleTrigger>
      );
    `,
  );

  webFile.valid(
    "leaves elements that are not ui exports alone",
    `export const save = <button className="bg-red-500">Save</button>;`,
  );

  uiFile.valid(
    "does not check the ui components themselves",
    `
      import { Button } from "~/components/ui/button";

      export const Save = () => <Button className="bg-red-500">Save</Button>;
    `,
  );

  mobileFile.valid(
    "does not check code outside the web app",
    `
      import { Button } from "~/components/ui/button";

      export const save = <Button className="bg-red-500">Save</Button>;
    `,
  );

  webFile.invalid("reports an appearance class on a ui export", restyledButton, (output) => {
    assert.match(output, /"bg-red-500" is not allowed on <Button>/u);
    assert.match(output, /T3CODE_GUARD_FINDING:/u);
    assert.match(output, /"ruleName":"no-restyle"/u);
    assert.match(output, /"kind":"Literal"/u);
    assert.include(output, String.raw`"fingerprint":"<Button> bg-red-500 in \"bg-red-500\""`);
    assert.match(output, /"ledgered":false/u);
  });

  zeropsFile.invalid(
    "holds the fork's own surfaces to the same rule",
    `
      import { Badge } from "~/components/ui/badge";

      export const tag = <Badge className="rounded-full px-3">prod</Badge>;
    `,
    undefined,
    2,
  );
});

it.layer(NodeServices.layer)("temporary no-restyle ledger", (it) => {
  it.effect("suppresses an exact finding from a fixture ledger", () =>
    withFixtureLedger(
      [
        {
          path: "apps/web/src/components/example/Surface.tsx",
          kind: "Literal",
          fingerprint: '<Button> bg-red-500 in "bg-red-500"',
          owner: "karel",
          reason: "fixture exception",
          expires: "F6",
        },
      ],
      webFile.run(restyledButton),
    ),
  );
});
