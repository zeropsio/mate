/**
 * crewTemplates — the three starting crews of *Set up a crew* (PRD §4.7):
 * *Feature team* (lead, two builders, a reviewer; without the lead until
 * phase C), *Solo + reviewer* and *Start empty*. Each is a definition that
 * parses and validates as it is, so the editor opens on a crew that could be
 * applied; the person fills in setup, check and database choices there.
 *
 * @module crewTemplates
 */
import type { CrewMemberKind } from "@t3tools/contracts";

import { MATE_TINT_IDS, type MateTintId } from "./brand.ts";
import { parseBrief, type CrewDefinition, type CrewMemberSpec } from "./crewHome.ts";

export type CrewTemplateId = "feature-team" | "solo-reviewer" | "empty";

export interface CrewTemplateInput {
  readonly template: CrewTemplateId;
  readonly crew: string;
  /** The Mate's dev services; builders take them in turn. */
  readonly devHosts: ReadonlyArray<string>;
  /** Phase C: *Feature team* includes its lead. */
  readonly withLead: boolean;
  /** The Mate's own tint, which no crewmate takes. */
  readonly mateTint?: MateTintId;
}

const LEAD_JOB = `Turn the brief into tasks, one area of the code per crewmate, and propose them.
Review each finished task against its Done when and the brief's binding decisions.
You read and plan; you never change files.
`;

const BUILDER_JOB = `Build what your task asks, in your copy of the code.
Keep each change small and covered by tests; report when the check passes.
`;

const REVIEWER_JOB = `Review each change against its task and the brief: correctness, tests, the binding decisions.
Say what must change and why; you never change files.
`;

/** The brief every template starts from: a placeholder the person replaces. */
export const CREW_BRIEF_TEMPLATE = `Describe what the crew builds and why.

## Binding decisions
- Decisions every crewmate must follow.

## Done when
- The outcome that finishes the work.
`;

interface Seat {
  readonly handle: string;
  readonly displayName: string;
  readonly kind: CrewMemberKind;
  readonly job: string;
}

const seatsOf = (template: CrewTemplateId, withLead: boolean): ReadonlyArray<Seat> => {
  const reviewer: Seat = {
    handle: "reviewer",
    displayName: "Reviewer",
    kind: "reader",
    job: REVIEWER_JOB,
  };
  switch (template) {
    case "feature-team":
      return [
        ...(withLead
          ? [{ handle: "lead", displayName: "Lead", kind: "lead", job: LEAD_JOB } as const]
          : []),
        { handle: "builder-1", displayName: "Builder 1", kind: "writer", job: BUILDER_JOB },
        { handle: "builder-2", displayName: "Builder 2", kind: "writer", job: BUILDER_JOB },
        reviewer,
      ];
    case "solo-reviewer":
      return [
        { handle: "builder", displayName: "Builder", kind: "writer", job: BUILDER_JOB },
        reviewer,
      ];
    case "empty":
      return [];
  }
};

const TEMPLATE_NAMES: Record<CrewTemplateId, string> = {
  "feature-team": "Feature team",
  "solo-reviewer": "Solo + reviewer",
  empty: "Crew",
};

export const crewFromTemplate = (input: CrewTemplateInput): CrewDefinition => {
  const tints = MATE_TINT_IDS.filter((tint) => tint !== input.mateTint);
  let writers = 0;
  const members = seatsOf(input.template, input.withLead).map((seat, index): CrewMemberSpec => {
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
    name: TEMPLATE_NAMES[input.template],
    brief: parseBrief("New brief", CREW_BRIEF_TEMPLATE),
    members,
  };
};
