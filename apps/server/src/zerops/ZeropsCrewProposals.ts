/**
 * ZeropsCrewProposals — *Let Fen suggest a crew*: a roster proposed from the goal,
 * for the person to edit in the setup before anything is saved.
 *
 * One generation on the Mate's own agent (the model its conversation runs),
 * through `TextGeneration`: no tools, no conversation, in an empty directory
 * of its own, so it reads nothing of the project and changes nothing. It
 * spends that agent's login, so D6's gate judges it first, as the person who
 * pressed (`admitGeneration`: a run's judgement, without being a run). It
 * lives beside the Zerops services rather than in `crew/`: it needs none of
 * the crew's state, only the Mate's agent, and crew reaches no text generation. The answer is judged by the crew's own rules (`CrewProposal`); one
 * that breaks them is no crew. Interrupting the request stops the agent.
 *
 * @module ZeropsCrewProposals
 */
import {
  CrewProposal,
  CrewProposalError,
  type CrewProposalInput,
  type TextGenerationError,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import { ZeropsTurnAdmission } from "./ZeropsTurnAdmission.ts";

const decodeProposal = Schema.decodeUnknownEffect(CrewProposal);

/** What an agent's CLI said when it stopped (`<Agent> CLI command failed: <its words>`). */
const CLI_WORDS = /^\w+ CLI command failed: (.+)$/su;
/** Words an agent stops with when its sign-in expired or was never made. */
const SIGNED_OUT =
  /\b(?:not (?:logged|signed) in|please run \/login|log ?in again|sign ?in again|unauthori[sz]ed|authentication (?:failed|required|error)|invalid api key|(?:token|credentials?|session) (?:has )?expired|401)\b/iu;
/** How much of an agent's words the row says: its first line, bounded. */
const WORDS_MAX = 240;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * Why the agent produced no crew, from its failure: a sign-in it lacks as
 * that, plainly; its own words where it gave some (a CLI that stopped saying
 * why, OpenCode's provider message), as a refusal; anything else — a timeout,
 * a crash, silence — as a plain failure.
 */
export function crewProposalFailureOf(error: TextGenerationError): CrewProposalError {
  const spoken =
    CLI_WORDS.exec(error.detail)?.[1] ??
    (isRecord(error.cause) && error.cause._tag === "OpenCodeTextGenerationPromptResponseError"
      ? error.detail
      : null);
  if (SIGNED_OUT.test(spoken ?? error.detail))
    return new CrewProposalError({ reason: "signed-out", detail: null });
  const words = spoken?.split(/\r?\n/u)[0]?.trim().slice(0, WORDS_MAX) ?? "";
  return words === ""
    ? new CrewProposalError({ reason: "failed", detail: null })
    : new CrewProposalError({ reason: "refused", detail: words });
}

export class ZeropsCrewProposals extends Context.Service<
  ZeropsCrewProposals,
  {
    /** A crew for `input.goal`, proposed by the agent `input.modelSelection` names, for `subject`. */
    readonly propose: (
      input: CrewProposalInput,
      subject: string,
    ) => Effect.Effect<CrewProposal, CrewProposalError>;
  }
>()("t3/zerops/ZeropsCrewProposals") {}

const make = Effect.gen(function* () {
  const textGeneration = yield* TextGeneration.TextGeneration;
  const admission = yield* ZeropsTurnAdmission;
  const fileSystem = yield* FileSystem.FileSystem;

  const generate = (input: CrewProposalInput) =>
    Effect.scoped(
      Effect.gen(function* () {
        const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "mate-crew-proposal-" });
        return yield* textGeneration.generateCrewProposal({
          cwd,
          goal: input.goal,
          modelSelection: input.modelSelection,
        });
      }),
    ).pipe(
      Effect.tapError((cause) =>
        Effect.logWarning("crew proposal failed").pipe(
          Effect.annotateLogs({ instanceId: input.modelSelection.instanceId, error: cause._tag }),
        ),
      ),
      Effect.catchTags({
        TextGenerationError: (error) => Effect.fail(crewProposalFailureOf(error)),
        PlatformError: () => Effect.fail(new CrewProposalError({ reason: "failed", detail: null })),
      }),
    );

  const propose = Effect.fn("ZeropsCrewProposals.propose")(function* (
    input: CrewProposalInput,
    subject: string,
  ) {
    yield* admission.admitGeneration({ instanceId: input.modelSelection.instanceId, subject }).pipe(
      Effect.catchTags({
        OrchestrationDispatchCommandError: (refusal) =>
          Effect.fail(new CrewProposalError({ reason: "refused", detail: refusal.message })),
      }),
    );
    const answer = yield* generate(input);
    return yield* decodeProposal(answer).pipe(
      Effect.catchTags({
        SchemaError: () =>
          Effect.fail(new CrewProposalError({ reason: "malformed", detail: null })),
      }),
    );
  });

  return ZeropsCrewProposals.of({ propose });
});

export const layer = Layer.effect(ZeropsCrewProposals, make);

/** Where no agent may be asked — a fixture scene, whose crew mode is off: every proposal is refused. */
export const inertCrewProposals = ZeropsCrewProposals.of({
  propose: () => Effect.fail(new CrewProposalError({ reason: "refused", detail: null })),
});

export const layerInert = Layer.succeed(ZeropsCrewProposals, inertCrewProposals);
