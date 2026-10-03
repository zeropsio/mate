import { describe, expect, it } from "@effect/vitest";
import type * as EffectAcpSchema from "effect-acp/schema";
import * as Effect from "effect/Effect";

import { acpGateCalls, decideAcpPermission } from "./acpThreadProfile.ts";
import type { ThreadToolProfile, ToolDecision } from "./threadToolPolicy.ts";

const CWD = "/var/www/.crew/backend";

/** A gate that allows what a crew lane would: its own files, a plain test run, the crew tools. */
const decide = (call: { readonly toolName: string; readonly input: unknown }): ToolDecision => {
  const input = call.input as Record<string, unknown>;
  if (call.toolName.startsWith("mcp__crew__")) return { kind: "allow" };
  if (call.toolName === "mcp__zerops__zerops_deploy") return { kind: "deny", reason: "no" };
  if (call.toolName === "Bash") {
    if (input.command === "npm test") return { kind: "allow" };
    if (input.command === "npm run dev") {
      return { kind: "allow", updatedInput: { command: "ssh appdev 'npm run dev'" } };
    }
    return { kind: "deny", reason: "no" };
  }
  if (call.toolName === "Edit" || call.toolName === "Read") {
    return String(input.file_path).startsWith(CWD)
      ? { kind: "allow" }
      : { kind: "deny", reason: "no" };
  }
  return { kind: "deny", reason: "no" };
};

const asked: Array<unknown> = [];
const profile = {
  sessionContext: "",
  contextWindow: 1,
  decideTool: (call) => Effect.sync(() => (asked.push(call), decide(call))),
  tools: [],
} satisfies ThreadToolProfile;

const OPTIONS: EffectAcpSchema.RequestPermissionRequest["options"] = [
  { optionId: "always", kind: "allow_always", name: "Always" },
  { optionId: "once", kind: "allow_once", name: "Once" },
  { optionId: "no", kind: "reject_once", name: "No" },
];

const request = (
  toolCall: Omit<EffectAcpSchema.RequestPermissionRequest["toolCall"], "toolCallId">,
  options = OPTIONS,
): EffectAcpSchema.RequestPermissionRequest => ({
  sessionId: "s",
  options,
  toolCall: { toolCallId: "call-1", ...toolCall },
});

describe("decideAcpPermission", () => {
  it.effect.each([
    {
      name: "a command the gate allows as it is",
      call: { kind: "execute", rawInput: { command: "npm test" } },
      expected: "once",
    },
    {
      name: "a command in a shell wrapper, judged inside",
      call: { kind: "execute", rawInput: { command: ["bash", "-lc", "npm test"] } },
      expected: "once",
    },
    {
      name: "a command the gate refuses",
      call: { kind: "execute", rawInput: { command: "rm -rf /" } },
      expected: "no",
    },
    {
      name: "a command the gate would rewrite: the agent would run the original",
      call: { kind: "execute", rawInput: { command: "npm run dev" } },
      expected: "no",
    },
    {
      name: "a command that names nothing to run",
      call: { kind: "execute", title: "Run `npm test`" },
      expected: "no",
    },
    {
      name: "an edit of the lane's own file, relative to the session",
      call: { kind: "edit", locations: [{ path: "src/a.ts" }] },
      expected: "once",
    },
    {
      name: "an edit that also touches a file outside the lane",
      call: { kind: "edit", locations: [{ path: "src/a.ts" }], rawInput: { path: "/etc/passwd" } },
      expected: "no",
    },
    { name: "an edit naming no file", call: { kind: "edit" }, expected: "no" },
    {
      name: "a crew tool",
      call: { title: "crew_report", rawInput: { status: "done" } },
      expected: "once",
    },
    {
      name: "a crew tool named by its server",
      call: { title: "crew: crew_board" },
      expected: "once",
    },
    { name: "a deploy", call: { kind: "other", title: "zerops: zerops_deploy" }, expected: "no" },
    {
      name: "a mode switch",
      call: { kind: "switch_mode", title: "Exit plan mode" },
      expected: "no",
    },
    { name: "thinking", call: { kind: "think" }, expected: "once" },
  ] as const)("$name", ({ call, expected }) =>
    Effect.gen(function* () {
      const answer = yield* decideAcpPermission(profile, request(call as never), CWD);
      expect(answer.outcome).toEqual({ outcome: "selected", optionId: expected });
    }),
  );

  it.effect("never picks an always option: a request offering only that is declined", () =>
    Effect.gen(function* () {
      const answer = yield* decideAcpPermission(
        profile,
        request({ kind: "execute", rawInput: { command: "npm test" } }, [OPTIONS[0]!]),
        CWD,
      );
      expect(answer.outcome).toEqual({ outcome: "cancelled" });
    }),
  );

  it.effect("a failing gate declines", () =>
    Effect.gen(function* () {
      const answer = yield* decideAcpPermission(
        { ...profile, decideTool: () => Effect.die("gate down") },
        request({ kind: "execute", rawInput: { command: "npm test" } }),
        CWD,
      );
      expect(answer.outcome).toEqual({ outcome: "selected", optionId: "no" });
    }),
  );
});

describe("acpGateCalls", () => {
  it.each([
    [
      { kind: "read", locations: [{ path: "/var/www/a.ts" }] },
      [{ toolName: "Read", input: { file_path: "/var/www/a.ts" } }],
    ],
    [{ kind: "search", rawInput: { pattern: "x" } }, [{ toolName: "Grep", input: { path: CWD } }]],
    [
      { kind: "execute", rawInput: { command: ["git", "commit", "-m", "a b"] } },
      [{ toolName: "Bash", input: { command: "git commit -m 'a b'" } }],
    ],
    [{ title: "mcp__zerops__zerops_logs" }, [{ toolName: "mcp__zerops__zerops_logs", input: {} }]],
    [{ title: "Running zerops_verify" }, [{ toolName: "mcp__zerops__zerops_verify", input: {} }]],
  ] as const)("shapes %j as the gate's calls", (call, expected) => {
    expect(acpGateCalls({ toolCallId: "c", ...(call as object) } as never, CWD)).toEqual(expected);
  });
});
