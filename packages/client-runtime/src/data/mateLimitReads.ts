import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import { mateEngineHostAtom } from "./engineHost.ts";
import { engineRows } from "./projections/mateEngine.ts";
import { accountReadsAtom } from "./reads.ts";
import { mateConversationStoreAtom } from "./adapters/mateConversation.ts";
import { mateShell } from "./projections/mateConversation.ts";
import { hqMates } from "./projections/hqMates.ts";
import { parseScopedThreadKey } from "../environment/index.ts";
import { sameValue } from "./projections/equal.ts";
import { Atom } from "effect/reactivity";
import { projectMateLimit, type MateLimitSource } from "./projections/mateLimit.ts";

/** One deadline wake per demanded conversation, shared by every surface reading its limit. */
export function createMateLimitAtoms(source: (key: string) => Atom.Atom<MateLimitSource | null>) {
  return Atom.family((key: string) =>
    Atom.make((get) => {
      const limit = projectMateLimit(get(source(key)), Effect.runSync(Clock.currentTimeMillis));
      if (limit.kind === "limited" && limit.resetsAt !== null) {
        const remaining = Date.parse(limit.resetsAt) - Effect.runSync(Clock.currentTimeMillis);
        if (remaining > 0) {
          const refresh = () => get.refreshSelf();
          const timer = Effect.runFork(
            Effect.sleep(Math.min(remaining, 2 ** 31 - 1)).pipe(
              Effect.andThen(Effect.sync(refresh)),
            ),
          );
          globalThis.addEventListener?.("focus", refresh);
          get.addFinalizer(() => {
            Effect.runFork(Fiber.interrupt(timer));
            globalThis.removeEventListener?.("focus", refresh);
          });
        }
      }
      return limit;
    }).pipe(Atom.withEquality(sameValue)),
  );
}

const sourceAtom = Atom.family((key: string) =>
  Atom.make((get): MateLimitSource | null => {
    const ref = parseScopedThreadKey(key);
    if (ref === null) return null;
    const engine = get(mateEngineHostAtom);
    const row =
      engine === null
        ? undefined
        : get(engine.store.data.project(engineRows, ref.environmentId)).find(
            (row) => String(row.conversationId) === ref.threadId,
          );
    if (row !== undefined) return { engineRow: row, latestTurn: null, session: null };
    const store = get(mateConversationStoreAtom);
    if (store !== null) {
      const shell = get(store.data.project(mateShell, { environmentId: ref.environmentId }));
      if (Option.isSome(shell.snapshot)) {
        const thread = shell.snapshot.value.threads.find((thread) => thread.id === ref.threadId);
        if (thread !== undefined) return thread;
      }
    }
    const account = get(accountReadsAtom);
    if (account?.orgId == null) return null;
    const mates = get(account.data.project(hqMates, account.orgId));
    for (const overview of Object.values(mates.mates))
      if (
        overview.identity?.environmentId === ref.environmentId &&
        overview.main?.id === ref.threadId
      )
        return overview.main;
    return null;
  }).pipe(Atom.withEquality(sameValue)),
);
export const mateLimitAtom = createMateLimitAtoms(sourceAtom);
