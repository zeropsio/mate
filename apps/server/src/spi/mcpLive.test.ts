import { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import { describe, expect, it } from "@effect/vitest";

import {
  claudeMcpControl,
  claudeMcpLiveServers,
  codexMcpControl,
  codexMcpLiveServers,
  openCodeMcpControl,
  openCodeMcpLiveServers,
  loopbackRedirect,
  type ClaudeMcpQuery,
  type McpSignInStart,
  type OpenCodeMcpClient,
  layer as McpLiveLayer,
  McpLive,
} from "./mcpLive.ts";
import type { ProviderInstance } from "../provider/ProviderDriver.ts";
import { ProviderInstanceRegistry } from "../provider/Services/ProviderInstanceRegistry.ts";
import { ProviderRegistryTest } from "./ProviderRegistryTest.ts";

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
        signedIn: false,
        tools: [{ name: "zerops_discover", description: "Look", readOnly: true }],
      },
      { name: "broken", state: "configured", signedIn: false, error: "timed out" },
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

const live = <R>(runtime: R) => ({ runtime, profiled: false });
const crewmate = <R>(runtime: R) => ({ runtime, profiled: true });

describe("a crewmate's session and the MCP tab", () => {
  it.effect("no press or config change reaches it, on any agent", () =>
    Effect.gen(function* () {
      const calls: string[] = [];
      const claude = claudeMcpControl({
        get: () => crewmate(recordingClaudeQuery(calls)),
        all: () => [crewmate(recordingClaudeQuery(calls))],
      });
      const reloads = {
        reloadMcpServers: Effect.sync(() => {
          calls.push("reload");
        }),
      };
      const codex = codexMcpControl({
        get: () => crewmate(reloads),
        all: () => [crewmate(reloads)],
      });
      const client: OpenCodeMcpClient = {
        status: async () => ({}),
        connect: async (name) => calls.push(`connect ${name}`),
        disconnect: async (name) => calls.push(`disconnect ${name}`),
        add: async (name) => calls.push(`add ${name}`),
      };
      const openCode = openCodeMcpControl({
        get: () => crewmate(client),
        all: () => [crewmate(client)],
      });
      const refusals: string[] = [];
      for (const control of [claude, codex, openCode]) {
        refusals.push((yield* Effect.flip(control.reconnect(THREAD, "zerops"))).detail);
        refusals.push((yield* Effect.flip(control.setEnabled(THREAD, "zerops", true))).detail);
        yield* control.configChanged({ kind: "enabled", name: "zerops", enabled: true });
        yield* control.configChanged({ kind: "added", name: "x", entry: {} });
      }
      expect({ calls, refusals: new Set(refusals) }).toEqual({
        calls: [],
        refusals: new Set([
          "A crewmate's tools are the crew's to set; its MCP servers can't be changed here.",
        ]),
      });
    }),
  );
});

describe("claudeMcpControl", () => {
  it.effect("answers for the thread's running query only", () =>
    Effect.gen(function* () {
      const calls: string[] = [];
      const query = recordingClaudeQuery(calls);
      const control = claudeMcpControl({
        get: (threadId) => (threadId === THREAD ? live(query) : undefined),
        all: () => [live(query)],
      });
      expect(yield* control.status(THREAD)).toEqual([{ name: "zerops", state: "connected" }]);
      expect(yield* control.status(OTHER)).toBeUndefined();
      yield* control.reconnect(THREAD, "zerops");
      const refused = yield* Effect.flip(control.reconnect(OTHER, "zerops"));
      expect(refused.detail).toBe("No conversation is running on this agent.");
      expect(calls).toEqual(["reconnect zerops"]);
    }),
  );

  it.effect("turns a server off in every running session", () =>
    Effect.gen(function* () {
      const calls: string[] = [];
      const control = claudeMcpControl({
        get: () => undefined,
        all: () => [live(recordingClaudeQuery(calls)), live(recordingClaudeQuery(calls))],
      });
      yield* control.configChanged({ kind: "enabled", name: "x", enabled: false });
      expect(calls).toEqual(["toggle x false", "toggle x false"]);
    }),
  );

  it.effect(
    "a server added in the MCP tab joins every running Claude conversation, and leaves it when removed",
    () =>
      Effect.gen(function* () {
        const calls: string[] = [];
        const query = (): ClaudeMcpQuery => ({
          ...recordingClaudeQuery(calls),
          setMcpServers: async (servers) => {
            calls.push(`set ${Object.keys(servers).join(",")}`);
          },
        });
        const control = claudeMcpControl({
          get: () => undefined,
          all: () => sessions,
        });
        const sessions = [live(query()), live(query())];
        yield* control.configChanged({
          kind: "added",
          name: "a",
          entry: { type: "http", url: "u" },
        });
        yield* control.configChanged({ kind: "added", name: "b", entry: { command: "c" } });
        yield* control.configChanged({ kind: "removed", name: "a" });
        // A server the conversation started with is the next conversation's to drop.
        yield* control.configChanged({ kind: "removed", name: "zerops" });
        expect(calls).toEqual(["set a", "set a", "set a,b", "set a,b", "set b", "set b"]);
      }),
  );

  it.effect("reads a query that cannot answer as no live state", () =>
    Effect.gen(function* () {
      const control = claudeMcpControl({
        get: () =>
          live({
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
        get: (threadId) => (threadId === THREAD ? live(runtime) : undefined),
        all: () => [live(runtime), live({ ...runtime })],
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
      const control = openCodeMcpControl({ get: () => live(client), all: () => [live(client)] });
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

describe("signing in to a remote MCP server", () => {
  const CODE = ["c0de", "0n3", "t1me"].join("-");
  const PAGE = "https://mate.example.app/mate/mcp/oauth/callback";
  const started = (answer: McpSignInStart | "signed-in"): McpSignInStart => {
    if (answer === "signed-in") throw new Error("expected a sign-in to open");
    return answer;
  };

  it.effect(
    "Claude Code opens its own OAuth flow, sent back to the Mate's page, and takes the landing",
    () =>
      Effect.gen(function* () {
        const calls: string[] = [];
        const query: ClaudeMcpQuery = {
          mcpAuthenticate: async (name, redirectUri) => {
            calls.push(`authenticate ${name} ${redirectUri ?? ""}`);
            return {
              requiresUserAction: true,
              callbackExpected: true,
              authUrl: "https://auth.example.com/a",
            };
          },
          mcpSubmitOAuthCallbackUrl: async (name, url) => {
            calls.push(`landed ${name} ${url}`);
          },
        };
        const control = claudeMcpControl({ get: () => live(query), all: () => [] });
        const start = started(yield* control.signIn!(THREAD, "adobe", PAGE));
        expect(start.url).toBe("https://auth.example.com/a");
        yield* start.finish(new URL(`${PAGE}?code=${CODE}&state=s`));
        expect(calls).toEqual([
          `authenticate adobe ${PAGE}`,
          `landed adobe ${PAGE}?code=${CODE}&state=s`,
        ]);
      }),
  );

  it.effect("Claude Code holding a valid sign-in opens nothing", () =>
    Effect.gen(function* () {
      const query: ClaudeMcpQuery = {
        mcpAuthenticate: async () => ({ requiresUserAction: false, callbackExpected: false }),
        mcpSubmitOAuthCallbackUrl: async () => undefined,
      };
      const control = claudeMcpControl({ get: () => live(query), all: () => [] });
      expect(yield* control.signIn!(THREAD, "adobe", PAGE)).toBe("signed-in");
    }),
  );

  it.effect(
    "Codex's sign-in lands on its listener in the container and ends when the app-server says so",
    () =>
      Effect.gen(function* () {
        const calls: string[] = [];
        const runtime = {
          loginMcpServer: (name: string) =>
            Effect.succeed({
              authorizationUrl: `https://auth.example.com/a?redirect_uri=${encodeURIComponent("http://127.0.0.1:5555/callback")}&state=s`,
              completed: Effect.sync(() => {
                calls.push(`completed ${name}`);
              }),
            }),
          reloadMcpServers: Effect.sync(() => {
            calls.push("reload");
          }),
        };
        const control = codexMcpControl({ get: () => live(runtime), all: () => [] });
        const start = started(yield* control.signIn!(THREAD, "adobe", PAGE));
        expect(start.listener?.href).toBe("http://127.0.0.1:5555/callback");
        yield* start.finish(new URL(`http://127.0.0.1:5555/callback?code=${CODE}&state=s`));
        expect(calls).toEqual(["completed adobe", "reload"]);
      }),
  );

  it.effect("OpenCode exchanges the code the landing carries", () =>
    Effect.gen(function* () {
      const calls: string[] = [];
      const client: OpenCodeMcpClient = {
        status: async () => ({}),
        connect: async () => undefined,
        disconnect: async () => undefined,
        add: async () => undefined,
        startAuth: async () => ({ authorizationUrl: "https://auth.example.com/a?state=s" }),
        finishAuth: async (name, code) => calls.push(`${name} ${code}`),
      };
      const control = openCodeMcpControl({ get: () => live(client), all: () => [] });
      const start = started(yield* control.signIn!(THREAD, "adobe", PAGE));
      yield* start.finish(
        new URL(`http://127.0.0.1:19876/mcp/oauth/callback?code=${CODE}&state=s`),
      );
      expect(calls).toEqual([`adobe ${CODE}`]);
    }),
  );

  it.each([
    ["http://127.0.0.1:5555/callback", "http://127.0.0.1:5555/callback"],
    ["http://localhost:19876/mcp/oauth/callback", "http://localhost:19876/mcp/oauth/callback"],
    ["https://127.0.0.1:5555/callback", undefined],
    ["http://10.0.0.5:5555/callback", undefined],
    ["https://mate.example.app/mate/mcp/oauth/callback", undefined],
  ])(
    "only a plain-http loopback redirect is a listener in the container: %s",
    (redirect, listener) => {
      const url = `https://auth.example.com/a?redirect_uri=${encodeURIComponent(redirect)}`;
      expect(loopbackRedirect(url)?.href).toBe(listener);
    },
  );
});

describe("signing out of a remote MCP server", () => {
  it.effect("each agent drops its sign-in its own way, and the server asks for one again", () =>
    Effect.gen(function* () {
      const calls: string[] = [];
      const claude = claudeMcpControl({
        get: () =>
          live({
            mcpClearAuth: async (name: string) => {
              calls.push(`claude clear ${name}`);
            },
          } satisfies ClaudeMcpQuery),
        all: () => [],
      });
      const codex = codexMcpControl({
        get: () =>
          live({
            logoutMcpServer: (name: string) =>
              Effect.sync(() => {
                calls.push(`codex logout ${name}`);
              }),
            reloadMcpServers: Effect.sync(() => {
              calls.push("codex reload");
            }),
          }),
        all: () => [],
      });
      const client: OpenCodeMcpClient = {
        status: async () => ({}),
        connect: async (name) => calls.push(`opencode connect ${name}`),
        disconnect: async (name) => calls.push(`opencode disconnect ${name}`),
        add: async () => undefined,
        removeAuth: async (name) => calls.push(`opencode forget ${name}`),
      };
      const openCode = openCodeMcpControl({ get: () => live(client), all: () => [] });
      for (const control of [claude, codex, openCode]) yield* control.signOut!(THREAD, "adobe");
      expect(calls).toEqual([
        "claude clear adobe",
        "codex logout adobe",
        "codex reload",
        "opencode forget adobe",
        "opencode disconnect adobe",
        "opencode connect adobe",
      ]);
    }),
  );

  it.each([
    ["oAuth", true],
    ["bearerToken", false],
    ["unsupported", false],
    ["unknown", undefined],
  ])("Codex says whether it holds a sign-in for a server: %s", (authStatus, signedIn) => {
    const [server] = codexMcpLiveServers({
      data: [{ name: "adobe", runtimeStatus: "connected", authStatus }],
    });
    expect(server?.signedIn).toBe(signedIn);
  });
});

describe("McpLive", () => {
  const hung = {
    status: () => Effect.undefined,
    reconnect: () => Effect.never,
    setEnabled: () => Effect.never,
    configChanged: () => Effect.void,
  };
  const instance = {
    driverKind: "claudeAgent",
    adapter: { hasSession: () => Effect.succeed(true), mcp: hung },
  } as unknown as ProviderInstance;
  const live = McpLiveLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ProviderInstanceRegistry)({ listInstances: Effect.succeed([instance]) }),
        ProviderRegistryTest.empty(),
      ),
    ),
  );

  it.effect("gives up on a reconnect or a toggle the agent never answers", () =>
    Effect.gen(function* () {
      const mcp = yield* McpLive;
      for (const call of [mcp.reconnect(THREAD, "x"), mcp.setEnabled(THREAD, "x", false)]) {
        const fiber = yield* Effect.forkChild(Effect.flip(call));
        yield* TestClock.adjust("16 seconds");
        const error = yield* Fiber.join(fiber);
        expect(error.detail).toBe("the agent did not answer in 15 seconds");
      }
    }).pipe(Effect.provide(live)),
  );
});
