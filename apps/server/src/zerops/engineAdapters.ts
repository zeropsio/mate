/**
 * The Mate engine's ports, implemented for Zerops: a run is admitted by
 * `ZeropsTurnAdmission.admitRun` (D6), the restart is read by
 * `ZeropsRestartRead` and worded as V1 words it, and the agent works in the
 * server's own directory, or a crewmate where its crew says. Outside Zerops nothing is gated and
 * nothing is read.
 *
 * @module engineAdapters
 */
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type { Principal, RunTrigger } from "@t3tools/contracts";

import { ServerConfig } from "../config.ts";
import {
  AgentWorkspace,
  RestartEvidence,
  RunAdmission,
  RunRefused,
  type RestartFacts,
} from "../engine/ports.ts";
import { CrewWorkspaceDirectory } from "./crew/engine/CrewWorkspaceDirectory.ts";
import { isZeropsEnvironment } from "./ZeropsEnvironment.ts";
import { restartCause, ZeropsRestartRead } from "./ZeropsRestartRead.ts";
import { ZeropsTurnAdmission, type TurnPrincipal } from "./ZeropsTurnAdmission.ts";

const ZEROPS_SUBJECT = "zerops:";

/**
 * A person at the keyboard is their session; a crew wake is crew's, every other wake a stand-up's
 * kind, for the person it continues. The engine is never a run's principal: none.
 */
export const turnPrincipalOf = (
  principal: Principal,
  trigger: RunTrigger,
): TurnPrincipal | null => {
  switch (principal.kind) {
    case "person":
      if (trigger.kind === "person") return { kind: "session", subject: principal.subject };
      return {
        kind: "standup",
        startedBy: principal.subject.startsWith(ZEROPS_SUBJECT)
          ? principal.subject.slice(ZEROPS_SUBJECT.length)
          : principal.subject,
      };
    case "crew":
      return { kind: "crew", startedBy: principal.startedBy };
    case "standup":
      return { kind: "standup", startedBy: principal.startedBy };
    default:
      return null;
  }
};

/** Runs admitted by D6's gate, `ZeropsTurnAdmission.admitRun`: the same gate V1's turns pass. */
export const zeropsRunAdmission = Layer.effect(
  RunAdmission,
  Effect.map(ZeropsTurnAdmission, (admission) =>
    RunAdmission.of({
      admit: ({ instanceId, principal, trigger }) => {
        const turnPrincipal = turnPrincipalOf(principal, trigger);
        if (turnPrincipal === null) {
          return Effect.fail(new RunRefused({ message: "Nobody this run could act for." }));
        }
        return admission
          .admitRun({ instanceId, principal: turnPrincipal })
          .pipe(Effect.mapError((refusal) => new RunRefused({ message: refusal.message })));
      },
    }),
  ),
);

const iso = (millis: number) => DateTime.formatIso(DateTime.makeUnsafe(millis));

/** The restart in V1's words: the container action, its replacement, or a plain restart. */
const explainRestart = (
  facts: RestartFacts | null,
  window: { readonly lastActivityAt: number; readonly bootAt: number },
) =>
  `${restartCause({ evidence: facts, lastActivityAt: iso(window.lastActivityAt), bootAt: iso(window.bootAt) })}.`;

/** No platform to read a restart from: a fixture scene, or a process outside Zerops. */
export const noRestartEvidence = Layer.succeed(
  RestartEvidence,
  RestartEvidence.of({ read: Effect.succeed(null), explain: explainRestart }),
);

/**
 * A crewmate's conversation works where its crew says (its copy, or the Mate's tree); every other
 * agent works in the server's own directory, with full access: the Mate's container.
 */
export const serverWorkspace = Layer.effect(
  AgentWorkspace,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const crew = yield* Effect.serviceOption(CrewWorkspaceDirectory);
    const server = { cwd: config.cwd, runtimeMode: "full-access" } as const;
    return AgentWorkspace.of({
      of: (conversation) =>
        Option.match(crew, {
          onNone: () => Effect.succeed(server),
          onSome: (directory) =>
            Effect.map(
              directory.workspaceOf(conversation),
              Option.getOrElse(() => server),
            ),
        }),
    });
  }),
);

/** Outside Zerops: every run is admitted, and there is no restart to read. */
export const engineAdaptersOpen = Layer.mergeAll(
  Layer.succeed(RunAdmission, RunAdmission.of({ admit: () => Effect.void })),
  noRestartEvidence,
);

const zeropsAdapters = Layer.mergeAll(
  zeropsRunAdmission,
  Layer.effect(
    RestartEvidence,
    Effect.map(ZeropsRestartRead, (reader) =>
      RestartEvidence.of({
        // Asked once per boot and never retried: an unreadable platform reads as no evidence.
        read: reader.read.pipe(Effect.orElseSucceed(() => null)),
        explain: explainRestart,
      }),
    ),
  ),
);

/**
 * The ports for this process: Zerops's inside a Zerops project, open everywhere else; the agent
 * works in the server's directory either way.
 */
export const engineAdaptersLayer = Layer.merge(
  Layer.unwrap(
    Effect.gen(function* () {
      return isZeropsEnvironment(yield* ServerConfig) ? zeropsAdapters : engineAdaptersOpen;
    }),
  ),
  serverWorkspace,
);
