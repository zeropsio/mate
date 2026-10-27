import * as NodeAssert from "node:assert/strict";

import * as RegExpUtils from "effect/RegExp";
import { describe, it } from "vite-plus/test";

import { buildOpenCodePermissionRules, toOpenCodePermissionReply } from "./opencodeRuntime.ts";

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

describe("buildOpenCodePermissionRules", () => {
  it("pre-approves edits once the user has chosen to auto-accept them", () => {
    NodeAssert.equal(actionFor("auto-accept-edits", "edit"), "allow");
  });

  it("still asks before editing when approval is required", () => {
    NodeAssert.equal(actionFor("approval-required", "edit"), "ask");
  });

  // OpenCode has no AI reviewer, so "auto" keeps supervised approval.
  it("leaves auto asking, as the docs say it does without a reviewer", () => {
    NodeAssert.equal(actionFor("auto", "edit"), "ask");
  });

  it("allows workspace reads and task updates without asking in supervised modes", () => {
    for (const runtimeMode of ["approval-required", "auto-accept-edits", "auto"] as const) {
      for (const permission of ["read", "glob", "grep", "lsp", "skill", "todowrite"]) {
        NodeAssert.equal(actionFor(runtimeMode, permission, "src/index.ts"), "allow");
      }
    }
  });

  it("preserves OpenCode's environment-file approval rules", () => {
    for (const runtimeMode of ["approval-required", "auto-accept-edits", "auto"] as const) {
      for (const target of [
        ".env",
        ".env.local",
        "config/service.env",
        "config/service.env.local",
      ]) {
        NodeAssert.equal(actionFor(runtimeMode, "read", target), "ask");
      }
      for (const target of [".env.example", "config/service.env.example"]) {
        NodeAssert.equal(actionFor(runtimeMode, "read", target), "allow");
      }
    }
  });

  // zcp pre-approves its own tools for every agent (Claude's mcp__zerops__*,
  // Cursor's Mcp(zerops:*), OpenCode's config). A session's rules override
  // OpenCode's config file, so the allowance has to be here too.
  it("lets the Zerops tools run without asking, as zcp sets them up for every agent", () => {
    for (const runtimeMode of ["approval-required", "auto-accept-edits", "auto"] as const) {
      NodeAssert.equal(actionFor(runtimeMode, "zerops_zerops_discover"), "allow");
      NodeAssert.equal(actionFor(runtimeMode, "zeropsish_tool"), "ask");
    }
  });

  it("still asks before commands, network access, external directories and unknown tools", () => {
    for (const runtimeMode of ["approval-required", "auto-accept-edits", "auto"] as const) {
      NodeAssert.equal(actionFor(runtimeMode, "bash"), "ask");
      NodeAssert.equal(actionFor(runtimeMode, "webfetch"), "ask");
      NodeAssert.equal(actionFor(runtimeMode, "websearch"), "ask");
      NodeAssert.equal(actionFor(runtimeMode, "external_directory"), "ask");
      NodeAssert.equal(actionFor(runtimeMode, "doom_loop"), "ask");
      NodeAssert.equal(actionFor(runtimeMode, "custom_tool"), "ask");
    }
  });

  it("allows everything only under full access", () => {
    NodeAssert.deepEqual(buildOpenCodePermissionRules("full-access"), [
      { permission: "*", pattern: "*", action: "allow" },
      { permission: "external_directory", pattern: "*", action: "allow" },
    ]);
  });
});

describe("toOpenCodePermissionReply", () => {
  it.each([
    ["accept", "once"],
    ["acceptForSession", "always"],
    ["acceptAlways", "always"],
    ["decline", "reject"],
    ["cancel", "reject"],
  ] as const)("maps %s to %s", (decision, reply) => {
    NodeAssert.equal(toOpenCodePermissionReply(decision), reply);
  });
});
