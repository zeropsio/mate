import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { type ExceptionEntry } from "../exceptions.ts";
import { createOxlintRuleHarness } from "../test/utils.ts";

const RULE = "t3code/no-failure-to-empty";
const LEDGER_DIRECTORY_ENV = "T3CODE_FAILURE_TO_EMPTY_LEDGER_DIRECTORY";
const encodeUnknownJson = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

const webHook = createOxlintRuleHarness(RULE, { filename: "apps/web/src/zerops/useFixture.ts" });
const webComponent = createOxlintRuleHarness(RULE, {
  filename: "apps/web/src/components/zerops/ZeropsFixture.tsx",
});
const CAUGHT_EMPTY = `export const read = (client) => client.listTags("o", "r").catch(() => []);`;
const guardedFiles = [
  "apps/web/src/components/zerops/ZeropsFixture.tsx",
  "packages/client-runtime/src/zerops/forge/fixture.ts",
];
const unguardedFiles = [
  "apps/web/src/components/Fixture.tsx",
  "apps/mobile/src/features/zerops/fixture.ts",
  "packages/client-runtime/src/connection/fixture.ts",
  "apps/web/src/zerops/useFixture.test.ts",
  "packages/client-runtime/src/zerops/forge/fixture.test.ts",
];

const withEnvironment = <A, E, R>(
  values: Readonly<Record<string, string>>,
  effect: Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const environment = globalThis.process.env;
    const previous = Object.fromEntries(Object.keys(values).map((key) => [key, environment[key]]));
    Object.assign(environment, values);
    return yield* effect.pipe(
      Effect.ensuring(
        Effect.sync(() => {
          for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete environment[key];
            else environment[key] = value;
          }
        }),
      ),
    );
  });

const withFixtureLedger = <A, E, R>(
  entries: ReadonlyArray<ExceptionEntry>,
  effect: Effect.Effect<A, E, R>,
  reportLedgered = false,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "failure-to-empty-ledger-" });
      yield* fs.writeFileString(
        path.join(directory, "no-failure-to-empty.json"),
        `${encodeUnknownJson(entries)}\n`,
      );
      return yield* withEnvironment(
        {
          [LEDGER_DIRECTORY_ENV]: directory,
          ...(reportLedgered ? { T3CODE_GUARD_REPORT_LEDGERED: "1" } : {}),
        },
        effect,
      );
    }),
  );

const CAUGHT_EMPTY_ENTRY: ExceptionEntry = {
  path: "apps/web/src/zerops/useFixture.ts",
  kind: "CallExpression",
  fingerprint: `client.listTags("o", "r").catch(() => [])`,
  owner: "state-model 4.1",
  reason: "fixture exception",
  expires: "never",
};

it.layer(NodeServices.layer)("no-failure-to-empty ledger", (it) => {
  it.effect("an exact ledger entry suppresses the finding", () =>
    withFixtureLedger([CAUGHT_EMPTY_ENTRY], webHook.run(CAUGHT_EMPTY)),
  );

  it.effect("the reconciliation driver still sees a ledgered finding", () =>
    withFixtureLedger([CAUGHT_EMPTY_ENTRY], webHook.runAndExpectFailure(CAUGHT_EMPTY), true).pipe(
      Effect.tap((output) => Effect.sync(() => assert.match(output, /"ledgered":true/u))),
    ),
  );

  it.effect("an unlisted finding says it is not ledgered", () =>
    withFixtureLedger([], webHook.runAndExpectFailure(CAUGHT_EMPTY)).pipe(
      Effect.tap((output) => Effect.sync(() => assert.match(output, /"ledgered":false/u))),
    ),
  );
});

describe(RULE, () => {
  for (const filename of guardedFiles) {
    createOxlintRuleHarness(RULE, { filename }).invalid(`guards ${filename}`, CAUGHT_EMPTY);
  }

  for (const filename of unguardedFiles) {
    createOxlintRuleHarness(RULE, { filename }).valid(`does not guard ${filename}`, CAUGHT_EMPTY);
  }

  for (const empty of ["[]", "undefined", "null"]) {
    webHook.invalid(
      `reports a failed read caught into ${empty}`,
      `export const read = (client) => client.listTags("o", "r").catch(() => ${empty});`,
      (output) => assert.match(output, /"kind":"CallExpression"/u),
    );
  }

  for (const [name, handler] of [
    ["a typed arrow", "(): ReadonlyArray<string> => []"],
    ["a block that returns the empty", "() => { return null; }"],
    ["a block that logs, then returns the empty", "(cause) => { console.warn(cause); return []; }"],
    ["a function expression", "function () { return undefined; }"],
    ["a parenthesized, asserted empty", "() => ([] as ReadonlyArray<string>)"],
    ["an empty block", "() => {}"],
    ["a block that logs, then returns nothing", "(cause) => { console.warn(cause); return; }"],
    ["a block that only logs", "(cause) => { console.warn(cause); }"],
    ["a block that returns only on one branch", "(cause) => { if (fatal(cause)) throw cause; }"],
    ["a void expression", "() => void 0"],
  ] as const) {
    webHook.invalid(
      `reports ${name} catching into an empty`,
      `export const read = (client) => client.listTags("o", "r").catch(${handler});`,
    );
  }

  for (const [name, handler] of [
    ["a known placeholder", "() => UNREAD_FORGE"],
    ["a non-empty array", "() => [fallback]"],
    ["a rethrow", "(cause) => { throw cause; }"],
    [
      "an early empty that rethrows otherwise",
      "(cause) => { if (gone(cause)) return []; throw cause; }",
    ],
    [
      "a branch that answers a placeholder and one that rethrows",
      "(cause) => { if (gone(cause)) { return UNREAD_FORGE; } else { throw cause; } }",
    ],
    ["a handler reference", "NOOP"],
  ] as const) {
    webHook.valid(
      `allows ${name} as the catch handler`,
      `export const read = (client) => client.listTags("o", "r").catch(${handler});`,
    );
  }

  for (const [name, source] of [
    ["a statement", `export const drop = (body) => { body.cancel().catch(() => undefined); };`],
    [
      "an awaited statement",
      `export const drop = async (body) => { await body.cancel().catch(() => undefined); };`,
    ],
    [
      "a void expression",
      `export const drop = (body) => { void body.cancel().catch(() => null); };`,
    ],
    [
      "a void expression after a finally",
      `export const drop = (body) => { void body.cancel().catch((cause) => { fail(cause); }).finally(done); };`,
    ],
  ] as const) {
    webHook.valid(`allows a caught empty discarded as ${name}`, source);
  }

  webHook.invalid(
    "reports a caught empty that is kept",
    `export const queue = (done) => { let tail; tail = done.catch(() => undefined); return tail; };`,
  );

  webHook.invalid(
    "reports a caught empty kept after a finally",
    `export const read = (client) => client.listTags("o", "r").catch(() => []).finally(done);`,
  );

  webHook.valid(
    "allows a catch after a then that answers nothing",
    `export const load = (client) => { const op = client.list().then((rows) => { show(rows); }).catch((cause) => { fail(cause); }); return op; };`,
  );

  webHook.valid(
    "allows a then handler that answers an empty",
    `export const read = (client) => client.listTags("o", "r").then(() => []);`,
  );

  for (const [name, source] of [
    [
      "a hook's field defaulted to []",
      `export function Rows({ id }) { const flow = useZeropsGroupFlow(id); return flow?.pullRequests ?? []; }`,
    ],
    [
      "a hook's field defaulted to an EMPTY_ constant",
      `export function Rows({ id }) { const flow = useZeropsGroupFlow(id); return flow?.pullRequests ?? EMPTY_PULLS; }`,
    ],
    [
      "an inline hook call",
      `export function Rows() { return useProjectTopology().view?.services ?? []; }`,
    ],
    [
      "a destructured hook answer",
      `export function Rows() { const { data } = useGitStatus(); return data?.files ?? EMPTY_CHANGED; }`,
    ],
    [
      "a const alias of a hook answer",
      `export function Rows() { const flow = useZeropsGroupFlow(); const release = flow?.release; return release?.contents ?? []; }`,
    ],
    [
      "a lookup on a hook's map",
      `export function Rows({ id }) { const deploys = useZeropsGroupDeploys(); return deploys.get(id)?.pullRequests ?? []; }`,
    ],
    ["an atom read", `export function Rows() { return useAtomValue(pullRequestsAtom) ?? []; }`],
  ] as const) {
    webComponent.invalid(`reports ${name} on a store read`, source, (output) =>
      assert.match(output, /"kind":"LogicalExpression"/u),
    );
  }

  for (const [name, source] of [
    ["a prop defaulted to []", `export function Rows({ offers }) { return offers ?? []; }`],
    [
      "a memo defaulted to []",
      `export function Rows({ a }) { const rows = useMemo(() => a.rows, [a]); return rows ?? []; }`,
    ],
    [
      "local state defaulted to []",
      `export function Rows() { const [items] = useState(); return items ?? []; }`,
    ],
    [
      "a store read defaulted to a non-empty value",
      `export function Rows() { const flow = useZeropsGroupFlow(); return flow?.name ?? "main"; }`,
    ],
    [
      "a store read defaulted to null",
      `export function Rows() { const flow = useZeropsGroupFlow(); return flow?.head ?? null; }`,
    ],
    ["a wire field defaulted to []", `export const decode = (body) => body.list ?? [];`],
  ] as const) {
    webComponent.valid(`allows ${name}`, source);
  }
});
