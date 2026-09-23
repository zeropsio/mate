import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { ZeropsProject } from "../api.ts";
import type { ZeropsCandidate } from "../candidates.ts";
import type { ZeropsContainerHealth } from "../provisioning.ts";
import {
  initialEnvironment,
  transitionEnvironment,
  type DescriptorFacts,
  type EnvironmentEvent,
  type EnvironmentGuards,
  type EnvironmentMachine,
} from "./environmentMachine.ts";
import { interimContainerVerdict, type InterimMateFlag } from "./interimContainer.ts";
import {
  environmentLinkable,
  isTerminalReachability,
  reachabilityPhrase,
  selectReachability,
  type Reachability,
} from "./reachability.ts";

const ORIGIN = "https://zcp-1-abc.prg1.zerops.app";
const ENV_A = EnvironmentId.make("env-a");
const ENV_B = EnvironmentId.make("env-b");
const NOW = 500_000;
const at = (ms: number) => ({ wall: ms, mono: ms });

const GUARDS: EnvironmentGuards = {
  want: true,
  routeTarget: true,
  visible: true,
  postGrant: true,
  identityMint: { allowed: true },
  zeropsFailing: false,
  grantVerifiedAtMs: 0,
  budget: true,
};

const descriptor = (overrides: Partial<DescriptorFacts> = {}): DescriptorFacts => ({
  environmentId: ENV_A,
  serverVersion: "0.12.0",
  update: null,
  identity: "ok",
  identityCheckedAt: "2026-09-23T10:00:00.000Z",
  ...overrides,
});

/** Region C as 0.9a derives it: the candidate's statuses and the probe's verdict. */
const interim = (
  serviceStatus: string,
  health?: ZeropsContainerHealth,
  mateFlag?: InterimMateFlag,
) => {
  const candidate: ZeropsCandidate = {
    key: "project-1:service-1",
    project: { id: "project-1", name: "shop", status: "ACTIVE" } as ZeropsProject,
    group: "ready",
    service: { id: "service-1", name: "zcp", status: serviceStatus },
  };
  return interimContainerVerdict({ candidate, health, mateFlag });
};

const machine = (overrides: Partial<EnvironmentMachine>): EnvironmentMachine => ({
  ...initialEnvironment({ record: ENV_A }),
  guards: GUARDS,
  presence: { kind: "present", origin: ORIGIN },
  container: interim("ACTIVE", "ready"),
  ...overrides,
});

const HELD = { kind: "held", environmentId: ENV_A, staleBlock: false, rereading: null } as const;
const CONNECTED = { phase: "connected", since: at(NOW - 5_000) } as const;

/**
 * DESIGN §4.4's reachability table, first match wins. Several rows also carry inputs a later row
 * would match (a live link under a gone presence, a stalled probe under a live link), so the order
 * is part of what is tested.
 */
const ROWS: ReadonlyArray<{
  readonly row: number;
  readonly name: string;
  readonly machine: EnvironmentMachine;
  readonly asked?: EnvironmentId;
  readonly verdict: Reachability;
}> = [
  {
    row: 1,
    name: "P gone, even with a held credential and a live link",
    machine: machine({
      presence: { kind: "gone", evidence: "direct-not-found" },
      credential: HELD,
      link: CONNECTED,
    }),
    verdict: { kind: "gone", because: "direct-not-found" },
  },
  {
    row: 1,
    name: "removed by the user",
    machine: machine({ credential: { kind: "retired", evidence: "removed-by-user" } }),
    verdict: { kind: "gone", because: "removed-by-user" },
  },
  {
    row: 2,
    name: "the asked environment was replaced by a redeploy",
    machine: machine({
      credential: { kind: "held", environmentId: ENV_B, staleBlock: false, rereading: null },
      link: CONNECTED,
      superseded: new Map([[ENV_A, ENV_B]]),
    }),
    asked: ENV_A,
    verdict: { kind: "replaced", by: ENV_B },
  },
  {
    row: 3,
    name: "the door refused the role",
    machine: machine({ credential: { kind: "refused", reason: { kind: "role" } } }),
    verdict: { kind: "refused-role" },
  },
  {
    row: 3,
    name: "below the floor, and zcp offers a Mate at or above it",
    machine: machine({
      credential: { kind: "refused", reason: { kind: "version" } },
      descriptor: descriptor({
        serverVersion: "0.10.4",
        update: {
          installed: "0.10.4",
          latest: "0.12.0",
          available: true,
          checkedAt: "2026-09-23T10:00:00.000Z",
        },
      }),
    }),
    verdict: { kind: "update-required", actual: "0.10.4", minimum: "0.11.0" },
  },
  {
    row: 3,
    name: "below the floor, and zcp installs nothing newer",
    machine: machine({
      credential: { kind: "refused", reason: { kind: "version" } },
      descriptor: descriptor({
        serverVersion: "0.10.4",
        update: {
          installed: "0.10.4",
          latest: "0.10.4",
          available: false,
          checkedAt: "2026-09-23T10:00:00.000Z",
        },
      }),
    }),
    verdict: { kind: "update-unavailable" },
  },
  {
    row: 3,
    name: "the link kept refusing its configuration",
    machine: machine({ credential: { kind: "refused", reason: { kind: "configuration" } } }),
    verdict: { kind: "refused-configuration" },
  },
  {
    row: 3,
    name: "the Mate at this origin belongs to another project: presence is re-read",
    machine: machine({ credential: { kind: "refused", reason: { kind: "project-mismatch" } } }),
    verdict: { kind: "connecting", waitingOn: "presence" },
  },
  {
    row: 4,
    name: "blocked while the descriptor is re-read",
    machine: machine({
      credential: {
        kind: "held",
        environmentId: ENV_A,
        staleBlock: false,
        rereading: { attempt: 3, deadline: at(NOW + 8_000), block: "configuration" },
      },
      link: { phase: "blocked", reason: "configuration" },
    }),
    verdict: { kind: "connecting", waitingOn: "descriptor" },
  },
  {
    row: 5,
    name: "held, connected, container ready",
    machine: machine({ credential: HELD, link: CONNECTED }),
    verdict: { kind: "ready", notice: null },
  },
  {
    row: 5,
    name: "held, connected, platform RESTARTING: ready with the restart as a notice",
    machine: machine({ credential: HELD, link: CONNECTED, container: interim("RESTARTING") }),
    verdict: {
      kind: "ready",
      notice: { level: "restarting", by: "platform", overdue: false },
    },
  },
  {
    row: 5,
    name: "held, connected, container still booting by the probe: the socket outranks it",
    machine: machine({
      credential: HELD,
      link: CONNECTED,
      container: interim("ACTIVE", "stalled"),
    }),
    verdict: { kind: "ready", notice: null },
  },
  {
    row: 6,
    name: "no public address",
    machine: machine({ presence: { kind: "no-origin", reason: "subdomain-off" } }),
    verdict: { kind: "no-address", reason: "subdomain-off" },
  },
  {
    row: 7,
    name: "held and connected, but the service is STOPPED",
    machine: machine({ credential: HELD, link: CONNECTED, container: interim("STOPPED") }),
    verdict: { kind: "container", container: { level: "inactive", status: "STOPPED" } },
  },
  {
    row: 7,
    name: "booting past its cap",
    machine: machine({
      credential: { kind: "waiting", on: "container", reconnect: false },
      container: interim("ACTIVE", "stalled"),
    }),
    verdict: { kind: "container", container: { level: "booting", overdue: true } },
  },
  {
    row: 7,
    name: "the Mate flag reads off",
    machine: machine({
      credential: { kind: "waiting", on: "container", reconnect: false },
      container: interim("ACTIVE", "predates-mate", false),
    }),
    verdict: { kind: "container", container: { level: "needs-enable" } },
  },
  {
    row: 8,
    name: "Zerops is failing for the grant",
    machine: machine({ credential: { kind: "waiting", on: "zerops", reconnect: false } }),
    verdict: { kind: "waiting-for-zerops" },
  },
  {
    row: 9,
    name: "an exchange failed and waits for its retry",
    machine: machine({
      credential: {
        kind: "backoff",
        retryAt: at(NOW + 4_000),
        last: { kind: "server", status: 500 },
        reconnect: false,
      },
    }),
    verdict: {
      kind: "retrying",
      retryAtMs: NOW + 4_000,
      last: { kind: "server", status: 500 },
      restart: false,
    },
  },
  {
    row: 9,
    name: "a network failure after two identity failures offers no Restart",
    machine: machine({
      guards: { ...GUARDS, grantVerifiedAtMs: NOW - 10_000 },
      identityFailures: {
        reads: 2,
        lastCheckedAt: "2026-09-23T10:00:20.000Z",
        sinceMs: NOW - 30_000,
      },
      credential: {
        kind: "backoff",
        retryAt: at(NOW + 60_000),
        last: { kind: "network" },
        reconnect: false,
      },
    }),
    verdict: {
      kind: "retrying",
      retryAtMs: NOW + 60_000,
      last: { kind: "network" },
      restart: false,
    },
  },
  {
    row: 9,
    name: "identity failed twice with a fresh grant offers Restart",
    machine: machine({
      guards: { ...GUARDS, grantVerifiedAtMs: NOW - 10_000 },
      identityFailures: {
        reads: 2,
        lastCheckedAt: "2026-09-23T10:00:20.000Z",
        sinceMs: NOW - 30_000,
      },
      credential: {
        kind: "backoff",
        retryAt: at(NOW + 60_000),
        last: { kind: "identity-failed" },
        reconnect: false,
      },
    }),
    verdict: {
      kind: "retrying",
      retryAtMs: NOW + 60_000,
      last: { kind: "identity-failed" },
      restart: true,
    },
  },
  {
    row: 10,
    name: "held, link in backoff",
    machine: machine({ credential: HELD, link: { phase: "backoff", retryAtMs: NOW + 2_000 } }),
    verdict: { kind: "reconnecting" },
  },
  {
    row: 10,
    name: "re-exchanging after an auth rejection",
    machine: machine({
      credential: { kind: "exchanging", attempt: 4, deadline: at(NOW + 20_000), reconnect: true },
      link: { phase: "blocked", reason: "authentication" },
    }),
    verdict: { kind: "reconnecting" },
  },
  {
    row: 11,
    name: "presence not known yet",
    machine: machine({
      presence: { kind: "unknown" },
      credential: { kind: "waiting", on: "presence", reconnect: false },
      container: { level: "unknown" },
    }),
    verdict: { kind: "resolving" },
  },
  {
    row: 12,
    name: "a first exchange in flight",
    machine: machine({
      credential: { kind: "exchanging", attempt: 1, deadline: at(NOW + 20_000), reconnect: false },
    }),
    verdict: { kind: "connecting", waitingOn: "exchange" },
  },
  {
    row: 12,
    name: "waiting for the tab to be visible",
    machine: machine({ credential: { kind: "waiting", on: "visible", reconnect: false } }),
    verdict: { kind: "connecting", waitingOn: "visible" },
  },
];

const TERMINAL = new Set<Reachability["kind"]>([
  "gone",
  "replaced",
  "refused-role",
  "update-unavailable",
]);

describe("selectReachability (DESIGN §4.4 table, over the interim container region)", () => {
  for (const row of ROWS) {
    it(`row ${row.row}: ${row.name}`, () => {
      const verdict = selectReachability(row.machine, row.asked ?? ENV_A);
      expect(verdict).toEqual(row.verdict);
      expect(isTerminalReachability(verdict)).toBe(TERMINAL.has(verdict.kind));
      expect(environmentLinkable(verdict)).toBe(
        verdict.kind !== "gone" && verdict.kind !== "replaced",
      );
    });
  }
});

/** Feeds events one second apart from `NOW`; `TICK` lands on the machine's timer. */
const drive = (
  start: EnvironmentMachine,
  events: ReadonlyArray<EnvironmentEvent>,
): { readonly machine: EnvironmentMachine; readonly nowMs: number } => {
  let nowMs = NOW;
  let current = start;
  for (const event of events) {
    nowMs = event.type === "TICK" && current.timer !== null ? current.timer.wall : nowMs + 1_000;
    current = transitionEnvironment(current, event, { now: at(nowMs), random: () => 0.5 }).state;
  }
  return { machine: current, nowMs };
};

const attemptOf = (current: EnvironmentMachine): number => {
  if (current.credential.kind !== "exchanging") throw new Error("no exchange in flight");
  return current.credential.attempt;
};

const OPENING: ReadonlyArray<EnvironmentEvent> = [
  { type: "GUARDS", guards: GUARDS },
  { type: "CONTAINER", container: interim("ACTIVE", "ready") },
  { type: "PRESENCE", presence: { kind: "present", origin: ORIGIN } },
];

const connectedMachine = (): EnvironmentMachine => {
  const opened = drive(initialEnvironment({ record: ENV_A }), OPENING).machine;
  return drive(opened, [
    {
      type: "EXCHANGE_SUCCEEDED",
      attempt: attemptOf(opened),
      environmentId: ENV_A,
      descriptor: descriptor(),
    },
    { type: "LINK", link: { phase: "connected" } },
  ]).machine;
};

describe("reachability over the machine's own transitions", () => {
  it("connected link + non-terminal container → ready (T-L8)", () => {
    const restarting = drive(connectedMachine(), [
      { type: "CONTAINER", container: interim("RESTARTING") },
    ]).machine;
    expect(selectReachability(restarting, ENV_A)).toEqual({
      kind: "ready",
      notice: { level: "restarting", by: "platform", overdue: false },
    });
    const dropped = drive(restarting, [{ type: "LINK", link: { phase: "connecting" } }]).machine;
    expect(selectReachability(dropped, ENV_A)).toEqual({
      kind: "container",
      container: { level: "restarting", by: "platform", overdue: false },
    });
  });

  it("blocked(configuration mismatch) → replaced (T-L22)", () => {
    const blocked = drive(connectedMachine(), [
      { type: "LINK", link: { phase: "blocked", reason: "configuration" } },
    ]).machine;
    expect(selectReachability(blocked, ENV_A)).toEqual({
      kind: "connecting",
      waitingOn: "descriptor",
    });
    const credential = blocked.credential;
    if (credential.kind !== "held" || credential.rereading === null) throw new Error("no re-read");
    const reread = drive(blocked, [
      {
        type: "DESCRIPTOR_READ",
        attempt: credential.rereading.attempt,
        result: { ok: true, descriptor: descriptor({ environmentId: ENV_B }) },
      },
    ]).machine;
    expect(selectReachability(reread, ENV_A)).toEqual({ kind: "replaced", by: ENV_B });
    expect(environmentLinkable(selectReachability(reread, ENV_A))).toBe(false);
  });

  it("blocked(unsupported) → update-required or update-unavailable by update.latest (T-L22)", () => {
    for (const [latest, verdict] of [
      ["0.12.0", { kind: "update-required", actual: "0.10.4", minimum: "0.11.0" }],
      ["0.10.9", { kind: "update-unavailable" }],
    ] as const) {
      const old = drive(connectedMachine(), [
        {
          type: "DESCRIPTOR",
          descriptor: descriptor({
            serverVersion: "0.10.4",
            update: {
              installed: "0.10.4",
              latest,
              available: true,
              checkedAt: "2026-09-23T10:00:00.000Z",
            },
          }),
        },
        { type: "LINK", link: { phase: "blocked", reason: "unsupported" } },
      ]).machine;
      expect(selectReachability(old, ENV_A)).toEqual(verdict);
    }
  });

  it("blocked(unsupported) with no descriptor read yet reads one before the floor verdict", () => {
    const opened = drive(initialEnvironment({ record: null }), OPENING).machine;
    const blocked = drive(opened, [
      {
        type: "EXCHANGE_SUCCEEDED",
        attempt: attemptOf(opened),
        environmentId: ENV_A,
        descriptor: null,
      },
      { type: "LINK", link: { phase: "blocked", reason: "unsupported" } },
    ]).machine;
    expect(selectReachability(blocked, ENV_A)).toEqual({
      kind: "connecting",
      waitingOn: "descriptor",
    });
    const credential = blocked.credential;
    if (credential.kind !== "held" || credential.rereading === null) throw new Error("no re-read");
    const read = drive(blocked, [
      {
        type: "DESCRIPTOR_READ",
        attempt: credential.rereading.attempt,
        result: {
          ok: true,
          descriptor: descriptor({
            serverVersion: "0.10.4",
            update: {
              installed: "0.10.4",
              latest: "0.12.0",
              available: true,
              checkedAt: "2026-09-23T10:00:00.000Z",
            },
          }),
        },
      },
    ]).machine;
    expect(selectReachability(read, ENV_A)).toEqual({
      kind: "update-required",
      actual: "0.10.4",
      minimum: "0.11.0",
    });
  });

  it("a version refusal with no descriptor behind it is retried, never update-unavailable", () => {
    const opened = drive(initialEnvironment({ record: null }), OPENING).machine;
    const refused = drive(opened, [
      {
        type: "EXCHANGE_FAILED",
        attempt: attemptOf(opened),
        failure: { class: "refusal", reason: { kind: "version" } },
        descriptor: null,
      },
    ]).machine;
    expect(selectReachability(refused, ENV_A)).toMatchObject({
      kind: "retrying",
      last: { kind: "descriptor-unreachable" },
    });
  });

  it("blocked(permission) twice → refused(role) (T-L22)", () => {
    const once = drive(connectedMachine(), [
      { type: "LINK", link: { phase: "blocked", reason: "permission" } },
    ]).machine;
    expect(selectReachability(once, ENV_A)).toEqual({ kind: "reconnecting" });
    const again = drive(once, [
      {
        type: "EXCHANGE_SUCCEEDED",
        attempt: attemptOf(once),
        environmentId: ENV_A,
        descriptor: null,
      },
      { type: "LINK", link: { phase: "blocked", reason: "permission" } },
    ]).machine;
    expect(selectReachability(again, ENV_A)).toEqual({ kind: "refused-role" });
  });

  it("identity failed during a Zerops outage → retrying, no Restart (T-L21)", () => {
    const opened = drive(initialEnvironment({ record: ENV_A }), OPENING).machine;
    const failedAt = (attempt: number, checkedAt: string): EnvironmentEvent => ({
      type: "EXCHANGE_FAILED",
      attempt,
      failure: { class: "retryable", cause: { kind: "identity-failed" } },
      descriptor: descriptor({ identity: "failed", identityCheckedAt: checkedAt }),
    });
    const first = drive(opened, [
      failedAt(attemptOf(opened), "2026-09-23T10:00:00.000Z"),
      { type: "TICK" },
    ]).machine;
    // The grant's last round predates the failures: Zerops has not answered us since.
    const second = drive(first, [failedAt(attemptOf(first), "2026-09-23T10:00:30.000Z")]);
    const verdict = selectReachability(second.machine, ENV_A);
    expect(verdict).toMatchObject({
      kind: "retrying",
      last: { kind: "identity-failed" },
      restart: false,
    });
    const phrase = reachabilityPhrase(verdict, { nowMs: second.nowMs, mateName: "shop" });
    expect(phrase.text).toMatch(
      /^This Mate can't reach Zerops to check who you are\. Trying again in \d+ s\.$/u,
    );
    expect(phrase.actions).toEqual(["try-now"]);

    // Then the grant's rounds fail too: the Mate waits for Zerops instead of retrying.
    const outage = drive(second.machine, [
      { type: "GUARDS", guards: { ...GUARDS, zeropsFailing: true } },
      { type: "TICK" },
    ]).machine;
    expect(selectReachability(outage, ENV_A)).toEqual({ kind: "waiting-for-zerops" });
  });

  it("a hanging exchange reads as retrying, never as gone, while presence is unknown (T-L5)", () => {
    const hung = drive(initialEnvironment({ record: ENV_A }), [
      ...OPENING,
      { type: "TICK" },
    ]).machine;
    const timedOut = selectReachability(hung, ENV_A);
    expect(timedOut).toMatchObject({ kind: "retrying", last: { kind: "timeout" } });
    expect(isTerminalReachability(timedOut)).toBe(false);
    // The inventory goes stale: a presence change releases the backoff, and the wait is on presence.
    const unknown = drive(hung, [{ type: "PRESENCE", presence: { kind: "unknown" } }]).machine;
    expect(selectReachability(unknown, ENV_A)).toEqual({ kind: "resolving" });
  });
});

describe("reachabilityPhrase", () => {
  const phrase = (verdict: Reachability) =>
    reachabilityPhrase(verdict, { nowMs: NOW, mateName: "shop" });

  it("names the cause only and offers each action once", () => {
    expect(phrase({ kind: "refused-role" })).toEqual({
      text: "You can see this project in Zerops but can't operate its Mate.",
      actions: [],
    });
    expect(phrase({ kind: "refused-configuration" })).toEqual({
      text: "This Mate keeps refusing its connection settings.",
      actions: ["try-now"],
    });
    expect(phrase({ kind: "update-unavailable" })).toEqual({
      text: "This project's Zerops tooling installs an older Mate than this app supports.",
      actions: [],
    });
    expect(
      phrase({ kind: "update-required", actual: "0.10.4", minimum: "0.11.0" }).actions,
    ).toEqual(["restart"]);
    expect(phrase({ kind: "no-address", reason: "no-port" })).toEqual({
      text: "This Mate has no public address.",
      actions: ["open-in-zerops"],
    });
    expect(phrase({ kind: "waiting-for-zerops" })).toEqual({
      text: "Zerops isn't answering. This Mate reconnects when it's back.",
      actions: [],
    });
    expect(phrase({ kind: "container", container: { level: "booting", overdue: true } })).toEqual({
      text: "shop is taking longer than usual to start.",
      actions: ["restart"],
    });
    expect(
      phrase({
        kind: "retrying",
        retryAtMs: NOW + 15_000,
        last: { kind: "identity-failed" },
        restart: true,
      }),
    ).toEqual({
      text: "This Mate can't reach Zerops to check who you are. Trying again in 15 s.",
      actions: ["try-now", "restart"],
    });
    expect(phrase({ kind: "reconnecting" }).text).toBe("Reconnecting…");
    expect(phrase({ kind: "gone", because: "direct-not-found" })).toEqual({
      text: "This project is no longer available. It was deleted, or you no longer have access.",
      actions: ["go-to-projects"],
    });
  });

  it("never says 'environment' in user-facing copy", () => {
    for (const row of ROWS) {
      const text = reachabilityPhrase(row.verdict, { nowMs: NOW, mateName: "shop" }).text ?? "";
      expect(text).not.toMatch(/environment/iu);
    }
  });
});
