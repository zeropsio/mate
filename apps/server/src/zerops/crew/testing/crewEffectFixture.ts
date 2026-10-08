/**
 * Crew effect handlers under test: an outbox row as the worker claims it, an attempt as the
 * worker runs it (its own evidence adopted first, then the act), and the crew git core over the
 * ssh shim against a fresh service repository.
 *
 * @module crewEffectFixture
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { ConversationId, EffectId, type EffectOutcome } from "@t3tools/contracts";

import type { EffectLane } from "../../../engine/domain/command.ts";
import type { EffectRow } from "../../../engine/outbox/EffectOutbox.ts";
import type { EffectHandler, HandlerResult } from "../../../engine/outbox/EffectWorker.ts";
import * as CrewReads from "../CrewReads.ts";
import * as CrewRuntime from "../CrewRuntime.ts";
import * as CrewWorkspace from "../CrewWorkspace.ts";
import { laneKey } from "../engine/effects/shared.ts";
import {
  crewGitLayer,
  git,
  withCrewService,
  write,
  TEST_HOST,
  type CrewShellFixtureOptions,
} from "./crewGitFixture.ts";

export const CREW_OWNER = ConversationId.make("crew/main");

/** A claimed outbox row of `kind`; `attempt` > 1 is a row a restart requeued. */
export const effectRow = (
  kind: string,
  payload: unknown,
  options: { readonly effectId?: string; readonly attempt?: number; readonly lane?: string } = {},
): EffectRow => ({
  effectId: EffectId.make(options.effectId ?? `crew/main/e/${kind}/1`),
  conversationId: CREW_OWNER,
  lane: (options.lane ?? "side") as EffectLane,
  kind,
  class: "replay-safe",
  runId: null,
  payload,
  state: "running",
  attempt: options.attempt ?? 1,
  availableAt: 0,
  claimedBoot: null,
  lastError: null,
  outcome: null,
  settleAttempt: 0,
});

/** One attempt as the worker makes it: evidence of an earlier attempt first, else the act. */
export const attempt = (handler: EffectHandler, row: EffectRow): Effect.Effect<HandlerResult> =>
  handler.adopt === undefined
    ? handler.run(row)
    : handler.adopt(row).pipe(
        Effect.catchCause(() => Effect.succeed(Option.none<EffectOutcome>())),
        Effect.flatMap(
          Option.match({
            onNone: () => handler.run(row),
            onSome: (outcome) => Effect.succeed<HandlerResult>({ _tag: "Done", outcome }),
          }),
        ),
      );

/** The `ok` value of a result; anything else is the test's failure. */
export const okValue = (result: HandlerResult): unknown => {
  if (result._tag === "Done" && result.outcome.kind === "ok") return result.outcome.value;
  throw new Error(`expected an ok outcome, got ${JSON.stringify(result)}`);
};

/** The crew git core with reads and the claim runtime, over the shim. */
export const crewEffectLayer = (root: string, options: CrewShellFixtureOptions = {}) => {
  const core = crewGitLayer(root, options);
  return Layer.mergeAll(CrewReads.layer, CrewRuntime.layer).pipe(Layer.provideMerge(core));
};

export type CrewEffectServices = Layer.Success<ReturnType<typeof crewEffectLayer>>;

export const withCrewEffects = <A, E>(
  body: (root: string) => Effect.Effect<A, E, CrewEffectServices>,
  options: CrewShellFixtureOptions = {},
) => withCrewService(body, (root) => crewEffectLayer(root, options));

/** A writer's copy on the fixture's host, recorded as the engine path keys it. */
export const createLane = (handle: string) =>
  Effect.flatMap(CrewWorkspace.CrewWorkspace, (workspace) =>
    workspace.create({ crew: laneKey(handle).crew, handle, host: TEST_HOST }),
  );

/** The person commits `path` on your tree; its new HEAD. */
export const personCommits = (root: string, path: string, content: string): string => {
  write(root, path, content);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", `person edits ${path}`]);
  return git(root, ["rev-parse", "HEAD"]);
};

/** The commits in a copy since `from`, newest first, by subject. */
export const subjectsSince = (
  root: string,
  handle: string,
  from: string,
): ReadonlyArray<string> => {
  const out = git(`${root}/.crew/${handle}`, ["log", "--format=%s", `${from}..HEAD`]);
  return out === "" ? [] : out.split("\n");
};
