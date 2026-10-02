import { describe, expect, it } from "vite-plus/test";

import {
  isGenericPlatformError,
  pickProjectCreation,
  projectCreationFailureSentence,
  projectCreationOutcome,
  projectCreationsBy,
  projectProcessSearchBody,
  zcpCreationUnderWay,
} from "./projectCreation.ts";

/** A process item as `POST /process/search` answers it (measured 2026-09-16). */
function process(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: "proc-1",
    actionName: "project.create",
    status: "FINISHED",
    created: "2026-09-16T20:21:17.000Z",
    projectId: "proj-1",
    clientId: "org-1",
    error: null,
    ...overrides,
  };
}

describe("projectCreationOutcome", () => {
  it.each([
    { creation: undefined, kind: "running" },
    { creation: { processId: "p", status: "RUNNING", error: null }, kind: "running" },
    { creation: { processId: "p", status: "PENDING", error: null }, kind: "running" },
    { creation: { processId: "p", status: "FINISHED", error: null }, kind: "finished" },
  ] as const)("reads $creation as $kind", ({ creation, kind }) => {
    expect(projectCreationOutcome(creation)).toEqual({ kind });
  });

  it.each(["FAILED", "CANCELED"] as const)(
    "reads %s as failed with the platform's message",
    (status) => {
      expect(
        projectCreationOutcome({
          processId: "p",
          status,
          error: { code: "internalServerError", message: "unexpected internal server error" },
        }),
      ).toEqual({ kind: "failed", status, message: "unexpected internal server error" });
    },
  );

  it("has no message for a failure the platform said nothing about", () => {
    expect(projectCreationOutcome({ processId: "p", status: "FAILED", error: null })).toEqual({
      kind: "failed",
      status: "FAILED",
      message: undefined,
    });
    expect(
      projectCreationOutcome({
        processId: "p",
        status: "FAILED",
        error: { code: "x", message: "  " },
      }),
    ).toMatchObject({ message: undefined });
  });
});

describe("projectCreationFailureSentence", () => {
  it("says the platform's message when there is one, and the status when there is not", () => {
    expect(
      projectCreationFailureSentence({
        kind: "failed",
        status: "FAILED",
        message: "quota reached",
      }),
    ).toBe("quota reached");
    expect(
      projectCreationFailureSentence({ kind: "failed", status: "CANCELED", message: undefined }),
    ).toBe("Zerops reported the project's creation as CANCELED.");
  });
});

describe("isGenericPlatformError", () => {
  it("recognises the platform's empty internal error and nothing else", () => {
    expect(isGenericPlatformError("unexpected internal server error")).toBe(true);
    expect(isGenericPlatformError(" Unexpected internal server error ")).toBe(true);
    expect(isGenericPlatformError("project name is taken")).toBe(false);
  });
});

describe("projectProcessSearchBody", () => {
  it("searches one project's processes in one org, newest first", () => {
    expect(projectProcessSearchBody({ clientId: "org-1", projectId: "proj-1" })).toEqual({
      search: [
        { name: "clientId", operator: "eq", value: "org-1" },
        { name: "projectId", operator: "eq", value: "proj-1" },
      ],
      sort: [{ name: "created", ascending: false }],
      limit: 20,
    });
  });
});

describe("pickProjectCreation", () => {
  it("answers nothing when no project.create has appeared yet", () => {
    expect(pickProjectCreation([], "proj-1")).toBeUndefined();
    expect(
      pickProjectCreation([process({ actionName: "stack.build", status: "FAILED" })], "proj-1"),
    ).toBeUndefined();
  });

  it("takes the newest project.create of that project, whatever the order", () => {
    const items = [
      process({ id: "old", status: "FAILED", created: "2026-09-16T19:00:00.000Z" }),
      process({ id: "other", projectId: "proj-2", created: "2026-09-16T21:00:00.000Z" }),
      process({ id: "new", status: "FINISHED", created: "2026-09-16T20:21:18.151Z" }),
      process({ id: "build", actionName: "stack.build", created: "2026-09-16T20:21:19.000Z" }),
    ];
    expect(pickProjectCreation(items, "proj-1")).toEqual({
      processId: "new",
      status: "FINISHED",
      error: null,
    });
  });

  it("carries the platform's error and skips items with no id or status", () => {
    const items = [
      process({ id: "", status: "FAILED" }),
      process({
        id: "failed",
        status: "FAILED",
        error: {
          code: "internalServerError",
          message: "unexpected internal server error",
          meta: [],
        },
      }),
    ];
    expect(pickProjectCreation(items, "proj-1")).toEqual({
      processId: "failed",
      status: "FAILED",
      error: { code: "internalServerError", message: "unexpected internal server error" },
    });
    expect(
      pickProjectCreation([null, 3, "x", { actionName: "project.create" }], "proj-1"),
    ).toBeUndefined();
  });
});

// A Mate's key is regenerated only where no container holds it: a zcp the platform is still
// creating does, though the services listing may not say so yet (pass 28 review).
describe("zcpCreationUnderWay", () => {
  const step = (actionName: string, status: string, names: ReadonlyArray<string>) => ({
    id: `pr-${actionName}-${status}`,
    actionName,
    status,
    serviceStacks: names.map((name) => ({ name })),
  });
  it.each([
    { case: "nothing running", items: [], want: false },
    { case: "a zcp being created", items: [step("stack.create", "RUNNING", ["zcp"])], want: true },
    {
      case: "a second zcp pending",
      items: [step("stack.create", "PENDING", ["zcp1"])],
      want: true,
    },
    {
      case: "a zcp created already",
      items: [step("stack.create", "FINISHED", ["zcp"])],
      want: false,
    },
    {
      case: "a database being created",
      items: [step("stack.create", "RUNNING", ["db"])],
      want: false,
    },
    { case: "a zcp being built", items: [step("stack.build", "RUNNING", ["zcp"])], want: false },
    {
      case: "an answer it cannot read",
      items: [null, "x", { actionName: "stack.create" }],
      want: false,
    },
  ])("$case: $want", ({ items, want }) => {
    expect(zcpCreationUnderWay(items)).toBe(want);
  });
});

describe("projectCreationsBy — who created which project, as its creation's process says", () => {
  it("names each project.create's project and the person who started it, and nothing else", () => {
    const items = [
      process({
        id: "p1",
        created: "2026-10-02T05:00:00.000Z",
        project: { id: "hq1", name: "Headquarters" },
        createdByUser: { type: "USER", id: "u-ada" },
      }),
      process({
        id: "p2",
        actionName: "project.delete",
        project: { id: "hq0", name: "Headquarters" },
      }),
      // A creation no person started names nobody.
      process({ id: "p3", project: { id: "x", name: "x" }, createdByUser: null }),
      process({ id: "p4", project: undefined }),
      "noise",
    ];
    expect(projectCreationsBy(items)).toEqual([
      {
        projectId: "hq1",
        projectName: "Headquarters",
        createdAt: Date.parse("2026-10-02T05:00:00.000Z"),
        createdByUserId: "u-ada",
      },
      {
        projectId: "x",
        projectName: "x",
        createdAt: Date.parse("2026-09-16T20:21:17.000Z"),
        createdByUserId: undefined,
      },
    ]);
  });
});
