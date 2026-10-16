/**
 * crewTemplates — the starting crews of the Crew tab's setup: *Start with a
 * lead and two builders* (the lead, two builders), the empty crew *Add
 * someone yourself* begins from, and the crew the Mate proposed from the goal
 * (*Let Fen suggest a crew*). Each is a definition that parses and
 * validates as it is, so the setup opens on a crew that could start — a
 * builder on a service with a database shares it — and the person names each
 * crewmate and writes what it is responsible for there.
 *
 * A job is written to its crewmate, and its first sentence is what the Crew
 * tab's row says while the crewmate is on nothing: each opens with the line
 * the person reads ("Plans the work…"), then speaks to the crewmate.
 *
 * @module crewTemplates
 */
import type { CrewMemberKind, CrewProposal } from "@t3tools/contracts";

import type { MateTintId } from "./brand.ts";
import {
  parseBrief,
  withSharedDatabase,
  type CrewDefinition,
  type CrewMemberSpec,
} from "./crewHome.ts";

export type CrewTemplateId = "lead-and-builders" | "empty";

export interface CrewTemplateInput {
  readonly template: CrewTemplateId;
  readonly crew: string;
  /** The Mate's dev services; builders take them in turn. */
  readonly devHosts: ReadonlyArray<string>;
  /** Those of them known to reach a database: a builder there shares it (`withSharedDatabase`). */
  readonly databaseHosts?: ReadonlyArray<string>;
  /** The Mate's own tint, which no crewmate takes. */
  readonly mateTint?: MateTintId;
}

const LEAD_JOB = `Plans the work and splits it between the crew.
Turn the goal into tasks, one area of the code per crewmate, and propose them.
Review each finished task against its Done when and the goal's rules.
You read and plan; you never change files.
`;

const BUILDER_JOB = `Builds its part of the work.
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

export const crewFromTemplate = (input: CrewTemplateInput): CrewDefinition =>
  crewOf(seatsOf(input.template), input);

export interface CrewFromProposalInput {
  readonly proposal: CrewProposal;
  readonly crew: string;
  /** The Mate's dev services; builders take them in turn. */
  readonly devHosts: ReadonlyArray<string>;
  /** Those of them known to reach a database: a builder there shares it (`withSharedDatabase`). */
  readonly databaseHosts?: ReadonlyArray<string>;
  /** The Mate's own tint, which no crewmate takes. */
  readonly mateTint?: MateTintId;
}

/** The job past its first line: what a lead or a builder is told, as the starting crew's. */
const jobRest = (job: string): string => job.slice(job.indexOf("\n") + 1);

const HANDLE_MAX = 20;

/** A handle from a name: its letters and digits, dashed, lower case — `crewmate` when none is left. */
const handleOf = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+/u, "")
    .slice(0, HANDLE_MAX)
    .replace(/-+$/u, "") || "crewmate";

/**
 * The crew the Mate proposed, as a crew home: each crewmate named as proposed,
 * its handle from its name (once each), its job opening with its part — the
 * line its row says — and going on as the starting crew's lead or builder.
 */
export const crewFromProposal = (input: CrewFromProposalInput): CrewDefinition => {
  const taken = new Set<string>();
  const unique = (name: string): string => {
    const base = handleOf(name);
    let handle = base;
    for (let n = 2; taken.has(handle); n++) {
      const suffix = `-${n}`;
      handle = `${base.slice(0, HANDLE_MAX - suffix.length).replace(/-+$/u, "")}${suffix}`;
    }
    taken.add(handle);
    return handle;
  };
  const seat = (kind: CrewMemberKind, proposed: CrewProposal["lead"], template: string): Seat => ({
    handle: unique(proposed.name),
    displayName: proposed.name,
    kind,
    job: `${proposed.part}\n${jobRest(template)}`,
  });
  return crewOf(
    [
      seat("lead", input.proposal.lead, LEAD_JOB),
      ...input.proposal.builders.map((builder) => seat("writer", builder, BUILDER_JOB)),
    ],
    input,
  );
};

const crewOf = (
  seats: ReadonlyArray<Seat>,
  input: Pick<CrewTemplateInput, "crew" | "devHosts" | "databaseHosts" | "mateTint">,
): CrewDefinition => {
  const tints = CREW_TINTS.filter((tint) => tint !== input.mateTint);
  let writers = 0;
  const members = seats.map((seat, index): CrewMemberSpec => {
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
  return withSharedDatabase(
    {
      crew: input.crew,
      name: "Crew",
      brief: parseBrief("New brief", CREW_BRIEF_TEMPLATE),
      members,
    },
    input.databaseHosts ?? [],
  );
};
