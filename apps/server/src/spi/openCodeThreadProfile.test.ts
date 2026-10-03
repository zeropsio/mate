import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  decideOpenCodePermission,
  type OpenCodePermissionAsk,
  type OpenCodeToolInput,
  openCodeGateCalls,
} from "./openCodeThreadProfile.ts";
import type { ThreadToolProfile, ToolDecision } from "./threadToolPolicy.ts";

const CWD = "/var/www/.crew/backend";
const SERVER = "crew-0123456789";

const decide = (call: { readonly toolName: string; readonly input: unknown }): ToolDecision => {
  const input = call.input as Record<string, unknown>;
  if (call.toolName.startsWith("mcp__crew__")) return { kind: "allow" };
  if (call.toolName === "mcp__zerops__zerops_logs") return { kind: "allow" };
  if (call.toolName === "Bash" && input.command === "npm test") return { kind: "allow" };
  if (call.toolName === "Bash" && input.command === "npm run dev") {
    return { kind: "allow", updatedInput: { command: "ssh appdev 'npm run dev'" } };
  }
  if (["Edit", "Read"].includes(call.toolName) && String(input.file_path).startsWith(CWD)) {
    return { kind: "allow" };
  }
  if (call.toolName === "Grep" || call.toolName === "Glob") return { kind: "allow" };
  return { kind: "deny", reason: "no" };
};

const profile: ThreadToolProfile = {
  sessionContext: "",
  contextWindow: 1,
  decideTool: (call) => Effect.succeed(decide(call)),
  tools: [],
};

const ask = (fields: Partial<OpenCodePermissionAsk> & Pick<OpenCodePermissionAsk, "permission">) =>
  ({ id: "per_1", patterns: ["*"], metadata: {}, ...fields }) as OpenCodePermissionAsk;
const call = (tool: string, input: Record<string, unknown>): OpenCodeToolInput => ({ tool, input });

describe("decideOpenCodePermission", () => {
  it.effect.each([
    {
      name: "a command the gate allows, from the call's input",
      ask: ask({ permission: "bash", patterns: ["npm test"] }),
      call: call("bash", { command: "npm test" }),
      expected: "once",
    },
    {
      name: "a command from the ask's own metadata when no call was seen",
      ask: ask({ permission: "bash", metadata: { command: "npm test" } }),
      call: undefined,
      expected: "once",
    },
    {
      name: "a command run in another directory",
      ask: ask({ permission: "bash" }),
      call: call("bash", { command: "npm test", workdir: "/etc" }),
      expected: "reject",
    },
    {
      name: "a command the gate would rewrite",
      ask: ask({ permission: "bash" }),
      call: call("bash", { command: "npm run dev" }),
      expected: "reject",
    },
    {
      name: "an edit of the lane's file",
      ask: ask({ permission: "edit", metadata: { filepath: `${CWD}/src/a.ts` } }),
      call: undefined,
      expected: "once",
    },
    {
      name: "a patch touching a file outside the lane",
      ask: ask({ permission: "edit", patterns: ["src/a.ts", "../../etc/x"] }),
      call: undefined,
      expected: "reject",
    },
    {
      name: "a read of the lane's file",
      ask: ask({ permission: "read", patterns: ["src/a.ts"] }),
      call: undefined,
      expected: "once",
    },
    {
      name: "a crew tool on this thread's server",
      ask: ask({ permission: `${SERVER}_crew_report` }),
      call: call(`${SERVER}_crew_report`, { status: "done" }),
      expected: "once",
    },
    {
      name: "a crew tool on another thread's server",
      ask: ask({ permission: "crew-9999999999_crew_report" }),
      call: undefined,
      expected: "reject",
    },
    {
      name: "a Zerops tool the gate allows",
      ask: ask({ permission: "zerops_zerops_logs" }),
      call: call("zerops_zerops_logs", { serviceHostname: "appdev" }),
      expected: "once",
    },
    {
      name: "a question for the person",
      ask: ask({ permission: "question" }),
      call: undefined,
      expected: "reject",
    },
    {
      name: "a doom loop",
      ask: ask({ permission: "doom_loop" }),
      call: undefined,
      expected: "reject",
    },
  ])("$name", ({ ask, call, expected }) =>
    Effect.gen(function* () {
      expect(yield* decideOpenCodePermission(profile, ask, call, CWD, SERVER)).toBe(expected);
    }),
  );

  it.effect("a failing gate rejects", () =>
    Effect.gen(function* () {
      expect(
        yield* decideOpenCodePermission(
          { ...profile, decideTool: () => Effect.die("down") },
          ask({ permission: "bash" }),
          call("bash", { command: "npm test" }),
          CWD,
          SERVER,
        ),
      ).toBe("reject");
    }),
  );
});

describe("openCodeGateCalls", () => {
  it("reads an outside directory as a read of it", () => {
    expect(
      openCodeGateCalls(
        ask({ permission: "external_directory", patterns: ["/srv/shared/*"] }),
        undefined,
        CWD,
        SERVER,
      ),
    ).toEqual([{ toolName: "Read", input: { file_path: "/srv/shared" } }]);
  });
});
