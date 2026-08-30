import { assert, describe } from "@effect/vitest";

import { createOxlintRuleHarness } from "../test/utils.ts";

const guardedFile = createOxlintRuleHarness("t3code/no-platform-globals", {
  filename: "packages/client-runtime/src/zerops/probe.ts",
});
const webFile = createOxlintRuleHarness("t3code/no-platform-globals", {
  filename: "apps/web/src/zerops/firstPromptStorage.ts",
});
const guardedTestFile = createOxlintRuleHarness("t3code/no-platform-globals", {
  filename: "packages/client-runtime/src/zerops/probe.test.ts",
});

describe("t3code/no-platform-globals", () => {
  guardedFile.valid(
    "allows parameters named like platform globals",
    `function decodeError(document: Record<string, unknown>) { return document.x; }`,
  );

  guardedFile.valid(
    "allows local bindings named like platform globals",
    `const window = 1; export const y = window + 1;`,
  );

  guardedFile.valid(
    "allows property keys on objects",
    `const value = options.fetch ?? globalThis.fetch.bind(globalThis);`,
  );

  guardedFile.valid("allows object literal property keys", `const o = { fetch: 1, window: 2 };`);

  guardedFile.valid(
    "allows imported bindings named like platform globals",
    `import { fetch } from "./fetchLike.ts"; fetch("x");`,
  );

  guardedFile.valid("ignores comments", `// window.localStorage`);

  webFile.valid(
    "does not impose the client-runtime policy on web adapters",
    `window.localStorage.getItem("k");`,
  );

  guardedTestFile.valid("does not impose the policy on tests", `fetch("x");`);

  guardedFile.invalid("reports window reads", `window.localStorage.getItem("k");`);
  guardedFile.invalid("reports document reads", `document.title;`);
  guardedFile.invalid("reports localStorage reads", `localStorage.setItem("k", "v");`);
  guardedFile.invalid("reports fetch calls", `fetch("https://x");`);
  guardedFile.invalid("reports captured fetch references", `const f = fetch;`);
  guardedFile.invalid("reports typeof checks", `typeof window !== "undefined";`);
  guardedFile.invalid("reports computed property references", `const f = options[fetch];`);

  guardedFile.invalid(
    "includes the exception-ledger payload in diagnostics",
    `fetch("x");`,
    (output) => {
      assert.match(output, /T3CODE_GUARD_FINDING:/u);
      assert.match(output, /"ruleName":"no-platform-globals"/u);
      assert.match(output, /"ledgered":false/u);
    },
  );
});
