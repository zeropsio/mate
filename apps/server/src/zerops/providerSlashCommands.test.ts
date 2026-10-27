import {
  defaultInstanceIdForDriver,
  ProviderDriverKind,
  type ServerProvider,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { withoutUnworkableSlashCommands } from "./providerSlashCommands.ts";

const CLAUDE = ProviderDriverKind.make("claudeAgent");
const CODEX = ProviderDriverKind.make("codex");

const commands = (...names: ReadonlyArray<string>) => names.map((name) => ({ name }));

const provider = (
  driver: ProviderDriverKind,
  overrides?: Partial<ServerProvider>,
): ServerProvider => ({
  instanceId: defaultInstanceIdForDriver(driver),
  driver,
  enabled: true,
  installed: true,
  version: "1.0.0",
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-10-03T10:00:00.000Z",
  models: [],
  slashCommands: [],
  skills: [],
  ...overrides,
});

const names = (items: ReadonlyArray<{ readonly name: string }>) => items.map((item) => item.name);

describe("withoutUnworkableSlashCommands", () => {
  it.each([
    // The model picker owns these; Mate's own /model stays in the menu.
    ["model"],
    ["effort"],
    ["fast"],
    ["clear"],
    ["rename"],
    ["color"],
    ["heapdump"],
    ["agents"],
    ["extra-usage"],
    ["__remote-workflow"],
    ["workflow-launch-exec"],
    ["auto-mode-setup"],
  ])("takes Claude's /%s off the menu", (name) => {
    const [claude] = withoutUnworkableSlashCommands([
      provider(CLAUDE, { slashCommands: commands("context", name) }),
    ]);
    expect(names(claude!.slashCommands)).toEqual(["context"]);
  });

  it("keeps every Claude command that answers in the conversation", () => {
    const working = [
      "compact",
      "context",
      "mcp",
      "config",
      "usage",
      "usage-credits",
      "output-style",
      "advisor",
      "autocompact",
      "reload-plugins",
      "reload-skills",
      "recap",
      "goal",
      "import",
      "init",
      "review",
      "loop",
    ];
    const [claude] = withoutUnworkableSlashCommands([
      provider(CLAUDE, { slashCommands: commands(...working) }),
    ]);
    expect(names(claude!.slashCommands)).toEqual(working);
  });

  it("cleans a workspace's own list too, which replaces the global one", () => {
    const [claude] = withoutUnworkableSlashCommands([
      provider(CLAUDE, {
        workspaceSnapshots: [
          {
            cwd: "/var/www",
            checkedAt: "2026-10-03T10:00:00.000Z",
            slashCommands: commands("clear", "deploy-notes"),
            skills: [],
          },
        ],
      }),
    ]);
    expect(names(claude!.workspaceSnapshots![0]!.slashCommands)).toEqual(["deploy-notes"]);
  });

  it("leaves another agent's commands alone, even under the same name", () => {
    const codex = provider(CODEX, { slashCommands: commands("compact", "feedback", "clear") });
    expect(withoutUnworkableSlashCommands([codex])).toEqual([codex]);
  });
});
