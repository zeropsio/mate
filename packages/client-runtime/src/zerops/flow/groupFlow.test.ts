import { describe, expect, it } from "vite-plus/test";

import { project, service } from "../data/__fixtures__/index.ts";
import type { Known, Shown } from "../knowledge/known.ts";
import type { Deployment, SettledDeployment, StopService } from "./deployment.ts";
import { stopDeploymentOf } from "./groupFlow.ts";

const NOW = 1_000_000;
const MAIN_SHA = "a".repeat(40);
const PRODUCTION_SHA = "b".repeat(40);

const known = <T>(value: T): Known<T> => ({
  state: "known",
  value,
  asOf: { ordinal: 1, atMs: NOW - 1_000 },
  coverage: "complete",
  freshness: { kind: "live" },
});
const READING: Known<never> = { state: "reading", sinceMs: NOW - 100, attempt: 1 };

const version = (sha: string) => ({
  name: sha,
  commit: sha.slice(0, 7),
  sha,
  taggedBy: undefined,
  label: sha.slice(0, 7),
});

const running = (sha: string): SettledDeployment => ({
  kind: "running",
  activatedAt: "2026-09-23T09:00:00Z",
  version: version(sha),
});

const deploying = (sha: string): Deployment => ({
  kind: "deploying",
  version: version(sha),
  previous: null,
});

const stopService = (hostname: string, deployment: Shown<Deployment>): StopService => ({
  service: service(`p-stage-${hostname}`, project("p-stage")),
  hostname,
  deployment,
});

describe("stopDeploymentOf", () => {
  it("runs its first running service, and none only when every service runs none", () => {
    expect(
      stopDeploymentOf(
        known([
          stopService("apidev", known({ kind: "none" })),
          stopService("appdev", known(running(MAIN_SHA))),
        ]),
      ),
    ).toMatchObject({ state: "known", value: { kind: "running" } });
    expect(
      stopDeploymentOf(
        known([stopService("apidev", known({ kind: "none" })), stopService("appdev", READING)]),
      ).state,
    ).toBe("reading");
    expect(stopDeploymentOf(known([stopService("apidev", known({ kind: "none" }))]))).toMatchObject(
      { state: "known", value: { kind: "none" } },
    );
  });

  it("deploys while any of its services does", () => {
    expect(
      stopDeploymentOf(
        known([
          stopService("apidev", known(running(PRODUCTION_SHA))),
          stopService("appdev", known(deploying(MAIN_SHA))),
        ]),
      ),
    ).toMatchObject({ value: { kind: "deploying", version: { sha: MAIN_SHA } } });
  });

  it("is what the services are while they are not known", () => {
    expect(stopDeploymentOf(READING)).toBe(READING);
  });
});
