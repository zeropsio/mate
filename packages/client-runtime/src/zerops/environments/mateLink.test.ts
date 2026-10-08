import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { DescriptorIndex } from "./descriptorIndex.ts";
import { IDLE_GUARDS, initialEnvironment, type EnvironmentMachine } from "./environmentMachine.ts";
import { mateLink, rowTarget, type MateLink } from "./mateLink.ts";

const ENV_A = EnvironmentId.make("env-a");
const ENV_B = EnvironmentId.make("env-b");
/** Project 1's Mate, and the row its project stands as while its services are not read. */
const KEY = "project-1:service-1";
const PROJECT = "project-1";

const HELD = {
  kind: "held",
  environmentId: ENV_A,
  installed: true,
  staleBlock: false,
  rereading: null,
} as const;
const CONNECTED = { phase: "connected", since: { wall: 0, mono: 0 } } as const;

/** A Mate present at its origin, remembering `env-a`, its container ready. */
const machine = (overrides: Partial<EnvironmentMachine> = {}): EnvironmentMachine => ({
  ...initialEnvironment({ record: ENV_A }),
  presence: { kind: "present", origin: "https://zcp-1-8080.prg1.zerops.app" },
  container: { level: "ready" },
  readySeen: true,
  ...overrides,
});

/** What the driver keeps for the placeholder row's own target: nothing known there. */
const NOBODY: EnvironmentMachine = {
  ...initialEnvironment({ record: null }),
  presence: { kind: "unknown" },
};

const NO_INDEX: DescriptorIndex = {
  serving: new Map(),
  reported: new Map(),
};

describe("rowTarget — the Mate a listing row stands for", () => {
  it.each<{
    readonly case: string;
    readonly key: string;
    readonly machines: ReadonlyArray<readonly [string, EnvironmentMachine]>;
    readonly target: string | undefined;
  }>([
    {
      case: "a row naming its target: that target, machine or not",
      key: KEY,
      machines: [],
      target: KEY,
    },
    {
      case: "the project's row, its Mate's machine holding a credential",
      key: PROJECT,
      machines: [
        [PROJECT, NOBODY],
        [KEY, machine({ credential: HELD })],
      ],
      target: KEY,
    },
    {
      case: "the project's row, its Mate's machine remembering an environment",
      key: PROJECT,
      machines: [
        [PROJECT, NOBODY],
        [KEY, machine()],
      ],
      target: KEY,
    },
    {
      case: "the project's row, the one holding before one only remembering",
      key: PROJECT,
      machines: [
        ["project-1:service-0", machine()],
        [KEY, machine({ credential: HELD })],
      ],
      target: KEY,
    },
    {
      case: "the project's row, another project's Mate never its own",
      key: PROJECT,
      machines: [
        [PROJECT, NOBODY],
        ["project-10:service-1", machine({ credential: HELD })],
      ],
      target: undefined,
    },
    {
      case: "the project's row, nothing of its Mate known",
      key: PROJECT,
      machines: [[PROJECT, NOBODY]],
      target: undefined,
    },
  ])("$case", ({ key, machines, target }) => {
    expect(rowTarget({ key, projectId: PROJECT, machines: new Map(machines) })).toBe(target);
  });
});

describe("mateLink — what a door opens of a Mate, and what its own view waits for", () => {
  it.each<{
    readonly case: string;
    readonly key: string;
    readonly machines: ReadonlyArray<readonly [string, EnvironmentMachine]>;
    readonly registered: ReadonlyArray<EnvironmentId>;
    readonly index?: DescriptorIndex;
    /**
     * What it opens and waits for; its failures since it last connected are none, and — its
     * container found ready and nothing wanting its link, as its machine here has it unless said
     * — it has answered.
     */
    readonly link: Omit<MateLink, "failuresSinceConnect" | "errorsSinceConnect" | "answered"> & {
      readonly failuresSinceConnect?: number;
      readonly errorsSinceConnect?: number;
      readonly answered?: boolean;
    };
  }>([
    {
      case: "held, connected and registered: its conversation opens",
      key: KEY,
      machines: [[KEY, machine({ credential: HELD, link: CONNECTED })]],
      registered: [ENV_A],
      link: {
        key: KEY,
        environmentId: ENV_A,
        reachability: { kind: "ready", notice: null },
      },
    },
    {
      case: "the project's row while its services are unread: its Mate's conversation opens",
      key: PROJECT,
      machines: [
        [PROJECT, NOBODY],
        [KEY, machine({ credential: HELD, link: CONNECTED })],
      ],
      registered: [ENV_A],
      link: {
        key: KEY,
        environmentId: ENV_A,
        reachability: { kind: "ready", notice: null },
      },
    },
    {
      case: "reconnecting on its record after its session ended: still its conversation",
      key: KEY,
      machines: [[KEY, machine({ credential: { kind: "none", reconnect: true } })]],
      registered: [ENV_A],
      link: { key: KEY, environmentId: ENV_A, reachability: { kind: "reconnecting" } },
    },
    {
      case: "held while the registry has not taken it yet: its own view waits",
      key: KEY,
      machines: [[KEY, machine({ credential: { ...HELD, installed: false } })]],
      registered: [],
      link: {
        key: KEY,
        environmentId: undefined,
        reachability: { kind: "connecting", waitingOn: "exchange" },
      },
    },
    {
      case: "never exchanged in this tab: its own view connects it",
      key: KEY,
      machines: [[KEY, { ...machine(), record: null }]],
      registered: [],
      link: {
        key: KEY,
        environmentId: undefined,
        reachability: { kind: "connecting", waitingOn: "exchange" },
      },
    },
    {
      case: "found gone: nothing to open, and why",
      key: KEY,
      machines: [
        [
          KEY,
          machine({
            presence: { kind: "gone", evidence: "direct-not-found" },
            credential: { kind: "retired", evidence: "direct-not-found" },
          }),
        ],
      ],
      registered: [ENV_A],
      link: {
        key: KEY,
        environmentId: undefined,
        reachability: { kind: "gone", because: "direct-not-found" },
      },
    },
    {
      case: "its origin now reporting another environment: replaced",
      key: KEY,
      machines: [[KEY, machine({ credential: { kind: "none", reconnect: false } })]],
      registered: [ENV_A],
      index: { ...NO_INDEX, reported: new Map([[KEY, ENV_B]]) },
      link: { key: KEY, environmentId: undefined, reachability: { kind: "replaced", by: ENV_B } },
    },
    {
      case: "failing since it last connected: how often, for its arrival",
      key: KEY,
      machines: [[KEY, { ...machine(), record: null, failuresSinceConnect: 2 }]],
      registered: [],
      link: {
        key: KEY,
        environmentId: undefined,
        reachability: { kind: "connecting", waitingOn: "exchange" },
        failuresSinceConnect: 2,
      },
    },
    {
      case: "its link lost since it connected: it has answered, whatever it waits for now",
      key: KEY,
      machines: [
        [
          KEY,
          machine({
            credential: { kind: "none", reconnect: true },
            linkLostAt: { wall: 5_000, mono: 5_000 },
          }),
        ],
      ],
      registered: [ENV_A],
      link: {
        key: KEY,
        environmentId: ENV_A,
        reachability: { kind: "reconnecting" },
        linkLostAt: 5_000,
      },
    },
    {
      case: "its container still booting, its link never made: it has not answered",
      key: KEY,
      machines: [
        [
          KEY,
          {
            ...machine({ container: { level: "booting", overdue: false }, readySeen: false }),
            record: null,
          },
        ],
      ],
      registered: [],
      link: {
        key: KEY,
        environmentId: undefined,
        reachability: { kind: "container", container: { level: "booting", overdue: false } },
        answered: false,
      },
    },
    {
      case: "its container booting after its link connected and dropped: it has answered",
      key: KEY,
      machines: [
        [
          KEY,
          machine({
            container: { level: "booting", overdue: false },
            credential: { kind: "none", reconnect: true },
            linkLostAt: { wall: 5_000, mono: 5_000 },
          }),
        ],
      ],
      registered: [ENV_A],
      link: {
        linkLostAt: 5_000,
        key: KEY,
        environmentId: ENV_A,
        reachability: { kind: "container", container: { level: "booting", overdue: false } },
      },
    },
    {
      case: "found ready, its link wanted and being made: not answered until it connects",
      key: KEY,
      machines: [
        [
          KEY,
          {
            ...machine({
              guards: { ...IDLE_GUARDS, want: true },
              credential: {
                kind: "exchanging",
                attempt: 1,
                deadline: { wall: 30_000, mono: 30_000 },
                reconnect: false,
              },
            }),
            record: null,
          },
        ],
      ],
      registered: [],
      link: {
        key: KEY,
        environmentId: undefined,
        reachability: { kind: "connecting", waitingOn: "exchange" },
        answered: false,
      },
    },
    {
      case: "found ready, then booting again, nothing wanting its link: it has answered",
      key: KEY,
      machines: [
        [KEY, { ...machine({ container: { level: "booting", overdue: false } }), record: null }],
      ],
      registered: [],
      link: {
        key: KEY,
        environmentId: undefined,
        reachability: { kind: "container", container: { level: "booting", overdue: false } },
      },
    },
    {
      case: "failing with errors its server answered: how many, for its arrival",
      key: KEY,
      machines: [
        [KEY, { ...machine(), record: null, failuresSinceConnect: 4, errorsSinceConnect: 3 }],
      ],
      registered: [],
      link: {
        key: KEY,
        environmentId: undefined,
        reachability: { kind: "connecting", waitingOn: "exchange" },
        failuresSinceConnect: 4,
        errorsSinceConnect: 3,
      },
    },
    {
      case: "no machine names it yet (the stage not bound)",
      key: KEY,
      machines: [],
      registered: [ENV_A],
      link: { key: KEY, environmentId: undefined, reachability: null, answered: false },
    },
  ])("$case", ({ key, machines, registered, index, link }) => {
    expect(
      mateLink({
        key,
        projectId: PROJECT,
        machines: new Map(machines),
        index: index ?? NO_INDEX,
        registered: new Set(registered),
      }),
    ).toEqual({ failuresSinceConnect: 0, errorsSinceConnect: 0, answered: true, ...link });
  });
});
