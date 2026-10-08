import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, type ExecutionEnvironmentUpdate } from "@t3tools/contracts";
import { initialContainer } from "../../zerops/environments/containerMachine.ts";
import { initialEnvironment } from "../../zerops/environments/environmentMachine.ts";
import { mateLinkScope, type MateLinkValue } from "../families/mateLink.ts";
import { updateAvailabilityScope } from "../families/mateUpdate.ts";
import { emptyAccount } from "../model.ts";
import { reduceAccount } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { mateUpdate } from "./mateUpdate.ts";

const env = EnvironmentId.make("environment");
const stale: ExecutionEnvironmentUpdate = {
  installed: "1",
  latest: "2",
  available: true,
  checkedAt: "earlier-check",
};
const streamed = (
  latest: string,
  phase: NonNullable<ExecutionEnvironmentUpdate["automatic"]>["phase"],
): ExecutionEnvironmentUpdate => ({
  installed: "1",
  latest,
  available: latest !== "",
  checkedAt: "live-state",
  automatic: { protocol: 1, rollbackCompatible: true, phase, runningVersion: "1" },
});
const read = (watched: boolean, update: ExecutionEnvironmentUpdate, ready = true) => {
  const link: MateLinkValue = {
    key: "project:service",
    projectId: "project",
    orgId: "org",
    origin: "https://mate.example",
    shown: true,
    watched,
    environment: initialEnvironment({ record: env }),
    container: {
      ...initialContainer(),
      reading: ready
        ? {
            sentAt: { wall: 1, mono: 1 },
            reading: {
              kind: "ready",
              projectId: "project",
              initAt: null,
              descriptor: {
                environmentId: env,
                serverVersion: "1",
                update,
                identity: "ok",
                identityCheckedAt: null,
              },
            },
          }
        : null,
    },
  };
  const availability = reduceAccount(emptyAccount, {
    kind: "rows",
    scope: updateAvailabilityScope(env),
    generation: 0,
    method: "read",
    via: "mate-direct",
    rows: [
      {
        family: "mateUpdateAvailability",
        id: env,
        value: stale,
        revision: { kind: "mate-link", sequence: 1 },
      },
    ],
  }).state;
  const state = reduceAccount(availability, {
    kind: "rows",
    scope: mateLinkScope("project"),
    generation: 0,
    method: "read",
    via: "mate-direct",
    rows: [
      {
        family: "mateLink",
        id: link.key,
        value: link,
        revision: { kind: "mate-link", sequence: 2 },
      },
    ],
  }).state;
  return mateUpdate.derive(readsOfState(state), env);
};

describe("automatic update evidence", () => {
  it.each(["draining", "switching", "updated", "postponed"] as const)(
    "current streamed %s replaces an earlier manual check",
    (phase) => {
      const update = streamed("3", phase);
      expect(read(true, update).checked).toEqual(update);
    },
  );
  it.each([
    { name: "not currently watched", watched: false, ready: true },
    { name: "not currently ready", watched: true, ready: false },
  ])("retains check evidence when the Mate is $name", ({ watched, ready }) => {
    expect(read(watched, streamed("3", "draining"), ready).checked).toEqual(stale);
  });
  it("an unknown latest version keeps the streamed phase without claiming up to date", () => {
    const update = streamed("", "postponed");
    expect(read(true, update)).toEqual({ checked: update, state: { phase: "idle" } });
  });
});
