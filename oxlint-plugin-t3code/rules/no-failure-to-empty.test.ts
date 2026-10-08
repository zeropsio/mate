import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { type ExceptionEntry } from "../exceptions.ts";
import { createOxlintRuleHarness } from "../test/utils.ts";

const readImports = `
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { useProjectTopology } from "~/zerops/useProjectTopology";
import { useEnvironmentQuery as useGitStatus } from "~/state/query";
import { useProjectFlows as useZeropsGroupFlow, useMateNames as useZeropsGroupDeploys } from "~/zerops/projectFlows";
import type { Known } from "@t3tools/client-runtime/zerops/knowledge";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
`;
const RULE = "t3code/no-failure-to-empty";
const LEDGER_DIRECTORY_ENV = "T3CODE_FAILURE_TO_EMPTY_LEDGER_DIRECTORY";
const encodeUnknownJson = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

const webHook = createOxlintRuleHarness(RULE, { filename: "apps/web/src/zerops/useFixture.ts" });
const webComponent = createOxlintRuleHarness(RULE, {
  filename: "apps/web/src/components/zerops/ZeropsFixture.tsx",
});
const CAUGHT_EMPTY = `export const read = (client) => client.listTags("o", "r").catch(() => []);`;
const guardedFiles = [
  "apps/web/src/components/Fixture.tsx",
  "apps/web/src/hooks/useFixture.ts",
  "packages/client-runtime/src/data/fixture.ts",
  "apps/web/src/components/zerops/ZeropsFixture.tsx",
  "packages/client-runtime/src/zerops/forge/fixture.ts",
];
const unguardedFiles = [
  "apps/web/src/hooks/useFixture.test.ts",
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
  class: "review",
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
    webComponent.invalid(`reports ${name} on a store read`, readImports + source, (output) =>
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
    webComponent.valid(`allows ${name}`, readImports + source);
  }

  for (const [name, source] of [
    [
      "a known value's field or []",
      `export function Rows(read: Known<Rows>) { return read?.state === "known" ? read.value.recentTools : []; }`,
    ],
    [
      "a known value or undefined",
      `export function Rows(read: Known<Rows>) { return read.state === "known" ? read.value : undefined; }`,
    ],
    [
      "a known value or null, the literal first",
      `export function Rows(read: Known<Rows>) { return "known" === read.state ? read.value : null; }`,
    ],
    [
      "a known value or an EMPTY_ constant",
      `export function Rows(read: Known<Rows>) { return read.state === "known" ? read.value.rows : EMPTY_ROWS; }`,
    ],
    [
      "a value that is not known turned into null",
      `export function Rows(read: Known<Rows>) { return read.state !== "known" ? null : read.value; }`,
    ],
    [
      "a known value rendered or nothing",
      `export function Rows(read: Known<Rows>) { return read.state === "known" ? <List rows={read.value} /> : null; }`,
    ],
    [
      "a successful result's value or undefined",
      `export function Rows(result: AtomCommandResult<Rows, unknown>) { return result._tag === "Success" ? result.value : undefined; }`,
    ],
    [
      "a successful result's value or [], by its guard",
      `export function Rows(result: AtomCommandResult<Rows, unknown>) { return AsyncResult.isSuccess(result) ? result.value : []; }`,
    ],
    [
      "a result that did not succeed turned into []",
      `export function Rows(result: AtomCommandResult<Rows, unknown>) { return !AsyncResult.isSuccess(result) ? [] : result.value; }`,
    ],
  ] as const) {
    webComponent.invalid(`reports ${name}`, readImports + source, (output) =>
      assert.match(output, /"kind":"ConditionalExpression"/u),
    );
  }

  for (const [name, source] of [
    [
      "a known value or a constant this module binds to []",
      `const NO_CANDIDATES: ReadonlyArray<Row> = []; export function Rows(listing: Known<Rows>) { return listing.state === "known" ? listing.value : NO_CANDIDATES; }`,
    ],
    [
      "a known value or a constant this module binds to an asserted []",
      `const ROWS = [] as ReadonlyArray<Row>; export function Rows(read: Known<Rows>) { return read.state === "known" ? read.value : ROWS; }`,
    ],
    [
      "a known value or a constant this module binds to {}",
      `const BLANK = {}; export function Rows(read: Known<Rows>) { return read.state === "known" ? read.value : BLANK; }`,
    ],
    [
      "a known value or a constant this module binds to an empty Map",
      `const NO_MATES: ReadonlyMap<string, Mate> = new Map(); export function Rows(read: Known<Rows>) { return read.state === "known" ? read.value : NO_MATES; }`,
    ],
    [
      "a known value or a constant this module binds to an empty Set",
      `const SEEN = new Set<string>(); export function Rows(read: Known<Rows>) { return read.state === "known" ? read.value : SEEN; }`,
    ],
    [
      "a known value or a constant this module binds to another empty constant",
      `const NONE = new Map(); const NO_NAMES = NONE; export function Rows(read: Known<Rows>) { return read.state === "known" ? read.value : NO_NAMES; }`,
    ],
    [
      "a known value or an empty object",
      `export function Rows(read: Known<Rows>) { return read.state === "known" ? read.value : {}; }`,
    ],
    [
      "a known value or an imported NO_ constant",
      `import { NO_CANDIDATES } from "./rows"; export function Rows(read: Known<Rows>) { return read.state === "known" ? read.value : NO_CANDIDATES; }`,
    ],
    [
      "a known value or an imported NONE constant",
      `import { NONE } from "./rows"; export function Rows(read: Known<Rows>) { return read.state === "known" ? read.value : NONE; }`,
    ],
  ] as const) {
    webComponent.invalid(`reports ${name}`, readImports + source, (output) =>
      assert.match(output, /"kind":"ConditionalExpression"/u),
    );
  }

  for (const [name, source] of [
    [
      "an atom read defaulted to a constant this module binds to an empty Map",
      `const NO_MATES: ReadonlyMap<string, Mate> = new Map(); export function useMates() { return useAtomValue(matesAtom) ?? NO_MATES; }`,
    ],
    [
      "an atom read defaulted to an empty Map",
      `export function useMates() { return useAtomValue(matesAtom) ?? new Map(); }`,
    ],
    [
      "a hook's field defaulted to an imported NO_ constant",
      `import { NO_PULLS } from "./rows"; export function Rows({ id }) { const flow = useZeropsGroupFlow(id); return flow?.pullRequests ?? NO_PULLS; }`,
    ],
  ] as const) {
    webComponent.invalid(`reports ${name}`, readImports + source, (output) =>
      assert.match(output, /"kind":"LogicalExpression"/u),
    );
  }

  for (const [name, source] of [
    [
      "a known value or a NO_ constant this module binds to a value",
      `const NO_SERVICES = { hostnames: [] }; export function Rows(read: Known<Rows>) { return read.state === "known" ? read.value : NO_SERVICES; }`,
    ],
    [
      "a known value or a constant this module binds to a non-empty Map",
      `const NO_MATES = new Map([["a", mate]]); export function Rows(read: Known<Rows>) { return read.state === "known" ? read.value : NO_MATES; }`,
    ],
    [
      "a known value or a variable, not a constant, bound to []",
      `let rows = []; export function Rows(read: Known<Rows>) { return read.state === "known" ? read.value : rows; }`,
    ],
    [
      "a known value or an imported constant named for something else",
      `import { NOTES } from "./rows"; export function Rows(read: Known<Rows>) { return read.state === "known" ? read.value : NOTES; }`,
    ],
    [
      "an atom read defaulted to a constant this module binds to a value",
      `const FALLBACK = new Map([["a", mate]]); export function useMates() { return useAtomValue(matesAtom) ?? FALLBACK; }`,
    ],
  ] as const) {
    webComponent.valid(`allows ${name}`, readImports + source);
  }

  for (const [name, source] of [
    [
      "a known value or a placeholder",
      `export function Rows(read: Known<Rows>) { return read.state === "known" ? read.value : UNREAD_ROWS; }`,
    ],
    [
      "a known value's bookkeeping or null",
      `export function Rows(read: Known<Rows>) { return read.state === "known" ? read.freshness : null; }`,
    ],
    [
      "another value checked on a Known state",
      `export function Rows(read: Known<Rows>, rows: Known<Rows>) { return read.state === "known" ? rows.value : []; }`,
    ],
    [
      "a state that is not a Known state",
      `export function Rows({ view }) { return view.kind === "known" ? view.value : undefined; }`,
    ],
    [
      "a test that is not a state check",
      `export function Rows({ read, open }) { return open ? read.value : []; }`,
    ],
  ] as const) {
    webComponent.valid(`allows ${name}`, readImports + source);
  }
});

const data = createOxlintRuleHarness(RULE, {
  filename: "packages/client-runtime/src/data/fixture.ts",
});
data.invalid(
  "public reads cannot answer unknown as no rows",
  `
import type { ProjectionReads } from "./store.ts";
export function rows(read: ProjectionReads) {
  const fact = read.fact("projectVariables", "p");
  return fact.kind === "known" ? fact.value.rows : [];
}`,
);
webComponent.valid(
  "unrelated hooks are not remote read boundaries",
  `
import { useSomething } from "./local";
export function Rows() { return useSomething()?.rows ?? []; }
`,
);

for (const [name, source] of [
  [
    "an aliased public conversion",
    `import { publicRead as convert } from "./store.ts"; const read = convert(fact); export const rows = read.kind !== "known" ? [] : read.value.rows;`,
  ],
  [
    "a public fact alias",
    `import type { ProjectionReads } from "./store.ts"; export function rows(read: ProjectionReads) { const fact = read.fact("service", "s"); const alias = fact; return alias.kind === "known" ? alias.value : null; }`,
  ],
  [
    "a contextual projection read",
    `import type { Projection } from "./store.ts"; export const rows: Projection<string, unknown> = { derive: (read, id) => { const fact = read.fact("service", id); return fact.kind === "known" ? fact.value : []; } };`,
  ],
  [
    "an account fact atom",
    `import { useAtomValue as value } from "@effect/atom-react"; import type { AccountData } from "./store.ts"; export function rows(data: AccountData) { const fact = value(data.fact("service", "s")); return fact.kind === "known" ? fact.value : undefined; }`,
  ],
] as const)
  data.invalid(`reports ${name}`, source);

for (const [name, source] of [
  [
    "an unrelated fact method",
    `export function rows(read) { const fact = read.fact("service", "s"); return fact.kind === "known" ? fact.value : []; }`,
  ],
  [
    "arbitrary projection output",
    `import type { AccountData } from "./store.ts"; import { useAtomValue } from "@effect/atom-react"; export function rows(data: AccountData) { const fact = useAtomValue(data.project(projection, "s")); return fact.kind === "known" ? fact.value : []; }`,
  ],
  [
    "a conversion import from another module",
    `import { publicRead } from "./local.ts"; const fact = publicRead(input); export const rows = fact.kind === "known" ? fact.value : [];`,
  ],
  [
    "a shadowed conversion import",
    `import { publicRead } from "./store.ts"; export function rows(publicRead) { const fact = publicRead(input); return fact.kind === "known" ? fact.value : []; }`,
  ],
  [
    "an unrelated success guard",
    `import { AsyncResult } from "./local.ts"; export function rows(result) { return AsyncResult.isSuccess(result) ? result.value : []; }`,
  ],
  [
    "an unrelated legacy discriminant",
    `export function rows(read) { return read.state === "known" ? read.value : []; }`,
  ],
] as const)
  data.valid(`allows ${name}`, source);

webComponent.invalid(
  "imported read aliases retain provenance through destructuring",
  `
import { useEnvironmentQuery as query } from "~/state/query";
export function Rows() { const { data: response } = query(atom); const alias = response; return alias?.rows ?? []; }
`,
);
webComponent.valid(
  "shadowed read imports are local values",
  `
import { useAtomValue } from "@effect/atom-react";
export function Rows(useAtomValue) { return useAtomValue(atom)?.rows ?? []; }
`,
);
webComponent.valid(
  "an optional scalar field is not an empty collection",
  `
import { useEnvironmentQuery } from "~/state/query";
export function Rows() { const { data } = useEnvironmentQuery(atom); return data?.label ?? null; }
`,
);
webComponent.valid(
  "a retained explicitly void command queue loses no receipt",
  `
export function queue(tail: Promise<void>) { return tail.catch(() => undefined); }
`,
);
// Compatibility checks deliberately pass before enrollment: they protect the narrow void allowance.
webComponent.invalid(
  "a void queue cannot manufacture an empty collection",
  `
export function queue(tail: Promise<void>) { return tail.catch(() => []); }
`,
);
webComponent.invalid(
  "an unresolved operation receipt cannot become successful void",
  `
import type { OperationReceipt } from "@t3tools/client-runtime/data/model";
export function queue(tail: Promise<OperationReceipt>) { return tail.catch(() => undefined); }
`,
);
webComponent.invalid(
  "a retained read promise cannot become void",
  `
export function rows(tail: Promise<ReadonlyArray<string>>) { return tail.catch(() => undefined); }
`,
);
const guardedBrowser = createOxlintRuleHarness(RULE, {
  filename: "apps/web/src/components/files/FileBrowserPanel.tsx",
});
const browserImports = `import { useProjectEntriesQuery } from "./projectFilesQueryState"; import { FileBrowserPanelState } from "./FileBrowserPanelState";`;
it.layer(NodeServices.layer)("file browser reviewed debt", (it) => {
  it.effect(
    "guarded file collections retain loading and error presentation through their reviewed ledger",
    () =>
      withFixtureLedger(
        [
          {
            path: "apps/web/src/components/files/FileBrowserPanel.tsx",
            kind: "LogicalExpression",
            fingerprint: "entriesQuery.data?.entries ?? []",
            owner: "maintainers",
            reason: "Children retain their data/error guard; review this default explicitly.",
            expires: "never",
            class: "justified",
          },
        ],
        guardedBrowser.run(
          browserImports +
            `
      export function Files() { const entriesQuery = useProjectEntriesQuery(); const entries = entriesQuery.data?.entries ?? []; return <FileBrowserPanelState hasData={entriesQuery.data !== null} error={entriesQuery.error}><Tree entries={entries}/></FileBrowserPanelState>; }
    `,
        ),
      ),
  );
});

it.layer(NodeServices.layer)("public read enrollment regression", (it) => {
  it.effect("reports one unknown-to-empty fact at the public boundary", () =>
    data
      .run(`import type { ProjectionReads } from "./store.ts";
      export function rows(read: ProjectionReads) {
        const fact = read.fact("projectVariables", "p");
        return fact.kind === "known" ? fact.value.rows : [];
      }`)
      .pipe(
        Effect.match({
          onSuccess: () => 0,
          onFailure: (error) =>
            "stdout" in error
              ? (error.stdout.match(/t3code\(no-failure-to-empty\)/gu)?.length ?? 0)
              : -1,
        }),
        Effect.tap((count) => Effect.sync(() => assert.equal(count, 1))),
      ),
  );
});

// Compatibility checks: explicit state and known optional fields were already safe before enrollment.
data.valid(
  "status-bearing projection placeholders preserve unavailable evidence",
  `
import type { ProjectionReads } from "./store.ts";
const NOT_READ = { status: "unread", complete: false, rows: [] };
export function rows(read: ProjectionReads) {
  const fact = read.fact("projectVariables", "p");
  return fact.kind === "known" ? { status: "known", complete: true, rows: fact.value.rows } : NOT_READ;
}`,
);
it.layer(NodeServices.layer)("optional field allowance regression", (it) => {
  it.effect("a known optional field can supply its empty default", () =>
    expectFindingCount(
      data,
      `
import type { AccountData } from "./store.ts";
import { useAtomValue } from "@effect/atom-react";
export function rows(data: AccountData) {
  const fact = useAtomValue(data.fact("projectVariables", "p"));
  return fact.kind === "known" ? { status: "known", rows: fact.value.optionalRows ?? [] } : { status: fact.kind };
}`,
      0,
    ),
  );
});

webComponent.invalid(
  "imported AsyncResult types qualify success discriminants",
  `
import { AsyncResult as Result } from "effect/reactivity";
export function rows(result: Result.AsyncResult<Rows, unknown>) { return result._tag === "Success" ? result.value : []; }
`,
);
webComponent.valid(
  "matching success tags on unrelated models are not reads",
  `
export function rows(result) { return result._tag === "Success" ? result.value : []; }
`,
);

const expectFindingCount = (harness: typeof data, source: string, expected: number) =>
  withFixtureLedger(
    [],
    harness.run(source).pipe(
      Effect.match({
        onSuccess: () => 0,
        onFailure: (error) =>
          "stdout" in error
            ? (error.stdout.match(/t3code\(no-failure-to-empty\)/gu)?.length ?? 0)
            : -1,
      }),
      Effect.tap((count) => Effect.sync(() => assert.equal(count, expected))),
    ),
  );

// Each review regression counts diagnostics independently, so RED is an assertion, not parsing failure.
it.layer(NodeServices.layer)("technical review regressions", (it) => {
  const expectCount = expectFindingCount;
  for (const filename of [
    "apps/web/src/components/Fixture.tsx",
    "apps/web/src/zerops/useFixture.ts",
  ]) {
    it.effect(`projection boundary stays enforced in ${filename}`, () =>
      expectCount(
        createOxlintRuleHarness(RULE, { filename }),
        `
      import { useProjection as read } from "~/zerops/ZeropsAccountData";
      export function rows() { return read(projection, key, fallback)?.rows ?? []; }
      `,
        1,
      ),
    );
  }
  it.effect("aliased projection receivers retain public fact provenance", () =>
    expectCount(
      data,
      `
    import type { ProjectionReads } from "./store.ts";
    export function rows(read: ProjectionReads) { const alias = read; const fact = alias.fact("service", "s"); return fact.kind === "known" ? fact.value : []; }
  `,
      1,
    ),
  );
  it.effect("aliased account fact atoms retain public fact provenance", () =>
    expectCount(
      data,
      `
    import type { AccountData } from "./store.ts";
    import { useAtomValue } from "@effect/atom-react";
    export function rows(data: AccountData) { const account = data; const atom = account.fact("service", "s"); const alias = atom; const fact = useAtomValue(alias); return fact.kind === "known" ? fact.value : []; }
  `,
      1,
    ),
  );
  it.effect("a guard cannot excuse an unguarded empty-file sibling", () =>
    expectCount(
      guardedBrowser,
      browserImports +
        `export function Files() {
      const entriesQuery = useProjectEntriesQuery(); const entries = entriesQuery.data?.entries ?? [];
      return <><FileBrowserPanelState hasData={entriesQuery.data !== null} error={entriesQuery.error}><Tree entries={entries}/></FileBrowserPanelState><p>{entries.length === 0 ? "No files" : "Files"}</p></>;
    }`,
      1,
    ),
  );
  it.effect("known React facts allow optional rows with explicit unread status", () =>
    expectCount(
      data,
      `
    import type { AccountData } from "./store.ts";
    import { useAtomValue } from "@effect/atom-react";
    export function rows(data: AccountData) { const fact = useAtomValue(data.fact("service", "s")); return fact.kind === "known" ? { status: "known", rows: fact.value.optionalRows ?? [] } : { status: fact.kind }; }
  `,
      0,
    ),
  );
  for (const factory of ["readsOfState", "readsOf"]) {
    it.effect(`${factory} factories preserve public fact provenance`, () =>
      expectCount(
        data,
        `
      import { ${factory} as reads } from "./store.ts";
      export function value(state) { const read = reads(state); const alias = read; const fact = alias.fact("database", "d"); return fact.kind === "known" ? fact.value : undefined; }
    `,
        1,
      ),
    );
  }
  it.effect("immutable Known aliases preserve existing enforcement", () =>
    expectCount(
      data,
      `
    import type { Known } from "@t3tools/client-runtime/zerops/knowledge";
    export function rows(read: Known<Rows>) { const alias = read; return alias.state === "known" ? alias.value : []; }
  `,
      1,
    ),
  );
  it.effect("local client preferences are not remote failures", () =>
    expectCount(
      webComponent,
      `
    import { useClientSettings } from "~/hooks/useSettings";
    export function rows() { return useClientSettings(s => s.favorites) ?? []; }
  `,
      0,
    ),
  );
  it.effect("query views retain their own error and pending state", () =>
    expectCount(
      webComponent,
      `
    import { useEnvironmentQuery } from "~/state/query";
    export function view() { const result = useEnvironmentQuery(atom); return { rows: result.data?.rows ?? [], error: result.error, isPending: result.isPending }; }
  `,
      0,
    ),
  );
  it.effect("void callbacks do not inherit nested helpers' returned values", () =>
    expectCount(
      webComponent,
      `
    export function queue(tail: Promise<void>) { return tail.catch(() => { function local() { return []; } console.log(local()); }); }
  `,
      0,
    ),
  );
});

// Negative compatibility cases constrain the new allowances; they are not RED claims.
webComponent.invalid(
  "another query's status cannot excuse unread rows",
  `
import { useEnvironmentQuery } from "~/state/query";
export function view() { const result = useEnvironmentQuery(a); const other = useEnvironmentQuery(b); return { rows: result.data?.rows ?? [], error: other.error, isPending: other.isPending }; }
`,
);
webComponent.invalid(
  "a status override cannot hide unavailable rows",
  `
import { useEnvironmentQuery } from "~/state/query";
export function view(overrides) { const result = useEnvironmentQuery(a); return { rows: result.data?.rows ?? [], error: result.error, isPending: result.isPending, ...overrides }; }
`,
);
webComponent.invalid(
  "extracting only rows discards the query status",
  `
import { useEnvironmentQuery } from "~/state/query";
export function view() { const result = useEnvironmentQuery(a); return ({ rows: result.data?.rows ?? [], error: result.error, isPending: result.isPending }).rows; }
`,
);
webComponent.invalid(
  "a nested helper cannot excuse the callback's empty return",
  `
export function queue(tail: Promise<void>) { return tail.catch(() => { function local() { return []; } console.log(local()); return []; }); }
`,
);
data.valid(
  "a lookalike read factory does not establish public provenance",
  `
import { readsOfState } from "./local.ts";
const fact = readsOfState(state).fact("database", "d"); export const value = fact.kind === "known" ? fact.value : undefined;
`,
);

it.layer(NodeServices.layer)("final orchestrator regressions", (it) => {
  it.effect("public-barrel Projection imports preserve contextual reads", () =>
    expectFindingCount(
      data,
      `
    import type { Projection as Project } from "@t3tools/client-runtime/data";
    export const rows: Project<string, unknown> = { derive: (read, id) => { const fact = read.fact("service", id); return fact.kind === "known" ? fact.value : []; } };
  `,
      1,
    ),
  );
  it.effect("namespace public conversions preserve provenance", () =>
    expectFindingCount(
      data,
      `
    import * as Store from "./store.ts";
    const fact = Store.publicRead(input); export const rows = fact.kind === "known" ? fact.value : [];
  `,
      1,
    ),
  );
  it.effect("namespace atom readers preserve provenance", () =>
    expectFindingCount(
      webComponent,
      `
    import * as Atoms from "@effect/atom-react";
    export const rows = Atoms.useAtomValue(atom)?.rows ?? [];
  `,
      1,
    ),
  );
  it.effect("aliased success guards use the imported function identity", () =>
    expectFindingCount(
      webComponent,
      `
    import { isSuccess as success } from "effect/reactivity/AsyncResult";
    export function rows(result) { return success(result) ? result.value : []; }
  `,
      1,
    ),
  );
  it.effect("paginated branch discovery cannot resemble an empty list", () =>
    expectFindingCount(
      webComponent,
      `
    import { usePaginatedBranches } from "~/state/queries";
    export function rows(target) { return usePaginatedBranches(target).data?.refs ?? []; }
  `,
      1,
    ),
  );
  for (const operator of ["!==", "!="]) {
    it.effect(`${operator} null guards allow known optional query rows`, () =>
      expectFindingCount(
        webComponent,
        `
      import { useEnvironmentQuery } from "~/state/query";
      export function rows() { const read = useEnvironmentQuery(atom); return read.data ${operator} null ? { status: "known", rows: read.data.optionalRows ?? [] } : { status: "loading-or-failed" }; }
    `,
        0,
      ),
    );
  }
});

it.layer(NodeServices.layer)("automatic policy carries unknown and failure presentation", (it) => {
  it.effect(
    "accepts the real policy view but rejects a version that discards failure evidence",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const source = yield* fs.readFileString(
          path.resolve(
            import.meta.dirname,
            "../../packages/client-runtime/src/data/projections/hqAutoUpdatePolicy.ts",
          ),
        );
        const policy = createOxlintRuleHarness(RULE, {
          filename: "packages/client-runtime/src/data/projections/hqAutoUpdatePolicy.ts",
        });
        yield* expectFindingCount(policy, source, 0);
        const discarded = source.replace(": fact;", ": null;");
        assert.notEqual(discarded, source);
        yield* expectFindingCount(policy, discarded, 1);
      }),
  );
});
