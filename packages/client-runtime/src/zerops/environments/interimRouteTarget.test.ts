import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ZeropsProject } from "../api.ts";
import type { ZeropsCandidate } from "../candidates.ts";
import { selectRouteGate, type RouteTarget } from "./gate.ts";
import { interimRouteTarget, type InterimRouteInput } from "./interimRouteTarget.ts";

const ORIGIN = "https://zcp-1-abc.prg1.zerops.app";
const OTHER_ORIGIN = "https://zcp-2-abc.prg1.zerops.app";
const ENV_A = EnvironmentId.make("env-a");

const project = (status = "ACTIVE"): ZeropsProject =>
  ({ id: "project-1", name: "shop", status }) as ZeropsProject;

const mate = (serviceStatus = "ACTIVE", origin: string | null = ORIGIN): ZeropsCandidate => ({
  key: "project-1:service-1",
  project: project(),
  group: origin === null ? "provisioning" : "ready",
  service: { id: "service-1", name: "zcp", status: serviceStatus },
  ...(origin === null ? {} : { containerOrigin: origin }),
});

const otherMate: ZeropsCandidate = {
  key: "project-2:service-2",
  project: { id: "project-2", name: "blog", status: "ACTIVE" } as ZeropsProject,
  group: "ready",
  service: { id: "service-2", name: "zcp", status: "ACTIVE" },
  containerOrigin: OTHER_ORIGIN,
};

const input = (overrides: Partial<InterimRouteInput> = {}): InterimRouteInput => ({
  environmentId: ENV_A,
  registration: null,
  recordKey: null,
  candidates: [otherMate],
  exchangePending: () => false,
  restoring: false,
  organization: "chosen",
  content: "empty",
  ...overrides,
});

const CONNECTED = { origin: ORIGIN, connection: "connected" } as const;
const RECONNECTING = { origin: ORIGIN, connection: "reconnecting" } as const;

/** What today's shell holds, and the target the gate reads from it. */
const ROWS: ReadonlyArray<{
  readonly name: string;
  readonly input: InterimRouteInput;
  readonly target: RouteTarget;
}> = [
  {
    name: "a registration, connected, on an ACTIVE Mate is ready",
    input: input({ registration: CONNECTED, recordKey: mate().key, candidates: [mate()] }),
    target: { kind: "resolved", reachability: { kind: "ready", notice: null }, content: "empty" },
  },
  {
    name: "a registration is ready before the inventory is known",
    input: input({ registration: CONNECTED, candidates: null, content: "live" }),
    target: { kind: "resolved", reachability: { kind: "ready", notice: null }, content: "live" },
  },
  {
    name: "a registration found by origin alone, before its record is written",
    input: input({ registration: CONNECTED, candidates: [mate()] }),
    target: { kind: "resolved", reachability: { kind: "ready", notice: null }, content: "empty" },
  },
  {
    name: "platform RESTARTING while connected is ready with a restart notice",
    input: input({
      registration: CONNECTED,
      recordKey: mate().key,
      candidates: [mate("RESTARTING", null)],
      content: "live",
    }),
    target: {
      kind: "resolved",
      reachability: {
        kind: "ready",
        notice: { level: "restarting", by: "platform", overdue: false },
      },
      content: "live",
    },
  },
  {
    name: "platform RESTARTING after the link dropped is the restarting container",
    input: input({
      registration: RECONNECTING,
      recordKey: mate().key,
      candidates: [mate("RESTARTING", null)],
      content: "cached",
    }),
    target: {
      kind: "resolved",
      reachability: {
        kind: "container",
        container: { level: "restarting", by: "platform", overdue: false },
      },
      content: "cached",
    },
  },
  {
    name: "a stopped Mate with a dropped link is inactive, never unavailable",
    input: input({
      registration: RECONNECTING,
      recordKey: mate().key,
      candidates: [mate("STOPPED", null)],
      content: "cached",
    }),
    target: {
      kind: "resolved",
      reachability: { kind: "container", container: { level: "inactive", status: "STOPPED" } },
      content: "cached",
    },
  },
  {
    name: "a project whose services could not be read stands in for its Mate",
    input: input({
      registration: RECONNECTING,
      recordKey: mate().key,
      candidates: [{ key: "project-1", project: project(), group: "unavailable" }],
      content: "cached",
    }),
    target: { kind: "resolved", reachability: { kind: "reconnecting" }, content: "cached" },
  },
  {
    name: "a registration with a blocked link reconnects",
    input: input({
      registration: { origin: ORIGIN, connection: "error" },
      recordKey: mate().key,
      candidates: [mate()],
    }),
    target: { kind: "resolved", reachability: { kind: "reconnecting" }, content: "empty" },
  },
  {
    name: "a remembered target with its exchange running is connecting",
    input: input({
      recordKey: mate().key,
      candidates: [mate()],
      exchangePending: (origin) => origin === ORIGIN,
    }),
    target: {
      kind: "resolved",
      reachability: { kind: "connecting", waitingOn: "exchange" },
      content: "empty",
    },
  },
  {
    name: "a remembered target before the inventory is known is resolving",
    input: input({ recordKey: mate().key, candidates: null }),
    target: { kind: "resolved", reachability: { kind: "resolving" }, content: "empty" },
  },
  {
    name: "a remembered target whose project the known inventory no longer lists is not in your projects",
    input: input({ recordKey: mate().key, candidates: [otherMate] }),
    target: { kind: "unresolved", discovery: "settled" },
  },
  {
    name: "a remembered target whose project has no Mate container left is not in your projects",
    input: input({
      recordKey: mate().key,
      candidates: [
        { key: "project-1", project: project(), group: "unavailable", missingContainer: true },
      ],
    }),
    target: { kind: "unresolved", discovery: "settled" },
  },
  {
    name: "an unknown environment before the inventory is known is pending",
    input: input({ candidates: null }),
    target: { kind: "unresolved", discovery: "pending" },
  },
  {
    name: "an unknown environment while remembered targets restore is pending",
    input: input({ restoring: true }),
    target: { kind: "unresolved", discovery: "pending" },
  },
  {
    name: "an unknown environment while the organization is still being restored is pending",
    input: input({ organization: "choosing", candidates: null }),
    target: { kind: "unresolved", discovery: "pending" },
  },
  {
    name: "an unknown environment with no organization chosen asks for one",
    input: input({ organization: "not-chosen", candidates: [] }),
    target: { kind: "unresolved", discovery: "no-organization" },
  },
  {
    name: "a registration with no organization chosen is still its own target",
    input: input({ organization: "not-chosen", registration: CONNECTED, candidates: [] }),
    target: { kind: "resolved", reachability: { kind: "ready", notice: null }, content: "empty" },
  },
  {
    name: "an unknown environment once the inventory is known and nothing runs is settled",
    input: input(),
    target: { kind: "unresolved", discovery: "settled" },
  },
];

describe("interimRouteTarget", () => {
  it.each(ROWS)("$name", ({ input: observed, target }) => {
    expect(interimRouteTarget(observed)).toEqual(target);
  });

  it("is never 'not in your projects' while an exchange is pending", () => {
    const pending = input({ exchangePending: (origin) => origin === OTHER_ORIGIN });

    expect(interimRouteTarget(pending)).toEqual({ kind: "unresolved", discovery: "pending" });
    expect(selectRouteGate(interimRouteTarget(pending)).kind).toBe("wait");
  });
});
