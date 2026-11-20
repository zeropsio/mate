/**
 * `decideCrew(state, envelope, now)`: every rule of a Mate's crew, pure. One writer per crew; it
 * never waits on a driver, a copy or a check.
 *
 * - **Out**, the crew asks for effects: a `crew.deliver` to a crewmate's conversation (a card or
 *   a person's message as a turn, a Stop, a new session, its agent, a seam row), and the git work
 *   in its copy as a chain (`crew.checkpoint → crew.mergeIn → crew.check → crew.land`).
 * - **In**, it reads each crewmate's conversation through a cursor: a run admitted, reached, ended
 *   (with its cost and why), the agent's last message, a compaction.
 * - **Timers** are wakes on the crew owner: the lead's spacing, a question's 15 minutes, a task
 *   left unattended, the run's working time, a claim's request, a redeploy's reads.
 *
 * After every accepted input the crew advances: each free crewmate's open task goes on in a
 * running run (rework, a nudge, a landing, a pause's carry-on), or its next queued task starts;
 * the lead is woken for the next review or question; the run's clock follows its crew's work.
 * The machines (`crewMachines`), the rotation table (`rotationDecision`), the routing
 * (`crewRouting`), the versions (`crewVersions`) and the door (`crewAccess`) are the guards.
 *
 * @module crew/engine/decide
 */
import { type CrewDecision, type CrewEnvelope, type CrewInput } from "./command.ts";
import { frozenHosts, type CrewState } from "./state.ts";
import { Rejected, Builder } from "./decide.step.ts";
import { settle } from "./decide.advance.ts";
import { tool } from "./decide.tools.ts";
import { observed } from "./decide.observed.ts";
import {
  deploy,
  readDeploy,
  recovering,
  loginsChanged,
  recovered,
  importV1,
} from "./decide.host.ts";
import { pressed } from "./decide.presses.ts";
import { settled } from "./decide.effects.ts";
import { wakeFired } from "./decide.wakes.ts";

export const decideCrew = (state: CrewState, envelope: CrewEnvelope, now: number): CrewDecision => {
  const b = new Builder(state, envelope, now);
  try {
    handle(b, envelope.input);
    // The import moves nothing of its own: the crew goes on at the next input, never in it.
    if (b.state.applied !== null && envelope.input._tag !== "ImportV1") settle(b);
  } catch (error) {
    if (error instanceof Rejected) {
      return { _tag: "Reject", rejection: { reason: error.reason, detail: error.detail } };
    }
    throw error;
  }
  return {
    _tag: "Accept",
    step: {
      events: b.events,
      effects: b.effects,
      result: {
        _tag: "Accepted",
        seq: b.state.headSeq,
        ...(b.reply === undefined ? {} : { reply: b.reply }),
        ...(b.taskIds.length === 0 ? {} : { taskIds: b.taskIds }),
      },
    },
  };
};

const handle = (b: Builder, input: CrewInput): void => {
  switch (input._tag) {
    case "Press":
      return pressed(b, input.press, input.door.refusal, input.home, input.seen, input.hosts);
    case "Tool":
      return tool(b, input.handle, input.call);
    case "Observed":
      return observed(b, input.conversationId, input.events);
    case "Deploy":
      return deploy(b, input.host, input.phase);
    case "Gauge":
      if ((b.state.usage[input.login] ?? null) !== input.usagePercent) {
        b.emit({ _tag: "UsageRead", login: input.login, percent: input.usagePercent });
      }
      return;
    case "LoginsChanged":
      return loginsChanged(b, input.logins);
    case "WakeFired":
      return wakeFired(b, input.wakeId);
    case "EffectSettled":
      return settled(b, input.effectId, input.outcome);
    case "Recovered":
      return recovered(b);
    case "ProcessesMoved":
      for (const host of frozenHosts(b.state)) if (!recovering(b, host)) readDeploy(b, host);
      return;
    case "Configure":
      if (JSON.stringify(b.state.timing) !== JSON.stringify(input.timing)) {
        b.emit({ _tag: "CrewConfigured", timing: input.timing });
      }
      return;
    case "ImportV1":
      return importV1(b, input.crew);
  }
};
