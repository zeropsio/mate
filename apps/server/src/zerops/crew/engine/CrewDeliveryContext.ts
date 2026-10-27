/**
 * What a crew delivery needs from outside the crew's own state to become an engine command: a
 * rotation's seed (the crewmate's state packet, from its memory and its copy), the agent a login
 * runs (its driver, model and options), and a seam's words. The wiring provides it; the
 * `crew.deliver` handler reads it when it translates the crew's command.
 *
 * @module crew/engine/CrewDeliveryContext
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type { ConversationAgent, RecordedCrewSeam } from "@t3tools/contracts";

export interface CrewAgentAsk {
  /** The crewmate's login (a provider instance id). */
  readonly instanceId: string;
  readonly model: string | null;
  readonly effort: string | null;
  readonly profile: { readonly kind: "crewmate"; readonly id: string; readonly name: string };
}

export interface CrewDeliveryContextShape {
  /**
   * The packet a crewmate's new session starts from (its state packet: memory, open task, its
   * copy's ground truth); `null` when it has none.
   */
  readonly seed: (input: {
    readonly handle: string;
    readonly taskId: string | null;
  }) => Effect.Effect<string | null>;
  /** The agent a crewmate's login runs; none when no live agent serves the login. */
  readonly agentOf: (ask: CrewAgentAsk) => Effect.Effect<ConversationAgent | undefined>;
  /** The words a seam's line reads in the crewmate's chat; `null` leaves them to the reader. */
  readonly seamWords: (seam: RecordedCrewSeam) => string | null;
}

export class CrewDeliveryContext extends Context.Service<
  CrewDeliveryContext,
  CrewDeliveryContextShape
>()("t3/zerops/crew/engine/CrewDeliveryContext") {}
