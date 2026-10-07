/**
 * The Mate engine's ports, implemented for Zerops: a run is admitted by
 * `ZeropsTurnAdmission.admitRun` (D6) and the restart is read by
 * `ZeropsRestartRead`. Outside Zerops nothing is gated and nothing is read.
 *
 * @module engineAdapters
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ServerConfig } from "../config.ts";
import { RestartEvidence, RunAdmission, RunRefused, type RunPrincipal } from "../engine/ports.ts";
import { isZeropsEnvironment } from "./ZeropsEnvironment.ts";
import { ZeropsRestartRead } from "./ZeropsRestartRead.ts";
import { ZeropsTurnAdmission, type TurnPrincipal } from "./ZeropsTurnAdmission.ts";

/** A person is their session; a crew wake is crew's, every other wake a stand-up's kind. */
export const turnPrincipalOf = (principal: RunPrincipal): TurnPrincipal =>
  principal.kind === "person"
    ? { kind: "session", subject: principal.subject }
    : { kind: principal.owner === "crew" ? "crew" : "standup", startedBy: principal.startedBy };

/** Outside Zerops: every run is admitted, and there is no restart to read. */
export const engineAdaptersOpen = Layer.mergeAll(
  Layer.succeed(RunAdmission, RunAdmission.of({ admit: () => Effect.void })),
  Layer.succeed(RestartEvidence, RestartEvidence.of({ read: Effect.succeed(null) })),
);

const zeropsAdapters = Layer.mergeAll(
  Layer.effect(
    RunAdmission,
    Effect.map(ZeropsTurnAdmission, (admission) =>
      RunAdmission.of({
        admit: ({ instanceId, principal }) =>
          admission
            .admitRun({ instanceId, principal: turnPrincipalOf(principal) })
            .pipe(Effect.mapError((refusal) => new RunRefused({ message: refusal.message }))),
      }),
    ),
  ),
  Layer.effect(
    RestartEvidence,
    Effect.map(ZeropsRestartRead, (reader) =>
      RestartEvidence.of({
        // Asked once per boot and never retried: an unreadable platform reads as no evidence.
        read: reader.read.pipe(Effect.orElseSucceed(() => null)),
      }),
    ),
  ),
);

/** The ports for this process: Zerops's inside a Zerops project, open everywhere else. */
export const engineAdaptersLayer = Layer.unwrap(
  Effect.gen(function* () {
    return isZeropsEnvironment(yield* ServerConfig) ? zeropsAdapters : engineAdaptersOpen;
  }),
);
