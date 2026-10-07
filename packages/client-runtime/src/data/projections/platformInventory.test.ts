import { expect, it } from "vite-plus/test";
import { liveProjects } from "../__fixtures__/account.ts";
import { emptyAccount } from "../model.ts";
import { reduceAccount, type AccountInput } from "../reducer.ts";
import { projectsScope } from "../families/project.ts";
import { readsOfState } from "../store.ts";
import { platformInventory } from "./platformInventory.ts";

const viewer = { id: "org", name: "Org", membershipId: "member", roleCode: "ADMIN" };
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
    name: "outage retains facts",
    inputs: [
      ...liveProjects("org", [{ id: "p" }]),
      { kind: "stream", key: projectsScope("org"), now: 0, event: { kind: "parent-lost" } },
    ],
    projects: ["p"],
    denied: [],
    read: "read",
    trouble: "retrying",
  },
  {
    name: "owner denial",
    inputs: [
      ...liveProjects("org", [{ id: "p" }]),
      { kind: "access", family: "project", id: "p", access: "denied" },
    ],
    projects: [],
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
