/**
 * The command generator: from a conversation's state, the next thing that could enter its actor
 * — a person's command, an effect outcome (oldest first, as the outbox claims them), a batch of
 * driver signals, a due wake, a restart's recovery — or time passing. State-aware, so a run of a
 * few hundred steps reaches deep states (waiting runs, usage limits, continuations, rotations).
 */
import {
  CommandId,
  type ConversationId,
  type EffectId,
  type ItemBody,
  type Principal,
  type RequestId,
  type RunId,
  SessionId,
  BootId,
  TurnHandle,
  type TurnEndSource,
  type WakeId,
} from "@t3tools/contracts";

import type { TurnOutcome } from "../bridge/spi3.ts";

import type { Command, Envelope, ImportedRecord, ProviderSignal } from "../domain/command.ts";
import {
  ItemId,
  RunId as RunIdOf,
  effectSettledCommandId,
  recoveredCommandId,
  signalsCommandId,
  wakeFiredCommandId,
} from "../domain/ids.ts";
import { activeRun, type ConversationState } from "../domain/state.ts";
import type { Rng } from "./rng.ts";

export const ana: Principal = { kind: "person", subject: "ana" };
export const bo: Principal = { kind: "person", subject: "bo" };
export const crew: Principal = { kind: "crew", startedBy: "ana" };
const ENGINE: Principal = { kind: "engine" };

export interface Played {
  readonly envelope: Envelope;
  readonly now: number;
}

const isLive = (state: string) => state === "sending" || state === "running" || state === "waiting";

const bodies = (rng: Rng, n: number): ItemBody =>
  rng.weighted<ItemBody>([
    [{ kind: "note", text: `note ${n}`, streaming: rng.chance(0.5), answer: false }, 3],
    [{ kind: "thought", preview: `thinking ${n}`, length: n, streaming: true }, 1],
    [
      {
        kind: "call",
        step: `step ${n}`,
        tool: { name: "Bash" },
        words: `ls ${n}`,
        state: "running",
        endedAt: null,
      },
      2,
    ],
  ]);

export interface GenOptions {
  /** Out-of-order effect outcomes (the real outbox settles a lane oldest first). */
  readonly unorderedSettles?: boolean;
}

/** One conversation's generator; holds the counters ids are made from. */
export class Gen {
  private commands = 0;
  private batches = 0;
  private turns = 0;
  private sessions = 0;
  private boots = 0;
  private keys = 0;

  readonly rng: Rng;
  readonly conversation: ConversationId;
  readonly options: GenOptions;

  constructor(rng: Rng, conversation: ConversationId, options: GenOptions = {}) {
    this.rng = rng;
    this.conversation = conversation;
    this.options = options;
  }

  private env(command: Command, by: Principal = ana, id?: CommandId): Envelope {
    return {
      commandId: id ?? CommandId.make(`c${++this.commands}`),
      conversationId: this.conversation,
      principal: by,
      command,
    };
  }

  /** The next input and the time it arrives. */
  next(state: ConversationState, now: number): Played {
    const rng = this.rng;
    const at =
      now +
      rng.weighted([
        [0, 2],
        [rng.int(1, 5_000), 6],
        [rng.int(60_000, 6 * 60_000), 1],
        [11 * 60_000, 0.3],
      ]);
    const active = activeRun(state);
    const effects = Object.values(state.effects);
    const wakes = Object.values(state.wakes).sort(
      (a, b) => a.dueAt - b.dueAt || (a.id < b.id ? -1 : 1),
    );
    const due = wakes.filter((wake) => wake.dueAt <= at);
    const kind = rng.weighted<string>([
      ["send", 3],
      ["stop", active === undefined ? 0.2 : 1],
      ["answer", Object.keys(state.requests).length > 0 ? 2 : 0.1],
      ["dismiss", Object.keys(state.requests).length > 0 ? 0.5 : 0.05],
      ["steer", active !== undefined && isLive(active.state) ? 0.5 : 0.05],
      ["model", 0.3],
      ["rotate", 0.3],
      ["options", 0.3],
      ["mode", 0.2],
      ["agent", 0.1],
      ["archive", 0.15],
      ["sign-out", 0.05],
      ["unarchive", state.archived ? 1 : 0.05],
      ["arm", 0.4],
      ["cancel", wakes.length > 0 ? 0.2 : 0.02],
      ["fire", due.length > 0 ? 4 : wakes.length > 0 ? 0.5 : 0],
      ["settle", effects.length > 0 ? 5 : 0.1],
      ["signals", state.session !== null ? 5 : 0.2],
      ["recover", 0.15],
      // The earlier record: asked early, before the conversation runs, and batch by batch.
      ["import", state.history === null ? (state.nextRunOrdinal === 1 ? 1.5 : 0.05) : 0.02],
      ["batch", state.history?.state === "importing" ? 3 : 0.02],
    ]);
    switch (kind) {
      case "send": {
        const text = rng.chance(0.05) ? "   " : `message ${this.commands + 1}`;
        return {
          envelope: this.env(
            {
              _tag: "Send",
              text,
              ...(rng.chance(0.05) ? { maintenance: true } : {}),
              ...(rng.chance(0.2) ? { interactionMode: "plan" as const } : {}),
            },
            // A crew's card now and then: its run is the crew's to carry on.
            rng.chance(0.1) ? crew : rng.chance(0.8) ? ana : bo,
          ),
          now: at,
        };
      }
      case "stop": {
        const ids = Object.keys(state.runs) as Array<RunId>;
        const target =
          active !== undefined && rng.chance(0.7)
            ? undefined
            : ids.length > 0 && rng.chance(0.8)
              ? rng.pick(ids)
              : undefined;
        return {
          envelope: this.env(
            target === undefined ? { _tag: "Stop" } : { _tag: "Stop", runId: target },
            rng.chance(0.5) ? ana : bo,
          ),
          now: at,
        };
      }
      case "answer": {
        const open = Object.values(state.requests);
        const requestId =
          open.length > 0 && rng.chance(0.9)
            ? rng.pick(open).id
            : (`${this.conversation}/r/1/q/9` as RequestId);
        return {
          envelope: this.env({
            _tag: "Answer",
            requestId,
            answer: rng.chance(0.8) ? { answers: { "0": "this one" } } : { ok: true },
            summary: "yes",
          }),
          now: at,
        };
      }
      case "dismiss": {
        const open = Object.values(state.requests);
        const requestId =
          open.length > 0 && rng.chance(0.9)
            ? rng.pick(open).id
            : (`${this.conversation}/r/1/q/9` as RequestId);
        return { envelope: this.env({ _tag: "Dismiss", requestId }), now: at };
      }
      case "steer": {
        const runId = active?.id ?? (`${this.conversation}/r/1` as RunId);
        return { envelope: this.env({ _tag: "Steer", runId, text: "also this" }), now: at };
      }
      case "model":
        return {
          envelope: this.env({ _tag: "SwitchModel", model: rng.pick(["m1", "m2"]) }),
          now: at,
        };
      case "rotate":
        return {
          envelope: this.env(
            {
              _tag: "RotateSession",
              reason: rng.pick(["context", "cleared", "job", "login", "budget", "task"] as const),
              fresh: rng.chance(0.7),
              seed: rng.chance(0.8) ? "the state packet" : null,
            },
            crew,
          ),
          now: at,
        };
      // A model option a session takes per turn (effort) or only in a new one (fast mode).
      case "options":
        return {
          envelope: this.env({
            _tag: "SwitchModel",
            model: state.model ?? "m1",
            options: [
              { id: "effort", value: rng.pick(["low", "high"]) },
              ...(rng.chance(0.5) ? [{ id: "fastMode", value: rng.chance(0.5) }] : []),
            ],
          }),
          now: at,
        };
      case "mode":
        return {
          envelope: this.env({
            _tag: "SetRuntimeMode",
            runtimeMode: rng.pick(["full-access", "approval-required"] as const),
          }),
          now: at,
        };
      case "agent":
        return {
          envelope: this.env({
            _tag: "ChooseAgent",
            instanceId: rng.pick(["claude", "claude-2", "codex"]),
            driver: rng.chance(0.7) ? "claude" : "codex",
            model: rng.pick(["m1", "m2"]),
            resumes: rng.chance(0.5),
          }),
          now: at,
        };
      case "archive":
        return { envelope: this.env({ _tag: "Archive" }), now: at };
      case "sign-out":
        return { envelope: this.env({ _tag: "CloseSession", reason: "signed-out" }), now: at };
      case "unarchive":
        return { envelope: this.env({ _tag: "Unarchive" }), now: at };
      case "arm": {
        const cron = rng.chance(0.15) ? "0 */5 * * * *" : null;
        return {
          envelope: this.env({
            _tag: "ArmWake",
            kind: rng.pick(["standup", "report"]),
            key: rng.pick(["k1", "k2"]),
            ...(cron === null ? { dueAt: at + rng.int(0, 10 * 60_000) } : { cron }),
            text: "wake up",
          }),
          now: at,
        };
      }
      case "cancel": {
        const wakeId =
          wakes.length > 0 ? rng.pick(wakes).id : (`${this.conversation}/w/x/y` as WakeId);
        return { envelope: this.env({ _tag: "CancelWake", wakeId }), now: at };
      }
      case "fire": {
        // The scheduler: the earliest armed wake, once it is due.
        const wake = due[0] ?? wakes[0]!;
        const when = Math.max(at, wake.dueAt);
        return {
          envelope: this.env(
            { _tag: "WakeFired", wakeId: wake.id, armedSeq: wake.armedSeq },
            ENGINE,
            wakeFiredCommandId(wake.id, wake.armedSeq),
          ),
          now: when,
        };
      }
      case "settle":
        return { envelope: this.settle(state, at), now: at };
      case "signals":
        return { envelope: this.signals(state, at), now: at };
      case "recover": {
        const boot = BootId.make(`boot-${++this.boots}`);
        return {
          envelope: this.env(
            {
              _tag: "Recovered",
              bootId: boot,
              cutEffects: effects.filter((_, i) => i % 2 === 0).map((effect) => effect.id),
              unstartedEffects: effects.filter((_, i) => i % 2 === 1).map((effect) => effect.id),
              ...(rng.chance(0.5) ? { words: "The service restarted." } : {}),
            },
            ENGINE,
            recoveredCommandId(boot, this.conversation),
          ),
          now: at,
        };
      }
      case "import":
        return {
          envelope: this.env(
            {
              _tag: "ImportHistory",
              source: { kind: "v1", threadId: this.conversation },
              runs: rng.int(0, 3),
            },
            ENGINE,
          ),
          now: at,
        };
      case "batch":
        return { envelope: this.batch(state), now: at };
      default:
        throw new Error(`unknown kind ${kind}`);
    }
  }

  /**
   * A batch of the earlier record: mostly from where the import stands, its records placed where
   * it reserved them; sometimes stale, or one out of place.
   */
  private batch(state: ConversationState): Envelope {
    const rng = this.rng;
    const history = state.history;
    const runs = Math.max(1, history?.runs ?? 1);
    const from = history !== null && rng.chance(0.9) ? history.cursor : rng.int(0, 6);
    const to = from + rng.int(1, 3);
    const effect = Object.values(state.effects).find((held) => held.kind === "history.import");
    const run = (ordinal: number) => RunIdOf.make(`${this.conversation}/r/${ordinal}`);
    const records: Array<ImportedRecord> = [];
    for (let at = from; at < to; at++) {
      const ordinal = rng.chance(0.03) ? runs + 1 : at < runs ? at + 1 : ((at - runs) % runs) + 1;
      records.push(
        at < runs
          ? {
              _tag: "RunImported",
              runId: run(ordinal),
              ordinal,
              trigger: { kind: "imported", from: "v1", turn: `v1-${ordinal}` },
              principal: ENGINE,
              end: { kind: "completed" },
              source: "agent",
              happenedAt: 0,
              startedAt: 0,
              endedAt: 0,
            }
          : {
              _tag: "ItemImported",
              runId: run(ordinal),
              itemId: ItemId.make(`${run(ordinal)}/i/${at}`),
              by: { kind: "mate" },
              body: { kind: "note", text: `earlier ${at}`, streaming: false, answer: false },
              happenedAt: 0,
            },
      );
    }
    return this.env(
      {
        _tag: "HistoryBatch",
        effectId: effect?.id ?? (`${this.conversation}/history/e/history.import/1` as EffectId),
        from,
        to,
        records,
        details: [],
        data: [],
      },
      ENGINE,
    );
  }

  private settle(state: ConversationState, _now: number): Envelope {
    const rng = this.rng;
    const effects = Object.values(state.effects);
    const effect =
      effects.length === 0
        ? { id: `${this.conversation}/r/1/e/provider.send/1` as EffectId, kind: "provider.send" }
        : this.options.unorderedSettles
          ? rng.pick(effects)
          : effects[0]!;
    const failed = rng.chance(0.12);
    let value: unknown;
    if (effect.kind === "session.open") {
      value = {
        sessionId: `s${++this.sessions}`,
        driver: "claude",
        model: rng.chance(0.9) ? state.model : "alias-of-" + String(state.model),
        nativeRef: `native-${this.sessions}`,
        capabilities: {
          steer: rng.chance(0.5),
          inSessionOptions: rng.pick<"all" | ReadonlyArray<string>>(["all", ["effort"], []]),
        },
        options: state.agent?.options ?? [],
        runtimeMode: state.runtimeMode ?? "full-access",
      };
    } else if (effect.kind === "provider.send") {
      value = { providerTurnId: `t${++this.turns}` };
    } else if (effect.kind === "session.close" && rng.chance(0.2)) {
      value = { kept: true };
    } else if (effect.kind === "run.prepare" && rng.chance(0.2)) {
      value = { gaps: [{ service: "api", reason: "Snapshot refused" }] };
    } else if (effect.kind === "history.import") {
      value = { done: rng.chance(0.5) };
    }
    return this.env(
      {
        _tag: "EffectSettled",
        effectId: effect.id,
        outcome: failed
          ? {
              kind: "failed",
              reason: "boom",
              ...(effect.kind === "provider.send" && rng.chance(0.5)
                ? { undelivered: rng.pick([true, false, "unknown"] as const) }
                : {}),
            }
          : value === undefined
            ? { kind: "ok" }
            : { kind: "ok", value },
      },
      ENGINE,
      effectSettledCommandId(effect.id),
    );
  }

  private signals(state: ConversationState, _now: number): Envelope {
    const rng = this.rng;
    const session =
      state.session !== null && rng.chance(0.95) ? state.session.id : SessionId.make("s-stale");
    const items = Object.values(state.items);
    const requests = Object.values(state.requests);
    const count = rng.int(1, 3);
    const active = activeRun(state);
    const known = Object.keys(state.turns) as Array<TurnHandle>;
    /** Mostly the active run's turn; sometimes an older one, or one the engine never knew. */
    const turn = (): TurnHandle =>
      active?.turn != null && rng.chance(0.75)
        ? active.turn
        : known.length > 0 && rng.chance(0.85)
          ? rng.pick(known)
          : TurnHandle.make(`stray-${this.keys}`);
    const signals: Array<ProviderSignal> = [];
    for (let i = 0; i < count; i++) {
      const kind = rng.weighted<string>([
        ["turn-started", 1.5],
        ["item-opened", 3],
        ["item-updated", items.length > 0 ? 1 : 0],
        ["item-closed", items.length > 0 ? 2 : 0.3],
        ["request-opened", 0.8],
        ["request-closed", requests.length > 0 ? 0.6 : 0],
        ["turn-ended", 2],
        ["usage-limit", 0.3],
        ["session-exited", 0.15],
        ["work", 0.4],
        ["reset-known", 0.1],
        ["activity", 1],
      ]);
      const n = ++this.keys;
      switch (kind) {
        case "turn-started": {
          const ended = state.endedRuns;
          const sending = active?.state === "sending" ? active.turn : null;
          signals.push(
            sending !== null && rng.chance(0.7)
              ? {
                  kind: "turn-started",
                  turn: sending,
                  origin: "engine",
                  providerTurnId: `t${++this.turns}`,
                }
              : {
                  kind: "turn-started",
                  turn: TurnHandle.make(`self-${++this.turns}`),
                  origin: "self",
                  providerTurnId: `t${this.turns}`,
                  ...(ended.length > 0 && rng.chance(0.3) ? { reportsOn: rng.pick(ended) } : {}),
                },
          );
          break;
        }
        case "item-opened":
          signals.push({
            kind: "item-opened",
            turn: turn(),
            key: items.length > 0 && rng.chance(0.2) ? (rng.pick(items).key ?? `k${n}`) : `k${n}`,
            by: { kind: "mate" },
            body: bodies(rng, n),
          });
          break;
        case "item-updated":
          signals.push({
            kind: "item-updated",
            turn: turn(),
            key: rng.pick(items).key ?? `k${n}`,
            body: bodies(rng, n),
          });
          break;
        case "item-closed":
          signals.push({
            kind: "item-closed",
            turn: turn(),
            key: items.length > 0 ? (rng.pick(items).key ?? `k${n}`) : `k${n}`,
            body: bodies(rng, n),
            ...(rng.chance(0.2) ? { detail: `full body ${n}` } : {}),
            ...(rng.chance(0.1) ? { afterEnd: true as const } : {}),
          });
          break;
        case "request-opened":
          signals.push({
            kind: "request-opened",
            ...(rng.chance(0.8) ? { turn: turn() } : {}),
            key: `q${n}`,
            ask: rng.chance(0.3)
              ? {
                  kind: "question",
                  questions: [{ id: "0", question: "Which one?" }],
                  dismissible: rng.chance(0.5),
                }
              : { kind: "approval", requestKind: "command", detail: "rm -rf build" },
            answerable: rng.chance(0.85),
          });
          break;
        case "request-closed":
          signals.push({
            kind: "request-closed",
            key: rng.pick(requests).key,
            state: rng.pick(["answered", "declined", "dismissed", "lapsed"] as const),
          });
          break;
        case "turn-ended":
          signals.push({
            kind: "turn-ended",
            turn: turn(),
            outcome: rng.weighted<TurnOutcome>([
              [{ kind: "completed" }, 8],
              [{ kind: "failed", class: "provider", words: "tool crashed" }, 1],
              [{ kind: "interrupted" }, 0.5],
              [{ kind: "cut", cause: "process-exit" }, 0.3],
            ]),
            source: rng.weighted<TurnEndSource>([
              [active?.stopAsked != null ? "stop-confirmed" : "agent", 8],
              ["stop-asked", 0.5],
              ["inferred-from-crash", 0.5],
              ["inferred-from-next-turn", 0.3],
            ]),
          });
          break;
        case "usage-limit":
          signals.push({
            kind: "usage-limit",
            ...(rng.chance(0.7) ? { turn: turn() } : {}),
            resetsAt: rng.chance(0.75) ? _now + rng.int(1, 90) * 60_000 : null,
            ...(rng.chance(0.3) ? { parks: true } : {}),
          });
          break;
        case "session-exited":
          signals.push({ kind: "session-exited", reason: "exit 137" });
          break;
        case "work":
          signals.push({
            kind: "work-upserted",
            work: `w${rng.int(1, 3)}`,
            origin: rng.chance(0.8) ? turn() : "unknown",
            workKind: rng.pick(["helper", "shell"] as const),
            status: rng.pick(["running", "running", "completed", "failed", "lost"] as const),
          });
          break;
        case "reset-known":
          signals.push({ kind: "usage-reset-known", resetsAt: _now + rng.int(1, 60) * 60_000 });
          break;
        default:
          signals.push({ kind: "activity", turn: turn() });
      }
    }
    return this.env(
      { _tag: "ProviderSignals", sessionId: session, signals },
      ENGINE,
      signalsCommandId(session, ++this.batches),
    );
  }
}
