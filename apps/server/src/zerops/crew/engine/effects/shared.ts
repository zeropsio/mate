/**
 * What every crew effect handler shares: its lanes, its kinds, its outcomes, and the reads it
 * takes its evidence from.
 *
 * A crew effect wraps one of the crew's git or app modules unchanged, and every crew effect is
 * replay-safe: run again after a crash, a handler first reads what its own earlier attempt
 * finished and adopts it instead of writing it twice. Its evidence is the effect id as the
 * `Crew-Operation:` trailer where the module takes one (a turn's WIP commit, a merge-in), the
 * task's `Crew-Assignment:` trailer for a landing, and otherwise what the write leaves behind
 * (a copy, an attempt ref, a reset, the sweep's own subject, a live pidfile, a stored receipt).
 *
 * Outcomes: what the module answered is the effect's `ok` value, a refusal included (a conflict,
 * a park, a failed check, a refused landing): the crew's decider reads it as the task's next
 * event. `failed` is kept for what no answer came from: a copy nobody recorded, a service that
 * answers as another one, a command its conversation refused, or a service that kept failing past
 * the worker's attempts.
 *
 * @module zerops/crew/engine/effects/shared
 */
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

import type { HandlerResult } from "../../../../engine/outbox/EffectWorker.ts";
import type { EffectRow } from "../../../../engine/outbox/EffectOutbox.ts";
import { shellQuote } from "../../../ZeropsWorkspaceAccess.ts";
import { CREW_ID } from "../../CrewHome.ts";
import {
  field,
  git,
  laneDirectory,
  runFields,
  shellVariable,
  type CrewGitError,
  type CrewShellError,
  type CrewShellService,
} from "../../CrewShell.ts";
import type { CrewLaneNotRecorded, CrewStoreError } from "../../CrewStore.ts";
import { OPERATION_TRAILER } from "../../crewTrailers.ts";
import { attemptRef } from "../../CrewWorkspace.ts";
import type { LaneKey } from "../../CrewWorkspace.ts";

/** The crew effect kinds, one handler each. */
export const CREW_EFFECT_KINDS = {
  laneCreate: "crew.lane.create",
  laneReset: "crew.lane.reset",
  checkpoint: "crew.checkpoint",
  mergeIn: "crew.mergeIn",
  check: "crew.check",
  land: "crew.land",
  sweep: "crew.sweep",
  inspect: "crew.inspect",
  recover: "crew.recover",
  hostFreeze: "crew.host.freeze",
  claimRead: "crew.claim.read",
  appRun: "crew.app.run",
  appStop: "crew.app.stop",
  deployPoll: "crew.deployPoll",
  deliver: "crew.deliver",
} as const;
export type CrewEffectKind = (typeof CREW_EFFECT_KINDS)[keyof typeof CREW_EFFECT_KINDS];

/**
 * Where crew effects queue on the crew owner; each lane is FIFO and lanes run side by side.
 * `git/<handle>`: writes to one crewmate's copy (create, reset, checkpoint, merge-in).
 * `check/<handle>`: its setup and check, which can run for minutes. `deliver/<handle>`: what goes
 * into its conversation, in order. `host/<host>`: what touches a service as a whole (a landing on
 * your tree, the boot sweep and inspection, a deploy's freeze and its recovery, the claim read, the crew apps, the deploy
 * poll), so presses on a host queue behind its boot work.
 */
export const crewLanes = {
  git: (handle: string) => `git/${handle}`,
  check: (handle: string) => `check/${handle}`,
  deliver: (handle: string) => `deliver/${handle}`,
  host: (host: string) => `host/${host}`,
} as const;

/** One crew effect as the decider queues it: its kind, lane and payload; always replay-safe. */
export interface CrewEffectSpec<P = unknown> {
  readonly kind: CrewEffectKind;
  readonly lane: string;
  readonly class: "replay-safe";
  readonly payload: P;
}

export const crewEffect = <P>(
  kind: CrewEffectKind,
  lane: string,
  payload: P,
): CrewEffectSpec<P> => ({
  kind,
  lane,
  class: "replay-safe",
  payload,
});

/** The engine path's one crew: the git core's lane rows are keyed by it. */
export const laneKey = (handle: string): LaneKey => ({ crew: CREW_ID, handle });

/**
 * Every ref the engine itself writes on a service, which ref policing must not blame on a turn:
 * each task's kept attempts and its landing anchor (another crewmate's landing may be mid-way).
 * No crew-state mirror: the engine path does not write one.
 */
export const engineRefs = (
  tasks: ReadonlyArray<{
    readonly assignment: string;
    readonly run: string | null;
    readonly attempt: number;
  }>,
): ReadonlyArray<string> =>
  tasks.flatMap((task) => [
    `refs/t3/crew/landing/${task.assignment}`,
    ...Array.from({ length: Math.max(1, task.attempt) }, (_, index) =>
      attemptRef({ run: task.run, assignment: task.assignment, attempt: index + 1 }),
    ),
  ]);

export const done = (value: unknown): HandlerResult => ({
  _tag: "Done",
  outcome: { kind: "ok", value },
});

export const failedFor = (reason: string): HandlerResult => ({
  _tag: "Done",
  outcome: { kind: "failed", reason },
});

export type CrewModuleError = CrewShellError | CrewGitError | CrewStoreError | CrewLaneNotRecorded;

/**
 * A module's error as the handler's result. A copy nobody recorded, or a service that answers as
 * another one, fails at once: trying again changes nothing. Anything else is tried again — the
 * connection, a git lock, the database, a host whose binding is not verified yet (the repository
 * list may still be loading at boot) — and past the worker's attempts it fails with these words.
 */
export const settleError = (error: CrewModuleError): HandlerResult => {
  switch (error._tag) {
    case "CrewLaneNotRecorded":
      return failedFor(error.message);
    case "CrewShellError":
      return error.reason === "identity"
        ? failedFor(error.message)
        : { _tag: "Retry", reason: error.message };
    default:
      return { _tag: "Retry", reason: error.message };
  }
};

/** Runs a handler's body, its module errors settled by {@link settleError}. */
export const settled = <R>(
  body: Effect.Effect<HandlerResult, CrewModuleError, R>,
): Effect.Effect<HandlerResult, never, R> =>
  body.pipe(Effect.catch((error) => Effect.succeed(settleError(error))));

export const payloadOf = <P>(row: EffectRow): P => row.payload as P;

const READ_TIMEOUT = Duration.seconds(30);

/** A copy as git shows it now, read for evidence before a handler acts. */
export interface LaneEvidence {
  readonly present: boolean;
  /** The copy's HEAD; empty when it is missing. */
  readonly tip: string;
  /** Your tree's HEAD. */
  readonly head: string;
  /** Any change git would show in the copy, untracked files included. */
  readonly dirty: boolean;
  /** An open merge's other side. */
  readonly mergeHead: string | null;
  /** The files an open merge left unmerged. */
  readonly unmerged: ReadonlyArray<string>;
  /** The copy's tip's first parent. */
  readonly parent: string | null;
  /** The copy's tip's second parent: what a merge took in. */
  readonly mergedFrom: string | null;
  /** Whether an open merge's other side is in your tree's history. */
  readonly mergeHeadInHead: boolean;
  /** The copy's tip's subject line. */
  readonly subject: string;
  /** The `Crew-Operation:` trailer of the copy's tip: the effect that wrote it, if one did. */
  readonly operation: string;
  /** Whether the tip is in your tree's history. */
  readonly inHead: boolean;
  /** Whether the tip descends from (or is) the `since` commit asked about. */
  readonly descends: boolean;
  /** The values of the refs asked about, by name; absent when the ref is not there. */
  readonly refs: Readonly<Record<string, string>>;
}

/** Reads a copy's state in one script; it never writes. */
export const readLane = (
  shell: CrewShellService,
  host: string,
  handle: string,
  refs: ReadonlyArray<string> = [],
  since?: string,
) =>
  runFields(
    shell,
    host,
    "evidence",
    `H=$(${git("integration", ["rev-parse", "-q", "--verify", "HEAD^{commit}"])}) || H=\n` +
      `printf 'head\\t%s\\n' "$H"\n` +
      refs
        .map(
          (ref) =>
            `v=$(${git("integration", ["rev-parse", "-q", "--verify", ref])}) && printf 'ref\\t%s %s\\n' ${shellQuote(ref)} "$v"\n`,
        )
        .join("") +
      `[ -d ${shellQuote(laneDirectory(handle))} ] || { printf 'present\\tno\\n'; exit 0; }\n` +
      `printf 'present\\tyes\\n'\n` +
      `tip=$(${git({ lane: handle }, ["rev-parse", "HEAD"])}) || exit 1\n` +
      `printf 'tip\\t%s\\n' "$tip"\n` +
      `p=$(${git({ lane: handle }, ["rev-parse", "-q", "--verify", "HEAD^1"])}) && printf 'parent\\t%s\\n' "$p"\n` +
      `p=$(${git({ lane: handle }, ["rev-parse", "-q", "--verify", "HEAD^2"])}) && printf 'merged\\t%s\\n' "$p"\n` +
      `printf 'subject\\t%s\\n' "$(${git({ lane: handle }, ["log", "-1", "--format=%s"])})"\n` +
      `printf 'operation\\t%s\\n' "$(${git({ lane: handle }, ["log", "-1", `--format=%(trailers:key=${OPERATION_TRAILER},valueonly,separator=%x20)`])})"\n` +
      `[ -z "$(${git({ lane: handle }, ["status", "--porcelain"])})" ] || printf 'dirty\\tyes\\n'\n` +
      `m=$(${git({ lane: handle }, ["rev-parse", "-q", "--verify", "MERGE_HEAD"])}) && {\n` +
      `  printf 'merge\\t%s\\n' "$m"\n` +
      `  [ -n "$H" ] && ${git("integration", ["merge-base", "--is-ancestor", shellVariable("m"), shellVariable("H")])} && printf 'mergeinhead\\tyes\\n'\n` +
      `  ${git({ lane: handle }, ["diff", "--name-only", "--diff-filter=U"])} | sed 's/^/unmerged\\t/'\n` +
      `}\n` +
      `[ -n "$H" ] && ${git("integration", ["merge-base", "--is-ancestor", shellVariable("tip"), shellVariable("H")])} && printf 'inhead\\tyes\\n'\n` +
      (since === undefined
        ? ""
        : `${git("integration", ["merge-base", "--is-ancestor", since, shellVariable("tip")])} 2>/dev/null && printf 'descends\\tyes\\n'\n`) +
      `exit 0\n`,
    READ_TIMEOUT,
  ).pipe(
    Effect.map((out): LaneEvidence => {
      const all = (key: string) => out.filter(([name]) => name === key).map(([, value]) => value);
      return {
        present: field(out, "present") === "yes",
        tip: field(out, "tip") ?? "",
        head: field(out, "head") ?? "",
        dirty: field(out, "dirty") === "yes",
        mergeHead: field(out, "merge") ?? null,
        unmerged: all("unmerged"),
        parent: field(out, "parent") ?? null,
        mergedFrom: field(out, "merged") ?? null,
        mergeHeadInHead: field(out, "mergeinhead") === "yes",
        subject: field(out, "subject") ?? "",
        operation: field(out, "operation") ?? "",
        inHead: field(out, "inhead") === "yes",
        descends: field(out, "descends") === "yes",
        refs: Object.fromEntries(
          all("ref").map((value) => {
            const space = value.lastIndexOf(" ");
            return [value.slice(0, space), value.slice(space + 1)] as const;
          }),
        ),
      };
    }),
  );

/** The files a commit changed against its first parent. */
export const savedBy = (shell: CrewShellService, host: string, handle: string, commit: string) =>
  runFields(
    shell,
    host,
    "evidence",
    `${git({ lane: handle }, ["diff", "--name-only", `${commit}~1`, commit])} | sed 's/^/saved\\t/'\n`,
    READ_TIMEOUT,
  ).pipe(Effect.map((out) => out.filter(([name]) => name === "saved").map(([, value]) => value)));
