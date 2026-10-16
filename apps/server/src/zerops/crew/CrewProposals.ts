/**
 * CrewProposals — *Let Fen suggest a crew*: a roster proposed from the goal,
 * for the person to edit in the setup before anything is saved.
 *
 * One generation on the Mate's own agent (the model its conversation runs),
 * through `TextGeneration`: no tools, no conversation, in an empty directory
 * of its own, so it reads nothing of the project and changes nothing. It
 * spends that agent's login, so D6's gate admits it first, as the person who
 * pressed. The answer is judged by the crew's own rules (`CrewProposal`); one
 * that breaks them is no crew. Interrupting the request stops the agent.
 *
 * @module CrewProposals
 */
import { CrewProposal, CrewProposalError, type CrewProposalInput } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as TextGeneration from "../../textGeneration/TextGeneration.ts";
import { ZeropsTurnAdmission } from "../ZeropsTurnAdmission.ts";

const decodeProposal = Schema.decodeUnknownEffect(CrewProposal);

export class CrewProposals extends Context.Service<
  CrewProposals,
  {
    /** A crew for `input.goal`, proposed by the agent `input.modelSelection` names, for `subject`. */
    readonly propose: (
      input: CrewProposalInput,
      subject: string,
    ) => Effect.Effect<CrewProposal, CrewProposalError>;
  }
>()("t3/zerops/crew/CrewProposals") {}

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
        TextGenerationError: () =>
          Effect.fail(new CrewProposalError({ reason: "failed", detail: null })),
        PlatformError: () => Effect.fail(new CrewProposalError({ reason: "failed", detail: null })),
      }),
    );

  const propose = Effect.fn("CrewProposals.propose")(function* (
    input: CrewProposalInput,
    subject: string,
  ) {
    yield* admission
      .admitRun({
        instanceId: input.modelSelection.instanceId,
        principal: { kind: "session", subject },
      })
      .pipe(
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

  return CrewProposals.of({ propose });
});

export const layer = Layer.effect(CrewProposals, make);

/** Where no agent may be asked — a fixture scene, whose crew mode is off: every proposal is refused. */
export const inertCrewProposals = CrewProposals.of({
  propose: () => Effect.fail(new CrewProposalError({ reason: "refused", detail: null })),
});

export const layerInert = Layer.succeed(CrewProposals, inertCrewProposals);
