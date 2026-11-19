/**
 * What a person changes on the conversation: its model, its runtime mode, its agent, a rotated session.
 *
 * @module engine/domain/decide.settings
 */
import type { ProviderOptionSelection, RuntimeMode } from "@t3tools/contracts";
import { changedOptionIds } from "@t3tools/shared/modelOptions";

import type { Command } from "./command.ts";
import { Rejected, type StepBuilder } from "./decide.step.ts";
import { workLives } from "./decide.lostWork.ts";
import { misfit } from "./decide.sessions.ts";
import { rotate, redispatch, actsForSomeone } from "./decide.runs.ts";

/**
 * Why a setting a run needs a new session for waits (V1's words, for every driver): the session it
 * would replace still runs the agent's background work.
 */
export const BACKGROUND_WORK_WORDS =
  "The agent is still running background work, and this change needs a new session that would end it. Wait for it to finish or stop it, or keep the current settings, then send the message again.";

/**
 * The crew rotates a conversation's session between turns: the boundary and the seed are recorded
 * at once (rule 9: what the agent is told is in the record); the next run closes the open session
 * (dispatch's `misfit`, the one place a session is replaced) and opens the next as the rotation
 * says, never under a running turn.
 */
export const rotateSession = (
  b: StepBuilder,
  command: Extract<Command, { _tag: "RotateSession" }>,
) => {
  if (b.state.archived) throw new Rejected("archived");
  rotate(b, command.reason, command.fresh, command.seed);
};

/**
 * A change that only a new session runs with, asked while the agent's background work lives in
 * the session, is refused: it would end that work (V1 refuses it the same way). So is a message
 * that would need such a session.
 */
export const refuseOverWork = (b: StepBuilder): void => {
  const session = b.state.session;
  if (session === null || !workLives(b.state)) return;
  if (misfit(b.state, session) === "settings") {
    throw new Rejected("background-work", BACKGROUND_WORK_WORDS);
  }
};

const sameOptions = (
  left: ReadonlyArray<ProviderOptionSelection> | undefined,
  right: ReadonlyArray<ProviderOptionSelection> | undefined,
) => changedOptionIds(left, right).length === 0;

/** The next model and its options: they apply from the next run on, never under a running turn. */
export const switchModel = (
  b: StepBuilder,
  model: string,
  options: ReadonlyArray<ProviderOptionSelection> | undefined,
): void => {
  if (b.state.archived) throw new Rejected("archived");
  const optionsChange = options !== undefined && !sameOptions(b.state.agent?.options, options);
  if (b.state.model === model && !optionsChange) return;
  b.emit({
    _tag: "ModelSwitched",
    model,
    by: b.envelope.principal,
    ...(optionsChange ? { options: [...options] } : {}),
  });
  refuseOverWork(b);
  redispatch(b);
};

/** How freely the agent works: from the next run on, in a session that resumes this one. */
export const setRuntimeMode = (b: StepBuilder, runtimeMode: RuntimeMode): void => {
  if (b.state.archived) throw new Rejected("archived");
  if (b.state.runtimeMode === runtimeMode) return;
  b.emit({ _tag: "RuntimeModeSet", runtimeMode, by: b.envelope.principal });
  refuseOverWork(b);
  redispatch(b);
};

/**
 * A person's pick of another agent. Before the conversation has started, any instance; after,
 * only an instance of its driver whose sessions resume the current one's — its thread carries
 * over and the next session resumes it. Another driver is refused in V1's words.
 */
export const chooseAgent = (
  b: StepBuilder,
  command: Extract<Command, { _tag: "ChooseAgent" }>,
): void => {
  actsForSomeone(b);
  if (b.state.archived) throw new Rejected("archived");
  const current = b.state.agent;
  if (current !== null && current.instanceId === command.instanceId) {
    return switchModel(b, command.model, command.options);
  }
  const started =
    b.state.nextRunOrdinal > 1 || b.state.session !== null || b.state.lastNativeRef !== null;
  if (current !== null && started) {
    if (current.driver !== command.driver) {
      throw new Rejected(
        "agent-locked",
        `This conversation is bound to driver '${current.driver}' and cannot switch to '${command.driver}'.`,
      );
    }
    if (!command.resumes) {
      throw new Rejected(
        "agent-locked",
        `This conversation cannot switch from instance '${current.instanceId}' to '${command.instanceId}' because their provider resume state is incompatible.`,
      );
    }
  }
  b.emit({
    _tag: "AgentAssigned",
    agent: {
      instanceId: command.instanceId,
      driver: command.driver,
      model: command.model,
      ...(command.options === undefined ? {} : { options: [...command.options] }),
      profile: current?.profile ?? { kind: "mate" },
    },
    by: b.envelope.principal,
    ...(current !== null && started ? { keepsThread: true } : {}),
  });
};
