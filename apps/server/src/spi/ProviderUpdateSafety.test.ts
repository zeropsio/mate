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
describe("updates wait for provider processes and credential changes", () => {
  it.each([
    ["native idle session", [idle], [false], "idle", true],
    ["native turn", [{ ...idle, activeTurnId: TurnId.make("turn") }], [false], "idle", false],
    ["session opening", [{ ...idle, status: "connecting" }], [false], "idle", false],
    ["session running", [{ ...idle, status: "running" }], [false], "idle", false],
    ["unknown session failure", [{ ...idle, status: "error" }], [false], "idle", false],
    ["authentication", [idle], [true], "idle", false],
    ["unobserved authentication", [idle], [undefined], "idle", false],
    ["download", [idle], [false], "downloading", false],
    ["extraction", [idle], [false], "extracting", false],
    ["installation verification", [idle], [false], "verifying", false],
    ["completed installation", [idle], [false], "succeeded", true],
  ] as const)(
    "%s permits a switch: %s",
    (_name, sessions, credentialChanges, installPhase, expected) => {
      expect(
        providerUpdateBlockers({ sessions, credentialChanges, installPhase }).length === 0,
      ).toBe(expected);
    },
  );
});
