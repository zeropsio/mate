import { describe, expect, it } from "@effect/vitest";
import {
  ThreadId,
  IsoDateTime,
  TurnId,
  ProviderDriverKind,
  type ProviderSession,
} from "@t3tools/contracts";
import { providerUpdateBlockers } from "./ProviderUpdateSafety.ts";
const idle: ProviderSession = {
  provider: ProviderDriverKind.make("codex"),
  status: "ready",
  runtimeMode: "full-access",
  threadId: ThreadId.make("thread"),
  createdAt: IsoDateTime.make("2026-10-08T00:00:00Z"),
  updatedAt: IsoDateTime.make("2026-10-08T00:00:00Z"),
};
describe("updates wait for provider processes", () => {
  it.each([
    ["native idle session", [idle], true],
    ["native turn", [{ ...idle, activeTurnId: TurnId.make("turn") }], false],
    ["session opening", [{ ...idle, status: "connecting" }], false],
    ["session running", [{ ...idle, status: "running" }], false],
    ["unknown session failure", [{ ...idle, status: "error" }], false],
  ] as const)("%s permits a switch: %s", (_name, sessions, expected) => {
    expect(providerUpdateBlockers({ sessions }).length === 0).toBe(expected);
  });
});
