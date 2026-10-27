// @effect-diagnostics nodeBuiltinImport:off -- isolated SQLite snapshots.
import { expect, it } from "@effect/vitest";
import {
  ConversationId,
  CommandId,
  MATE_ENGINE_PROTOCOLS,
  type EngineConversationFrame,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as NodeSqlite from "node:sqlite";
import * as NodePath from "node:path";
import * as Stream from "effect/Stream";
import { makeScriptedProvider } from "./scriptedProviderDriver.ts";
import { startScenarioMate } from "./scenarioMate.ts";
import { scriptedHistoryTemplate } from "./scriptedHistory.ts";
const options = {
  projectId: "history",
  serviceId: "history-service",
  hostname: "zcp",
  zeropsApiBaseUrl: "http://127.0.0.1:9/api/rest/public",
  zeropsApiToken: "scenario-key",
  publicOrigin: "https://scenario.invalid",
  now: Date.now,
};
it.live("a worker's 200-turn SQLite template is engine-authored and independent of each copy", () =>
  Effect.gen(function* () {
    const template = yield* Effect.acquireRelease(
      Effect.promise(() => scriptedHistoryTemplate(options)),
      (t) => Effect.promise(t.remove),
    );
    const state = yield* Effect.promise(template.state);
    expect(yield* Effect.promise(template.state)).toBe(state);
    const scripted = yield* makeScriptedProvider();
    const mate = yield* Effect.acquireRelease(
      Effect.promise(() =>
        startScenarioMate({ ...options, stateFrom: state, drivers: [scripted.driver] }),
      ),
      (m) => Effect.promise(() => m.stop().then(m.remove)),
    );
    const protocol = MATE_ENGINE_PROTOCOLS[0]!;
    const conversationId = ConversationId.make("scripted-history");
    const caller = { subject: "scenario-person", environmentId: "scenario", epoch: 1 };
    const snapshot = yield* mate.engine.wire.subscribe({ protocol, conversationId }, caller).pipe(
      Stream.filter((f) => f.type === "snapshot"),
      Stream.take(1),
      Stream.runCollect,
    );
    expect(snapshot[0]).toMatchObject({
      header: { runStatus: "ready" },
      window: { earlier: true },
    });
    const pages = [];
    let beforeOrdinal = 201;
    while (true) {
      const page = yield* mate.engine.wire.readEarlier({
        protocol,
        conversationId,
        beforeOrdinal,
        groups: 200,
      });
      if (page._tag !== "Page") throw new Error("History unserved");
      pages.unshift(page);
      if (!page.window.earlier) break;
      beforeOrdinal = page.window.oldestOrdinal!;
    }
    const runs = pages.flatMap((p) => p.runs);
    const items = pages.flatMap((p) => p.items);
    expect(runs).toHaveLength(200);
    expect(runs.every((r) => r.state === "ended" && r.end?.kind === "completed")).toBe(true);
    expect(
      items.filter((i) => i.kind === "person").map((i) => (i.kind === "person" ? i.text : "")),
    ).toEqual(Array.from({ length: 200 }, (_, i) => `Historical request ${i + 1}`));
    expect(mate.stateDir).not.toBe(state);
    const frames = yield* Queue.unbounded<EngineConversationFrame>();
    yield* mate.engine.wire.subscribe({ protocol, conversationId }, caller).pipe(
      Stream.runForEach((f) => Queue.offer(frames, f)),
      Effect.forkScoped,
    );
    while ((yield* Queue.take(frames)).type !== "synchronized") {}
    yield* scripted.turn([{ kind: "say", text: "Only this copy changed" }]);
    expect(
      (yield* mate.engine.wire.send(
        {
          protocol,
          conversationId,
          commandId: CommandId.make("copy-only"),
          text: "Only this copy",
        },
        caller,
      ))._tag,
    ).toBe("Accepted");
    while (true) {
      const f = yield* Queue.take(frames);
      if (f.type === "changes" && f.runs.some((r) => r.ordinal === 201 && r.state === "ended"))
        break;
    }
    const sourceCount = yield* Effect.sync(() => {
      const db = new NodeSqlite.DatabaseSync(NodePath.join(state, "state.sqlite"), {
        readOnly: true,
      });
      try {
        return db
          .prepare("SELECT COUNT(*) AS n FROM engine_run WHERE conversation_id = ?")
          .get(conversationId)?.n;
      } finally {
        db.close();
      }
    });
    expect(sourceCount).toBe(200);
    yield* Effect.promise(mate.restart);
    const after = yield* mate.engine.wire.readEarlier({
      protocol,
      conversationId,
      beforeOrdinal: 201,
      groups: 10,
    });
    expect(after._tag).toBe("Page");
    if (after._tag === "Page")
      expect(after.runs.map((r) => r.ordinal)).toEqual(runs.slice(-10).map((r) => r.ordinal));
  }),
);
