/**
 * crewTemplates — the starting crews of the Crew tab's setup: *Start with a
 * lead and two builders* (the lead, two builders), and the empty crew *Add
 * someone yourself* begins from. Each is a definition that parses and
 * validates as it is, so the setup opens on a crew that could start; the
 * person names each crewmate and writes what it is responsible for there.
 *
 * A job is written to its crewmate, and its first sentence is what the Crew
 * tab's row says while the crewmate is on nothing: each opens with the line
 * the person reads ("Plans the work…"), then speaks to the crewmate.
 *
 * @module crewTemplates
 */
import type { CrewMemberKind } from "@t3tools/contracts";

import type { MateTintId } from "./brand.ts";
import { parseBrief, type CrewDefinition, type CrewMemberSpec } from "./crewHome.ts";

export type CrewTemplateId = "lead-and-builders" | "empty";

export interface CrewTemplateInput {
  readonly template: CrewTemplateId;
  readonly crew: string;
  /** The Mate's dev services; builders take them in turn. */
  readonly devHosts: ReadonlyArray<string>;
  /** The Mate's own tint, which no crewmate takes. */
  readonly mateTint?: MateTintId;
}

const LEAD_JOB = `Plans the work and splits it between the crew.
Turn the goal into tasks, one area of the code per crewmate, and propose them.
Review each finished task against its Done when and the goal's rules.
You read and plan; you never change files.
`;

const BUILDER_JOB = `Builds its part of the work, in its own copy of the code.
Build what your task asks. Keep each change small and covered by tests; report when the check passes.
`;

/** The goal every template starts from: a placeholder the person replaces. */
export const CREW_BRIEF_TEMPLATE = `Describe what the crew builds and why.

## Binding decisions
- Decisions every crewmate must follow.

## Done when
- The outcome that finishes the work.
`;

/**
 * The tints a starting crew takes, in turn: the lead violet, the builders sky
 * and coral — the setup's three faces — stepping past the Mate's own.
 */
const CREW_TINTS: ReadonlyArray<MateTintId> = [
  "violet",
  "sky",
  "coral",
  "olive",
  "rose",
  "sand",
  "slate",
  "amber",
];

interface Seat {
  readonly handle: string;
  readonly displayName: string;
  readonly kind: CrewMemberKind;
  readonly job: string;
}

const seatsOf = (template: CrewTemplateId): ReadonlyArray<Seat> => {
  switch (template) {
    case "lead-and-builders":
      return [
        { handle: "lead", displayName: "Lead", kind: "lead", job: LEAD_JOB },
        { handle: "builder-1", displayName: "Builder 1", kind: "writer", job: BUILDER_JOB },
        { handle: "builder-2", displayName: "Builder 2", kind: "writer", job: BUILDER_JOB },
      ];
    case "empty":
      return [];
  }
};

export const crewFromTemplate = (input: CrewTemplateInput): CrewDefinition => {
  const tints = CREW_TINTS.filter((tint) => tint !== input.mateTint);
  let writers = 0;
  const members = seatsOf(input.template).map((seat, index): CrewMemberSpec => {
    const host =
      seat.kind === "writer" && input.devHosts.length > 0
        ? input.devHosts[writers++ % input.devHosts.length]
        : undefined;
    return {
      handle: seat.handle,
      displayName: seat.displayName,
      kind: seat.kind,
      readOnly: seat.kind !== "writer",
      tint: tints[index % tints.length]!,
      ...(host ? { host } : {}),
      restartAfterMerge: false,
      afterLandRestart: false,
      env: {},
      migrations: [],
      job: seat.job,
    };
  });
  return {
    crew: input.crew,
    name: "Crew",
    brief: parseBrief("New brief", CREW_BRIEF_TEMPLATE),
    members,
  };
};
