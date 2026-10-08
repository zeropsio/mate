/**
 * The crew's effects on the crew's git and app handlers: every kind the crew's decider asks for
 * (`command.ts`) runs on the handler of `effects/` that does its work, its payload told in that
 * handler's terms and its outcome told back as the verdict the decider reads (`CrewEffectValues`).
 *
 * Each bridged handler keeps the row it was given — its effect id and attempt, which the handlers
 * adopt their own finished work by — and changes only its kind and payload, so a re-run reaches
 * the same evidence. The handler's own refusals (a conflict, a failed check, a refused landing) are
 * verdicts and come back `ok`; a `failed` outcome passes through unchanged, but for a Stop on a run
 * that already ended, which is a Stop done.
 *
 * The verdicts mean what V1 made of the same module outcomes: a guard that stops a WIP commit, or
 * a ref moved outside the engine, parks the task (`crewTurns.commitAndPolice`); a landing's
 * refusals hold, redo, retry or park it (`crewLanding`); a discard of a copy that is gone still
 * discards (`crewTasks`); a copy's creation fails in its setup's words (`crewApply`).
 *
 * The decider asks for no boot inspection; that handler stays registered under its own kind for
 * the wiring to queue.
 *
 * @module crew/engine/CrewEffectBridge
 */
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type {
  ChatFileAttachment,
  ChatImageAttachment,
  EffectOutcome,
  Principal,
} from "@t3tools/contracts";

import type { Command } from "../../../engine/domain/command.ts";
import type { EffectRow } from "../../../engine/outbox/EffectOutbox.ts";
import type { EffectHandler, HandlerResult } from "../../../engine/outbox/EffectWorker.ts";
import type { CheckOutcome } from "../CrewChecks.ts";
import { crewLane } from "../CrewDefinition.ts";
import { CREW_ID } from "../CrewHome.ts";
import { readDeclaredPorts } from "../crewPorts.ts";
import { CrewReads } from "../CrewReads.ts";
import { CrewShell } from "../CrewShell.ts";
import { CrewStore } from "../CrewStore.ts";
import {
  CrewWorkspace,
  type DispatchOutcome,
  type KeepOutcome,
  type LaneParkReason,
} from "../CrewWorkspace.ts";
import { CrewDeliveryContext } from "./CrewDeliveryContext.ts";
import type {
  CrewEffectKind,
  CrewEffectPayload,
  CrewEffectValues,
  LaneEnvironment,
  LaneStatsValue,
} from "./command.ts";
import {
  CREW_EFFECT_KINDS as HANDLER_KINDS,
  done,
  engineRefs,
  laneKey,
  makeCrewEffectHandlers,
  readLane,
  settleError,
  type AppRunPayload,
  type AppRunValue,
  type CheckPayload,
  type CheckpointPayload,
  type CheckpointValue,
  type CheckValue,
  type ClaimReadPayload,
  type ClaimReadValue,
  type CrewModuleError,
  type DeliverPayload,
  type DeliverValue,
  type DeployPollPayload,
  type DeployPollValue,
  type LandPayload,
  type LandValue,
  type LaneCreatePayload,
  type LaneCreateValue,
  type LaneResetPayload,
  type LaneResetValue,
  type MergeInPayload,
  type MergeInValue,
  type RecoverPayload,
  type RecoverValue,
  type SweepPayload,
  type SweepValue,
} from "./effects/index.ts";

type Asked<K extends CrewEffectKind> = Extract<CrewEffectPayload, { readonly kind: K }>;
type Verdict<K extends CrewEffectKind> = CrewEffectValues[K];

/** A payload that cannot reach its handler: the effect settles with this at once. */
class SettledAtOnce {
  readonly result: HandlerResult;
  constructor(result: HandlerResult) {
    this.result = result;
  }
}

const refusedFor = (reason: string) =>
  new SettledAtOnce({ _tag: "Done", outcome: { kind: "failed", reason, refused: true } });

/** V1's words for a guard that stopped a WIP commit (`crewTurns`). */
const GUARD_WORDS: Readonly<Record<Exclude<LaneParkReason, "unknown-tip">, string>> = {
  dependencies: "an unignored dependency directory",
  secrets: "a secret file",
  size: "a file over the size cap",
};

const MOVED_OUTSIDE = "its copy of the code moved outside the engine";

/** A Stop whose run is already over, or never ran: the engine's refusals, a Stop done. */
const STOP_DONE = new Set(["run-ended", "run-not-running", "unknown-run", "stop-already-asked"]);

const environmentOf = (lane: LaneEnvironment) => ({
  ...(lane.crewPort === null ? {} : { crewPort: lane.crewPort }),
  env: lane.env,
});

const setupWords = (command: string, setup: CheckOutcome): string => {
  const last = "tail" in setup ? setup.tail.trimEnd().split("\n").at(-1) : undefined;
  return `setup (${command}) ${setup._tag}${last ? `: ${last}` : ""}`;
};

/**
 * How one kind of the crew's reaches its handler: the handler's payload for the crew's, or a
 * settle at once; the crew's verdict for the handler's `ok` value; and, for a `failed` the crew
 * reads as done, the outcome instead.
 */
interface Translation<K extends CrewEffectKind, P, V> {
  readonly payload: (asked: Asked<K>) => Effect.Effect<P | SettledAtOnce, CrewModuleError>;
  readonly verdict: (value: V, asked: Asked<K>) => Effect.Effect<Verdict<K>, CrewModuleError>;
  readonly failed?: (
    outcome: Extract<EffectOutcome, { readonly kind: "failed" }>,
    asked: Asked<K>,
  ) => EffectOutcome | undefined;
}

/** A failure's first line, the words a row or a refusal gives. */
const firstLine = (text: string): string =>
  text.split("\n").find((line) => line.trim() !== "") ?? text;

const bridged = <K extends CrewEffectKind, P, V>(
  kind: K,
  handler: EffectHandler,
  translation: Translation<K, P, V>,
): EffectHandler => {
  const told = (outcome: EffectOutcome, asked: Asked<K>) => {
    if (outcome.kind === "ok") {
      return Effect.map(translation.verdict(outcome.value as V, asked), (value): EffectOutcome => ({
        kind: "ok",
        value,
      }));
    }
    return Effect.succeed(
      (outcome.kind === "failed" ? translation.failed?.(outcome, asked) : undefined) ?? outcome,
    );
  };
  const asItsOwn = (row: EffectRow, payload: P): EffectRow => ({
    ...row,
    kind: handler.kind,
    payload,
  });
  const adopt = handler.adopt;
  return {
    kind,
    ...(adopt === undefined
      ? {}
      : {
          adopt: (row: EffectRow) =>
            Effect.gen(function* () {
              const asked = row.payload as Asked<K>;
              const payload = yield* translation.payload(asked);
              if (payload instanceof SettledAtOnce) return Option.none<EffectOutcome>();
              const adopted = yield* adopt(asItsOwn(row, payload));
              if (Option.isNone(adopted)) return adopted;
              return Option.some(yield* told(adopted.value, asked));
            }).pipe(Effect.orElseSucceed(() => Option.none<EffectOutcome>())),
        }),
    run: (row) =>
      Effect.gen(function* () {
        const asked = row.payload as Asked<K>;
        const payload = yield* translation.payload(asked);
        if (payload instanceof SettledAtOnce) return payload.result;
        const result = yield* handler.run(asItsOwn(row, payload));
        if (result._tag === "Retry") return result;
        return {
          _tag: "Done",
          outcome: yield* told(result.outcome, asked),
        } satisfies HandlerResult;
      }).pipe(Effect.catch((error) => Effect.succeed(settleError(error)))),
  };
};

/** What a recovery found gone, in the crew's words: landings, branches, saved work. */
const lossesOf = (value: RecoverValue): ReadonlyArray<string> => {
  switch (value._tag) {
    case "lost":
      return [
        ...value.landings.map((landing) => `landing of ${landing.title}`),
        ...value.branches.map((handle) => `crew/${handle}`),
        ...value.wip.map((lane) => `crew/${lane.handle} work since ${lane.since}`),
      ];
    case "landings-lost":
      return value.landings.map((landing) => `landing of ${landing.title}`);
    default:
      return [];
  }
};

/** Every kind the crew asks for, on the crew's git and app handlers; and the one it never asks. */
export const makeCrewEngineEffectHandlers = Effect.gen(function* () {
  const own = new Map((yield* makeCrewEffectHandlers).map((handler) => [handler.kind, handler]));
  const handlerOf = (kind: string): EffectHandler => {
    const handler = own.get(kind);
    if (handler === undefined) throw new Error(`no crew handler for ${kind}`);
    return handler;
  };
  const workspace = yield* CrewWorkspace;
  const store = yield* CrewStore;
  const reads = yield* CrewReads;
  const shell = yield* CrewShell;
  const context = yield* CrewDeliveryContext;

  /** A copy's figures as the board shows them; none when they cannot be read. */
  const statsOf = (handle: string) =>
    Effect.gen(function* () {
      const lane = yield* store.getLane(CREW_ID, handle);
      if (Option.isNone(lane)) return undefined;
      const stats = yield* reads.laneStats(lane.value.host, handle);
      return {
        ahead: stats.ahead,
        insertions: stats.insertions,
        deletions: stats.deletions,
        dirty: stats.dirty,
      } satisfies LaneStatsValue;
    }).pipe(Effect.orElseSucceed(() => undefined));

  const withStats = <A extends object>(handle: string, value: A) =>
    Effect.map(statsOf(handle), (stats) => (stats === undefined ? value : { ...value, stats }));

  const laneCreate = bridged<"crew.lane.create", LaneCreatePayload, LaneCreateValue>(
    "crew.lane.create",
    handlerOf(HANDLER_KINDS.laneCreate),
    {
      payload: (asked) =>
        Effect.succeed({
          handle: asked.handle,
          host: asked.host,
          ...(asked.setup === null ? {} : { setup: asked.setup }),
          ...environmentOf(asked),
        }),
      verdict: (value, asked) => {
        switch (value._tag) {
          case "created":
            return Effect.succeed(
              value.setup === undefined || value.setup._tag === "passed"
                ? { _tag: "ready" }
                : { _tag: "failed", detail: setupWords(asked.setup ?? "", value.setup) },
            );
          case "no-head":
            return Effect.succeed({
              _tag: "failed",
              detail: `${asked.host}'s tree has no commit yet`,
            });
          case "no-space":
            return Effect.succeed({
              _tag: "failed",
              detail: `no free disk on ${asked.host}: a copy needs ${Math.ceil(value.needKiB / 1024)} MiB, ${Math.floor(value.availableKiB / 1024)} MiB are free`,
            });
          case "mount-unseen":
            return Effect.succeed({
              _tag: "failed",
              detail: `the copy did not appear through ${asked.host}'s mount`,
            });
        }
      },
    },
  );

  const laneReset = bridged<"crew.lane.reset", LaneResetPayload, LaneResetValue>(
    "crew.lane.reset",
    handlerOf(HANDLER_KINDS.laneReset),
    {
      payload: (asked) => Effect.succeed({ mode: "dispatch", handle: asked.handle }),
      verdict: (value, asked): Effect.Effect<Verdict<"crew.lane.reset">> => {
        const dispatched = value as DispatchOutcome;
        switch (dispatched._tag) {
          case "ready":
            return withStats(asked.handle, {
              _tag: "ready",
              resetTo: dispatched.reset ? dispatched.dispatchCommit : null,
            } as const);
          case "parked":
            return Effect.succeed({ _tag: "moved" });
          default:
            return Effect.succeed({ _tag: dispatched._tag });
        }
      },
    },
  );

  const keepAside = bridged<"crew.lane.keep", LaneResetPayload, LaneResetValue>(
    "crew.lane.keep",
    handlerOf(HANDLER_KINDS.laneReset),
    {
      // V1's discard: any open merge aborted first, the attempt kept under the task's key.
      payload: (asked) =>
        Effect.succeed({
          mode: "discard",
          handle: asked.handle,
          run: asked.run,
          assignment: asked.assignment,
          attempt: asked.attempt,
          abortMerge: true,
        }),
      verdict: (value) => {
        const kept = value as KeepOutcome;
        switch (kept._tag) {
          case "kept":
          // A copy that is gone keeps nothing; the task is discarded all the same.
          case "lane-missing":
            return Effect.succeed({ _tag: "kept" });
          case "frozen":
            return Effect.succeed({ _tag: "failed", detail: "its service is redeploying" });
          case "rework":
            return Effect.succeed({ _tag: "failed", detail: kept.reason });
          case "parked":
            return Effect.succeed({
              _tag: "failed",
              detail:
                kept.reason === "unknown-tip"
                  ? MOVED_OUTSIDE
                  : `its work could not be kept: ${GUARD_WORDS[kept.reason]}: ${kept.paths.join(", ")}`,
            });
        }
      },
    },
  );

  /**
   * A discard is the person's press, answered as V1 answered it: a copy that cannot be reset
   * now (a git lock, a failed command) reads as not kept at once, its task as it was, rather
   * than a reset retried behind the person's back; pressed again, it goes again.
   */
  const laneKeep: EffectHandler = {
    ...keepAside,
    run: (row) =>
      Effect.map(keepAside.run(row), (result): HandlerResult =>
        result._tag === "Retry"
          ? {
              _tag: "Done",
              outcome: {
                kind: "ok",
                value: { _tag: "failed", detail: firstLine(result.reason) },
              },
            }
          : result,
      ),
  };

  /** Removal: the copy goes, unless it holds work not landed and the person kept it. */
  const laneRemove: EffectHandler = {
    kind: "crew.lane.remove",
    // A copy no longer recorded was removed by an earlier attempt.
    adopt: (row) =>
      Effect.map(
        store.getLane(CREW_ID, (row.payload as Asked<"crew.lane.remove">).handle),
        (lane) =>
          Option.isNone(lane)
            ? Option.some<EffectOutcome>({
                kind: "ok",
                value: { _tag: "removed" } satisfies Verdict<"crew.lane.remove">,
              })
            : Option.none<EffectOutcome>(),
      ).pipe(Effect.orElseSucceed(() => Option.none<EffectOutcome>())),
    run: (row) => {
      const asked = row.payload as Asked<"crew.lane.remove">;
      return workspace.cleanup(laneKey(asked.handle), { discard: asked.discardUnlanded }).pipe(
        Effect.map((cleaned) =>
          done(
            (cleaned._tag === "removed"
              ? { _tag: "removed" }
              : { _tag: "unlanded-commits" }) satisfies Verdict<"crew.lane.remove">,
          ),
        ),
        Effect.catch((error) => Effect.succeed(settleError(error))),
      );
    },
  };

  const checkpoint = bridged<"crew.checkpoint", CheckpointPayload, CheckpointValue>(
    "crew.checkpoint",
    handlerOf(HANDLER_KINDS.checkpoint),
    {
      payload: (asked) =>
        Effect.succeed({
          handle: asked.handle,
          assignment: asked.assignment,
          turn: asked.turn,
          checked: asked.checked,
          explained: engineRefs(asked.refTasks),
        }),
      verdict: (value, asked): Effect.Effect<Verdict<"crew.checkpoint">> => {
        if (value._tag === "checked") {
          return value.edits
            ? withStats(asked.handle, { _tag: "edited-after-check" } as const)
            : withStats(asked.handle, { _tag: "unchanged" } as const);
        }
        const { commit, changes } = value;
        switch (commit._tag) {
          case "committed":
          case "unchanged":
            return changes.length > 0
              ? withStats(asked.handle, {
                  _tag: "park",
                  detail: `a ref changed outside the engine: ${changes.map((change) => change.ref).join(", ")}`,
                } as const)
              : withStats(asked.handle, { _tag: commit._tag });
          case "parked":
            return withStats(asked.handle, {
              _tag: "park",
              detail:
                commit.reason === "unknown-tip"
                  ? MOVED_OUTSIDE
                  : `the WIP commit stopped on ${GUARD_WORDS[commit.reason]}: ${commit.paths.join(", ")}`,
            } as const);
          case "rework":
          case "frozen":
          case "lane-missing":
            return Effect.succeed({ _tag: commit._tag });
        }
      },
    },
  );

  const mergeIn = bridged<"crew.mergeIn", MergeInPayload, MergeInValue>(
    "crew.mergeIn",
    handlerOf(HANDLER_KINDS.mergeIn),
    {
      payload: (asked) => Effect.succeed({ handle: asked.handle }),
      verdict: (value, asked): Effect.Effect<Verdict<"crew.mergeIn">, CrewModuleError> => {
        switch (value._tag) {
          case "merged":
            return withStats(asked.handle, {
              _tag: "merged",
              head: value.head,
              tip: value.tip,
              lockfileChanged: value.lockfileChanged,
            } as const);
          case "current":
            // Nothing merged: the copy's tip, as recorded, is the tree its check is for.
            return Effect.flatMap(store.requireLane(CREW_ID, asked.handle), (lane) =>
              withStats(asked.handle, {
                _tag: "current",
                head: value.head,
                ...(lane.recordedTip === null ? {} : { tip: lane.recordedTip }),
              } as const),
            );
          case "conflict":
            return Effect.succeed({ _tag: "conflict", head: value.head, paths: value.paths });
          default:
            return Effect.succeed({ _tag: value._tag });
        }
      },
    },
  );

  /** A check, its setup first when the merge changed the lockfile; both on the tree asked for. */
  const check: EffectHandler = (() => {
    const handler = handlerOf(HANDLER_KINDS.check);
    const runOne = (row: EffectRow, payload: CheckPayload) =>
      handler.run({ ...row, kind: handler.kind, payload });
    return {
      kind: "crew.check",
      run: (row) =>
        Effect.gen(function* () {
          const asked = row.payload as Asked<"crew.check">;
          const base = {
            handle: asked.handle,
            host: asked.host,
            ...environmentOf(asked),
            ...(asked.tip === null ? {} : { tip: asked.tip }),
          };
          const settle = (value: Verdict<"crew.check">) => done(value);
          if (asked.setup !== null) {
            const setup = yield* runOne(row, { ...base, kind: "setup", command: asked.setup });
            if (setup._tag === "Retry" || setup.outcome.kind !== "ok") return setup;
            const set = setup.outcome.value as CheckValue;
            if (set._tag === "moved") return settle({ _tag: "moved" });
            if (set._tag === "lane-missing") return settle({ _tag: "lane-missing" });
            if (set.outcome._tag === "lane-missing") return settle({ _tag: "lane-missing" });
            if (set.outcome._tag !== "passed") return settle({ _tag: "setup-failed" });
          }
          const checked = yield* runOne(row, { ...base, kind: "check", command: asked.command });
          if (checked._tag === "Retry" || checked.outcome.kind !== "ok") return checked;
          const value = checked.outcome.value as CheckValue;
          if (value._tag !== "checked") return settle({ _tag: value._tag });
          const outcome = value.outcome;
          switch (outcome._tag) {
            case "passed":
              return settle({ _tag: "passed", tail: outcome.tail, tip: value.tip });
            case "failed":
              return settle({ _tag: "failed", tail: outcome.tail });
            default:
              return settle({ _tag: outcome._tag });
          }
        }),
    };
  })();

  const land = bridged<"crew.land", LandPayload, LandValue>(
    "crew.land",
    handlerOf(HANDLER_KINDS.land),
    {
      payload: (asked) =>
        Effect.succeed({
          handle: asked.handle,
          assignment: asked.assignment,
          title: asked.title,
          ...(asked.checkedTip === null ? {} : { checkedTip: asked.checkedTip }),
        }),
      verdict: (value, asked): Effect.Effect<Verdict<"crew.land">> => {
        switch (value._tag) {
          case "landed":
          case "already-landed":
            return withStats(asked.handle, { _tag: value._tag, commit: value.commit } as const);
          case "refused": {
            const { refusal } = value;
            switch (refusal.kind) {
              case "dirty":
                return Effect.succeed({ _tag: "dirty-tree", paths: refusal.paths });
              case "untracked":
                return Effect.succeed({ _tag: "untracked-in-way", paths: refusal.paths });
              case "no-space":
                return Effect.succeed({ _tag: "disk-full" });
              case "unknown":
                return Effect.succeed({ _tag: "park", detail: refusal.detail });
              default:
                return Effect.succeed({ _tag: refusal.kind });
            }
          }
          default:
            return Effect.succeed({ _tag: value._tag });
        }
      },
    },
  );

  const claimRead = bridged<"crew.claim.read", ClaimReadPayload, ClaimReadValue>(
    "crew.claim.read",
    handlerOf(HANDLER_KINDS.claimRead),
    {
      payload: (asked) => Effect.succeed({ host: asked.host }),
      // The dev server a claim restarts, and where the claimant's copy is on the service.
      verdict: (value, asked) =>
        Effect.gen(function* () {
          const command = yield* reads.devServerCommand(asked.host);
          const yaml = yield* reads.zeropsYaml(asked.host);
          const port =
            yaml === undefined ? null : (readDeclaredPorts(yaml, asked.host)?.main ?? null);
          const repository = yield* shell.repository(asked.host);
          return {
            served: value.served,
            devServer: command === undefined || port === null ? null : { port, command },
            workDir: crewLane(repository, asked.handle).remoteDir,
          };
        }),
    },
  );

  const appState = (status: AppRunValue): Verdict<"crew.app.run"> => ({
    state: status.state === "running" ? "running" : "stopped",
  });

  const appRun = bridged<"crew.app.run", AppRunPayload, AppRunValue>(
    "crew.app.run",
    handlerOf(HANDLER_KINDS.appRun),
    {
      payload: (asked) =>
        Effect.succeed(
          asked.crewPort === null
            ? refusedFor(`@${asked.handle} has no crew port to run its app on`)
            : {
                host: asked.host,
                handle: asked.handle,
                command: asked.command,
                port: asked.crewPort,
                env: asked.env,
              },
        ),
      verdict: (value) => Effect.succeed(appState(value)),
    },
  );

  const appStop = bridged<"crew.app.stop", { host: string; handle: string }, AppRunValue>(
    "crew.app.stop",
    handlerOf(HANDLER_KINDS.appStop),
    {
      payload: (asked) => Effect.succeed({ host: asked.host, handle: asked.handle }),
      verdict: (value) => Effect.succeed(appState(value)),
    },
  );

  const deployPoll = bridged<"crew.deploy.poll", DeployPollPayload, DeployPollValue>(
    "crew.deploy.poll",
    handlerOf(HANDLER_KINDS.deployPoll),
    {
      // The service by its id where the Mate knows it (a renamed service is still found).
      payload: (asked) =>
        Effect.map(Effect.option(shell.repository(asked.host)), (repository) => {
          const serviceId = Option.getOrUndefined(repository)?.identity?.serviceId;
          return serviceId === undefined ? { host: asked.host } : { host: asked.host, serviceId };
        }),
      verdict: (value) =>
        Effect.succeed({
          phase:
            value.state === "running"
              ? "running"
              : value.state === "settled"
                ? "ended"
                : "unreadable",
        }),
    },
  );

  const recover = bridged<"crew.recover", RecoverPayload, RecoverValue>(
    "crew.recover",
    handlerOf(HANDLER_KINDS.recover),
    {
      payload: (asked) =>
        Effect.succeed({
          host: asked.host,
          specs: asked.specs.map((spec) => ({
            handle: spec.handle,
            ...(spec.setup === null ? {} : { setup: spec.setup }),
            ...environmentOf(spec),
          })),
          landings: asked.landings,
        }),
      // Whatever the recovery came to, a copy not on the service now stays missing; what it
      // found gone is named, as V1 named it.
      verdict: (value, asked) =>
        Effect.map(
          Effect.filter(asked.handles, (handle) =>
            Effect.map(readLane(shell, asked.host, handle), (copy) => !copy.present),
          ),
          (lost) => ({ lost, losses: lossesOf(value) }),
        ),
    },
  );

  const sweep = bridged<"crew.sweep", SweepPayload, SweepValue>(
    "crew.sweep",
    handlerOf(HANDLER_KINDS.sweep),
    {
      // The host's sweep, every other copy read as checked so it is only read: the crew sweeps
      // one copy at a time, each when nothing else runs on it.
      payload: (asked) =>
        Effect.map(store.lanesOnHost(asked.host), (lanes) => ({
          host: asked.host,
          checked: lanes
            .map((lane) => lane.lane)
            .filter((handle) => handle !== asked.handle || asked.checked),
        })),
      verdict: (value, asked): Effect.Effect<Verdict<"crew.sweep">> => {
        const copy = value.lanes.find((lane) => lane.handle === asked.handle);
        if (copy === undefined) return Effect.succeed({ swept: false });
        const found =
          copy._tag === "committed"
            ? ({ _tag: "committed", commit: copy.tip, paths: copy.saved } as const)
            : ({ _tag: copy._tag } as const);
        const verdict = { swept: copy._tag === "committed", copy: found };
        return copy._tag === "missing" ? Effect.succeed(verdict) : withStats(asked.handle, verdict);
      },
    },
  );

  const deliver = bridged<"crew.deliver", DeliverPayload, DeliverValue>(
    "crew.deliver",
    handlerOf(HANDLER_KINDS.deliver),
    {
      payload: (asked) =>
        Effect.gen(function* () {
          const crewCommand = asked.command;
          const told = (command: Command, principal: Principal = asked.principal) => ({
            handle: asked.handle ?? "",
            conversationId: asked.conversationId,
            principal,
            command,
          });
          switch (crewCommand._tag) {
            case "Send": {
              // Pictures and files reach the agent; an attachment of a kind unknown here does not.
              const pictures = (crewCommand.attachments ?? []).filter(
                (attachment): attachment is ChatImageAttachment | ChatFileAttachment =>
                  attachment.type === "image" || attachment.type === "file",
              );
              const send = told(
                {
                  _tag: "Send",
                  text: crewCommand.text,
                  ...(pictures.length === 0 ? {} : { attachments: pictures }),
                  ...(crewCommand.card === null ? {} : { card: crewCommand.card }),
                },
                crewCommand.principal,
              );
              // Joins the running run (V1's steer); a turn of its own when that run is gone.
              return crewCommand.steer === undefined || pictures.length > 0
                ? send
                : {
                    ...send,
                    command: { _tag: "Steer", runId: crewCommand.steer, text: crewCommand.text },
                    fallback: send.command,
                  };
            }
            case "Stop":
              return told(
                crewCommand.runId === null
                  ? { _tag: "Stop" }
                  : { _tag: "Stop", runId: crewCommand.runId },
              );
            case "RotateSession":
              return told({
                _tag: "RotateSession",
                reason: crewCommand.reason,
                fresh: crewCommand.fresh,
                seed: crewCommand.seed ?? (yield* context.seed(crewCommand.packet)),
              });
            case "AssignAgent": {
              const agent = yield* context.agentOf({
                instanceId: crewCommand.instanceId,
                model: crewCommand.model,
                effort: crewCommand.effort,
                profile: crewCommand.profile,
              });
              return agent === undefined
                ? refusedFor(`no signed-in agent runs the login ${crewCommand.instanceId}`)
                : told({ _tag: "AssignAgent", agent });
            }
            case "Archive":
              return told({ _tag: "Archive" });
            case "Seam":
              return told({
                _tag: "MarkSeam",
                seam: crewCommand.seam,
                words: crewCommand.words ?? context.seamWords(crewCommand.seam),
              });
          }
        }),
      verdict: (value) => Effect.succeed(value),
      failed: (outcome, asked) =>
        asked.command._tag === "Stop" && STOP_DONE.has(outcome.reason)
          ? { kind: "ok", value: {} }
          : undefined,
    },
  );

  const handlers: ReadonlyArray<EffectHandler> = [
    deliver,
    laneCreate,
    laneReset,
    laneKeep,
    laneRemove,
    checkpoint,
    mergeIn,
    check,
    land,
    claimRead,
    appRun,
    appStop,
    deployPoll,
    recover,
    sweep,
    handlerOf(HANDLER_KINDS.hostFreeze),
    handlerOf(HANDLER_KINDS.inspect),
  ];
  return handlers;
});
