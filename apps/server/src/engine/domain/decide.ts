/**
 * `decide(state, envelope, now)`: every rule and guard of a conversation, pure.
 *
 * A run moves queued → admitted → sending → running ⇄ waiting → ended, one active at a time.
 * Admission asks the run's principal first (`run.prepare`), for the agent instance the run goes on
 * (an admission for another instance is asked again), then opens a session as an effect
 * when none fits (never as a side effect of a send), and waits while a usage limit pauses the
 * conversation. Every turn-scoped signal is routed to its own turn's run, never to the active one.
 * A run ends by evidence, its source the bridge's word (the agent, a Stop asked or confirmed, a
 * crash, a close, the next turn) or the engine's (a restart, an effect that failed for good); a
 * Stop ends a run only on its turn's own end. A restart cuts the active run and arms a
 * continuation only when no newer person message, no Stop, no archive and no maintenance turn
 * stands against it; the continuation is a new run that `joins` the cut one, as a usage resume
 * joins its limited run and an agent-started turn joins the run whose work it reports. Background
 * work a lost session took with it wakes the Mate once with a note naming it, unless a message
 * waiting to go carries the note. A watchdog only marks a running run unresponsive.
 *
 * @module engine/domain/decide
 */
import type { Command, Decision, Envelope } from "./command.ts";
import type { ConversationState } from "./state.ts";
import { Rejected, StepBuilder } from "./decide.step.ts";
import { closeSession } from "./decide.sessions.ts";
import { recordLoose } from "./decide.runs.ts";
import { rotateSession, switchModel, setRuntimeMode, chooseAgent } from "./decide.settings.ts";
import { steer } from "./decide.steer.ts";
import { armWake, wakeFired } from "./decide.wakes.ts";
import { limitGone, tryPastLimit } from "./decide.usage.ts";
import { send, stop } from "./decide.send.ts";
import { answer, dismiss } from "./decide.questions.ts";
import { askLeaseRelease } from "./decide.lease.ts";
import { importHistory, historyBatch } from "./decide.history.ts";
import { effectSettled } from "./decide.effects.ts";
import { signals } from "./decide.signals.ts";
import { recovered } from "./decide.restart.ts";

export const decide = (state: ConversationState, envelope: Envelope, now: number): Decision => {
  const b = new StepBuilder(state, envelope, now);
  try {
    handle(b, envelope.command);
  } catch (error) {
    if (error instanceof Rejected) {
      return {
        _tag: "Reject",
        rejection:
          error.detail === undefined
            ? { reason: error.reason }
            : { reason: error.reason, detail: error.detail },
      };
    }
    throw error;
  }
  return {
    _tag: "Accept",
    step: {
      events: b.events,
      effects: b.effects,
      details: b.details,
      ...(b.data.length === 0 ? {} : { data: b.data }),
      result: { _tag: "Accepted", seq: b.state.headSeq, ...b.result },
    },
  };
};

const handle = (b: StepBuilder, command: Command): void => {
  switch (command._tag) {
    case "Send":
      return send(b, command);
    case "Stop":
      return stop(b, command.runId);
    case "Continue":
      return tryPastLimit(b, "the person asked to continue");
    case "ProviderUsage":
      if (limitGone(b.state, command.usage)) {
        tryPastLimit(b, "the provider no longer reports the limit");
      }
      return;
    case "Answer":
      return answer(b, command);
    case "Dismiss":
      return dismiss(b, command.requestId);
    case "Steer":
      return steer(b, command);
    case "SwitchModel":
      return switchModel(b, command.model, command.options);
    case "SetRuntimeMode":
      return setRuntimeMode(b, command.runtimeMode);
    case "ChooseAgent":
      return chooseAgent(b, command);
    case "AssignAgent":
      if (b.state.archived) throw new Rejected("archived");
      if (JSON.stringify(b.state.agent) !== JSON.stringify(command.agent)) {
        b.emit({ _tag: "AgentAssigned", agent: command.agent, by: b.envelope.principal });
      }
      return;
    case "CloseSession":
      return closeSession(b, command.reason);
    case "RotateSession":
      return rotateSession(b, command);
    case "MarkSeam":
      return recordLoose(b, {
        kind: "marker",
        marker: {
          kind: "crew.seam",
          ...(command.words === null ? {} : { reason: command.words }),
          seam: command.seam,
        },
      });
    case "Archive":
      if (b.state.archived) return;
      b.emit({ _tag: "ConversationArchived", by: b.envelope.principal });
      return askLeaseRelease(b);
    case "Unarchive":
      if (b.state.archived) b.emit({ _tag: "ConversationUnarchived", by: b.envelope.principal });
      return;
    case "ForgetMateAnswer":
      if (
        b.state.awaits.some((awaited) => awaited.id === command.messageId) ||
        !b.state.answered.includes(command.messageId)
      )
        b.emit({ _tag: "MateAnswerHeard", messageId: command.messageId });
      return;
    case "BindLease":
      // Its first lease is where it works: another the agent acquires is only a container it uses.
      if (b.state.lease === null) b.emit({ _tag: "LeaseBound", lease: command.lease });
      return;
    case "UnbindLease": {
      const bound = b.state.lease;
      if (bound !== null && bound.alias === command.ended) {
        b.emit({ _tag: "LeaseUnbound", alias: bound.alias });
      }
      return;
    }
    case "ArmWake":
      return armWake(b, command);
    case "CancelWake":
      if (b.state.wakes[command.wakeId] === undefined) throw new Rejected("wake-not-armed");
      b.emit({ _tag: "WakeCancelled", wakeId: command.wakeId, reason: "cancelled" });
      return;
    case "WakeFired":
      return wakeFired(b, command.wakeId, command.armedSeq);
    case "EffectSettled":
      return effectSettled(b, command.effectId, command.outcome);
    case "ProviderSignals":
      return signals(b, command.sessionId, command.signals);
    case "Recovered":
      return recovered(
        b,
        command.cutEffects,
        command.unstartedEffects ?? [],
        command.words,
        command.restart,
        command.lastWords,
      );
    case "ImportHistory":
      return importHistory(b, command);
    case "HistoryBatch":
      return historyBatch(b, command);
  }
};
