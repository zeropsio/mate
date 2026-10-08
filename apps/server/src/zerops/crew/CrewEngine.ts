import type { SubscribeUpdateChanges } from "../../update/subscribeChanges.ts";
/**
 * CrewEngine — what the crew RPCs reach: the feed of snapshots, the crew
 * home's files, and every press as one command.
 *
 * `crewLayer` provides it in one of two forms, chosen when the layer is built
 * (ARCHITECTURE §1 gates 1–2): outside a Zerops project, or with
 * `T3CODE_ZEROPS_CREW` off, the inert form below answers `status: "off"` once
 * and refuses everything as `unavailable`; otherwise the live engine
 * (`crewLayer.ts`) runs it.
 *
 * A command, and a write to the crew home, carries its caller as a
 * `TurnPrincipal`: the person's session, so a turn the command starts inside
 * the call is admitted as them (PRD §5.2a), and a press that runs or changes
 * the crew is refused at its entry for anybody who may not run the logins it
 * reaches (`crewAccess.ts`).
 *
 * @module CrewEngine
 */
import {
  CrewCommandError,
  type CrewCommand,
  type CrewCommandResult,
  type CrewFiles,
  type CrewSnapshot,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import type { UpdateIdleFacts } from "../../update/MateUpdateDrain.ts";
import type { TurnPrincipal } from "../ZeropsTurnAdmission.ts";
import { CREW_OFF_SNAPSHOT } from "./crewSnapshot.ts";

export interface CrewEngineService {
  /** The current snapshot at once, then one per change, coalesced. */
  readonly snapshot: Stream.Stream<CrewSnapshot>;
  readonly updateFacts?: Effect.Effect<UpdateIdleFacts>;
  readonly updateChanges?: Stream.Stream<void>;
  readonly subscribeUpdateChanges?: SubscribeUpdateChanges;
  readonly readFiles: Effect.Effect<CrewFiles, CrewCommandError>;
  readonly writeFiles: (
    files: CrewFiles,
    principal: TurnPrincipal,
  ) => Effect.Effect<void, CrewCommandError>;
  readonly command: (
    command: CrewCommand,
    principal: TurnPrincipal,
  ) => Effect.Effect<CrewCommandResult, CrewCommandError>;
}

export class CrewEngine extends Context.Service<CrewEngine, CrewEngineService>()(
  "t3/zerops/crew/CrewEngine",
) {}

const unavailable = Effect.fail(new CrewCommandError({ reason: "unavailable", detail: null }));

/** Crew mode is off here: one snapshot saying so, and every request refused. */
export const inertCrewEngine: CrewEngineService = {
  snapshot: Stream.make(CREW_OFF_SNAPSHOT),
  updateFacts: Effect.succeed({ idle: true, blockers: [] }),
  updateChanges: Stream.empty,
  subscribeUpdateChanges: Effect.succeed({ changes: Stream.empty }),
  readFiles: unavailable,
  writeFiles: () => unavailable,
  command: () => unavailable,
};
