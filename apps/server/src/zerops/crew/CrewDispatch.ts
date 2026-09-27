/**
 * CrewDispatch — the one place the crew builds a turn, and it admits every
 * one (D6; `scripts/turn-start-sites.test.ts` lists this file as the crew's
 * dispatch site).
 *
 * Every crew turn traces to a person (PRD §2.4, acceptance 9): a turn sent
 * inside the person's own RPC call runs as their `session`; a turn sent later
 * on their behalf — a queued task starting when its crewmate frees up, the
 * continue turn after *Save and apply now* — runs as `{kind: "crew",
 * startedBy}`, the person whose press or message made it. Admission then
 * re-checks that they still signed in the crewmate's login and are still an
 * active member.
 *
 * A crew turn names its crewmate's login in its model selection, so admission
 * judges the login the turn will spend, whatever thread it lands in. Crew
 * turns run `approval-required` (never the default `full-access`, which maps
 * to bypassing permissions); the thread's profile folds that into `dontAsk`
 * behind the gate.
 *
 * @module CrewDispatch
 */
import {
  CommandId,
  DEFAULT_MODEL,
  DEFAULT_MODEL_BY_PROVIDER,
  MessageId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ChatAttachment,
  type ModelSelection,
  type OrchestrationCommand,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import type { TurnPrincipal } from "../ZeropsTurnAdmission.ts";
import { asRefusal, refuse, type CrewCore } from "./crewCore.ts";
import type { CrewMemberRow } from "./CrewStore.ts";

/** A crewmate's login when its `crew.yaml` names none: the project's default. */
export const DEFAULT_CREW_LOGIN = "claudeAgent";

/** The login and model a crewmate's turns run on (PRD §2.3 *Runs on*). */
export const modelSelectionFor = (core: CrewCore, member: Pick<CrewMemberRow, "login" | "model">) =>
  Effect.gen(function* () {
    const login = member.login ?? DEFAULT_CREW_LOGIN;
    if (member.model !== null) {
      return {
        instanceId: ProviderInstanceId.make(login),
        model: member.model,
      } satisfies ModelSelection;
    }
    const project = yield* core.projection
      .getActiveProjectByWorkspaceRoot(core.config.cwd)
      .pipe(Effect.orElseSucceed(() => Option.none()));
    const projectDefault = Option.getOrUndefined(project)?.defaultModelSelection ?? null;
    if (projectDefault !== null && projectDefault.instanceId === login) {
      return {
        instanceId: projectDefault.instanceId,
        model: projectDefault.model,
      } satisfies ModelSelection;
    }
    const driver = yield* core.instances.driverKindOf(login);
    return {
      instanceId: ProviderInstanceId.make(login),
      model:
        DEFAULT_MODEL_BY_PROVIDER[driver ?? ProviderDriverKind.make(DEFAULT_CREW_LOGIN)] ??
        DEFAULT_MODEL,
    } satisfies ModelSelection;
  });

export interface CrewTurn {
  readonly threadId: string;
  readonly modelSelection: ModelSelection;
  readonly text: string;
  readonly attachments: ReadonlyArray<ChatAttachment>;
  readonly createdAt: string;
}

/** A crew turn's command; its ids are fresh, a crew turn is never replayed by id. */
export const crewTurnCommand = (core: CrewCore, turn: CrewTurn) =>
  Effect.gen(function* () {
    const id = yield* core.uuid;
    return {
      type: "thread.turn.start",
      commandId: CommandId.make(`crew:turn:${id}`),
      threadId: ThreadId.make(turn.threadId),
      message: {
        messageId: MessageId.make(`crew:${id}`),
        role: "user",
        text: turn.text,
        attachments: turn.attachments,
      },
      modelSelection: turn.modelSelection,
      runtimeMode: "approval-required",
      interactionMode: "default",
      createdAt: turn.createdAt,
    } satisfies OrchestrationCommand;
  });

/** D6 for a crew turn: refused as `not-allowed` with admission's own words. */
export const admitCrewTurn = (
  core: CrewCore,
  command: OrchestrationCommand,
  principal: TurnPrincipal,
) =>
  core.admission
    .admit({ command, principal })
    .pipe(Effect.mapError((error) => refuse("not-allowed", error.message)));

export const dispatchCrewTurn = (core: CrewCore, command: OrchestrationCommand) =>
  asRefusal(core.orchestration.dispatch(command)).pipe(Effect.asVoid);
