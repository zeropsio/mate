import { expect, it } from "vite-plus/test";
import { liveProjects, projectValue, zeropsVersion } from "../__fixtures__/account.ts";
import { emptyAccount } from "../model.ts";
import { reduceAccount, type AccountInput } from "../reducer.ts";
import { projectsScope } from "../families/project.ts";
import { readsOfState } from "../store.ts";
import type { StreamEvent } from "../streamMachine.ts";
import { pastGrace } from "../__fixtures__/account.ts";
import { platformInventory } from "./platformInventory.ts";

const viewer = { id: "org", name: "Org", membershipId: "member", roleCode: "ADMIN" };

it.each([
  { older: "BASIC_USER", newer: "NO_ACCESS", projects: [], denied: ["p"] },
  { older: "NO_ACCESS", newer: "BASIC_USER", projects: ["p"], denied: [] },
])(
  "shows a project only when its newest owner role permits it, regardless of answer order ($older → $newer)",
  ({ older, newer, projects, denied }) => {
    const answer = (roleCode: string, version: number): AccountInput => ({
      kind: "rows",
      scope: projectsScope("org"),
      generation: 1,
      method: "push",
      via: "zerops-realtime",
      rows: [
        {
          family: "project",
          id: "p",
          value: projectValue({
            id: "p",
            userRoles: [{ clientUserId: "member", roleCode }],
          }),
          revision: zeropsVersion(version),
        },
      ],
    });
    for (const answers of [
      [answer(older, 2), answer(newer, 3)],
      [answer(newer, 3), answer(older, 2)],
    ]) {
      const state = [...liveProjects("org", [{ id: "p" }]), ...answers].reduce(
        (held, input) => reduceAccount(held, input).state,
        emptyAccount,
      );
      const shown = platformInventory.derive(readsOfState(state), { orgId: "org", viewer });
      expect(shown.projects.map(({ id }) => id)).toEqual(projects);
      expect(shown.denied).toEqual(denied);
    }
  },
);

const deniedProject: ReadonlyArray<AccountInput> = [
  ...liveProjects("org", [{ id: "p" }]),
  { kind: "access", family: "project", id: "p", access: "denied" },
];
const projectBaseline = (restored: boolean): ReadonlyArray<AccountInput> => [
  { kind: "baseline-begin", scope: projectsScope("org"), generation: 1 },
  {
    kind: "baseline-commit",
    scope: projectsScope("org"),
    generation: 1,
    via: "zerops-realtime",
    members: restored ? ["p"] : [],
    rows: restored
      ? [
          {
            family: "project",
            id: "p",
            value: projectValue({ id: "p" }),
            revision: zeropsVersion(1),
          },
        ]
      : [],
  },
];
/** The organization's Zerops link, as its stream machine hears it. */
const link = (event: StreamEvent, now = 0): AccountInput => ({
  kind: "stream",
  key: "zerops:org",
  now,
  event,
});
const failed = (message = "closed"): AccountInput =>
  link({ kind: "fault", jitter: 0, fault: { outcome: "transient", message } });
const firstConnect: ReadonlyArray<AccountInput> = [
  link({ kind: "demand", demanded: true }),
  {
    kind: "stream",
    key: projectsScope("org"),
    now: 0,
    event: { kind: "demand", demanded: true },
  },
];
const lostFromLive: ReadonlyArray<AccountInput> = [
  ...liveProjects("org", [{ id: "p" }]),
  failed(),
  link({ kind: "retry-due" }, 1_000),
  failed("503"),
];
it.each([
  { name: "unread", inputs: [], projects: [], denied: [], read: "unread", trouble: null },
  {
    name: "One failed first attempt inside the grace says nothing",
    inputs: [...firstConnect, failed()],
    projects: [],
    denied: [],
    read: "reading",
    trouble: null,
  },
  {
    name: "A first connect failing a second time says Zerops is not answering",
    inputs: [...firstConnect, failed(), link({ kind: "retry-due" }, 1_000), failed()],
    projects: [],
    denied: [],
    read: "reading",
    trouble: "retrying",
  },
  {
    name: "A first attempt that waited out its deadline says Zerops is not answering",
    inputs: [...firstConnect, link({ kind: "deadline" }, 10_000)],
    projects: [],
    denied: [],
    read: "reading",
    trouble: "retrying",
  },
  {
    name: "A reconnect failing inside its grace says nothing",
    inputs: lostFromLive,
    projects: ["p"],
    denied: [],
    read: "read",
    trouble: null,
  },
  {
    name: "complete",
    inputs: liveProjects("org", [{ id: "p" }]),
    projects: ["p"],
    denied: [],
    read: "read",
    trouble: null,
  },
  {
    name: "partial coverage",
    inputs: [
      {
        kind: "stream",
        key: projectsScope("org"),
        now: 0,
        event: { kind: "demand", demanded: true },
      },
      { kind: "stream", key: projectsScope("org"), now: 0, event: { kind: "attempt" } },
      { kind: "stream", key: projectsScope("org"), now: 0, event: { kind: "handshake" } },
      { kind: "baseline-begin", scope: projectsScope("org"), generation: 1 },
    ],
    projects: [],
    denied: [],
    read: "reading",
    trouble: null,
  },
  {
    name: "transport recovery retains facts without an outage verdict",
    inputs: [
      ...liveProjects("org", [{ id: "p" }]),
      { kind: "stream", key: projectsScope("org"), now: 0, event: { kind: "parent-lost" } },
    ],
    projects: ["p"],
    denied: [],
    read: "read",
    trouble: null,
  },
  {
    name: "owner denial remains visible to protection guards",
    inputs: [
      ...liveProjects("org", [{ id: "p" }]),
      { kind: "access", family: "project", id: "p", access: "denied" },
    ],
    projects: [],
    denied: ["p"],
    read: "read",
    trouble: null,
  },
  {
    name: "denial survives an outage and an empty authoritative baseline",
    inputs: [
      ...deniedProject,
      { kind: "stream", key: projectsScope("org"), now: 0, event: { kind: "parent-lost" } },
      ...projectBaseline(false),
    ],
    projects: [],
    denied: ["p"],
    read: "read",
    trouble: null,
  },
  {
    name: "a newer realtime row cannot reopen a revoked project",
    inputs: [
      ...deniedProject,
      {
        kind: "rows",
        scope: projectsScope("org"),
        generation: 1,
        method: "push",
        via: "zerops-realtime",
        rows: [
          {
            family: "project",
            id: "p",
            value: projectValue({ id: "p" }),
            revision: zeropsVersion(2),
          },
        ],
      },
    ],
    projects: [],
    denied: ["p"],
    read: "read",
    trouble: null,
  },
  {
    name: "an explicit owner baseline restores access at the same revision",
    inputs: [...deniedProject, ...projectBaseline(true)],
    projects: ["p"],
    denied: [],
    read: "read",
    trouble: null,
  },
  {
    name: "another organization's denial does not enter this inventory",
    inputs: [
      ...liveProjects("other", [{ id: "other-project" }]),
      { kind: "access", family: "project", id: "other-project", access: "denied" },
      ...liveProjects("org", [{ id: "p" }]),
    ],
    projects: ["p"],
    denied: [],
    read: "read",
    trouble: null,
  },
  {
    name: "A reconnect still failing past its grace says Zerops is not answering",
    inputs: lostFromLive,
    pastGrace: true,
    projects: ["p"],
    denied: [],
    read: "read",
    trouble: "retrying",
  },
  {
    name: "definitive refusal retains facts and names manual recovery",
    inputs: [
      ...liveProjects("org", [{ id: "p" }]),
      {
        kind: "stream",
        key: projectsScope("org"),
        now: 0,
        event: {
          kind: "fault",
          jitter: 0,
          fault: { outcome: "definitive-refusal", message: "No." },
        },
      },
    ],
    projects: ["p"],
    denied: [],
    read: "read",
    trouble: "refused",
  },
] satisfies ReadonlyArray<{
  name: string;
  inputs: ReadonlyArray<AccountInput>;
  projects: string[];
  denied: string[];
  read: string;
  trouble: "retrying" | "refused" | null;
  pastGrace?: boolean;
}>)("$name", (entry) => {
  const inputs: ReadonlyArray<AccountInput> = entry.inputs;
  const reduced = inputs.reduce((state, input) => reduceAccount(state, input).state, emptyAccount);
  const state = entry.pastGrace === true ? pastGrace(reduced) : reduced;
  const result = platformInventory.derive(readsOfState(state), { orgId: "org", viewer });
  expect(result.projects.map(({ id }) => id)).toEqual(entry.projects);
  expect(result.denied).toEqual(entry.denied);
  expect(result.read).toBe(entry.read);
  expect(result.trouble).toBe(entry.trouble);
});
