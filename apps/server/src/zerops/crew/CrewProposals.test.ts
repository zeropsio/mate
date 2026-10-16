import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  OrchestrationDispatchCommandError,
  ProviderInstanceId,
  TextGenerationError,
  type CrewProposalInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as TextGeneration from "../../textGeneration/TextGeneration.ts";
import { ZeropsTurnAdmission } from "../ZeropsTurnAdmission.ts";
import * as CrewProposals from "./CrewProposals.ts";

const input: CrewProposalInput = {
  goal: "A tea shop that ships weekly.",
  modelSelection: { instanceId: ProviderInstanceId.make("claude"), model: "claude-sonnet-4-5" },
};

const roster = {
  lead: { name: "Lead", part: "Plans the shop and splits the work." },
  builders: [
    { name: "Checkout", part: "Builds the checkout and its payment step." },
    { name: "Catalog", part: "Builds the tea catalog and its search." },
  ],
};

type Generate = TextGeneration.TextGeneration["Service"]["generateCrewProposal"];

const notCalled = (name: string) => () => Effect.die(`${name} is not part of a crew proposal`);

/** The service over a stub agent and a gate that admits, or refuses with `refusal`. */
const layerWith = (generate: Generate, refusal?: string) =>
  CrewProposals.layer.pipe(
    Layer.provide(
      Layer.succeed(
        TextGeneration.TextGeneration,
        TextGeneration.TextGeneration.of({
          generateCommitMessage: notCalled("generateCommitMessage"),
          generatePrContent: notCalled("generatePrContent"),
          generateBranchName: notCalled("generateBranchName"),
          generateThreadTitle: notCalled("generateThreadTitle"),
          generateCrewProposal: generate,
        }),
      ),
    ),
    Layer.provide(
      Layer.succeed(
        ZeropsTurnAdmission,
        ZeropsTurnAdmission.of({
          admit: () => Effect.void,
          admitOperator: () => Effect.void,
          admitRun: () =>
            refusal === undefined
              ? Effect.void
              : Effect.fail(new OrchestrationDispatchCommandError({ message: refusal })),
        }),
      ),
    ),
    Layer.provide(NodeServices.layer),
  );

const propose = Effect.gen(function* () {
  const proposals = yield* CrewProposals.CrewProposals;
  return yield* Effect.exit(proposals.propose(input, "user-1"));
});

const failureOf = <A, E>(exit: Exit.Exit<A, E>) =>
  Exit.isFailure(exit) ? exit.cause.reasons.find((reason) => reason._tag === "Fail")?.error : null;

describe("CrewProposals", () => {
  it.effect("proposes a crew from the goal, on the Mate's own agent", () => {
    const seen: Array<Parameters<Generate>[0]> = [];
    return Effect.gen(function* () {
      const exit = yield* propose;
      expect(exit).toEqual(Exit.succeed(roster));
      expect(seen.map((call) => [call.goal, call.modelSelection])).toEqual([
        [input.goal, input.modelSelection],
      ]);
    }).pipe(
      Effect.provide(
        layerWith((call) => {
          seen.push(call);
          return Effect.succeed(roster);
        }),
      ),
    );
  });

  it.effect("runs the agent in an empty directory of its own, never the project", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      let entries: ReadonlyArray<string> | null = null;
      let cwd = "";
      yield* Effect.gen(function* () {
        yield* propose;
      }).pipe(
        Effect.provide(
          layerWith((call) =>
            Effect.gen(function* () {
              cwd = call.cwd;
              entries = yield* fileSystem.readDirectory(call.cwd).pipe(Effect.orDie);
              return roster;
            }),
          ),
        ),
      );
      expect(entries).toEqual([]);
      expect(cwd).not.toBe(process.cwd());
      expect(yield* fileSystem.exists(cwd)).toBe(false);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("says why, and asks nothing of the agent, when the person may not run it", () => {
    let asked = false;
    return Effect.gen(function* () {
      const exit = yield* propose;
      expect(failureOf(exit)).toMatchObject({
        _tag: "CrewProposalError",
        reason: "refused",
        detail: "Claude's sign-in has expired.",
      });
      expect(asked).toBe(false);
    }).pipe(
      Effect.provide(
        layerWith(() => {
          asked = true;
          return Effect.succeed(roster);
        }, "Claude's sign-in has expired."),
      ),
    );
  });

  it.effect("fails plainly when the agent fails or runs out of time", () =>
    Effect.gen(function* () {
      const exit = yield* propose;
      expect(failureOf(exit)).toMatchObject({
        _tag: "CrewProposalError",
        reason: "failed",
        detail: null,
      });
    }).pipe(
      Effect.provide(
        layerWith(() =>
          Effect.fail(
            new TextGenerationError({
              operation: "generateCrewProposal",
              detail: "Claude CLI request timed out.",
            }),
          ),
        ),
      ),
    ),
  );

  it.effect.each([
    ["no builder", { lead: roster.lead, builders: [] }],
    ["two crewmates of one name", { lead: roster.lead, builders: [{ ...roster.lead }] }],
    [
      "a part over two lines",
      { lead: roster.lead, builders: [{ name: "Checkout", part: "Builds it.\nAnd more." }] },
    ],
    ["a nameless crewmate", { lead: roster.lead, builders: [{ name: " ", part: "Builds it." }] }],
  ] as const)("refuses an answer with %s as no crew", ([, answer]) =>
    Effect.gen(function* () {
      const exit = yield* propose;
      expect(failureOf(exit)).toMatchObject({ _tag: "CrewProposalError", reason: "malformed" });
    }).pipe(Effect.provide(layerWith(() => Effect.succeed(answer)))),
  );
});
