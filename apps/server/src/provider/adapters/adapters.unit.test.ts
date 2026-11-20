import type { OpencodeClient } from "@opencode-ai/sdk/v2";
import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as RegExpUtils from "effect/RegExp";
import * as Result from "effect/Result";

import { routeCodexChildNotification } from "../Layers/CodexSessionRuntime.ts";
import {
  buildOpenCodePermissionRules,
  OpenCodeRuntimeError,
  resolveOpenCodeServerPassword,
  toOpenCodePermissionReply,
  verifyOpenCodeServerVersion,
} from "../opencodeRuntime.ts";
import { pendingWorkspaceRescans } from "../workspaceSnapshots.ts";

function actionFor(
  runtimeMode: Parameters<typeof buildOpenCodePermissionRules>[0],
  permission: string,
  target = "*",
) {
  // OpenCode uses the last matching rule. Its wildcards, in a permission's
  // name as in its pattern, match directory separators.
  const matches = (wildcard: string, value: string) =>
    new RegExp(`^${RegExpUtils.escape(wildcard).replaceAll("\\*", ".*")}$`, "s").test(value);
  return buildOpenCodePermissionRules(runtimeMode).findLast(
    (rule) => matches(rule.permission, permission) && matches(rule.pattern, target),
  )?.action;
}

const supervisedModes = ["approval-required", "auto-accept-edits", "auto"] as const;

// witness: apps/server/src/provider/opencodeRuntime.ts | { permission: "read", pattern: "*.env.*", action: "ask" }, → { permission: "read", pattern: "*.env.*", action: "allow" },
it("PA1: Under supervised, auto-accept-edits and auto, OpenCode reads, searches and updates tasks in the workspace without asking, asks before reading an env file but not its example, and asks before a command, a web fetch or search, an outside directory, a repeated loop or an unknown tool", () => {
  for (const runtimeMode of supervisedModes) {
    for (const permission of ["read", "glob", "grep", "lsp", "skill", "todowrite"]) {
      expect(actionFor(runtimeMode, permission, "src/index.ts"), permission).toBe("allow");
    }
    for (const target of [".env", ".env.local", "config/service.env", "config/service.env.local"]) {
      expect(actionFor(runtimeMode, "read", target), target).toBe("ask");
    }
    for (const target of [".env.example", "config/service.env.example"]) {
      expect(actionFor(runtimeMode, "read", target), target).toBe("allow");
    }
    for (const permission of [
      "bash",
      "webfetch",
      "websearch",
      "external_directory",
      "doom_loop",
      "custom_tool",
    ]) {
      expect(actionFor(runtimeMode, permission), permission).toBe("ask");
    }
  }
});

// witness: apps/server/src/provider/opencodeRuntime.ts | const editAction = runtimeMode === "auto-accept-edits" ? "allow" : "ask"; → const editAction = runtimeMode === "approval-required" ? "ask" : "allow";
it("PA2: OpenCode pre-approves edits only under auto-accept-edits, keeps asking under supervised and auto (it has no reviewer), and allows everything, outside directories included, only under full access", () => {
  expect(actionFor("auto-accept-edits", "edit")).toBe("allow");
  expect(actionFor("approval-required", "edit")).toBe("ask");
  expect(actionFor("auto", "edit")).toBe("ask");
  expect(buildOpenCodePermissionRules("full-access")).toEqual([
    { permission: "*", pattern: "*", action: "allow" },
    { permission: "external_directory", pattern: "*", action: "allow" },
  ]);
});

// witness: apps/server/src/provider/opencodeRuntime.ts | { permission: "zerops_*", pattern: "*", action: "allow" }, → { permission: "zerops*", pattern: "*", action: "allow" },
it("PA3: In every supervised mode OpenCode runs the Zerops tools (`zerops_…`) without asking, and still asks for a tool whose name only starts with `zerops`", () => {
  for (const runtimeMode of supervisedModes) {
    expect(actionFor(runtimeMode, "zerops_zerops_discover"), runtimeMode).toBe("allow");
    expect(actionFor(runtimeMode, "zeropsish_tool"), runtimeMode).toBe("ask");
  }
});

// witness: apps/server/src/provider/opencodeRuntime.ts | return "once"; → return "always";
it("PA4: A person's approval reaches OpenCode as once for accept, always for this thread and for always, and reject for decline and for cancel", () => {
  for (const [decision, reply] of [
    ["accept", "once"],
    ["acceptForSession", "always"],
    ["acceptAlways", "always"],
    ["decline", "reject"],
    ["cancel", "reject"],
  ] as const) {
    expect(toOpenCodePermissionReply(decision), decision).toBe(reply);
  }
});

// witness: apps/server/src/provider/opencodeRuntime.ts | if (input.external) { → if (input.external && input.environment === undefined) {
it("PA5: The OpenCode server password is the settings' one when set; otherwise a local server takes the launch environment's, and an external server never gets an inherited or launch-environment password", () => {
  expect(
    resolveOpenCodeServerPassword(
      { external: false, environment: { OPENCODE_SERVER_PASSWORD: " env password " } },
      {},
    ),
  ).toBe(" env password ");
  expect(
    resolveOpenCodeServerPassword({ external: false, serverPassword: " settings password " }, {}),
  ).toBe(" settings password ");
  expect(
    resolveOpenCodeServerPassword(
      {
        external: false,
        serverPassword: "settings-password",
        environment: { OPENCODE_SERVER_PASSWORD: "environment-password" },
      },
      {},
    ),
  ).toBe("settings-password");
  expect(
    resolveOpenCodeServerPassword(
      { external: true, environment: { OPENCODE_SERVER_PASSWORD: "local-secret" } },
      { OPENCODE_SERVER_PASSWORD: "inherited-secret" },
    ),
  ).toBeUndefined();
});

// witness: apps/server/src/provider/opencodeRuntime.ts | if (compareSemverVersions(health.version, MINIMUM_OPENCODE_VERSION) < 0) { → if (compareSemverVersions(health.version, MINIMUM_OPENCODE_VERSION) <= 0) {
it.effect(
  "PA6: Mate accepts an OpenCode server at v1.14.19 and refuses one below it or one whose health answer is unhealthy, unversioned or not a version",
  () =>
    Effect.gen(function* () {
      for (const [data, accepted] of [
        [{ healthy: true, version: "1.14.19" }, true],
        [{ healthy: true, version: "1.14.18" }, false],
        [{ healthy: true }, false],
        [{ healthy: true, version: "not-a-version" }, false],
        [{ healthy: false, version: "1.14.19" }, false],
      ] as const) {
        const client = {
          global: { health: () => Promise.resolve({ data }) },
        } as unknown as OpencodeClient;
        const result = yield* verifyOpenCodeServerVersion(client).pipe(Effect.result);
        if (accepted) {
          expect(result, JSON.stringify(data)).toEqual(Result.succeed("1.14.19"));
        } else {
          expect(Result.isFailure(result), JSON.stringify(data)).toBe(true);
          expect(Result.isFailure(result) ? result.failure : undefined).toBeInstanceOf(
            OpenCodeRuntimeError,
          );
        }
      }
    }),
);

// witness: apps/server/src/provider/Layers/CodexSessionRuntime.ts | if (CHILD_AGENT_EVENT_METHODS.has(method)) { → if (CHILD_AGENT_EVENT_METHODS.has(method) && method !== "error") {
it("PA7: A Codex child agent's lifecycle (turn start and end, thread status, usage, settings, model reroute, items, close, error) becomes agent events, its streaming chatter is dropped, and no child-owned thread lifecycle reaches the parent", () => {
  for (const method of [
    "turn/started",
    "turn/completed",
    "thread/status/changed",
    "thread/tokenUsage/updated",
    "rawResponse/completed",
    "thread/settings/updated",
    "model/rerouted",
    "item/started",
    "item/completed",
    "thread/closed",
    "error",
  ]) {
    expect(routeCodexChildNotification(method), method).toBe("agent-event");
  }
  for (const method of [
    "item/agentMessage/delta",
    "item/reasoning/textDelta",
    "item/commandExecution/outputDelta",
    "turn/plan/updated",
    "thread/name/updated",
  ]) {
    expect(routeCodexChildNotification(method), method).toBe("drop");
  }
  for (const method of [
    "thread/started",
    "thread/status/changed",
    "thread/archived",
    "thread/unarchived",
    "thread/closed",
    "thread/compacted",
    "thread/name/updated",
    "thread/tokenUsage/updated",
    "turn/started",
    "turn/completed",
    "turn/plan/updated",
    "item/plan/delta",
    "thread/settings/updated",
    "model/rerouted",
  ]) {
    expect(routeCodexChildNotification(method), method).not.toBe("parent");
  }
});

// witness: apps/server/src/provider/Layers/CodexSessionRuntime.ts | return "parent"; → return "drop";
it("PA8: A child notification the parent owns (`serverRequest/resolved`) or one the router does not know goes to the parent, never lost", () => {
  for (const method of [
    "serverRequest/resolved",
    "thread/somethingBrandNew",
    "account/rateLimits/updated",
  ]) {
    expect(routeCodexChildNotification(method), method).toBe("parent");
  }
});

// witness: apps/server/src/provider/workspaceSnapshots.ts | previous.version !== next.version || → false ||
it("PA+1: A folder whose commands did not come is scanned again once its agent's install, version, enabled state, status, sign-in or machine commands change, and never on a change of usage or check time alone", () => {
  const previous: ServerProvider = {
    instanceId: ProviderInstanceId.make("claudeAgent"),
    driver: ProviderDriverKind.make("claudeAgent"),
    enabled: true,
    installed: true,
    version: "2.1.329",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-11-20T09:00:00.000Z",
    models: [],
    slashCommands: [{ name: "compact" }, { name: "review" }],
    skills: [],
    usageLimits: { checkedAt: "2026-11-20T09:00:00.000Z", windows: [] },
    workspaceSnapshots: [
      {
        cwd: "/var/www/pending",
        checkedAt: "2026-11-20T09:00:00.000Z",
        slashCommands: [{ name: "compact" }],
        slashCommandsPending: true,
        skills: [],
      },
      {
        cwd: "/var/www/complete",
        checkedAt: "2026-11-20T09:00:00.000Z",
        slashCommands: [{ name: "compact" }, { name: "deploy" }],
        skills: [],
      },
    ],
  };
  const agentChanges: ReadonlyArray<readonly [string, ServerProvider]> = [
    ["install", { ...previous, installed: false }],
    ["version", { ...previous, version: "2.1.330" }],
    ["enabled state", { ...previous, enabled: false }],
    ["status", { ...previous, status: "error" }],
    ["sign-in", { ...previous, auth: { status: "unauthenticated" } }],
    ["machine commands", { ...previous, slashCommands: [{ name: "compact" }, { name: "init" }] }],
  ];
  for (const [change, next] of agentChanges) {
    expect(pendingWorkspaceRescans(previous, next), change).toEqual(["/var/www/pending"]);
  }
  const quietChanges: ReadonlyArray<readonly [string, ServerProvider]> = [
    ["check time", { ...previous, checkedAt: "2026-11-20T09:05:00.000Z" }],
    [
      "usage",
      {
        ...previous,
        checkedAt: "2026-11-20T09:05:00.000Z",
        usageLimits: {
          checkedAt: "2026-11-20T09:05:00.000Z",
          windows: [{ id: "five_hour", kind: "session", label: "Session", usedPercent: 40 }],
        },
      },
    ],
  ];
  for (const [change, next] of quietChanges) {
    expect(pendingWorkspaceRescans(previous, next), change).toEqual([]);
  }
});
