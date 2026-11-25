import { MATE_SHAPE_OF_TINT, MATE_TINT_IDS } from "@t3tools/shared/brand";

import { CrewSectionEmpty } from "~/components/zerops/crew/CrewSection";
import { MateDetailFailure } from "~/components/zerops/MateDetailFailure";
import { MateEmptyStateView } from "~/components/zerops/ZeropsMateEmptyState";

import { definePlayground, jsxElement } from "../kitPlayground";
import { ArrivalStage, NotCreatedStage } from "../sections/mate-stage";
import { variantsOf } from "../specimenLabel";
import { WREN, type BirthAge } from "../states/fixtures";
import { StateFrame } from "../states/StateFrame";

/** What a Mate's page waits on while there is nothing in it yet. */
const STAGES = ["empty chat", "coming up", "not created", "details failed", "no crew"] as const;
const AGES = variantsOf<BirthAge>({ start: true, midway: true, "over-time": true });

export default definePlayground({
  section: "mate-stage",
  name: "MateEmptyStateView",
  imports: 'import { MateEmptyStateView } from "~/components/zerops/ZeropsMateEmptyState";',
  controls: {
    stage: { kind: "enum", options: STAGES, note: "what the page waits on" },
    age: { kind: "enum", options: AGES, note: "how far into coming up: its steps and its clock" },
    name: { kind: "text", note: "the Mate's name" },
    tint: { kind: "enum", options: MATE_TINT_IDS, note: "the Mate's colour; its shape follows" },
  },
  initial: { stage: "empty chat", age: "midway", name: "Wren", tint: "slate" },
  render: ({ stage, age, name, tint }) => {
    const mate = { ...WREN, name, tint, shape: MATE_SHAPE_OF_TINT[tint] };
    return (
      <StateFrame size="page">
        {stage === "empty chat" ? (
          <MateEmptyStateView
            mate={{ ...mate, connected: true }}
            phase={null}
            signIn={null}
            signInRequired={false}
            unknown={null}
          />
        ) : stage === "coming up" ? (
          <ArrivalStage age={age} key={age} mate={mate} />
        ) : stage === "not created" ? (
          <NotCreatedStage mate={mate} />
        ) : stage === "details failed" ? (
          <MateDetailFailure
            again={() => {}}
            mate={mate}
            message="Zerops did not answer within 20 seconds."
          />
        ) : (
          <CrewSectionEmpty
            error={null}
            lock={null}
            mate={{ name, tint }}
            onSetUp={() => {}}
            onSignIn={() => {}}
          />
        )}
      </StateFrame>
    );
  },
  jsx: ({ stage, name, tint }) =>
    stage === "details failed"
      ? jsxElement("MateDetailFailure", {
          "mate={mate}": true,
          message: "Zerops did not answer within 20 seconds.",
          "again={again}": true,
        })
      : stage === "no crew"
        ? jsxElement("CrewSectionEmpty", {
            [`mate={{ name: "${name}", tint: "${tint}" }}`]: true,
            "lock={null}": true,
            "error={null}": true,
            "onSetUp={setUp}": true,
            "onSignIn={signIn}": true,
          })
        : jsxElement("MateEmptyStateView", {
            "mate={mate}": true,
            ...(stage === "coming up"
              ? {
                  'coming={{ kind: "coming", sentence, below: <ComingBelow … /> }}': true,
                }
              : stage === "not created"
                ? {
                    'coming={{ kind: "failed", sentence, below: <ComingBelow onTryAgain … /> }}': true,
                  }
                : {}),
            "phase={null}": true,
            "signIn={null}": true,
            "signInRequired={false}": true,
            "unknown={null}": true,
          }),
  usage: {
    do: [
      "Stand the Mate's face and one headline on its page while there is nothing in its chat yet.",
      "Say under them what it waits on: its arrival's steps, a setup that stopped, a crew to set up.",
      "Offer Try again and Remove where its setup stopped.",
    ],
    dont: [
      "Show an empty chat with a composer while the Mate cannot act on what is typed.",
      "Explain its container or its services: say what the person can do.",
    ],
  },
});
