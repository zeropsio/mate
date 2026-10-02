/**
 * `node dist/main.mjs import …`, run in HQ's container by whoever migrates an account from main
 * (T13). Migration-only: it goes with T14.
 *
 * - `import --check <bundle>` checks a bundle whole (`importBundle.ts`) and writes nothing: the
 *   exporter's contract test, needing no database.
 * - `import <bundle>` checks it, queues it in `hq_import` and follows it until the leader has done
 *   it or it failed (`importJob.ts`). The command writes no record of its own: the leader imports.
 *   The same bundle again resumes a run that failed, or verifies a done one once more; another
 *   bundle is refused, as one HQ takes one import.
 *
 * @module importCli
 */
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { type Bundle, type BundleRefused, checkBundle } from "./importBundle.ts";
import { ImportReport } from "./importJob.ts";

export interface CommandResult {
  readonly code: number;
  readonly lines: ReadonlyArray<string>;
}

export type ImportArgs =
  | { readonly kind: "check"; readonly dir: string }
  | { readonly kind: "import"; readonly dir: string }
  | { readonly kind: "usage" };

export const USAGE: CommandResult = {
  code: 2,
  lines: ["usage: import --check <bundle> | import <bundle>"],
};

/** The words after `import`, read. */
export const importArgs = (args: ReadonlyArray<string>): ImportArgs => {
  const [first, second, ...rest] = args;
  if (first === "--check" && second !== undefined && rest.length === 0)
    return { kind: "check", dir: second };
  if (first !== undefined && !first.startsWith("-") && second === undefined)
    return { kind: "import", dir: first };
  return { kind: "usage" };
};

const plural = (count: number, one: string, many = `${one}s`) =>
  `${String(count)} ${count === 1 ? one : many}`;

/** What a bundle holds, in one line. */
export const bundleSummary = (bundle: Bundle) =>
  [
    `bundle ${bundle.digest}:`,
    [
      plural(bundle.mapping.apps.length, "application"),
      plural(bundle.mapping.apps.flatMap((app) => app.repos).length, "repository", "repositories"),
      plural(bundle.changes.length, "change"),
      plural(bundle.changes.flatMap((change) => change.attachments).length, "picture"),
      plural(bundle.releases.length, "release"),
    ].join(", "),
  ].join(" ");

const refusedResult = (refused: BundleRefused): CommandResult => ({
  code: 1,
  lines: ["bundle refused:", ...refused.problems.map((problem) => `  ${problem}`)],
});

export const checkCommand = (dir: string) =>
  checkBundle(dir).pipe(
    Effect.map((bundle): CommandResult => ({ code: 0, lines: [bundleSummary(bundle)] })),
    Effect.catchTag("BundleRefused", (refused) => Effect.succeed(refusedResult(refused))),
  );

const decodeReport = Schema.decodeUnknownSync(ImportReport);
const listed = (items: ReadonlyArray<string>) => (items.length === 0 ? "none" : items.join(", "));

/** `import <bundle>`: queued, then followed every `follow` (1 s) until it is done or failed. */
export const queueCommand = (dir: string, options: { readonly follow?: Duration.Duration } = {}) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const checked = yield* Effect.result(checkBundle(dir));
    if (checked._tag === "Failure") return refusedResult(checked.failure);
    const bundle = checked.success;
    const summary = bundleSummary(bundle);
    const held = yield* sql<{ readonly digest: string }>`SELECT digest FROM hq_import`;
    const other = held.find((row) => row.digest !== bundle.digest);
    if (other !== undefined)
      return {
        code: 1,
        lines: [summary, `this HQ holds import ${other.digest}: one HQ takes one import`],
      } satisfies CommandResult;
    yield* sql`
      INSERT INTO hq_import (digest, dir, state) VALUES (${bundle.digest}, ${bundle.dir}, 'queued')
      ON CONFLICT (digest) DO UPDATE
      SET state = 'queued', dir = EXCLUDED.dir, error = NULL, updated_at = now()
      WHERE hq_import.state IN ('failed', 'done')`;
    const [outcome] = yield* sql<{
      readonly state: string;
      readonly error: string | null;
      readonly report: unknown;
    }>`SELECT state, error, report FROM hq_import WHERE digest = ${bundle.digest}`.pipe(
      Effect.filterOrFail((rows) => rows[0]?.state === "done" || rows[0]?.state === "failed"),
      Effect.retry(Schedule.spaced(options.follow ?? Duration.seconds(1))),
    );
    if (outcome?.state !== "done")
      return {
        code: 1,
        lines: [summary, `import ${bundle.digest} failed: ${outcome?.error ?? "no reason kept"}`],
      } satisfies CommandResult;
    const report = decodeReport(outcome.report);
    return {
      code: 0,
      lines: [
        summary,
        `import ${bundle.digest} done and verified`,
        `  merged otherwise than by HQ's squash: ${listed(report.mergedOtherwise)}`,
        `  Mates not enrolled yet: ${listed(report.notEnrolled)}`,
      ],
    } satisfies CommandResult;
  }).pipe(
    Effect.catchTag("SqlError", (error) =>
      Effect.succeed<CommandResult>({ code: 1, lines: [`the database refused: ${error.message}`] }),
    ),
  );
