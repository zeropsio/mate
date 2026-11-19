import { expect, it } from "vite-plus/test";
import { ConversationId, wakeId } from "@t3tools/contracts";

import { SESSION_IDLE_MS } from "./decide.sessions.ts";
import { fired, play, running, send, settled, T0, turnEnded } from "../testing/scene.ts";

const conversation = ConversationId.make("mate");

// witness: apps/server/src/engine/domain/decide.sessions.ts | dueAt: b.now + SESSION_IDLE_MS, → dueAt: b.now,
it("ED97: A session with nothing to do is closed after its idle time, unless background work keeps it busy or an admission cancels the wait", () => {
  const idle = play([...running, turnEnded]);
  expect(idle.state.wakes[wakeId(conversation, "session-idle", "s1")]?.dueAt).toBe(
    T0 + SESSION_IDLE_MS,
  );
  const busy = play([...running, turnEnded, send("again")]);
  expect(busy.events.filter((e) => e._tag === "WakeCancelled")).toMatchObject([
    { wakeId: wakeId(conversation, "session-idle", "s1") },
  ]);
  const idleFired = fired("session-idle", "s1", T0 + SESSION_IDLE_MS);
  const closed = play([...running, turnEnded, idleFired]);
  expect(closed.effects).toMatchObject([{ kind: "session.close", payload: { reason: "idle" } }]);
  const kept = play([
    ...running,
    turnEnded,
    idleFired,
    settled("s1", "session.close", { kind: "ok", value: { kept: true } }),
  ]);
  expect(kept.state.session?.id).toBe("s1");
  expect(kept.events.map((e) => e._tag)).toEqual(["EffectOutcomeRecorded", "WakeArmed"]);
});

// witness: apps/server/src/engine/domain/decide.ts | return closeSession(b, command.reason); → return closeSession(b, "idle");
it("ED98: Signing out closes the conversation's session", () => {
  const scene = play([...running, turnEnded, { _tag: "CloseSession", reason: "signed-out" }]);
  expect(scene.effects).toMatchObject([
    { kind: "session.close", payload: { reason: "signed-out" } },
  ]);
});
