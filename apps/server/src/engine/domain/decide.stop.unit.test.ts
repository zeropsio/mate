import { expect, it } from "vite-plus/test";
import { play, r, running, send, settled, stop, turnEnded } from "../testing/scene.ts";

// witness: apps/server/src/engine/domain/decide.ts | return closeSession(b, "stop"); → return closeSession(b, "idle");
it("ED43: A second Stop on a turn whose first was not confirmed closes its session, and the closed session ends the run and admits the next", () => {
  const closing = play([...running, stop(), stop()]);
  expect(closing.effects).toMatchObject([
    { kind: "session.close", payload: { sessionId: "s1", reason: "stop" } },
  ]);
  const closed = play([
    ...running,
    send("next"),
    stop(),
    stop(),
    settled("s1", "session.close", { kind: "ok" }),
  ]);
  expect(closed.state.runs[r(1)]).toMatchObject({
    end: { kind: "stopped" },
    endSource: "inferred-from-close",
  });
  expect(closed.state.runs[r(2)]?.state).toBe("admitted");
});

// witness: apps/server/src/engine/domain/decide.ts | if (b.state.closing !== null) throw new Rejected("stop-already-asked"); → if (b.state.closing !== null) throw new Rejected("run-not-running");
it("ED44: Stop is refused with nothing running, for a run that does not exist or has ended, and a third time while the session closes", () => {
  expect(play([stop()]).decision).toMatchObject({
    _tag: "Reject",
    rejection: { reason: "run-not-running" },
  });
  expect(play([...running, stop(9)]).decision).toMatchObject({
    _tag: "Reject",
    rejection: { reason: "unknown-run" },
  });
  expect(play([...running, turnEnded, stop(1)]).decision).toMatchObject({
    _tag: "Reject",
    rejection: { reason: "run-ended" },
  });
  expect(play([...running, stop(), stop(), stop()]).decision).toMatchObject({
    _tag: "Reject",
    rejection: { reason: "stop-already-asked" },
  });
});
