import type { EngineAnswer } from "@t3tools/contracts";

import type { MateFake } from "../../fakes/mate.ts";
import { MateEngineFake } from "../../fakes/mateEngine.ts";
import {
  RESPONSE_RECEIVED,
  TARGET_QUESTION,
  type ChatAsk,
  type ChatIntent,
  type ChatWire,
} from "./wire.ts";

/** The engine's wire: a conversation's runs, items and requests, calls by command id. */
export class EngineChatWire implements ChatWire {
  readonly name = "engine";
  readonly engine: MateEngineFake;
  /** Which of this area's asks each request is. */
  private readonly asks = new Map<string, ChatAsk>();
  constructor(mate: MateFake) {
    this.engine = new MateEngineFake(mate);
    // The fixture's agent acknowledges an answer and ends the run it waited in.
    this.engine.onAnswer.push((request) =>
      this.engine.note(request.runId, RESPONSE_RECEIVED, { kind: "completed" }),
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

  approval() {
    const id = this.engine.ask({
      kind: "approval",
      requestKind: "command",
      detail: "vp run build",
    });
    this.asks.set(id, "approval");
  }

  question() {
    const id = this.engine.ask({
      kind: "question",
      questions: [TARGET_QUESTION],
      dismissible: true,
    });
    this.asks.set(id, "question");
  }

  intents() {
    return this.engine.applied.flatMap(({ op, payload }): ChatIntent[] => {
      if (op === "send") return [{ kind: "turn", text: String(payload.text) }];
      if (op !== "answer") return [];
      const ask = this.asks.get(String(payload.requestId)) ?? "other";
      const answer = payload.answer as EngineAnswer;
      if (answer.kind === "approval") return [{ kind: "decision", ask, decision: answer.decision }];
      if (answer.kind === "input") return [{ kind: "answer", ask, answers: answer.answers }];
      return [];
    });
  }

  waitForMessage(text: string) {
    return this.engine.waitForMessage(text);
  }
}
