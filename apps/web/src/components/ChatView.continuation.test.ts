import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { deriveProviderInstanceEntries } from "../providerInstances";
import { resolveComposerProviderSelection } from "./ChatView.logic";

function account(driver: string, instanceId: string, groupKey: string) {
  return {
    driver: ProviderDriverKind.make(driver),
    instanceId: ProviderInstanceId.make(instanceId),
    enabled: true,
    installed: true,
    status: "ready",
    auth: { status: "authenticated" },
    version: null,
    checkedAt: "2026-10-08T10:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
    continuation: { groupKey },
  } satisfies ServerProvider;
}

describe("account switching in an existing conversation", () => {
  it.each([
    { name: "Codex", driver: "codex" },
    { name: "Claude", driver: "claudeAgent" },
  ])(
    "an existing $name conversation switches accounts only within its continuation workspace",
    ({ driver }) => {
      // Account labels and ready status alone cannot make saved provider history transferable.
      const entries = deriveProviderInstanceEntries([
        account(driver, "work-account", "shared-workspace"),
        account(driver, "personal-account", "shared-workspace"),
        account(driver, "separate-account", "other-workspace"),
      ]);
      const input = {
        entries,
        lockedProvider: ProviderDriverKind.make(driver),
        lockedInstanceId: ProviderInstanceId.make("work-account"),
      };
      expect(
        resolveComposerProviderSelection({
          ...input,
          candidateInstanceIds: [ProviderInstanceId.make("personal-account")],
        }).selectedProviderEntry?.instanceId,
      ).toBe("personal-account");
      expect(
        resolveComposerProviderSelection({
          ...input,
          candidateInstanceIds: [ProviderInstanceId.make("separate-account")],
        }).selectedProviderEntry?.instanceId,
      ).toBe("work-account");
    },
  );
});
