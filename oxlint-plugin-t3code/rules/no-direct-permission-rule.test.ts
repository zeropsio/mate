import { assert, describe } from "@effect/vitest";

import { createOxlintRuleHarness } from "../test/utils.ts";

const RULE = "t3code/no-direct-permission-rule";
const webFile = createOxlintRuleHarness(RULE, { filename: "apps/web/src/zerops/offersLike.ts" });
const mobileFile = createOxlintRuleHarness(RULE, {
  filename: "apps/mobile/src/features/zerops/screen.tsx",
});
const runtimeFile = createOxlintRuleHarness(RULE, {
  filename: "packages/client-runtime/src/zerops/barrel.ts",
});
const sharedFile = createOxlintRuleHarness(RULE, { filename: "packages/shared/src/index.ts" });
const offersFile = createOxlintRuleHarness(RULE, {
  filename: "packages/client-runtime/src/zerops/offers.ts",
});
const ruleItself = createOxlintRuleHarness(RULE, {
  filename: "packages/shared/src/zeropsPermissions.ts",
});
const testFile = createOxlintRuleHarness(RULE, {
  filename: "packages/client-runtime/src/zerops/hq/refusals.test.ts",
});
const hqFile = createOxlintRuleHarness(RULE, { filename: "apps/hq/src/api.ts" });

/** The import offers.ts makes, as its ledger entry names it. */
const OFFERS_IMPORT = `import {
  can,
  type Facts,
  type FactsFor,
  type Held,
  type Principal,
  type Reason,
  type Targets,
  type Verb,
} from "@t3tools/shared/zeropsPermissions";`;

describe("t3code/no-direct-permission-rule", () => {
  webFile.valid(
    "allows a type import",
    `import type { Reason } from "@t3tools/shared/zeropsPermissions";`,
  );
  webFile.valid(
    "allows an import of types alone",
    `import { type Reason, type Verb } from '@t3tools/shared/zeropsPermissions';`,
  );
  webFile.valid(
    "allows a type re-export",
    `export type { Reason } from "@t3tools/shared/zeropsPermissions";`,
  );
  webFile.valid("allows cached facts", `const facts = { freshness: "cached", members: [] };`);
  webFile.valid(
    "allows another freshness, such as a listing's",
    `const listing = { freshness: { kind: "live" } };`,
  );

  offersFile.valid("allows offers.ts the import its ledger lists", OFFERS_IMPORT);
  ruleItself.valid(
    "leaves the rule's own module alone",
    `export const facts = { freshness: "fresh" };`,
  );
  testFile.valid(
    "leaves tests alone",
    `import { REASONS } from "@t3tools/shared/zeropsPermissions";`,
  );
  hqFile.valid(
    "leaves HQ, which enforces the rule, alone",
    `import { can } from "@t3tools/shared/zeropsPermissions";`,
  );

  webFile.invalid(
    "reports a named import of a value",
    `import { can } from "@t3tools/shared/zeropsPermissions";`,
  );
  webFile.invalid(
    "reports one in single quotes",
    `import { REASONS } from '@t3tools/shared/zeropsPermissions';`,
  );
  webFile.invalid(
    "reports a namespace import",
    `import * as P from "@t3tools/shared/zeropsPermissions"; P.can;`,
  );
  webFile.invalid(
    "reports a value beside types",
    `import { type Verb, can } from "@t3tools/shared/zeropsPermissions";`,
  );
  mobileFile.invalid(
    "reports it in the mobile app",
    `import { can } from "@t3tools/shared/zeropsPermissions";`,
  );
  runtimeFile.invalid(
    "reports a barrel re-export",
    `export { can } from "@t3tools/shared/zeropsPermissions";`,
  );
  runtimeFile.invalid(
    "reports a re-export of everything",
    `export * from "@t3tools/shared/zeropsPermissions";`,
  );
  runtimeFile.invalid(
    "reports a relative path into the shared source",
    `import { can } from "../../../shared/src/zeropsPermissions.ts";`,
  );
  sharedFile.invalid(
    "reports a shared module passing it on",
    `export { can } from "./zeropsPermissions.ts";`,
  );
  webFile.invalid(
    "reports a dynamic import",
    `const rule = await import("@t3tools/shared/zeropsPermissions");`,
  );
  webFile.invalid(
    "reports fresh facts",
    `const facts = { freshness: "fresh", members: [], projects: [] };`,
  );
  webFile.invalid(
    "reports fresh facts by a constant",
    `const FRESH = "fresh"; const facts = { freshness: FRESH, members: [] };`,
  );
  webFile.invalid(
    "reports fresh facts asserted",
    `const facts = { "freshness": "fresh" as const };`,
  );

  webFile.invalid(
    "includes the exception-ledger payload in diagnostics",
    `import { can } from "@t3tools/shared/zeropsPermissions";`,
    (output) => {
      assert.match(output, /T3CODE_GUARD_FINDING:/u);
      assert.match(output, /"ruleName":"no-direct-permission-rule"/u);
      assert.match(output, /"ledgered":false/u);
    },
  );
});
