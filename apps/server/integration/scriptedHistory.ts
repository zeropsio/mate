// @effect-diagnostics nodeBuiltinImport:off -- one worker's isolated, engine-authored SQLite snapshot.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import {
  CommandId,
  ConversationId,
  MATE_ENGINE_PROTOCOLS,
  type EngineConversationFrame,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { makeScriptedProvider } from "./scriptedProviderDriver.ts";
import { startScenarioMate, type ScenarioMateOptions } from "./scenarioMate.ts";

/** One factory per worker: seed once through real admission, receipts and workers; every Mate copies it. */
export async function scriptedHistoryTemplate(
  options: Omit<ScenarioMateOptions, "drivers" | "stateFrom">,
  count = 200,
) {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "scripted-history-"));
  const state = NodePath.join(root, "userdata");
  let seeded: Promise<string> | undefined;
  const seed = () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* Effect.promise(() => NodeFSP.mkdir(state));
          const provider = yield* makeScriptedProvider();
          const mate = yield* Effect.acquireRelease(
            Effect.promise(() => startScenarioMate({ ...options, drivers: [provider.driver] })),
            (m) => Effect.promise(() => m.stop().then(m.remove)),
          );
          const conversationId = ConversationId.make("scripted-history");
          yield* mate.engine.assignAgent(conversationId, {
            instanceId: "opencode",
            driver: "opencode",
            model: "gpt-5.4",
            profile: { kind: "mate" },
          });
          const protocol = MATE_ENGINE_PROTOCOLS[0]!;
          const caller = { subject: "scenario-person", environmentId: "scenario", epoch: 1 };
          const frames = yield* Queue.unbounded<EngineConversationFrame>();
          yield* mate.engine.wire.subscribe({ protocol, conversationId }, caller).pipe(
            Stream.runForEach((f) => Queue.offer(frames, f)),
            Effect.forkScoped,
          );
          while ((yield* Queue.take(frames)).type !== "synchronized") {}
          for (let i = 1; i <= count; i++) {
            yield* provider.turn([{ kind: "say", text: `Historical reply ${i}` }]);
            const result = yield* mate.engine.wire.send(
              {
                protocol,
                conversationId,
                commandId: CommandId.make(`history-${i}`),
                text: `Historical request ${i}`,
              },
              caller,
            );
            if (result._tag !== "Accepted")
              throw new Error(`Historical send ${i} refused: ${result._tag}`);
            while (true) {
              const frame = yield* Queue.take(frames);
              if (
                frame.type === "changes" &&
                frame.runs.some((r) => r.ordinal === i && r.state === "ended")
              )
                break;
            }
          }
          const drain = mate.engine.updateDrain;
          if (drain === undefined) throw new Error("Real engine has no worker drain");
          if (drain.subscribeChanges === undefined)
            throw new Error("Real engine has no receipt subscription");
          const receipts = yield* drain.subscribeChanges;
          // Snapshot waits for workers, not updater admission/native-resume policy.
          const pending = Effect.sync(() => {
            const db = new NodeSqlite.DatabaseSync(mate.dbPath, { readOnly: true });
            try {
              return db
                .prepare(
                  "SELECT COUNT(*) AS n FROM engine_effect WHERE state IN ('pending','running','settling')",
                )
                .get()?.n;
            } finally {
              db.close();
            }
          });
          yield* Stream.concat(
            Stream.fromEffect(pending),
            receipts.changes.pipe(Stream.mapEffect(() => pending)),
          ).pipe(
            Stream.filter((n) => n === 0),
            Stream.take(1),
            Stream.runDrain,
          );
          yield* Effect.promise(async () => {
            const db = new NodeSqlite.DatabaseSync(mate.dbPath, { readOnly: true });
            try {
              db.prepare("VACUUM INTO ?").run(NodePath.join(state, "state.sqlite"));
            } finally {
              db.close();
            }
            await NodeFSP.copyFile(
              NodePath.join(mate.stateDir, "settings.json"),
              NodePath.join(state, "settings.json"),
            );
          });
          return state;
        }),
      ),
    );
  return {
    state: () => (seeded ??= seed()),
    remove: async () => {
      await seeded?.catch(() => undefined);
      await NodeFSP.rm(root, { recursive: true, force: true });
    },
  };
}
