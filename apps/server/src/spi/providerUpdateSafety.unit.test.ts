import { expect, it } from "@effect/vitest";
import {
  IsoDateTime,
  ProviderDriverKind,
  ThreadId,
  TurnId,
  type ProviderSession,
} from "@t3tools/contracts";

import { providerUpdateBlockers } from "./ProviderUpdateSafety.ts";

const session = (overrides: Partial<ProviderSession>): ProviderSession => ({
  provider: ProviderDriverKind.make("codex"),
  status: "ready",
  runtimeMode: "full-access",
  threadId: ThreadId.make("thread"),
  createdAt: IsoDateTime.make("2026-11-20T00:00:00Z"),
  updatedAt: IsoDateTime.make("2026-11-20T00:00:00Z"),
  ...overrides,
});

// witness: apps/server/src/spi/ProviderUpdateSafety.ts | !["ready", "closed"].includes(session.status) → !["ready", "closed", "error"].includes(session.status)
it("SP3: A provider update waits while any session is opening, running, on a turn or failed for an unknown reason; only idle sessions let it go", () => {
  const sessions = {
    ready: session({ status: "ready" }),
    closed: session({ status: "closed" }),
    opening: session({ status: "connecting" }),
    running: session({ status: "running" }),
    onTurn: session({ status: "ready", activeTurnId: TurnId.make("turn") }),
    failed: session({ status: "error" }),
  };
  const holdsUpdate = Object.fromEntries(
    Object.entries(sessions).map(([name, one]) => [
      name,
      providerUpdateBlockers({ sessions: [one], leftToRestart: new Set() }).length > 0,
    ]),
  );
  expect(holdsUpdate).toEqual({
    ready: false,
    closed: false,
    opening: true,
    running: true,
    onTurn: true,
    failed: true,
  });
  // One busy session among idle ones still holds the update.
  expect(
    providerUpdateBlockers({
      sessions: [sessions.ready, sessions.failed, sessions.closed],
      leftToRestart: new Set(),
    }).length,
  ).toBe(1);
});

// witness: apps/server/src/spi/ProviderUpdateSafety.ts | if (input.leftToRestart.has(session.threadId)) continue; → if (!input.leftToRestart.has(session.threadId)) continue;
it("SP8: A provider session whose open turn the engine leaves to the restart holds no update, while another session with a turn open still holds it. Breaks: a question waiting on its person keeps its Mate from every release through its live session.", () => {
  const onThread = (thread: string, open: boolean): ProviderSession =>
    session({
      provider: ProviderDriverKind.make("claudeAgent"),
      status: open ? "running" : "ready",
      threadId: ThreadId.make(thread),
      ...(open ? { activeTurnId: TurnId.make("turn") } : {}),
    });
  expect(
    providerUpdateBlockers({
      sessions: [onThread("waiting/s/1", true), onThread("idle/s/1", false)],
      leftToRestart: new Set(["waiting/s/1"]),
    }),
  ).toEqual([]);
  expect(
    providerUpdateBlockers({
      sessions: [onThread("waiting/s/1", true), onThread("running/s/1", true)],
      leftToRestart: new Set(["waiting/s/1"]),
    }),
  ).toEqual(["provider:running/s/1"]);
});
