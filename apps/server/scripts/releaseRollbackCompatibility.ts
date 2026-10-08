import { compareSemverVersions } from "@t3tools/shared/semver";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

export type RollbackCompatibility =
  | { readonly rollbackCompatible: false }
  | { readonly rollbackCompatible: true; readonly compatibleFrom: string };

export interface RollbackEvidence {
  readonly previousTag: string;
  readonly candidateVersion: string;
  readonly ancestor: boolean;
  readonly previousProtocol: number | undefined;
  readonly currentProtocol: number | undefined;
  readonly previousPackage: string;
  readonly currentPackage: string;
  readonly changedPaths: ReadonlyArray<string>;
}

const stableVersion = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u;
const decodePackage = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);
const decodeProtocol = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ protocol: Schema.Literal(1) })),
);
const MANUAL: RollbackCompatibility = { rollbackCompatible: false };

const runtimeDeclaration = (encoded: string): string | undefined => {
  const decoded = decodePackage(encoded);
  return Option.isNone(decoded)
    ? undefined
    : JSON.stringify(
        Object.fromEntries(Object.entries(decoded.value).filter(([key]) => key !== "version")),
      );
};

/**
 * V1 proves a deliberately narrow range: the previous stable release to this candidate, with
 * the whole server's write/replay/resume surface and its runtime declarations unchanged.
 * Any server, shared contract or dependency change takes the attended path.
 */
export function rollbackCompatibility(evidence: RollbackEvidence): RollbackCompatibility {
  const from = evidence.previousTag.startsWith("v") ? evidence.previousTag.slice(1) : "";
  if (
    !stableVersion.test(from) ||
    !stableVersion.test(evidence.candidateVersion) ||
    compareSemverVersions(from, evidence.candidateVersion) >= 0 ||
    !evidence.ancestor ||
    evidence.previousProtocol !== 1 ||
    evidence.currentProtocol !== 1
  ) {
    return MANUAL;
  }
  const previousRuntime = runtimeDeclaration(evidence.previousPackage);
  if (
    previousRuntime === undefined ||
    previousRuntime !== runtimeDeclaration(evidence.currentPackage)
  )
    return MANUAL;
  const protectedChange = evidence.changedPaths.some(
    (path) =>
      path.startsWith("apps/server/src/") ||
      path.startsWith("apps/server/scripts/") ||
      path.startsWith("packages/contracts/") ||
      path.startsWith("packages/shared/") ||
      path.startsWith("packages/effect-") ||
      path.startsWith("packages/hq-git/") ||
      path.startsWith("packages/ssh/") ||
      path === "pnpm-lock.yaml" ||
      path === "pnpm-workspace.yaml" ||
      path === "package.json",
  );
  return protectedChange ? MANUAL : { rollbackCompatible: true, compatibleFrom: from };
}

/** A failed or incomplete git probe never stamps permission into a release. */
export const readRollbackCompatibility = Effect.fn("readRollbackCompatibility")(
  function* (previousTag: string, candidateVersion: string, cwd?: string) {
    if (!previousTag.startsWith("v") || !stableVersion.test(previousTag.slice(1))) return MANUAL;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const git = Effect.fnUntraced(function* (args: ReadonlyArray<string>) {
      const child = yield* spawner.spawn(ChildProcess.make("git", args, { stderr: "ignore", cwd }));
      const [output, code] = yield* Effect.all(
        [Stream.mkString(Stream.decodeText(child.stdout)), child.exitCode],
        { concurrency: "unbounded" },
      );
      return { output, code };
    }, Effect.scoped);
    const ancestor = yield* git(["merge-base", "--is-ancestor", previousTag, "HEAD"]);
    if (ancestor.code !== 0) return MANUAL;
    const previousProtocol = yield* git([
      "show",
      `${previousTag}:apps/server/update-protocol.json`,
    ]);
    const currentProtocol = yield* git(["show", "HEAD:apps/server/update-protocol.json"]);
    const previousPackage = yield* git(["show", `${previousTag}:apps/server/package.json`]);
    const currentPackage = yield* git(["show", "HEAD:apps/server/package.json"]);
    const changed = yield* git(["diff", "--no-renames", "--name-only", "-z", previousTag, "HEAD"]);
    if (
      [previousProtocol, currentProtocol, previousPackage, currentPackage, changed].some(
        (read) => read.code !== 0,
      )
    )
      return MANUAL;
    return rollbackCompatibility({
      previousTag,
      candidateVersion,
      ancestor: true,
      previousProtocol: Option.getOrUndefined(decodeProtocol(previousProtocol.output))?.protocol,
      currentProtocol: Option.getOrUndefined(decodeProtocol(currentProtocol.output))?.protocol,
      previousPackage: previousPackage.output,
      currentPackage: currentPackage.output,
      changedPaths: changed.output.split("\0").filter(Boolean),
    });
  },
  Effect.orElseSucceed(() => MANUAL),
);
