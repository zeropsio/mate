import { readRestart, NO_RESTARTS } from "../../../data/projections/restart.ts";
import { describe, expect, it } from "vite-plus/test";

import type { ZeropsCall } from "../types.ts";
import { buildSimpleFields } from "./simple.ts";

function simpleCall(
  toolName: string,
  status: ZeropsCall["status"],
  result: unknown | undefined,
): ZeropsCall {
  return {
    id: "c1",
    turnId: "t1",
    toolName,
    input: { serviceHostname: "apidev" },
    status,
    ...(result === undefined ? {} : { resultText: JSON.stringify(result) }),
    truncated: false,
    startedAt: "2026-09-01T00:00:00.000Z",
    anchorActivityId: "a1",
    ...(status === "inProgress" ? {} : { settledAt: "2026-09-01T00:00:30.000Z" }),
    rowIds: new Set(["a1"]),
    agentInternal: false,
  };
}

const proc = (status: string, failReason?: string) => ({
  id: "proc-1",
  actionName: "stack.scale",
  status,
  created: "2026-09-01T00:00:01Z",
  ...(failReason === undefined ? {} : { failReason }),
});

describe("buildSimpleFields — why a delete / scale / manage / env failed or timed out", () => {
  it.each([
    {
      name: "none while it runs",
      kind: "scale" as const,
      call: simpleCall("zerops_scale", "inProgress", undefined),
      expected: undefined,
    },
    {
      name: "none when the process finished",
      kind: "scale" as const,
      call: simpleCall("zerops_scale", "completed", { process: proc("FINISHED") }),
      expected: undefined,
    },
    {
      name: "the platform's reason for a process that failed",
      kind: "scale" as const,
      call: simpleCall("zerops_scale", "completed", {
        process: proc("FAILED", "quota exceeded"),
        message: "Scaling apidev",
      }),
      expected: { reason: "quota exceeded" },
    },
    {
      name: "the message of a process zcp stopped waiting for",
      kind: "scale" as const,
      call: simpleCall("zerops_scale", "completed", {
        process: proc("RUNNING"),
        timedOut: true,
        message: "Scale still running after 5m",
      }),
      expected: { reason: "Scale still running after 5m" },
    },
    {
      name: "delete's own warning when it timed out",
      kind: "delete" as const,
      call: simpleCall("zerops_delete", "completed", {
        process: proc("RUNNING"),
        timedOut: true,
        warning: "Delete not confirmed yet",
      }),
      expected: { reason: "Delete not confirmed yet" },
    },
    {
      name: "the error of a call that failed outright",
      kind: "manage" as const,
      call: simpleCall("zerops_manage", "failed", {
        code: "SERVICE_NOT_FOUND",
        error: "Service apidev not found\ndetails",
      }),
      expected: { reason: "Service apidev not found" },
    },
  ])("$name", ({ kind, call, expected }) => {
    expect(buildSimpleFields(kind, call).explanation).toEqual(expected);
  });
});

describe("buildSimpleFields — what an env call changed and where, by its input", () => {
  const envCall = (input: Record<string, unknown>, status: ZeropsCall["status"] = "completed") => ({
    ...simpleCall(
      "zerops_env",
      status,
      status === "inProgress" ? undefined : { process: proc("FINISHED") },
    ),
    input,
  });
  it.each([
    {
      name: "the project's variables, counted",
      input: { action: "set", project: true, variables: ["A=1", "B=2", "C=3"] },
      subject: "the project",
      envChange: { action: "set", scope: "project", count: 3 },
      target: undefined,
    },
    {
      name: "a stringified project flag still names the project",
      input: { action: "delete", project: "true", variables: ["A"] },
      subject: "the project",
      envChange: { action: "delete", scope: "project", count: 1 },
      target: undefined,
    },
    {
      name: "a service's variables, by its name",
      input: { action: "set", serviceHostname: "apidev", variables: ["A=1", "B=2"] },
      subject: "apidev",
      envChange: { action: "set", scope: "service", service: "apidev", count: 2 },
      target: { hostname: "apidev" },
    },
    {
      name: "the count the live step relays in place of the variables",
      input: { action: "set", project: "true", variablesCount: "6" },
      subject: "the project",
      envChange: { action: "set", scope: "project", count: 6 },
      target: undefined,
    },
    {
      name: "a project flag in any case",
      input: { action: "set", project: "TRUE", variables: ["A=1"] },
      subject: "the project",
      envChange: { action: "set", scope: "project", count: 1 },
      target: undefined,
    },
    {
      name: "no service named: no service to observe",
      input: { action: "set", variables: ["A=1"] },
      subject: "the service",
      envChange: { action: "set", scope: "service", count: 1 },
      target: undefined,
    },
    {
      name: "a read names no count",
      input: { action: "get", project: true },
      subject: "the project",
      envChange: { action: "get", scope: "project" },
      target: undefined,
    },
    {
      name: "a .env written from a setup block",
      input: { action: "generate-dotenv", setup: "dev" },
      subject: "dev",
      envChange: { action: "dotenv", scope: "service", service: "dev" },
      target: undefined,
    },
    {
      name: "an action it does not know",
      input: { serviceHostname: "apidev" },
      subject: "apidev",
      envChange: { action: "update", scope: "service", service: "apidev" },
      target: { hostname: "apidev" },
    },
  ])("$name", ({ input, subject, envChange, target }) => {
    const fields = buildSimpleFields("env", envCall(input));
    expect(fields.subject).toBe(subject);
    expect(fields.envChange).toEqual(envChange);
    expect(fields.target).toEqual(target);
  });

  it("never carries a value it was given", () => {
    const secret = ["s3", "cr", "et-value"].join("");
    const fields = buildSimpleFields(
      "env",
      envCall({ action: "set", project: true, variables: [`TOKEN=${secret}`] }, "inProgress"),
    );
    expect(JSON.stringify(fields)).not.toContain(secret);
    expect(fields.voice).toBe("Setting one of the project's variables.");
  });
});

// zcp returns success for a `generate-dotenv` that wrote nothing — a preview,
// and a refusal by its safety gate (`internal/ops/env_generate.go`): neither
// reads as "Wrote the .env" (pass 43).
describe("buildSimpleFields — a .env that was not written says so", () => {
  const dotenvCall = (input: Record<string, unknown>, result: Record<string, unknown>) => ({
    ...simpleCall("zerops_env", "completed", result),
    input,
  });
  const written = { path: "/var/www/.env", setup: "dev", services: 1, variables: 4 };
  it.each([
    {
      name: "written",
      input: { action: "generate-dotenv", setup: "dev" },
      result: written,
      envChange: { action: "dotenv", scope: "service", service: "dev" },
    },
    {
      name: "a preview reads as a read, from its input",
      input: { action: "generate-dotenv", setup: "dev", preview: "True" },
      result: { ...written, preview: true },
      envChange: { action: "dotenvPreview", scope: "service", service: "dev" },
    },
    {
      name: "a refusal, and how many of its variables were set by hand",
      input: { action: "generate-dotenv", setup: "dev" },
      result: { ...written, refused: true, diff: { unowned: ["LOCAL_A", "LOCAL_B"] } },
      envChange: { action: "dotenv", scope: "service", service: "dev", refused: 2 },
    },
  ])("$name", ({ input, result, envChange }) => {
    expect(buildSimpleFields("env", dotenvCall(input, result)).envChange).toEqual(envChange);
  });
});

describe("buildSimpleFields — a call that names no service observes none", () => {
  it.each(["delete", "scale", "manage"] as const)("%s", (kind) => {
    const fields = buildSimpleFields(kind, {
      ...simpleCall(`zerops_${kind}`, "completed", { process: proc("FINISHED") }),
      input: {},
    });
    expect(fields.subject).toBe("the service");
    expect(fields.target).toBeUndefined();
  });
});

// zcp's error for an entry with no "=" repeats the entry whole
// (`internal/ops/helpers.go`): a bare secret an agent passed would reach the
// line and the card. An env call's failure never carries an entry's text.
describe("buildSimpleFields — an env call's failure never carries an entry", () => {
  const secret = ["sk", "_live_", "abc123xyz"].join("");
  const failed = (variables: ReadonlyArray<string>, result: Record<string, unknown>) => ({
    ...simpleCall("zerops_env", "failed", result),
    input: { action: "set", project: true, variables },
  });
  it.each([
    {
      name: "an entry with no '='",
      call: failed([secret], {
        code: "INVALID_ENV_FORMAT",
        error: `Invalid format '${secret}', expected KEY=value`,
      }),
      reason: "An entry wasn't KEY=value",
    },
    {
      name: "any other error that repeats a value",
      call: failed([`TOKEN=${secret}`], {
        code: "API_ERROR",
        error: `The platform rejected ${secret}\nmore`,
      }),
      reason: "Its variables were refused",
    },
    {
      name: "an error that repeats none keeps its own line",
      call: failed([`TOKEN=${secret}`], { code: "API_ERROR", error: "Project not found\nmore" }),
      reason: "Project not found",
    },
  ])("$name", ({ call, reason }) => {
    const fields = buildSimpleFields("env", call);
    expect(fields.explanation?.reason).toBe(reason);
    expect(JSON.stringify(fields)).not.toContain(secret);
  });
});

// zcp's `zerops_env action=request` asks the person for a value only they
// have (`internal/tools/env.go`): the card reads what was asked off the input
// and zcp's answer — never a value, there is none.
describe("buildSimpleFields — a request for a vault value", () => {
  const requestCall = (
    input: Record<string, unknown>,
    result: Record<string, unknown> | undefined,
    status: ZeropsCall["status"] = "completed",
  ) => ({ ...simpleCall("zerops_env", status, result), input });
  it.each([
    {
      name: "a Shared secret, sensitive as zcp answered",
      input: {
        action: "request",
        key: "STRIPE_KEY",
        project: true,
        reason: "Stripe charges cards.",
      },
      result: { requested: { key: "STRIPE_KEY", scope: "shared", sensitive: true } },
      envChange: {
        action: "request",
        scope: "project",
        request: {
          key: "STRIPE_KEY",
          sensitive: true,
          reason: "Stripe charges cards.",
          alreadySet: false,
        },
      },
    },
    {
      name: "a service's plain value, the answer's flag over the name",
      input: { action: "request", key: "PUBLIC_KEY", serviceHostname: "apidev" },
      result: {
        requested: {
          key: "PUBLIC_KEY",
          scope: "service",
          serviceHostname: "apidev",
          sensitive: false,
        },
      },
      envChange: {
        action: "request",
        scope: "service",
        service: "apidev",
        request: { key: "PUBLIC_KEY", sensitive: false, alreadySet: false },
      },
    },
    {
      name: "already in the vault: nothing was asked",
      input: { action: "request", key: "OPENAI_API_KEY", project: "true" },
      result: {
        alreadySet: { key: "OPENAI_API_KEY", scope: "shared", sensitive: true, alreadySet: true },
      },
      envChange: {
        action: "request",
        scope: "project",
        request: { key: "OPENAI_API_KEY", sensitive: true, alreadySet: true },
      },
    },
    {
      name: "while it runs, the input's flag, else the name",
      input: { action: "request", key: "DB_PASSWORD", project: true },
      result: undefined,
      status: "inProgress" as const,
      envChange: {
        action: "request",
        scope: "project",
        request: { key: "DB_PASSWORD", sensitive: true, alreadySet: false },
      },
    },
    {
      name: "a request naming no key asks for nothing",
      input: { action: "request", project: true },
      result: undefined,
      status: "failed" as const,
      envChange: { action: "request", scope: "project" },
    },
  ])("$name", ({ input, result, status, envChange }) => {
    expect(buildSimpleFields("env", requestCall(input, result, status)).envChange).toEqual(
      envChange,
    );
  });
});

it("a restart result retains process identity and uses calm failure words after reload", () => {
  const fields = buildSimpleFields(
    "manage",
    simpleCall("zerops_manage", "completed", {
      process: {
        ...proc("FAILED", "serviceStack private-id broke"),
        actionName: "stack.restart",
        created: "2026-09-01T00:00:00Z",
        finished: "2026-09-01T00:15:00Z",
      },
    }),
  );
  expect(fields).toMatchObject({
    processIds: ["proc-1"],
    phaseOverride: "failed",
    statusWord: "Failed",
    closing: "Zerops couldn't restart apidev after 15 min — platform error.",
  });
  expect(fields.explanation).toBeUndefined();
});

it("a history baseline behind a failed restart result cannot put it back in progress", () => {
  const process = {
    id: "proc-1",
    actionName: "stack.restart",
    status: "FAILED",
    created: "2026-09-01T00:00:01Z",
  };
  expect(
    buildSimpleFields("manage", simpleCall("zerops_manage", "completed", { process }), {
      projectId: "p",
      builds: () => "unobservable",
      restarts: (source) =>
        readRestart(
          {
            ...NO_RESTARTS,
            processes: { [process.id]: { ...process, status: "RUNNING" } },
            running: [process.id],
          },
          source,
        ),
    }),
  ).toMatchObject({ phaseOverride: "failed", statusWord: "Failed", steps: [{ state: "failed" }] });
});

it("a timed-out restart missing from owner history is unconfirmed, never actively restarting", () => {
  const fields = buildSimpleFields(
    "manage",
    simpleCall("zerops_manage", "completed", {
      process: { ...proc("RUNNING"), actionName: "stack.restart" },
      timedOut: true,
    }),
    {
      projectId: "p",
      builds: () => "unobservable",
      restarts: (source) => readRestart(NO_RESTARTS, source),
    },
  );
  expect(fields.phaseOverride).toBe("uncertain");
  expect(fields.statusWord).toBe("Restart unconfirmed");
  expect(fields.closing).toBe(
    "Zerops last reported apidev restarting. Its outcome is unconfirmed.",
  );
});

it("an accepted restart whose observation ended keeps its acceptance and names the owner's next action", () => {
  const source = { ...proc("RUNNING"), actionName: "stack.restart" };
  const fields = buildSimpleFields(
    "manage",
    simpleCall("zerops_manage", "completed", { process: source }),
    {
      projectId: "p",
      builds: () => "unobservable",
      restarts: () => ({
        sourceProcessId: source.id,
        process: source,
        phase: "uncertain",
        requestId: "retry",
        progress: {
          stage: "unresolved",
          operationId: "retry",
          nextActor: "you",
          nextAction: "Check the process in Zerops.",
        },
      }),
    },
  );
  expect(fields.closing).toBe(
    "Zerops accepted the restart. Its outcome is unconfirmed. Check the process in Zerops.",
  );
});
