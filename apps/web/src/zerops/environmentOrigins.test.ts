import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { registeredZeropsOrigins, rowEnvironment } from "./environmentOrigins";

const ORIGIN = "https://zcp-1a2b-8080.prg1.zerops.example";
const ENV = EnvironmentId.make("env-wren");
const OTHER = EnvironmentId.make("env-other");

const row = (patch: Partial<ZeropsCandidate>): ZeropsCandidate => ({
  key: "proj-wren:zcp",
  project: { id: "proj-wren", name: "Beviro - Wren", status: "ACTIVE", tagList: ["mate"] },
  group: "ready",
  service: { id: "zcp", name: "zcp", status: "ACTIVE" },
  ...patch,
});

describe("rowEnvironment — where a candidate row meets a registered environment", () => {
  const registered = registeredZeropsOrigins([
    { environmentId: ENV, displayUrl: ORIGIN, zeropsProjectId: "proj-wren" },
    { environmentId: OTHER, displayUrl: null, zeropsProjectId: undefined },
  ]);

  it.each([
    {
      case: "connected: its own environment",
      row: row({ group: "connected", containerOrigin: ORIGIN, environmentId: ENV }),
      expected: ENV,
    },
    {
      case: "up, its socket not open: the environment registered at its origin",
      row: row({ containerOrigin: ORIGIN }),
      expected: ENV,
    },
    {
      // The platform restarts or updates its container: the listing drops the origin while the
      // service is not ACTIVE, and the Mate must stay who it is.
      case: "its container restarting, no origin: the environment its descriptor names",
      row: row({ group: "unavailable", service: { id: "zcp", name: "zcp", status: "UPGRADING" } }),
      expected: ENV,
    },
    {
      case: "no origin, no environment names its project: none",
      row: row({ group: "unavailable", project: { ...row({}).project, id: "proj-elsewhere" } }),
      expected: undefined,
    },
  ])("$case", ({ row: input, expected }) => {
    expect(rowEnvironment(input, registered)).toBe(expected);
  });

  // Two environments on one project (a redeploy registered a new one): the row meets the newest,
  // by its project as by its origin, so a restarting row never maps to the superseded one.
  it("both keys pick the newest registered environment", () => {
    const NEWER = EnvironmentId.make("env-wren-2");
    const both = registeredZeropsOrigins([
      { environmentId: ENV, displayUrl: ORIGIN, zeropsProjectId: "proj-wren" },
      { environmentId: NEWER, displayUrl: ORIGIN, zeropsProjectId: "proj-wren" },
    ]);
    expect(rowEnvironment(row({ containerOrigin: ORIGIN }), both)).toBe(NEWER);
    expect(rowEnvironment(row({ group: "unavailable" }), both)).toBe(NEWER);
  });

  it("a server that has not answered names no project", () => {
    const unanswered = registeredZeropsOrigins([
      { environmentId: OTHER, displayUrl: null, zeropsProjectId: undefined },
    ]);
    expect(rowEnvironment(row({ group: "unavailable" }), unanswered)).toBeUndefined();
  });
});
