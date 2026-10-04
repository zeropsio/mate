import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  initialEnvironment,
  type ContainerVerdict,
  type Credential,
  type DescriptorFacts,
  type EnvironmentMachine,
  type Link,
  type Presence,
} from "./environmentMachine.ts";
import {
  CONVERSATION_UNVERIFIED_BOUND_MS,
  conversationPhrase,
  routeGatePhrase,
  selectConversation,
  selectRouteGate,
  type ConversationAccess,
  type ConversationView,
  type RouteGate,
  type RouteTarget,
} from "./gate.ts";
import { isTerminalReachability, selectReachability, type Reachability } from "./reachability.ts";

const ENV_B = EnvironmentId.make("env-b");
const CONTEXT = { nowMs: 0, mateName: "Wren" };

const resolved = (
  reachability: Reachability,
  content: "empty" | "cached" | "synchronizing" | "live",
): RouteTarget => ({ kind: "resolved", reachability, content });

const RESTARTING: Reachability = {
  kind: "container",
  container: { level: "restarting", by: "platform", overdue: false },
};

/**
 * DESIGN §4.8's route gate rows, RG1–RG9, plus Amendment A5's "no organization chosen". Each row
 * names what renders and the words it says; content present keeps the outlet for every verdict
 * that is not terminal.
 */
const ROWS: ReadonlyArray<{
  readonly row: string;
  readonly name: string;
  readonly target: RouteTarget | null;
  readonly gate: RouteGate;
  readonly text: string | null;
  readonly actions: ReadonlyArray<string>;
}> = [
  {
    row: "RG1",
    name: "no route environment",
    target: null,
    gate: { kind: "outlet", banner: null, composer: "enabled" },
    text: null,
    actions: [],
  },
  {
    row: "RG2",
    name: "unresolved while discovery is pending",
    target: { kind: "unresolved", discovery: "pending" },
    gate: { kind: "wait", reachability: null },
    text: "Opening this conversation…",
    actions: [],
  },
  {
    row: "RG3",
    name: "unresolved once discovery settled",
    target: { kind: "unresolved", discovery: "settled" },
    gate: { kind: "unavailable", reachability: null },
    text: "This conversation isn't in your Zerops projects.",
    actions: ["go-to-projects"],
  },
  {
    row: "A5",
    name: "unresolved with no organization chosen",
    target: { kind: "unresolved", discovery: "no-organization" },
    gate: { kind: "choose-organization" },
    text: "Choose an organization to open this conversation.",
    actions: ["choose-organization"],
  },
  {
    row: "RG4",
    name: "gone, even with content",
    target: resolved({ kind: "gone", because: "direct-not-found" }, "live"),
    gate: {
      kind: "unavailable",
      reachability: { kind: "gone", because: "direct-not-found" },
    },
    text: "This project is no longer available. It was deleted, or you no longer have access.",
    actions: ["go-to-projects"],
  },
  {
    row: "RG5",
    name: "replaced, even with content",
    target: resolved({ kind: "replaced", by: ENV_B }, "cached"),
    gate: { kind: "unavailable", reachability: { kind: "replaced", by: ENV_B } },
    text: "This Mate was redeployed. Its earlier conversations are not on it.",
    actions: ["go-to-projects"],
  },
  {
    row: "RG6",
    name: "refused on the role suppresses content",
    target: resolved({ kind: "refused-role" }, "live"),
    gate: { kind: "unavailable", reachability: { kind: "refused-role" } },
    text: "You can see this project in Zerops but can't operate its Mate.",
    actions: [],
  },
  {
    row: "RG6",
    name: "update-unavailable suppresses content",
    target: resolved({ kind: "update-unavailable" }, "cached"),
    gate: { kind: "unavailable", reachability: { kind: "update-unavailable" } },
    text: "This project's Zerops tooling installs an older Mate than this app supports.",
    actions: [],
  },
  {
    row: "RG7",
    name: "a restarting container over cached content keeps the outlet, composer disabled",
    target: resolved(RESTARTING, "cached"),
    gate: { kind: "outlet", banner: RESTARTING, composer: "disabled" },
    text: "Zerops is restarting this Mate.",
    actions: [],
  },
  {
    row: "RG7",
    name: "reconnecting over synchronizing content keeps the outlet",
    target: resolved({ kind: "reconnecting" }, "synchronizing"),
    gate: { kind: "outlet", banner: { kind: "reconnecting" }, composer: "disabled" },
    text: "Reconnecting…",
    actions: [],
  },
  {
    row: "RG7",
    name: "update-required over live content keeps the outlet with its verb",
    target: resolved({ kind: "update-required", actual: "0.10.0", minimum: "0.11.0" }, "live"),
    gate: {
      kind: "outlet",
      banner: { kind: "update-required", actual: "0.10.0", minimum: "0.11.0" },
      composer: "disabled",
    },
    text: "This Mate runs 0.10.0; this app needs 0.11.0 or newer. Restarting it installs a newer one.",
    actions: ["restart"],
  },
  {
    row: "RG7",
    name: "no public address over cached content keeps the outlet",
    target: resolved({ kind: "no-address", reason: "subdomain-off" }, "cached"),
    gate: {
      kind: "outlet",
      banner: { kind: "no-address", reason: "subdomain-off" },
      composer: "disabled",
    },
    text: "This Mate has no public address.",
    actions: ["open-in-zerops"],
  },
  {
    row: "RG8",
    name: "no content and a non-terminal verdict waits with the verdict's words",
    target: resolved({ kind: "connecting", waitingOn: "exchange" }, "empty"),
    gate: { kind: "wait", reachability: { kind: "connecting", waitingOn: "exchange" } },
    text: "Connecting…",
    actions: [],
  },
  {
    row: "RG8",
    name: "no content and retrying offers Try now",
    target: resolved(
      { kind: "retrying", retryAtMs: 4_000, last: { kind: "network" }, restart: false },
      "empty",
    ),
    gate: {
      kind: "wait",
      reachability: {
        kind: "retrying",
        retryAtMs: 4_000,
        last: { kind: "network" },
        restart: false,
      },
    },
    text: "This Mate isn't answering. Trying again in 4 s.",
    actions: ["try-now"],
  },
  {
    row: "RG9",
    name: "ready renders the outlet with the composer enabled",
    target: resolved({ kind: "ready", notice: null }, "live"),
    gate: { kind: "outlet", banner: null, composer: "enabled" },
    text: null,
    actions: [],
  },
  {
    row: "RG9",
    name: "ready with a restart notice keeps the composer enabled",
    target: resolved(
      { kind: "ready", notice: { level: "restarting", by: "platform", overdue: false } },
      "live",
    ),
    gate: {
      kind: "outlet",
      banner: { kind: "ready", notice: { level: "restarting", by: "platform", overdue: false } },
      composer: "enabled",
    },
    text: "Zerops is restarting this Mate.",
    actions: [],
  },
  {
    row: "RG9",
    name: "ready before any content still mounts the outlet",
    target: resolved({ kind: "ready", notice: null }, "empty"),
    gate: { kind: "outlet", banner: null, composer: "enabled" },
    text: null,
    actions: [],
  },
];

describe("selectRouteGate", () => {
  it.each(ROWS)("$row: $name", ({ target, gate, text, actions }) => {
    const selected = selectRouteGate(target);

    expect(selected).toEqual(gate);
    expect(routeGatePhrase(selected, CONTEXT)).toEqual({ text, actions });
  });
});

// ── I9 over every gate input ──────────────────────────────────────────────────────────────────

const ORIGIN = "https://zcp-1-abc.prg1.zerops.app";
const ENV_A = EnvironmentId.make("env-a");
const at = (ms: number) => ({ wall: ms, mono: ms });

const PRESENCES: ReadonlyArray<Presence> = [
  { kind: "unknown" },
  { kind: "present", origin: ORIGIN },
  { kind: "transitioning", status: "RESTARTING" },
  { kind: "inactive", status: "STOPPED" },
  { kind: "no-origin", reason: "subdomain-off" },
  { kind: "gone", evidence: "direct-not-found" },
];

const CREDENTIALS: ReadonlyArray<Credential> = [
  { kind: "none", reconnect: false },
  { kind: "none", reconnect: true },
  { kind: "waiting", on: "container", reconnect: false },
  { kind: "waiting", on: "zerops", reconnect: false },
  { kind: "exchanging", attempt: 1, deadline: at(20_000), reconnect: false },
  { kind: "backoff", retryAt: at(4_000), last: { kind: "network" }, reconnect: false },
  { kind: "refused", reason: { kind: "role" } },
  { kind: "refused", reason: { kind: "version" } },
  { kind: "refused", reason: { kind: "access", reason: "epoch-closed" } },
  { kind: "held", environmentId: ENV_A, installed: true, staleBlock: false, rereading: null },
  {
    kind: "held",
    environmentId: ENV_A,
    installed: true,
    staleBlock: false,
    rereading: { attempt: 2, deadline: at(8_000), block: "configuration" },
  },
  { kind: "retired", evidence: "removed-by-user" },
];

const LINKS: ReadonlyArray<Link> = [
  { phase: "idle" },
  { phase: "connecting" },
  { phase: "connected", since: at(0) },
  { phase: "backoff", retryAtMs: 4_000 },
  { phase: "blocked", reason: "authentication" },
  { phase: "offline" },
];

const CONTAINERS: ReadonlyArray<ContainerVerdict> = [
  { level: "unknown" },
  { level: "ready" },
  { level: "creating", overdue: false },
  { level: "provisioning", overdue: true },
  { level: "booting", overdue: false },
  { level: "restarting", by: "platform", overdue: false },
  { level: "restarting", by: "you", overdue: true },
  { level: "updating", overdue: false },
  { level: "needs-enable" },
  { level: "needs-update" },
  { level: "not-yet-available" },
  { level: "inactive", status: "STOPPED" },
];

const DESCRIPTORS: ReadonlyArray<DescriptorFacts | null> = [
  null,
  {
    environmentId: ENV_A,
    serverVersion: "0.10.0",
    update: null,
    identity: "ok",
    identityCheckedAt: null,
  },
];

const SUPERSEDED: ReadonlyArray<ReadonlyMap<EnvironmentId, EnvironmentId>> = [
  new Map(),
  new Map([[ENV_A, ENV_B]]),
];

const CONTENTS = ["empty", "cached", "synchronizing", "live"] as const;

/** Every region combination the machine can publish, each with the environment asked about. */
const machines = function* (): Generator<EnvironmentMachine> {
  for (const presence of PRESENCES)
    for (const credential of CREDENTIALS)
      for (const link of LINKS)
        for (const container of CONTAINERS)
          for (const descriptor of DESCRIPTORS)
            for (const superseded of SUPERSEDED)
              yield {
                ...initialEnvironment({ record: ENV_A }),
                presence,
                credential,
                link,
                container,
                descriptor,
                superseded,
              };
};

describe("I9: the route gate over every machine and content", () => {
  it("is unavailable only for terminal verdicts, keeps content mounted, and is ready on a held, connected, not inactive target", () => {
    const found: Array<string> = [];
    let checked = 0;
    for (const machine of machines()) {
      const reachability = selectReachability(machine, ENV_A);
      for (const content of CONTENTS) {
        const gate = selectRouteGate({ kind: "resolved", reachability, content });
        const where = `${JSON.stringify({
          presence: machine.presence,
          credential: machine.credential,
          link: machine.link.phase,
          container: machine.container,
          content,
        })}`;
        checked += 1;
        if (gate.kind === "unavailable" && !isTerminalReachability(reachability)) {
          found.push(`unavailable for the non-terminal ${reachability.kind}: ${where}`);
        }
        if (
          content !== "empty" &&
          !isTerminalReachability(reachability) &&
          gate.kind !== "outlet"
        ) {
          found.push(`content present but ${gate.kind}: ${where}`);
        }
        const readyInputs =
          machine.credential.kind === "held" &&
          machine.link.phase === "connected" &&
          machine.container.level !== "inactive" &&
          machine.presence.kind !== "gone" &&
          !machine.superseded.has(ENV_A);
        if (readyInputs && (reachability.kind !== "ready" || gate.kind !== "outlet")) {
          found.push(`held + connected + C ≠ inactive but ${reachability.kind}: ${where}`);
        }
        if (readyInputs && gate.kind === "outlet" && gate.composer !== "enabled") {
          found.push(`ready with the composer disabled: ${where}`);
        }
      }
    }

    expect(checked).toBe(
      PRESENCES.length *
        CREDENTIALS.length *
        LINKS.length *
        CONTAINERS.length *
        DESCRIPTORS.length *
        SUPERSEDED.length *
        CONTENTS.length,
    );
    expect(found.slice(0, 5)).toEqual([]);
  });

  it("is never 'not in your projects' while discovery is pending or no organization is chosen", () => {
    for (const discovery of ["pending", "no-organization"] as const) {
      const gate = selectRouteGate({ kind: "unresolved", discovery });

      expect(gate.kind).not.toBe("unavailable");
      expect(routeGatePhrase(gate, CONTEXT).text).not.toBe(
        "This conversation isn't in your Zerops projects.",
      );
    }
  });
});

// ── C1b: a conversation without verified access ───────────────────────────────────────────────

const MINUTE_MS = 60_000;
const LAPSED: ConversationAccess = { kind: "withheld", reason: "access-lapsed", cause: null };
const UNVERIFIED: ConversationAccess = {
  kind: "withheld",
  reason: "access-unverified",
  cause: null,
};
const DENIED: ConversationAccess = { kind: "withheld", reason: "access-denied", cause: null };
const NOW = at(100 * MINUTE_MS);
const CONNECTED: Link = { phase: "connected", since: at(0) };
const DOWN: Link = { phase: "backoff", retryAtMs: null };
/** The route target's link, and when it dropped. */
const linked = (link: Link, lostAgoMs: number | null) => ({
  link,
  linkLostAt: lostAgoMs === null ? null : at(NOW.wall - lostAgoMs),
});

/**
 * DESIGN §9 C1b: a Mate conversation stays shown while its project's access is not verified only
 * while its link is connected, or for at most 10 min after the link dropped; a confirmed loss
 * suppresses it at once.
 */
const CONVERSATION_ROWS: ReadonlyArray<{
  readonly name: string;
  readonly access: ConversationAccess;
  readonly machine: ReturnType<typeof linked> | undefined;
  readonly now?: { readonly wall: number; readonly mono: number };
  readonly view: ConversationView;
}> = [
  {
    name: "verified access shows it whatever the link does",
    access: { kind: "authorized" },
    machine: linked({ phase: "idle" }, null),
    view: { kind: "shown", until: null },
  },
  {
    name: "a lapse over a connected link keeps it shown",
    access: LAPSED,
    machine: linked(CONNECTED, null),
    view: { kind: "shown", until: null },
  },
  {
    name: "a lapse keeps it shown 9 min after the link dropped, until the bound",
    access: LAPSED,
    machine: linked(DOWN, 9 * MINUTE_MS),
    view: { kind: "shown", until: at(NOW.wall + MINUTE_MS) },
  },
  {
    name: "a lapse suppresses it 10 min after the link dropped",
    access: LAPSED,
    machine: linked(DOWN, CONVERSATION_UNVERIFIED_BOUND_MS),
    view: { kind: "suppressed", reason: "access-lapsed" },
  },
  {
    name: "an unverified project suppresses it past the bound",
    access: UNVERIFIED,
    machine: linked({ phase: "offline" }, 11 * MINUTE_MS),
    view: { kind: "suppressed", reason: "access-unverified" },
  },
  {
    name: "a link that never connected vouches for nothing",
    access: LAPSED,
    machine: linked({ phase: "connecting" }, null),
    view: { kind: "suppressed", reason: "access-lapsed" },
  },
  {
    name: "no target known vouches for nothing",
    access: LAPSED,
    machine: undefined,
    view: { kind: "suppressed", reason: "access-lapsed" },
  },
  {
    name: "a denial awaiting its confirming read keeps a connected link's conversation",
    access: DENIED,
    machine: linked(CONNECTED, null),
    view: { kind: "shown", until: null },
  },
  {
    name: "a confirmed loss suppresses it even over a connected link",
    access: { kind: "lost" },
    machine: linked(CONNECTED, null),
    view: { kind: "suppressed", reason: "access-denied" },
  },
  {
    name: "the bound holds on the monotonic clock when the wall clock is set back",
    access: LAPSED,
    machine: linked(DOWN, 5 * MINUTE_MS),
    now: { wall: NOW.wall - 60 * MINUTE_MS, mono: NOW.mono + 6 * MINUTE_MS },
    view: { kind: "suppressed", reason: "access-lapsed" },
  },
];

describe("selectConversation (C1b)", () => {
  it.each(CONVERSATION_ROWS)("$name", ({ access, machine, now, view }) => {
    expect(selectConversation({ access, machine, now: now ?? NOW })).toEqual(view);
  });

  it.each([
    ["access-lapsed", { text: null, actions: [] }],
    ["access-unverified", { text: "Checking your access to this project…", actions: [] }],
    [
      "access-denied",
      { text: "Your access to this project changed.", actions: ["go-to-projects"] },
    ],
  ] as const)("a conversation suppressed for %s says its cause only", (reason, phrase) => {
    expect(conversationPhrase({ kind: "suppressed", reason })).toEqual(phrase);
  });
});
