import { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { describe, expect, it } from "@effect/vitest";

import {
  claudeMcpControl,
  claudeMcpLiveServers,
  codexMcpControl,
  codexMcpLiveServers,
  openCodeMcpControl,
  openCodeMcpLiveServers,
  type ClaudeMcpQuery,
  type OpenCodeMcpClient,
} from "./mcpLive.ts";

const THREAD = ThreadId.make("thread-1");
const OTHER = ThreadId.make("thread-2");

describe("claudeMcpLiveServers", () => {
  it.each([
    ["connected", "connected"],
    ["pending", "connecting"],
    ["needs-auth", "needs-auth"],
    ["failed", "failed"],
    ["disabled", "disabled"],
    ["something-new", "configured"],
  ])("%s → %s", (status, state) => {
    expect(claudeMcpLiveServers([{ name: "x", status }])[0]?.state).toBe(state);
  });

  it("carries the error and the tools with their hints", () => {
    expect(
      claudeMcpLiveServers([
        {
          name: "zerops",
          status: "failed",
          error: "spawn zcp ENOENT",
          tools: [
            { name: "zerops_discover", description: "Read", annotations: { readOnly: true } },
            { name: "zerops_delete", annotations: { destructive: true } },
          ],
        },
      ]),
    ).toEqual([
      {
        name: "zerops",
        state: "failed",
        error: "spawn zcp ENOENT",
        tools: [
          { name: "zerops_discover", description: "Read", readOnly: true },
          { name: "zerops_delete", destructive: true },
        ],
      },
    ]);
  });
});

describe("codexMcpLiveServers", () => {
  it.each([
    [{ runtimeStatus: "connected", authStatus: "unsupported" }, "connected"],
    [{ runtimeStatus: "starting", authStatus: "unsupported" }, "connecting"],
    [{ runtimeStatus: "authenticationRequired", authStatus: "notLoggedIn" }, "needs-auth"],
    [{ runtimeStatus: "failed", authStatus: "unsupported" }, "failed"],
    [{ runtimeStatus: "cancelled", authStatus: "unsupported" }, "failed"],
    [{ runtimeStatus: "disabled", authStatus: "unsupported" }, "disabled"],
    [{ runtimeStatus: null, authStatus: "notLoggedIn" }, "needs-auth"],
    [{ runtimeStatus: "notStarted", authStatus: "bearerToken" }, "configured"],
    [{ authStatus: "unknown" }, "configured"],
  ])("%j → %s", (fields, state) => {
    const response = {
      data: [{ name: "x", tools: {}, resources: [], resourceTemplates: [], ...fields }],
    };
    expect(codexMcpLiveServers(response)[0]?.state).toBe(state);
  });

  it("reads the tools record and a discovery error", () => {
    expect(
      codexMcpLiveServers({
        data: [
          {
            name: "zerops",
            authStatus: "unsupported",
            runtimeStatus: "connected",
            tools: {
              zerops_discover: {
                name: "zerops_discover",
                description: "Look",
                inputSchema: {},
                annotations: { readOnlyHint: true },
              },
            },
            toolsError: null,
          },
          { name: "broken", authStatus: "unsupported", tools: {}, toolsError: "timed out" },
        ],
      }),
    ).toEqual([
      {
        name: "zerops",
        state: "connected",
        tools: [{ name: "zerops_discover", description: "Look", readOnly: true }],
      },
      { name: "broken", state: "configured", error: "timed out" },
    ]);
  });

  it.each([undefined, null, {}, { data: "x" }, { data: [{ tools: {} }] }])(
    "reads %j as no servers",
    (response) => {
      expect(codexMcpLiveServers(response)).toEqual([]);
    },
  );
});

describe("openCodeMcpLiveServers", () => {
  it("maps each status", () => {
    expect(
      openCodeMcpLiveServers({
        a: { status: "connected" },
        b: { status: "disabled" },
        c: { status: "failed", error: "exit 1" },
        d: { status: "needs_auth" },
        e: { status: "needs_client_registration", error: "no client id" },
      }),
    ).toEqual([
      { name: "a", state: "connected" },
      { name: "b", state: "disabled" },
      { name: "c", state: "failed", error: "exit 1" },
      { name: "d", state: "needs-auth" },
      { name: "e", state: "needs-auth", error: "no client id" },
    ]);
  });
});

const recordingClaudeQuery = (calls: string[]): ClaudeMcpQuery => ({
  mcpServerStatus: async () => [{ name: "zerops", status: "connected" }],
  reconnectMcpServer: async (name) => {
    calls.push(`reconnect ${name}`);
  },
  toggleMcpServer: async (name, enabled) => {
    calls.push(`toggle ${name} ${enabled}`);
  },
});

describe("claudeMcpControl", () => {
  it.effect("answers for the thread's running query only", () =>
    Effect.gen(function* () {
      const calls: string[] = [];
      const query = recordingClaudeQuery(calls);
      const control = claudeMcpControl({
        get: (threadId) => (threadId === THREAD ? query : undefined),
        all: () => [query],
      });
      expect(yield* control.status(THREAD)).toEqual([{ name: "zerops", state: "connected" }]);
      expect(yield* control.status(OTHER)).toBeUndefined();
      yield* control.reconnect(THREAD, "zerops");
      const refused = yield* Effect.flip(control.reconnect(OTHER, "zerops"));
      expect(refused.detail).toBe("No conversation is running on this agent.");
      expect(calls).toEqual(["reconnect zerops"]);
    }),
  );

  it.effect(
    "turns a server off in every running session, and leaves added or removed ones to the next",
    () =>
      Effect.gen(function* () {
        const calls: string[] = [];
        const control = claudeMcpControl({
          get: () => undefined,
          all: () => [recordingClaudeQuery(calls), recordingClaudeQuery(calls)],
        });
        yield* control.configChanged({ kind: "enabled", name: "x", enabled: false });
        yield* control.configChanged({ kind: "added", name: "y", entry: {} });
        yield* control.configChanged({ kind: "removed", name: "z" });
        expect(calls).toEqual(["toggle x false", "toggle x false"]);
      }),
  );

  it.effect("reads a query that cannot answer as no live state", () =>
    Effect.gen(function* () {
      const control = claudeMcpControl({
        get: () => ({
          mcpServerStatus: async () => {
            throw new Error("closed");
          },
        }),
        all: () => [],
      });
      expect(yield* control.status(THREAD)).toBeUndefined();
    }),
  );
});

describe("codexMcpControl", () => {
  it.effect("reloads the config to reconnect and after every change", () =>
    Effect.gen(function* () {
      const calls: string[] = [];
      const runtime = {
        listMcpServers: Effect.succeed({ data: [{ name: "zerops", runtimeStatus: "connected" }] }),
        reloadMcpServers: Effect.sync(() => {
          calls.push("reload");
        }),
      };
      const control = codexMcpControl({
        get: (threadId) => (threadId === THREAD ? runtime : undefined),
        all: () => [runtime, runtime],
      });
      expect(yield* control.status(THREAD)).toEqual([{ name: "zerops", state: "connected" }]);
      yield* control.reconnect(THREAD, "zerops");
      yield* control.configChanged({ kind: "removed", name: "x" });
      expect(calls).toEqual(["reload", "reload", "reload"]);
    }),
  );
});

describe("openCodeMcpControl", () => {
  it.effect("hands a running server what changed", () =>
    Effect.gen(function* () {
      const calls: string[] = [];
      const client: OpenCodeMcpClient = {
        status: async () => ({ zerops: { status: "connected" } }),
        connect: async (name) => calls.push(`connect ${name}`),
        disconnect: async (name) => calls.push(`disconnect ${name}`),
        add: async (name, config) => calls.push(`add ${name} ${JSON.stringify(config)}`),
      };
      const control = openCodeMcpControl({ get: () => client, all: () => [client] });
      yield* control.configChanged({
        kind: "added",
        name: "a",
        entry: { type: "remote", url: "u" },
      });
      yield* control.configChanged({ kind: "removed", name: "b" });
      yield* control.configChanged({ kind: "enabled", name: "c", enabled: true });
      yield* control.configChanged({ kind: "enabled", name: "d", enabled: false });
      yield* control.reconnect(THREAD, "e");
      expect(calls).toEqual([
        'add a {"type":"remote","url":"u"}',
        "disconnect b",
        "connect c",
        "disconnect d",
        "disconnect e",
        "connect e",
      ]);
    }),
  );
});
