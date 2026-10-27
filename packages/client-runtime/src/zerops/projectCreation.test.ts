import { describe, expect, it } from "vite-plus/test";

import {
  isGenericPlatformError,
  projectCreationFailureSentence,
  projectCreationOutcome,
  projectProcessSearchBody,
  zcpCreationUnderWay,
} from "./projectCreation.ts";

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
