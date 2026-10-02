/**
 * `node dist/main.mjs import …`, run in HQ's container by whoever migrates an account from main
 * (T13). `--check <bundle>` checks a bundle whole (`importBundle.ts`) and writes nothing: the
 * exporter's contract test. Migration-only: it goes with T14.
 *
 * @module importCli
 */
import * as Effect from "effect/Effect";

import { type Bundle, checkBundle } from "./importBundle.ts";

export interface CommandResult {
  readonly code: number;
  readonly lines: ReadonlyArray<string>;
}

const USAGE: CommandResult = {
  code: 2,
  lines: ["usage: import --check <bundle>"],
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

const check = (dir: string) =>
  checkBundle(dir).pipe(
    Effect.map((bundle): CommandResult => ({ code: 0, lines: [bundleSummary(bundle)] })),
    Effect.catchTag("BundleRefused", (refused) =>
      Effect.succeed<CommandResult>({
        code: 1,
        lines: ["bundle refused:", ...refused.problems.map((problem) => `  ${problem}`)],
      }),
    ),
  );

/** The command's outcome for `args`, the words after `import`. */
export const importCommand = (args: ReadonlyArray<string>) => {
  const [first, second, ...rest] = args;
  if (first === "--check" && second !== undefined && rest.length === 0) return check(second);
  return Effect.succeed(USAGE);
};
