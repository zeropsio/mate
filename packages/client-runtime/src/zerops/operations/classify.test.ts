import { describe, expect, it } from "vite-plus/test";

import { TIMELINE_HIDDEN_TOOL_NAMES, classifyZeropsCall } from "./classify.ts";

describe("classifyZeropsCall — non-Zerops tools", () => {
  it("hides ToolSearch", () => {
    expect(classifyZeropsCall("ToolSearch", {}, "completed")).toBe("hidden");
  });

  it("hides Skill", () => {
    expect(classifyZeropsCall("Skill", { skill: "route" }, "completed")).toBe("hidden");
  });

  it("hides a failed ToolSearch — the failed-call override is zerops_*-only", () => {
    expect(classifyZeropsCall("ToolSearch", {}, "failed")).toBe("hidden");
  });

  it("is generic for an ordinary dev tool", () => {
    expect(classifyZeropsCall("Bash", { command: "ls" }, "completed")).toBe("generic");
  });
});

describe("classifyZeropsCall — zerops_workflow", () => {
  it("hides action=status", () => {
    expect(classifyZeropsCall("zerops_workflow", { action: "status" }, "completed")).toBe("hidden");
  });

  it("hides action=list", () => {
    expect(classifyZeropsCall("zerops_workflow", { action: "list" }, "completed")).toBe("hidden");
  });

  it("hides action=close-mode", () => {
    expect(
      classifyZeropsCall("zerops_workflow", { action: "close-mode", closeMode: {} }, "completed"),
    ).toBe("hidden");
  });

  it("hides the route-menu reply: start bootstrap with no route", () => {
    expect(
      classifyZeropsCall(
        "zerops_workflow",
        { action: "start", workflow: "bootstrap", intent: "New service" },
        "completed",
      ),
    ).toBe("hidden");
  });

  it("is a card for start bootstrap with a route", () => {
    expect(
      classifyZeropsCall(
        "zerops_workflow",
        { action: "start", workflow: "bootstrap", route: "classic" },
        "completed",
      ),
    ).toBe("card");
  });

  it("is a card for a bootstrap continuation (complete)", () => {
    expect(
      classifyZeropsCall("zerops_workflow", { action: "complete", step: "discover" }, "completed"),
    ).toBe("card");
  });

  it("is a card for a bootstrap continuation (skip)", () => {
    expect(
      classifyZeropsCall("zerops_workflow", { action: "skip", step: "provision" }, "completed"),
    ).toBe("card");
  });

  it("is a card for a bootstrap continuation (resume)", () => {
    expect(classifyZeropsCall("zerops_workflow", { action: "resume" }, "completed")).toBe("card");
  });

  it("is a card for a bootstrap continuation (reset)", () => {
    expect(classifyZeropsCall("zerops_workflow", { action: "reset" }, "completed")).toBe("card");
  });

  it("is generic for develop start", () => {
    expect(
      classifyZeropsCall(
        "zerops_workflow",
        { action: "start", workflow: "develop", intent: "write code" },
        "completed",
      ),
    ).toBe("generic");
  });

  it("is a card for a failed bootstrap start-with-route (error override)", () => {
    expect(
      classifyZeropsCall(
        "zerops_workflow",
        { action: "start", workflow: "bootstrap", route: "classic" },
        "failed",
      ),
    ).toBe("card");
  });

  it("is a card for a failed route-menu start — the hidden rule only applies when not failed", () => {
    expect(
      classifyZeropsCall(
        "zerops_workflow",
        { action: "start", workflow: "bootstrap", intent: "New service" },
        "failed",
      ),
    ).toBe("card");
  });

  it("is a card for a failed action=status — the hidden rule only applies when not failed", () => {
    expect(classifyZeropsCall("zerops_workflow", { action: "status" }, "failed")).toBe("card");
  });
});

describe("classifyZeropsCall — zerops_mount", () => {
  it("hides action=status", () => {
    expect(classifyZeropsCall("zerops_mount", { action: "status" }, "completed")).toBe("hidden");
  });

  it("is a card for a mutating action", () => {
    expect(
      classifyZeropsCall("zerops_mount", { action: "mount", hostname: "db" }, "completed"),
    ).toBe("card");
  });

  it("is a card for a failed mount status call — the failed override is zerops_*-wide", () => {
    expect(classifyZeropsCall("zerops_mount", { action: "status" }, "failed")).toBe("card");
  });
});

describe("classifyZeropsCall — mutating zerops_* tools are cards", () => {
  const cases: ReadonlyArray<[string, Record<string, unknown>]> = [
    ["zerops_deploy", { targetService: "weatherdash" }],
    ["zerops_deploy_batch", { targetServices: ["a", "b"] }],
    ["zerops_import", { content: "services: []" }],
    ["zerops_verify", { serviceHostname: "weatherdash" }],
    ["zerops_subdomain", { serviceHostname: "weatherdash", action: "enable" }],
    ["zerops_delete", { hostname: "old" }],
    ["zerops_scale", { hostname: "weatherdash" }],
    ["zerops_manage", { hostname: "weatherdash" }],
    ["zerops_env", { hostname: "weatherdash" }],
  ];
  for (const [toolName, input] of cases) {
    it(`is a card for ${toolName}`, () => {
      expect(classifyZeropsCall(toolName, input, "completed")).toBe("card");
    });
    it(`is a card for a failed ${toolName}`, () => {
      expect(classifyZeropsCall(toolName, input, "failed")).toBe("card");
    });
  }
});

describe("classifyZeropsCall — generic zerops_* tools", () => {
  const cases = [
    "zerops_discover",
    "zerops_knowledge",
    "zerops_events",
    "zerops_logs",
    "zerops_process",
    "zerops_yml_exists",
  ];
  for (const toolName of cases) {
    it(`is generic for ${toolName}`, () => {
      expect(classifyZeropsCall(toolName, {}, "completed")).toBe("generic");
    });
  }

  it("is a card when a generic zerops_* tool call fails", () => {
    expect(classifyZeropsCall("zerops_discover", {}, "failed")).toBe("card");
  });
});

describe("TIMELINE_HIDDEN_TOOL_NAMES", () => {
  it("names exactly ToolSearch and Skill", () => {
    expect([...TIMELINE_HIDDEN_TOOL_NAMES].sort()).toEqual(["Skill", "ToolSearch"]);
  });
});
