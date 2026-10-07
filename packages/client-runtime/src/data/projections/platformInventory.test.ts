import { expect, it } from "vite-plus/test";
import { liveProjects, projectValue, zeropsVersion } from "../__fixtures__/account.ts";
import { emptyAccount } from "../model.ts";
import { reduceAccount, type AccountInput } from "../reducer.ts";
import { projectsScope } from "../families/project.ts";
import { readsOfState } from "../store.ts";
import { platformInventory } from "./platformInventory.ts";

const viewer = { id: "org", name: "Org", membershipId: "member", roleCode: "ADMIN" };
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
it.each([
  { name: "unread", inputs: [], projects: [], denied: [], read: "unread", trouble: null },
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
}>)("$name", (entry) => {
  const inputs: ReadonlyArray<AccountInput> = entry.inputs;
  const state = inputs.reduce((state, input) => reduceAccount(state, input).state, emptyAccount);
  const result = platformInventory.derive(readsOfState(state), { orgId: "org", viewer });
  expect(result.projects.map(({ id }) => id)).toEqual(entry.projects);
  expect(result.denied).toEqual(entry.denied);
  expect(result.read).toBe(entry.read);
  expect(result.trouble).toBe(entry.trouble);
});
