/**
 * crewTemplates — the starting crews of the Crew tab's setup: *Start with a
 * lead and two builders* (the lead, two builders), the empty crew *Add
 * someone yourself* begins from, the crew the Mate proposed from the goal
 * (*Let Fen suggest a crew*) and the one it set up in its conversation (a
 * `crew-ask`). Each is placed as `withBuildersPlaced` places a crew's
 * builders — on the project's one dev service or pool, sharing a service's
 * database — so on a Mate with one place the setup opens on a crew that could
 * start. A card's builder may name its place; with several places and none
 * named, or built before they are read, a builder is saved with nowhere for
 * its copy: placed when the crew starts where there is one place, else where
 * the person picks. The person
 * names each crewmate and writes what it is responsible for there.
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
  crewTints,
  parseBrief,
  withBuildersPlaced,
  type CrewDefinition,
  type CrewMemberSpec,
  type CrewPlaces,
} from "./crewHome.ts";

export type CrewTemplateId = "lead-and-builders" | "empty";

/** Where the builders work (`withBuildersPlaced`), and the Mate's own tint, which no crewmate takes. */
export interface CrewTemplateInput extends CrewPlaces {
  readonly template: CrewTemplateId;
  readonly crew: string;
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

const REVIEWER_JOB = `Reviews the crew's finished work.
Read each finished task against its Done when and the goal's rules, and say what must change before it lands. You read; you never change files.
`;

/** The goal every template starts from: a placeholder the person replaces. */
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
  /** The login it runs on, its model and effort; absent, the login's defaults. */
  readonly login?: string;
  readonly model?: string;
  readonly effort?: string;
  /** A builder's place, where it was named: a dev service, or a dev pool. */
  readonly host?: string;
  readonly pool?: string;
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

export interface CrewFromProposalInput extends Omit<CrewTemplateInput, "template"> {
  readonly proposal: CrewProposal;
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

/** One crewmate of a crew the Mate set up: proposed from the goal, or in its conversation. */
export interface CrewAskSeat {
  readonly name: string;
  /** The one line of its part, which its row says. */
  readonly part: string;
  readonly kind: CrewMemberKind;
  /** The Mate's login it runs on, its model and effort; absent, the login's defaults. */
  readonly login?: string | undefined;
  readonly model?: string | undefined;
  readonly effort?: string | undefined;
  /** A builder's dev service or dev pool, by its hostname; absent where none was named. */
  readonly place?: string | undefined;
}

export interface CrewFromAskInput extends Omit<CrewFromProposalInput, "proposal"> {
  readonly seats: ReadonlyArray<CrewAskSeat>;
  /** The crew card whose press set it up (`CrewDefinition.ask`); absent for a proposal. */
  readonly ask?: string | undefined;
}

/**
 * The crew a Mate set up, as a crew home: each crewmate named as set up, its handle from its name
 * (once each), its job opening with its part — the line its row says — and going on as the
 * starting crew's lead or builder, or as a reviewer, on the login, model and effort it was set up
 * on, a builder on the place it was set up on (a pool, when one of the project's pools is named;
 * else a dev service). A card's crew names the card, so the card knows the crew is its own.
 */
export const crewFromAsk = ({ ask, ...input }: CrewFromAskInput): CrewDefinition => {
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
  const jobOf = (kind: CrewMemberKind): string =>
    kind === "lead" ? LEAD_JOB : kind === "reader" ? REVIEWER_JOB : BUILDER_JOB;
  const crew = crewOf(
    input.seats.map((seat): Seat => ({
      handle: unique(seat.name),
      displayName: seat.name,
      kind: seat.kind,
      job: `${seat.part}\n${jobRest(jobOf(seat.kind))}`,
      ...(seat.login === undefined ? {} : { login: seat.login }),
      ...(seat.model === undefined ? {} : { model: seat.model }),
      ...(seat.effort === undefined ? {} : { effort: seat.effort }),
      ...(seat.kind !== "writer" || seat.place === undefined
        ? {}
        : (input.pools ?? []).includes(seat.place)
          ? { pool: seat.place }
          : { host: seat.place }),
    })),
    input,
  );
  return ask === undefined ? crew : { ...crew, ask };
};

/** The crew the Mate proposed from the goal: its lead, then its builders. */
export const crewFromProposal = ({ proposal, ...input }: CrewFromProposalInput): CrewDefinition =>
  crewFromAsk({
    ...input,
    seats: [
      { ...proposal.lead, kind: "lead" },
      ...proposal.builders.map((builder) => ({ ...builder, kind: "writer" as const })),
    ],
  });

const crewOf = (
  seats: ReadonlyArray<Seat>,
  input: Omit<CrewTemplateInput, "template">,
): CrewDefinition => {
  const tints = crewTints(seats, input.mateTint);
  const members = seats.map((seat): CrewMemberSpec => ({
    handle: seat.handle,
    displayName: seat.displayName,
    kind: seat.kind,
    readOnly: seat.kind !== "writer",
    tint: tints.get(seat.handle)!,
    restartAfterMerge: false,
    afterLandRestart: false,
    ...(seat.login === undefined ? {} : { login: seat.login }),
    ...(seat.model === undefined ? {} : { model: seat.model }),
    ...(seat.effort === undefined ? {} : { effort: seat.effort }),
    ...(seat.host === undefined ? {} : { host: seat.host }),
    ...(seat.pool === undefined ? {} : { pool: seat.pool }),
    env: {},
    migrations: [],
    job: seat.job,
  }));
  return withBuildersPlaced(
    {
      crew: input.crew,
      name: "Crew",
      brief: parseBrief("New brief", CREW_BRIEF_TEMPLATE),
      members,
    },
    input,
  );
};
