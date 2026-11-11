import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { type ExceptionEntry, FINDING_MESSAGE_MARKER } from "../exceptions.ts";
import { createOxlintRuleBatch } from "../test/utils.ts";

const RULE_NAME = "no-legacy-vocabulary";
const LEDGER_DIRECTORY_ENV = "T3CODE_LEGACY_VOCABULARY_LEDGER_DIRECTORY";
const encodeUnknownJson = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

const batch = createOxlintRuleBatch("t3code/no-legacy-vocabulary");

const webFile = batch.createHarness({
  filename: "apps/web/src/components/Probe.tsx",
});
const mobileFile = batch.createHarness({
  filename: "apps/mobile/src/components/Probe.tsx",
});
const copyModule = batch.createHarness({
  filename: "apps/web/src/versionSkew.ts",
});
const copyComponentModule = batch.createHarness({
  filename: "apps/web/src/components/RightPanelTabs.tsx",
});
const rightPanelKindsCopyModule = batch.createHarness({
  filename: "apps/web/src/rightPanelKinds.ts",
});
const ordinaryModule = batch.createHarness({
  filename: "apps/web/src/copy.ts",
});
const testFile = batch.createHarness({
  filename: "apps/web/src/components/Probe.test.tsx",
});

const withFixtureLedger = <A, E, R>(entry: ExceptionEntry, effect: Effect.Effect<A, E, R>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "legacy-vocabulary-ledger-" });
      yield* fs.writeFileString(
        path.join(directory, `${RULE_NAME}.json`),
        `${encodeUnknownJson([entry])}\n`,
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

describe("t3code/no-legacy-vocabulary", () => {
  webFile.invalid("reports legacy product names in JSX text", `const view = <p>Open T3 Code</p>;`);

  webFile.invalid(
    "reports case-insensitive pairing copy in aria labels",
    `const view = <Foo aria-label="Pairing token" />;`,
  );

  webFile.invalid(
    "reports pairing copy in placeholders",
    `const view = <Input placeholder="Paste a pairing secret" />;`,
  );

  webFile.invalid(
    "reports legacy product names passed through error props",
    `const view = <Foo error="Update your T3 Code servers" />;`,
  );

  mobileFile.invalid(
    "reports legacy product names in mobile accessibility labels",
    `const view = <Text accessibilityLabel="T3 Code, Threads" />;`,
  );

  webFile.invalid(
    "reports T3 Connect copy passed through title props",
    `const view = <Foo title="Sign in to T3 Connect" />;`,
  );

  webFile.invalid(
    "reports self-descriptions that say control plane",
    `const view = <span>the control plane</span>;`,
  );

  webFile.invalid(
    "reports the case-sensitive Local checkout phrase",
    `const view = <span>Local checkout</span>;`,
  );

  webFile.invalid("keeps guarding the retired Tailscale name", `const view = <p>Tailscale</p>;`);

  copyModule.invalid(
    "reports template elements in registered copy modules",
    "const label = `Previous worktree (${name})`;",
  );

  webFile.invalid(
    "reports template elements passed through sink attributes",
    "const view = <Foo accessibilityHint={`Previous worktree (${name})`} />;",
  );

  copyModule.invalid(
    "reports string literals in registered copy modules",
    `const label = "New worktree";`,
  );

  rightPanelKindsCopyModule.invalid(
    "reports unavailable hints in the right-panel copy module",
    `const meta = { unavailableHint: "Available in this worktree." };`,
  );

  ordinaryModule.invalid(
    "reports literals in named object copy properties",
    `const item = { label: "Open T3 Code" };`,
  );

  ordinaryModule.invalid(
    "reports conditional branches in named object copy properties",
    `const item = { label: ready ? "T3 Code" : "Ready" };`,
  );

  ordinaryModule.invalid(
    "reports logical branches in named object copy properties",
    `const item = { title: ready && "Pairing" };`,
  );

  ordinaryModule.invalid(
    "reports parenthesized branches in named object copy properties",
    `const item = { label: (ready ? "T3 Code" : "Ready") };`,
  );

  ordinaryModule.invalid(
    "reports literals under statically known computed copy keys",
    `const item = { ["label"]: "Open T3 Code" };`,
  );

  ordinaryModule.invalid(
    "reports branches under static template copy keys",
    'const item = { [`title`]: ready ? "Pairing" : "Ready" };',
  );

  webFile.invalid(
    "reports string literals in direct JSX expression children",
    `const view = <p>{"T3 Code"}</p>;`,
  );

  webFile.invalid(
    "reports conditional string branches in direct JSX expression children",
    `const view = <p>{ready ? "Pairing…" : "Ready"}</p>;`,
  );

  webFile.invalid(
    "reports logical string branches in direct JSX expression children",
    `const view = <p>{ready && "Pairing…"}</p>;`,
  );

  webFile.invalid(
    "reports statically concatenated sink copy",
    `const view = <Foo title={"T3 " + "Code"} />;`,
  );

  webFile.invalid(
    "reports statically interpolated sink copy",
    'const view = <Foo title={`T3 ${"Code"}`} />;',
  );

  webFile.invalid(
    "appends the machine-readable ledger tail to findings",
    `const view = <Foo message="Pairing failed" />;`,
    (output) => {
      assert.match(output, new RegExp(FINDING_MESSAGE_MARKER));
      assert.match(output, /"kind":"Literal"/u);
      assert.match(output, /"ledgered":false/u);
    },
  );

  // The glossary's retired words, each reported with the word that replaces it.
  const RETIRED_WORDS: ReadonlyArray<{
    readonly copy: string;
    readonly name: string;
    readonly say: string;
  }> = [
    { copy: "Log in to Zerops", name: "log in", say: "sign in, signed in, sign out" },
    {
      copy: "Already have an account? Log in",
      name: "log in",
      say: "sign in, signed in, sign out",
    },
    { copy: "Zerops Mate is logged in.", name: "log in", say: "sign in, signed in, sign out" },
    { copy: "Log out", name: "log in", say: "sign in, signed in, sign out" },
    { copy: "No open pull request found.", name: "pull request", say: "change" },
    { copy: "Open PR", name: "pull request", say: "change" },
    {
      copy: "Squash-merges 3 commits into main as one.",
      name: "squash",
      say: "adds {Mate}'s work to the main version",
    },
    { copy: "Merge to stage", name: "merge to stage", say: "approve it; it runs on Stage" },
    { copy: "appdev #1 landed", name: "landed", say: "merged, or in {Mate}'s code" },
    {
      copy: "History · appdev",
      name: "appdev",
      say: "{Mate}'s workspace, or {Mate}'s preview for its own address",
    },
    { copy: "Northwind has no recipe yet.", name: "recipe", say: "setup, or setup files" },
    { copy: "The group's import files", name: "import files", say: "setup files" },
    { copy: "from zcp's status file", name: "zcp", say: "Zerops Control Plane" },
    {
      copy: "Sign in a coding agent",
      name: "sign in an agent",
      say: "Sign {Mate} in with Claude or ChatGPT",
    },
    {
      copy: "Needs Basic user access",
      name: "Basic user",
      say: "Works on every project, or Edit",
    },
    {
      copy: "Set custom accesses",
      name: "accesses",
      say: "access, or what it opens: Choose projects",
    },
    { copy: "Add your domain", name: "Add your domain", say: "Put it on your domain" },
    { copy: "Open a surface", name: "surface", say: "page" },
  ];

  for (const { copy, name, say } of RETIRED_WORDS) {
    webFile.invalid(
      `reports "${copy}" and says what replaces ${name}`,
      `const view = <p>${copy}</p>;`,
      (output) => {
        assert.include(output, `(${name})`);
        assert.include(output, `say \\"${say}\\"`);
      },
    );
  }

  for (const copy of [
    "Sign in to Mate",
    "The last backup failed. HQ's log in Zerops says why.",
    "Add another login",
    "Merged into main",
    "Theme surface",
  ]) {
    webFile.valid(`allows the glossary's own words: "${copy}"`, `const view = <p>${copy}</p>;`);
  }

  webFile.valid(
    "allows the required Zerops Control Plane service name",
    `const view = <span>Zerops Control Plane</span>;`,
  );

  copyComponentModule.valid("ignores value attributes", `const view = <Foo value="worktree" />;`);

  copyComponentModule.valid("ignores id attributes", `const view = <Foo id="pairing-token" />;`);

  copyComponentModule.valid("ignores import declarations", `import token from "./pairing";`);

  copyComponentModule.valid("ignores identifiers", `const pairingToken = 1;`);

  copyComponentModule.valid("ignores comments", `const ready = 1; // pairing`);

  copyComponentModule.valid(
    "ignores data attributes",
    `const view = <Foo data-testid="worktree" />;`,
  );

  copyComponentModule.valid("ignores import expressions", `const token = import("./pairing");`);

  copyComponentModule.valid(
    "ignores statically composed import expressions",
    `const token = import("./pair" + "ing");`,
  );

  copyComponentModule.valid("ignores object property keys", `const item = { "pairing": true };`);

  copyComponentModule.valid(
    "ignores Schema literal tags",
    `const one = Schema.Literal("worktree"); const many = Schema.Literals(["local", "worktree"]);`,
  );

  copyComponentModule.valid(
    "ignores TypeScript literal union tags",
    `type WorkspaceMode = "local" | "worktree";`,
  );

  copyComponentModule.valid(
    "ignores equality discriminants",
    `const selected = mode === "worktree";`,
  );

  copyComponentModule.valid(
    "ignores equality discriminants nested inside copy attributes",
    `const view = <Foo label={mode === "worktree" ? "Ready" : "Unavailable"} />;`,
  );

  copyComponentModule.valid(
    "ignores switch discriminants",
    `switch (mode) { case "worktree": break; }`,
  );

  copyComponentModule.valid(
    "ignores kebab-case technical identifiers",
    `const operation = "create-pairing-credential";`,
  );

  ordinaryModule.valid(
    "ignores namespaced kebab-case identifiers in named properties",
    `const command = { label: "web:connection:connect-pairing" };`,
  );

  copyComponentModule.valid(
    "ignores snake_case technical identifiers",
    `const operation = "create_pairing_credential";`,
  );

  copyComponentModule.valid(
    "ignores statically composed object property keys",
    `const item = { ["T3 " + "Code"]: true };`,
  );

  webFile.valid(
    "keeps Local checkout matching case-sensitive",
    `const view = <span>local checkout</span>;`,
  );

  ordinaryModule.valid(
    "ignores ordinary string literals outside registered copy modules",
    `const internalValue = "New worktree";`,
  );

  ordinaryModule.valid(
    "ignores literals in non-copy object properties",
    `const item = { id: "T3 Code" };`,
  );

  ordinaryModule.valid(
    "ignores object shorthand",
    `const label = "ready"; const item = { label };`,
  );

  ordinaryModule.valid(
    "ignores dynamic computed property keys",
    `const item = { [copyKey]: "T3 Code" };`,
  );

  ordinaryModule.valid(
    "ignores dynamic templates in non-sink positions",
    "const internalValue = `${name} worktree`;",
  );

  testFile.valid("skips test files", `const view = <p>Pairing with T3 Code</p>;`);
});

it.layer(NodeServices.layer)("temporary legacy-vocabulary ledger", (it) => {
  it.effect("suppresses a reviewed fingerprint from a fixture ledger", () => {
    const fingerprint =
      '"Version mismatch. Try syncing the client and server to the same T3 Code version."';

    return withFixtureLedger(
      {
        path: "apps/web/src/versionSkew.ts",
        kind: "Literal",
        fingerprint,
        owner: "karel",
        reason: "fixture exception",
        expires: "F2",
      },
      copyModule.run(`const hint = ${fingerprint};`),
    );
  });
});
