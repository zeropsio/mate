import type { EngineAnswer } from "@t3tools/contracts";

import type { MateFake } from "../../fakes/mate.ts";
import { MateEngineFake } from "../../fakes/mateEngine.ts";
import {
  RESPONSE_RECEIVED,
  effortOf,
  TARGET_QUESTION,
  type ChatAsk,
  type ChatIntent,
  type ChatWire,
} from "./wire.ts";

/** The engine's wire: a conversation's runs, items and requests, calls by command id. */
export class EngineChatWire implements ChatWire {
  readonly name = "engine";
  readonly engine: MateEngineFake;
  /** Which of this area's asks each request is, and the id the journey gave it. */
  private readonly asks = new Map<string, { readonly ask: ChatAsk; readonly named: string }>();
  /** The engine's run for each run the journey started with `run`: the journey ends it. */
  private readonly journeyRuns = new Map<string, string>();
  constructor(mate: MateFake) {
    this.engine = new MateEngineFake(mate);
    // The fixture's agent acknowledges an answer and ends the run it waited in, unless the
    // journey runs that run itself: then the journey ends it, as on V1.
    this.engine.onAnswer.push((request) =>
      this.engine.note(
        request.runId,
        RESPONSE_RECEIVED,
        [...this.journeyRuns.values()].includes(request.runId) ? undefined : { kind: "completed" },
      ),
    );
  }

  /** Serves the engine's wire ahead of the area's own handlers: call once they are installed. */
  install() {
    this.engine.install();
    return this;
  }

  history(text: string) {
    this.engine.personTurn(text);
  }

  skewClock(ms: number) {
    this.engine.clockSkewMs = ms;
  }

  exchange(question: string, answer: string) {
    this.engine.note(this.engine.personRun(question), answer, { kind: "completed" });
  }

  approval() {
    const id = this.engine.ask({
      kind: "approval",
      requestKind: "command",
      detail: "vp run build",
    });
    this.asks.set(id, { ask: "approval", named: "approval-build" });
  }

  /** A question its agent waits on, as V1's TARGET_QUESTION is: answered, never dismissed. */
  question(requestId = "question-target", turnId: string | null = null) {
    const run = turnId === null ? undefined : this.journeyRuns.get(turnId);
    const id = this.engine.ask(
      { kind: "question", questions: [TARGET_QUESTION], dismissible: false },
      run === undefined ? {} : { runId: run },
    );
    this.asks.set(id, { ask: "question", named: requestId });
  }

  reply(turnId: string, text: string) {
    const run = this.journeyRuns.get(turnId);
    if (run !== undefined) this.engine.note(run, text);
  }

  /** The journey's runs are the engine's own runs, under the engine's ids. */
  run(turnId: string, state: "running" | "completed" | "error" | "interrupted") {
    const run = this.journeyRuns.get(turnId);
    if (state !== "running") {
      if (run !== undefined) this.engine.settleRun(run, state);
      return;
    }
    if (run === undefined) this.journeyRuns.set(turnId, this.engine.startRun());
  }

  intents() {
    // The conversation's options as the engine held them when each message was sent.
    let options: unknown = undefined;
    return this.engine.applied.flatMap(({ op, payload }): ChatIntent[] => {
      if (op === "switch-model" || op === "assign-agent") {
        if (payload.options !== undefined) options = payload.options;
        return [];
      }
      if (op === "set-runtime-mode")
        return [{ kind: "access", runtimeMode: String(payload.runtimeMode) }];
      // A message steered into the running run is a turn as V1's mid-turn send is.
      if (op === "send" || op === "steer") {
        const effort = effortOf(options as never);
        return [
          {
            kind: "turn",
            text: String(payload.text),
            ...(effort === undefined ? {} : { effort }),
            ...(payload.interactionMode === "plan" ? { plan: true as const } : {}),
          },
        ];
      }
      if (op !== "answer") return [];
      const asked = this.asks.get(String(payload.requestId));
      const ask = asked?.ask ?? "other";
      const answer = payload.answer as EngineAnswer;
      if (answer.kind === "approval") return [{ kind: "decision", ask, decision: answer.decision }];
      if (answer.kind === "input")
        return [
          {
            kind: "answer",
            ask,
            requestId: asked?.named ?? String(payload.requestId),
            answers: answer.answers,
            ...(answer.attachmentsByQuestionId === undefined
              ? {}
              : { attachmentsByQuestionId: answer.attachmentsByQuestionId }),
          },
        ];
      return [];
    });
  }

  waitForMessage(text: string) {
    return this.engine.waitForMessage(text);
  }
}
