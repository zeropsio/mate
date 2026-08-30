import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import {
  CSS_KIND,
  cssDeclarationFingerprint,
  formatFindingMessage,
  formatReconcileReport,
  loadCompletedPhases,
  loadExceptionLedger,
  normalizeFingerprint,
  parseFindingMessage,
  reconcileExceptions,
  shouldReportLedgered,
  type ExceptionEntry,
  type ExceptionFinding,
} from "./exceptions.ts";

const encodeUnknownJson = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

const entry = (overrides: Partial<ExceptionEntry> = {}): ExceptionEntry => ({
  path: "apps/web/src/Button.tsx",
  kind: "Literal",
  fingerprint: 'const color = "#fff"',
  owner: "design-systems",
  reason: "Legacy surface awaiting migration",
  expires: "F3",
  ...overrides,
});

const finding = (overrides: Partial<ExceptionFinding> = {}): ExceptionFinding => ({
  path: "apps/web/src/Button.tsx",
  kind: "Literal",
  fingerprint: 'const color = "#fff"',
  ledgered: true,
  ...overrides,
});

const writeJson = Effect.fn("test.writeExceptionJson")(function* (
  directory: string,
  filename: string,
  value: unknown,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  yield* fs.makeDirectory(directory, { recursive: true });
  yield* fs.writeFileString(path.join(directory, filename), `${encodeUnknownJson(value)}\n`);
});

const captureLedgerError = (ruleName: string, directory: string): unknown => {
  try {
    loadExceptionLedger(ruleName, directory);
    return undefined;
  } catch (error) {
    return error;
  }
};

describe("exception fingerprints", () => {
  it("collapses whitespace and formats CSS declarations", () => {
    assert.equal(
      normalizeFingerprint("  const\tvalue =\n  one   + two;  "),
      "const value = one + two;",
    );
    assert.equal(
      cssDeclarationFingerprint({
        selector: "  .button\n.primary ",
        property: " color ",
        value: " rgb(1,  2, 3) ",
      }),
      ".button .primary { color : rgb(1, 2, 3) }",
    );
    assert.equal(
      cssDeclarationFingerprint({ selector: "sel", property: "prop", value: "value" }),
      "sel{prop:value}",
    );
  });
});

it.layer(NodeServices.layer)("exception ledger loading", (it) => {
  it.effect("accepts a valid ledger and completed phases file", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "guard-exceptions-" });
        const expected = entry();
        yield* writeJson(directory, "valid-rule.json", [expected]);
        yield* writeJson(directory, "phases.json", { completed: ["F0", "F2"] });

        assert.deepStrictEqual(loadExceptionLedger("valid-rule", directory).entries, [expected]);
        assert.deepStrictEqual([...loadCompletedPhases(directory)], ["F0", "F2"]);
      }),
    ),
  );

  it.effect("accepts a leading BOM in ledger and completed phases JSON", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "guard-exceptions-" });
        const expected = entry();
        yield* fs.writeFileString(
          path.join(directory, "bom-rule.json"),
          `\uFEFF${encodeUnknownJson([expected])}\n`,
        );
        yield* fs.writeFileString(
          path.join(directory, "phases.json"),
          `\uFEFF${encodeUnknownJson({ completed: ["F0"] })}\n`,
        );

        assert.deepStrictEqual(loadExceptionLedger("bom-rule", directory).entries, [expected]);
        assert.deepStrictEqual([...loadCompletedPhases(directory)], ["F0"]);
      }),
    ),
  );

  it.effect("rejects malformed entries with the file, index, and field", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "guard-exceptions-" });
        const cases = [
          { name: "missing-field", value: [{ ...entry(), path: undefined }], field: "path" },
          { name: "empty-string", value: [entry({ owner: "" })], field: "owner" },
          { name: "expires-f9", value: [entry({ expires: "F9" })], field: "expires" },
          {
            name: "expires-empty-surface",
            value: [entry({ expires: "surface:" })],
            field: "expires",
          },
          { name: "expires-later", value: [entry({ expires: "later" })], field: "expires" },
        ] as const;

        for (const testCase of cases) {
          yield* writeJson(directory, `${testCase.name}.json`, testCase.value);
          const thrown = captureLedgerError(testCase.name, directory);
          assert(thrown instanceof Error);
          assert.match(thrown.message, new RegExp(`${testCase.name}\\.json`));
          assert.match(thrown.message, /index 0/u);
          assert.match(thrown.message, new RegExp(testCase.field));
        }
      }),
    ),
  );

  it.effect("treats missing ledger and phases files as empty", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "guard-exceptions-" });

        const ledger = loadExceptionLedger("missing-rule", directory);
        assert.deepStrictEqual(ledger.entries, []);
        assert.equal(
          ledger.has({ path: "apps/web/src/Button.tsx", kind: "Literal", fingerprint: "x" }),
          false,
        );
        assert.equal(loadCompletedPhases(directory).size, 0);
      }),
    ),
  );

  it.effect("matches exact repo paths and absolute paths by a path-segment suffix", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "guard-exceptions-" });
        yield* writeJson(directory, "path-rule.json", [entry()]);
        const ledger = loadExceptionLedger("path-rule", directory);
        const triple = {
          kind: "Literal",
          fingerprint: 'const color = "#fff"',
        };

        assert.equal(ledger.has({ path: "apps/web/src/Button.tsx", ...triple }), true);
        assert.equal(ledger.has({ path: "/repo/apps/web/src/Button.tsx", ...triple }), true);
        assert.equal(
          ledger.has({ path: "/repo/apps/web/src/Button.tsx/backup", ...triple }),
          false,
        );
        assert.equal(ledger.has({ path: "/repo/apps/web/src/Button.tsx.old", ...triple }), false);
        assert.equal(
          ledger.has({ path: "/repo/apps/web/src/Button.tsx", ...triple, kind: "JSXText" }),
          false,
        );
        assert.equal(
          ledger.has({ path: "/repo/apps/web/src/Button.tsx", ...triple, fingerprint: "changed" }),
          false,
        );
      }),
    ),
  );

  it.effect(
    "an entry written as a path suffix is matched by the rule AND counted alive by reconcile",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const directory = yield* fs.makeTempDirectoryScoped({ prefix: "guard-exceptions-" });
          const suffixEntry = entry({ path: "src/Button.tsx" });
          yield* writeJson(directory, "suffix-rule.json", [suffixEntry]);
          const ledger = loadExceptionLedger("suffix-rule", directory);
          const fullPathFinding = finding({ path: "apps/web/src/Button.tsx" });

          assert.equal(ledger.has(fullPathFinding), true);
          assert.deepStrictEqual(
            reconcileExceptions({
              entries: ledger.entries,
              findings: [fullPathFinding],
              completedPhases: new Set<string>(),
              scope: "ast",
            }),
            {
              entryCount: 1,
              unlisted: [],
              dead: [],
              changed: [],
              expired: [],
            },
          );
        }),
      ),
  );
});

describe("exception reconciliation", () => {
  const cases = [
    {
      name: "all matched",
      entries: [entry()],
      findings: [finding()],
      completedPhases: new Set<string>(),
      scope: "ast" as const,
      expected: {
        entryCount: 1,
        unlisted: [],
        dead: [],
        changed: [],
        expired: [],
      },
    },
    {
      name: "unlisted finding",
      entries: [],
      findings: [finding({ ledgered: false })],
      completedPhases: new Set<string>(),
      scope: "ast" as const,
      expected: {
        entryCount: 0,
        unlisted: [finding({ ledgered: false })],
        dead: [],
        changed: [],
        expired: [],
      },
    },
    {
      name: "dead entry",
      entries: [entry()],
      findings: [],
      completedPhases: new Set<string>(),
      scope: "ast" as const,
      expected: {
        entryCount: 1,
        unlisted: [],
        dead: [entry()],
        changed: [],
        expired: [],
      },
    },
    {
      name: "changed entry",
      entries: [entry()],
      findings: [finding({ fingerprint: "changed source", ledgered: false })],
      completedPhases: new Set<string>(),
      scope: "ast" as const,
      expected: {
        entryCount: 1,
        unlisted: [finding({ fingerprint: "changed source", ledgered: false })],
        dead: [],
        changed: [entry()],
        expired: [],
      },
    },
    {
      name: "matched but expired entry",
      entries: [entry()],
      findings: [finding()],
      completedPhases: new Set(["F3"]),
      scope: "ast" as const,
      expected: {
        entryCount: 1,
        unlisted: [],
        dead: [],
        changed: [],
        expired: [entry()],
      },
    },
    {
      name: "dead and expired entry is reported only as expired",
      entries: [entry()],
      findings: [],
      completedPhases: new Set(["F3"]),
      scope: "ast" as const,
      expected: {
        entryCount: 1,
        unlisted: [],
        dead: [],
        changed: [],
        expired: [entry()],
      },
    },
    {
      name: "AST scope ignores CSS entries",
      entries: [entry({ kind: CSS_KIND })],
      findings: [],
      completedPhases: new Set<string>(),
      scope: "ast" as const,
      expected: {
        entryCount: 0,
        unlisted: [],
        dead: [],
        changed: [],
        expired: [],
      },
    },
    {
      name: "CSS scope ignores AST entries",
      entries: [entry()],
      findings: [],
      completedPhases: new Set<string>(),
      scope: "css" as const,
      expected: {
        entryCount: 0,
        unlisted: [],
        dead: [],
        changed: [],
        expired: [],
      },
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      assert.deepStrictEqual(
        reconcileExceptions({
          entries: testCase.entries,
          findings: testCase.findings,
          completedPhases: testCase.completedPhases,
          scope: testCase.scope,
        }),
        testCase.expected,
      );
    });
  }

  it("formats actionable problem and success reports", () => {
    const clean = reconcileExceptions({
      entries: [entry()],
      findings: [finding()],
      completedPhases: new Set<string>(),
      scope: "ast",
    });
    assert.equal(
      formatReconcileReport({ ruleName: "sample-rule", result: clean }),
      "sample-rule: ledger reconciled (1 entries)",
    );

    const problems = reconcileExceptions({
      entries: [entry()],
      findings: [finding({ fingerprint: "changed source", ledgered: false })],
      completedPhases: new Set(["F3"]),
      scope: "ast",
    });
    const report = formatReconcileReport({ ruleName: "sample-rule", result: problems });
    assert.match(report, /unlisted apps\/web\/src\/Button\.tsx:Literal/u);
    assert.match(report, /"owner":"…"/u);
    assert.equal(/code under this entry changed.*re-review/u.test(report), false);
    assert.match(report, /phase F3 is complete.*exception must go/u);
  });
});

describe("finding messages", () => {
  it("round trips the machine marker through JSON-sensitive fingerprints", () => {
    const value = {
      ruleName: "no-theme-escape-hatches",
      summary: "Use a semantic design token.",
      kind: "Literal",
      fingerprint: normalizeFingerprint('const value = "quoted";\n.rule { content: "}"; }'),
      ledgered: true,
    };

    const message = formatFindingMessage(value);
    assert.match(
      message,
      /to except it, add to oxlint-plugin-t3code\/exceptions\/no-theme-escape-hatches\.json/u,
    );
    assert.deepStrictEqual(parseFindingMessage(message), value);
    assert.equal(parseFindingMessage("Use a semantic design token."), undefined);
  });

  it("reads the ledgered-report environment switch", () => {
    const previous = process.env.T3CODE_GUARD_REPORT_LEDGERED;
    try {
      delete process.env.T3CODE_GUARD_REPORT_LEDGERED;
      assert.equal(shouldReportLedgered(), false);
      process.env.T3CODE_GUARD_REPORT_LEDGERED = "0";
      assert.equal(shouldReportLedgered(), false);
      process.env.T3CODE_GUARD_REPORT_LEDGERED = "1";
      assert.equal(shouldReportLedgered(), true);
    } finally {
      if (previous === undefined) {
        delete process.env.T3CODE_GUARD_REPORT_LEDGERED;
      } else {
        process.env.T3CODE_GUARD_REPORT_LEDGERED = previous;
      }
    }
  });
});
