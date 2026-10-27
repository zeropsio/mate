import type { EngineAnswer } from "@t3tools/contracts";

import type { MateFake } from "../../fakes/mate.ts";
import type { MateEngineFake } from "../../fakes/mateEngine.ts";
import {
  RESPONSE_RECEIVED,
  effortOf,
  TARGET_QUESTION,
  type ChatAsk,
  type ChatIntent,
} from "./wire.ts";

/** A call's state as the engine records it. */
export type CallState = "running" | "done" | "failed" | "declined" | "stopped" | "unreturned";

/** What a call is besides the facts its row shows, when the journey says so. */
export interface CallShape {
  /** The call's step (`command` unless said): `edit`, `mcp`, `helper`, `look`, `web`, `tool`. */
  readonly step?: string;
  /** The call's own words for itself, when its agent gave them. */
  readonly words?: string;
  /** The line it was given. */
  readonly input?: string;
  /** A `zerops_*` call's result. */
  readonly result?: Record<string, unknown>;
  /** A helper's own call: the helper's, never the run's. */
  readonly helper?: string;
}

/** Background work's kind and state, as the engine records them. */
export type WorkKind = "helper" | "shell" | "monitor" | "other";
export type WorkStatus =
  | "running"
  | "waiting"
  | "idle"
  | "completed"
  | "failed"
  | "stopped"
  | "lost";

/** The engine's wire: a conversation's runs, items and requests, calls by command id. */
export class EngineChatWire {
  readonly engine: MateEngineFake;
  /** Which of this area's asks each request is, and the id the journey gave it. */
  private readonly asks = new Map<string, { readonly ask: ChatAsk; readonly named: string }>();
  /** The engine's run for each run the journey started: the journey ends it. */
  private readonly journeyRuns = new Map<string, string>();
  /** The engine's item for each call and each piece of work the journey named. */
  private readonly named = new Map<string, string>();
  constructor(mate: MateFake) {
    this.engine = mate.engine;
    // The fixture's agent acknowledges an answer and ends the run it waited in, unless the
    // journey runs that run itself: then the journey ends it.
    this.engine.onAnswer.push((request) =>
      // A value asked of the person resumes the agent in a run of its own, not the one that asked.
      request.ask.kind === "vault"
        ? undefined
        : this.engine.note(
            request.runId,
            RESPONSE_RECEIVED,
            [...this.journeyRuns.values()].includes(request.runId)
              ? undefined
              : { kind: "completed" },
          ),
    );
  }

  /** The engine's run for the journey's run `turnId`. */
  runOf(turnId: string): string {
    const run = this.journeyRuns.get(turnId);
    if (run === undefined) throw new Error(`The journey has not started run ${turnId}`);
    return run;
  }

  /** The engine's item for the call or work the journey named `id`. */
  itemOf(id: string): string {
    const item = this.named.get(id);
    if (item === undefined) throw new Error(`The journey has not recorded ${id}`);
    return item;
  }

  /**
   * The person said `text`, with its pictures: that exchange is over, or — in the journey's run
   * `turnId` — the agent is at work on it.
   */
  history(text: string, turnId: string | null = null, attachments: ReadonlyArray<unknown> = []) {
    if (turnId === null) return void this.engine.personTurn(text, attachments);
    const run = this.journeyRuns.get(turnId);
    if (run === undefined)
      return void this.journeyRuns.set(turnId, this.engine.personRun(text, attachments));
    this.engine.item(run, {
      kind: "person",
      by: { kind: "person", principal: { kind: "person", subject: "owner" } },
      text,
      attachments,
      sendId: `history-${turnId}-${this.engine.seq}`,
      // Into the run at work: steered, as the engine takes a message the agent is working on.
      delivery: { state: "steered", at: null },
    });
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

  /** A question its agent waits on: answered, never dismissed. */
  question(requestId = "question-target", turnId: string | null = null) {
    const run = turnId === null ? undefined : this.journeyRuns.get(turnId);
    const id = this.engine.ask(
      { kind: "question", questions: [TARGET_QUESTION], dismissible: false },
      run === undefined ? {} : { runId: run },
    );
    this.asks.set(id, { ask: "question", named: requestId });
  }

  /** The agent says `text` in run `turnId`. */
  reply(turnId: string, text: string) {
    const run = this.journeyRuns.get(turnId);
    if (run !== undefined) this.engine.note(run, text);
  }

  /**
   * The agent says `text`: in the journey's run `turnId` when named, else in a turn of its own
   * that ends with it. Its item, while `streaming`, is still being written.
   */
  say(text: string, turnId: string | null = null, streaming = false): string {
    const run = turnId === null ? this.engine.startRun(null) : this.runOf(turnId);
    const item = this.engine.item(run, { kind: "note", text, streaming, answer: true });
    if (turnId === null) this.engine.end(run);
    return item;
  }

  /** The agent thinks `text` in the journey's run `turnId`; while `streaming`, still thinking. */
  thought(text: string, turnId: string, streaming = false): string {
    return this.engine.item(this.runOf(turnId), {
      kind: "thought",
      preview: text,
      length: text.length,
      streaming,
    });
  }

  /**
   * A call of the journey's run `turnId`, opened or changed as its agent reports it: its row shows
   * `shows` (its tool's name, the command, its input's fields, what it returned).
   */
  call(
    id: string,
    state: CallState,
    shows: Record<string, unknown>,
    turnId = "run-one",
    shape: CallShape = {},
  ): string {
    const name = String(shows.toolName ?? "Tool");
    const [, server, tool] = /^mcp__([^_]+)__(.+)$/u.exec(name) ?? [];
    const body = {
      state,
      shows,
      ...(state === "running" ? {} : { endedAt: null }),
      ...(shape.words === undefined ? {} : { words: shape.words }),
      ...(shape.input === undefined ? {} : { input: shape.input }),
      ...(shape.result === undefined ? {} : { result: shape.result }),
    };
    const held = this.named.get(id);
    if (held !== undefined) {
      this.engine.update(held, body);
      return held;
    }
    const item = this.engine.item(this.runOf(turnId), {
      kind: "call",
      step: shape.step ?? "command",
      tool: { name: tool ?? name, ...(server === undefined ? {} : { server }) },
      words: null,
      endedAt: null,
      ...(shape.helper === undefined ? {} : { by: { kind: "helper", helperId: shape.helper } }),
      ...body,
    });
    this.named.set(id, item);
    return item;
  }

  /**
   * Background work the agent started in the journey's run `turnId` (a helper, a shell, a
   * monitor), opened or changed as it reports it; `call` names the call that started it.
   */
  work(
    id: string,
    status: WorkStatus,
    shape: {
      readonly kind?: WorkKind;
      readonly title?: string | null;
      readonly call?: string;
      readonly report?: string;
      readonly helper?: string;
    } = {},
    turnId = "run-one",
  ): string {
    const ended = ["completed", "failed", "stopped", "lost"].includes(status);
    const body = {
      status,
      ...(shape.report === undefined ? {} : { report: shape.report }),
      ...(ended ? { endedAt: Date.now() } : {}),
    };
    const held = this.named.get(id);
    if (held !== undefined) {
      this.engine.update(held, body);
      return held;
    }
    const item = this.engine.item(this.runOf(turnId), {
      kind: "work",
      work: id,
      workKind: shape.kind ?? "helper",
      title: shape.title ?? null,
      ...(shape.call === undefined ? {} : { call: this.itemOf(shape.call) }),
      ...(shape.helper === undefined ? {} : { by: { kind: "helper", helperId: shape.helper } }),
      ...body,
    });
    this.named.set(id, item);
    return item;
  }

  /**
   * The journey's run `turnId`: the agent at work on it (its session open), or its end as `state`
   * says — a failure in its own words when given.
   */
  run(turnId: string, state: "running" | "completed" | "error" | "interrupted", reason?: string) {
    const run = this.journeyRuns.get(turnId);
    if (state !== "running") {
      if (run !== undefined) this.engine.settleRun(run, state, reason);
      return;
    }
    if (run === undefined) this.journeyRuns.set(turnId, this.engine.startRun(null));
    else this.engine.session();
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
      // A message steered into the running run is a turn as much as one sent.
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
